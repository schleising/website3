"""2026 World Cup knockout bracket ordering and feeder paths."""

from __future__ import annotations

import copy
import unittest

from website.football.models import Match, TableItem, Team
from website.football.world_cup_utils import (
    WC_2026_KNOCKOUT_BRACKET_ORDER,
    WC_2026_KNOCKOUT_FIXTURES,
    _fixture_number_from_winner_match_label,
    order_knockout_round_by_fixture_feeders,
    order_knockout_stages_for_bracket,
    resolve_2026_knockout_fixture_maps,
)

_LAST_32_STAGE: tuple[str, str, str] = ("LAST_32", "round-of-32", "Round of 32")
_LAST_16_STAGE: tuple[str, str, str] = ("LAST_16", "round-of-16", "Round of 16")

_KNOCKOUT_FEEDER_STAGES = (
    ("LAST_32", "LAST_16"),
    ("LAST_16", "QUARTER_FINALS"),
    ("QUARTER_FINALS", "SEMI_FINALS"),
    ("SEMI_FINALS", "FINAL"),
)

_MATCH_TEMPLATE: dict = {
    "area": {"id": 1, "name": "World", "code": "INT", "flag": None},
    "competition": {
        "id": 2000,
        "name": "FIFA World Cup",
        "code": "WC",
        "type": "CUP",
        "emblem": "",
    },
    "season": {
        "id": 1,
        "startDate": "2026-06-11",
        "endDate": "2026-07-19",
        "currentMatchday": 1,
        "winner": None,
    },
    "status": "SCHEDULED",
    "minute": None,
    "injuryTime": None,
    "matchday": None,
    "stage": "LAST_32",
    "lastUpdated": "2026-06-28T12:00:00Z",
    "score": {
        "winner": None,
        "duration": "REGULAR",
        "fullTime": {"home": None, "away": None},
        "halfTime": {"home": None, "away": None},
    },
    "odds": {"msg": ""},
    "referees": [],
}


def _feeder_fixture_numbers(stage: str, fixture_number: int) -> tuple[int, int]:
    home_label, away_label = WC_2026_KNOCKOUT_FIXTURES[stage][fixture_number]
    home_fixture = _fixture_number_from_winner_match_label(home_label)
    away_fixture = _fixture_number_from_winner_match_label(away_label)
    assert home_fixture is not None
    assert away_fixture is not None
    return home_fixture, away_fixture


def _knockout_match(
    *,
    fixture: int,
    stage: str,
    utc_date: str,
    home_team: dict | None = None,
    away_team: dict | None = None,
) -> Match:
    payload = copy.deepcopy(_MATCH_TEMPLATE)
    payload.update(
        {
            "id": fixture,
            "stage": stage,
            "utcDate": utc_date,
            "homeTeam": home_team
            or {"id": fixture * 10, "name": f"Winner Match {fixture}", "shortName": f"W{fixture}"},
            "awayTeam": away_team or {"id": fixture * 10 + 1, "name": "Opponent", "shortName": "OPP"},
        }
    )
    return Match.model_validate(payload)


def _table_row(position: int, team_id: int, name: str) -> TableItem:
    return TableItem(
        position=position,
        team=Team(id=team_id, name=name, short_name=name),
        played_games=3,
        won=0,
        draw=0,
        lost=0,
        points=0,
        goals_for=0,
        goals_against=0,
        goal_difference=0,
    )


class WorldCupKnockoutBracketTests(unittest.TestCase):
    def test_bracket_order_pairs_match_next_round_feeders(self) -> None:
        for prev_stage, next_stage in _KNOCKOUT_FEEDER_STAGES:
            with self.subTest(prev_stage=prev_stage, next_stage=next_stage):
                prev_order = WC_2026_KNOCKOUT_BRACKET_ORDER[prev_stage]
                next_order = WC_2026_KNOCKOUT_BRACKET_ORDER[next_stage]

                for next_index, next_fixture in enumerate(next_order):
                    expected_home, expected_away = _feeder_fixture_numbers(
                        next_stage,
                        next_fixture,
                    )
                    slot_start = 2 * next_index
                    actual_pair = prev_order[slot_start : slot_start + 2]
                    self.assertEqual(actual_pair, (expected_home, expected_away))

    def test_last_16_official_pairings(self) -> None:
        last_16 = WC_2026_KNOCKOUT_FIXTURES["LAST_16"]
        self.assertEqual(last_16[89], ("Winner Match 74", "Winner Match 77"))
        self.assertEqual(last_16[90], ("Winner Match 73", "Winner Match 75"))
        self.assertEqual(last_16[91], ("Winner Match 76", "Winner Match 78"))
        self.assertEqual(last_16[92], ("Winner Match 79", "Winner Match 80"))
        self.assertEqual(last_16[93], ("Winner Match 83", "Winner Match 84"))
        self.assertEqual(last_16[94], ("Winner Match 81", "Winner Match 82"))
        self.assertEqual(last_16[95], ("Winner Match 86", "Winner Match 88"))
        self.assertEqual(last_16[96], ("Winner Match 85", "Winner Match 87"))

    def test_order_knockout_round_by_fixture_feeders_aligns_last_32(self) -> None:
        last_32_matches = [
            _knockout_match(
                fixture=fixture,
                stage="LAST_32",
                utc_date=f"2026-06-28T{fixture % 24:02d}:00:00Z",
            )
            for fixture in range(73, 89)
        ]
        last_16_matches = [
            _knockout_match(
                fixture=fixture,
                stage="LAST_16",
                utc_date=f"2026-07-04T{fixture % 24:02d}:00:00Z",
            )
            for fixture in (89, 90, 93, 94, 91, 92, 95, 96)
        ]

        ordered = order_knockout_round_by_fixture_feeders(
            last_32_matches,
            last_16_matches,
            prev_stage="LAST_32",
            next_stage="LAST_16",
        )
        self.assertIsNotNone(ordered)
        assert ordered is not None
        self.assertEqual(
            [match.id for match in ordered],
            list(WC_2026_KNOCKOUT_BRACKET_ORDER["LAST_32"]),
        )

    def test_resolve_confirmed_last_32_matches_from_group_standings(self) -> None:
        group_tables = {
            "e": [
                _table_row(1, 801, "Germany"),
                _table_row(2, 802, "Runner E"),
                _table_row(3, 803, "Third E"),
                _table_row(4, 804, "Fourth E"),
            ],
            "d": [
                _table_row(1, 805, "Winner D"),
                _table_row(2, 806, "Runner D"),
                _table_row(3, 807, "Paraguay"),
                _table_row(4, 808, "Fourth D"),
            ],
        }
        last_32_matches = [
            _knockout_match(
                fixture=7401,
                stage="LAST_32",
                utc_date="2026-06-29T20:30:00Z",
                home_team={"id": 801, "name": "Germany", "shortName": "GER"},
                away_team={"id": 807, "name": "Paraguay", "shortName": "PAR"},
            ),
        ]
        stage_matches = [
            (_LAST_32_STAGE, last_32_matches),
        ]
        fixture_maps = resolve_2026_knockout_fixture_maps(
            stage_matches,
            group_tables,
        )
        self.assertEqual(fixture_maps["LAST_32"][74].id, 7401)

    def test_order_stages_with_confirmed_last_32_and_placeholder_last_16(self) -> None:
        group_tables = {
            "a": [
                _table_row(1, 901, "Winner A"),
                _table_row(2, 902, "South Africa"),
                _table_row(3, 903, "Third A"),
                _table_row(4, 904, "Fourth A"),
            ],
            "b": [
                _table_row(1, 911, "Winner B"),
                _table_row(2, 912, "Canada"),
                _table_row(3, 913, "Third B"),
                _table_row(4, 914, "Fourth B"),
            ],
            "e": [
                _table_row(1, 801, "Germany"),
                _table_row(2, 802, "Runner E"),
                _table_row(3, 803, "Third E"),
                _table_row(4, 804, "Fourth E"),
            ],
            "d": [
                _table_row(1, 805, "Winner D"),
                _table_row(2, 806, "Runner D"),
                _table_row(3, 807, "Paraguay"),
                _table_row(4, 808, "Fourth D"),
            ],
            "i": [
                _table_row(1, 821, "France"),
                _table_row(2, 822, "Runner I"),
                _table_row(3, 823, "Third I"),
                _table_row(4, 824, "Fourth I"),
            ],
            "f": [
                _table_row(1, 831, "Winner F"),
                _table_row(2, 832, "Runner F"),
                _table_row(3, 833, "Sweden"),
                _table_row(4, 834, "Fourth F"),
            ],
        }
        last_32_matches = [
            _knockout_match(
                fixture=7301,
                stage="LAST_32",
                utc_date="2026-06-28T19:00:00Z",
                home_team={"id": 902, "name": "South Africa", "shortName": "RSA"},
                away_team={"id": 912, "name": "Canada", "shortName": "CAN"},
            ),
            _knockout_match(
                fixture=7401,
                stage="LAST_32",
                utc_date="2026-06-29T20:30:00Z",
                home_team={"id": 801, "name": "Germany", "shortName": "GER"},
                away_team={"id": 807, "name": "Paraguay", "shortName": "PAR"},
            ),
            _knockout_match(
                fixture=7701,
                stage="LAST_32",
                utc_date="2026-06-30T21:00:00Z",
                home_team={"id": 821, "name": "France", "shortName": "FRA"},
                away_team={"id": 833, "name": "Sweden", "shortName": "SWE"},
            ),
        ]
        last_16_matches = [
            _knockout_match(
                fixture=8901,
                stage="LAST_16",
                utc_date="2026-07-04T21:00:00Z",
                home_team={"name": "Winner Match 74", "shortName": "W74"},
                away_team={"name": "Winner Match 77", "shortName": "W77"},
            ),
            _knockout_match(
                fixture=9001,
                stage="LAST_16",
                utc_date="2026-07-04T16:00:00Z",
                home_team={"name": "Winner Match 73", "shortName": "W73"},
                away_team={"name": "Winner Match 75", "shortName": "W75"},
            ),
        ]
        stage_matches = [
            (_LAST_32_STAGE, last_32_matches),
            (_LAST_16_STAGE, last_16_matches),
        ]
        fixture_maps = resolve_2026_knockout_fixture_maps(
            stage_matches,
            group_tables,
        )
        ordered = order_knockout_stages_for_bracket(
            stage_matches,
            fixture_maps=fixture_maps,
        )
        ordered_last_32 = ordered[0][1]
        self.assertEqual(ordered_last_32[0].id, 7401)
        self.assertEqual(ordered_last_32[1].id, 7701)
        self.assertEqual(ordered_last_32[2].id, 7301)


if __name__ == "__main__":
    unittest.main()
