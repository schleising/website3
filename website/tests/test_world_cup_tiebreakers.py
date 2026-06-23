from __future__ import annotations

import copy
import unittest
from datetime import datetime, timezone

from website.football.models import Match, TableItem, Team
from website.football.world_cup_db import (
    _apply_current_edition_qualification_labels,
    _apply_guaranteed_qualification_labels,
)
from website.football.world_cup_utils import sort_group_table_rows

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
    "status": "FINISHED",
    "minute": 90,
    "injuryTime": None,
    "matchday": 1,
    "stage": "GROUP_STAGE",
    "lastUpdated": "2026-06-11T12:00:00Z",
    "score": {
        "winner": "HOME_TEAM",
        "duration": "REGULAR",
        "fullTime": {"home": 0, "away": 0},
        "halfTime": {"home": 0, "away": 0},
    },
    "odds": {"msg": ""},
    "referees": [],
}


def _team(team_id: int, name: str) -> Team:
    return Team(id=team_id, name=name, short_name=name)


def _team_tla(team: Team) -> str:
    return str(team.name or team.short_name or "")[:3].upper()


def _table_row(
    *,
    position: int,
    team: Team,
    played_games: int,
    won: int,
    draw: int,
    lost: int,
    goals_for: int,
    goals_against: int,
) -> TableItem:
    return TableItem(
        position=position,
        team=team,
        played_games=played_games,
        won=won,
        draw=draw,
        lost=lost,
        points=(won * 3) + draw,
        goals_for=goals_for,
        goals_against=goals_against,
        goal_difference=goals_for - goals_against,
    )


def _group_match(
    *,
    match_id: int,
    group: str,
    home: Team,
    away: Team,
    home_score: int,
    away_score: int,
    finished: bool = True,
) -> Match:
    payload = copy.deepcopy(_MATCH_TEMPLATE)
    score_payload = (
        {
            "winner": (
                "HOME_TEAM"
                if home_score > away_score
                else "AWAY_TEAM"
                if away_score > home_score
                else "DRAW"
            ),
            "duration": "REGULAR",
            "fullTime": {"home": home_score, "away": away_score},
            "halfTime": {"home": home_score, "away": away_score},
        }
        if finished
        else {
            "winner": None,
            "duration": "REGULAR",
            "fullTime": {"home": None, "away": None},
            "halfTime": {"home": None, "away": None},
        }
    )
    payload.update(
        {
            "id": match_id,
            "utcDate": datetime(2026, 6, 11, 18, 0, tzinfo=timezone.utc),
            "status": "FINISHED" if finished else "SCHEDULED",
            "group": group,
            "homeTeam": {
                "id": home.id,
                "name": home.name,
                "shortName": home.short_name,
                "tla": _team_tla(home),
                "crest": "",
            },
            "awayTeam": {
                "id": away.id,
                "name": away.name,
                "shortName": away.short_name,
                "tla": _team_tla(away),
                "crest": "",
            },
            "score": score_payload,
        }
    )
    return Match.model_validate(payload)


class WorldCup2026HeadToHeadSortTests(unittest.TestCase):
    def test_two_way_tie_uses_head_to_head_before_group_goal_difference(self) -> None:
        usa = _team(1, "USA")
        mexico = _team(2, "Mexico")
        canada = _team(3, "Canada")
        table = [
            _table_row(
                position=1,
                team=mexico,
                played_games=2,
                won=1,
                draw=1,
                lost=0,
                goals_for=5,
                goals_against=2,
            ),
            _table_row(
                position=2,
                team=usa,
                played_games=2,
                won=1,
                draw=1,
                lost=0,
                goals_for=3,
                goals_against=2,
            ),
            _table_row(
                position=3,
                team=canada,
                played_games=2,
                won=0,
                draw=0,
                lost=2,
                goals_for=1,
                goals_against=5,
            ),
        ]
        matches = [
            _group_match(
                match_id=1,
                group="GROUP_A",
                home=usa,
                away=mexico,
                home_score=2,
                away_score=1,
            ),
        ]

        sorted_table = sort_group_table_rows(
            table,
            "2026",
            group_slug="a",
            edition_matches=matches,
        )

        self.assertEqual(sorted_table[0].team.id, usa.id)
        self.assertEqual(sorted_table[1].team.id, mexico.id)

    def test_three_way_tie_uses_head_to_head_mini_league(self) -> None:
        team_a = _team(1, "Alpha")
        team_b = _team(2, "Bravo")
        team_c = _team(3, "Charlie")
        team_d = _team(4, "Delta")
        table = [
            _table_row(
                position=1,
                team=team_b,
                played_games=2,
                won=1,
                draw=1,
                lost=0,
                goals_for=4,
                goals_against=2,
            ),
            _table_row(
                position=2,
                team=team_c,
                played_games=2,
                won=1,
                draw=1,
                lost=0,
                goals_for=3,
                goals_against=2,
            ),
            _table_row(
                position=3,
                team=team_a,
                played_games=2,
                won=1,
                draw=1,
                lost=0,
                goals_for=3,
                goals_against=3,
            ),
            _table_row(
                position=4,
                team=team_d,
                played_games=2,
                won=0,
                draw=0,
                lost=2,
                goals_for=1,
                goals_against=4,
            ),
        ]
        matches = [
            _group_match(
                match_id=1,
                group="GROUP_A",
                home=team_a,
                away=team_b,
                home_score=2,
                away_score=0,
            ),
            _group_match(
                match_id=2,
                group="GROUP_A",
                home=team_b,
                away=team_c,
                home_score=1,
                away_score=0,
            ),
            _group_match(
                match_id=3,
                group="GROUP_A",
                home=team_c,
                away=team_a,
                home_score=1,
                away_score=0,
            ),
        ]

        sorted_table = sort_group_table_rows(
            table,
            "2026",
            group_slug="a",
            edition_matches=matches,
        )

        self.assertEqual(
            [row.team.id for row in sorted_table[:3]],
            [team_a.id, team_c.id, team_b.id],
        )


class WorldCup2026QualificationWithHeadToHeadTests(unittest.TestCase):
    def test_completed_group_marks_top_two_as_qualified(self) -> None:
        table = [
            _table_row(
                position=1,
                team=_team(1, "Leader"),
                played_games=3,
                won=2,
                draw=1,
                lost=0,
                goals_for=4,
                goals_against=2,
            ),
            _table_row(
                position=2,
                team=_team(2, "Runner"),
                played_games=3,
                won=1,
                draw=2,
                lost=0,
                goals_for=3,
                goals_against=2,
            ),
            _table_row(
                position=3,
                team=_team(3, "Third"),
                played_games=3,
                won=1,
                draw=0,
                lost=2,
                goals_for=3,
                goals_against=4,
            ),
            _table_row(
                position=4,
                team=_team(4, "Fourth"),
                played_games=3,
                won=0,
                draw=1,
                lost=2,
                goals_for=2,
                goals_against=4,
            ),
        ]

        _apply_guaranteed_qualification_labels(table)

        self.assertEqual(table[0].position_label, "Q")
        self.assertEqual(table[1].position_label, "Q")
        self.assertIsNone(table[2].position_label)

    def test_points_lock_still_marks_both_leaders_qualified_when_chasers_cannot_catch(
        self,
    ) -> None:
        leader = _team(1, "Leader")
        runner = _team(2, "Runner")
        third = _team(3, "Third")
        fourth = _team(4, "Fourth")
        table = [
            _table_row(
                position=1,
                team=leader,
                played_games=2,
                won=2,
                draw=0,
                lost=0,
                goals_for=4,
                goals_against=1,
            ),
            _table_row(
                position=2,
                team=runner,
                played_games=2,
                won=2,
                draw=0,
                lost=0,
                goals_for=3,
                goals_against=1,
            ),
            _table_row(
                position=3,
                team=third,
                played_games=2,
                won=0,
                draw=0,
                lost=2,
                goals_for=1,
                goals_against=4,
            ),
            _table_row(
                position=4,
                team=fourth,
                played_games=2,
                won=0,
                draw=0,
                lost=2,
                goals_for=0,
                goals_against=3,
            ),
        ]
        matches = [
            _group_match(
                match_id=1,
                group="GROUP_A",
                home=leader,
                away=runner,
                home_score=1,
                away_score=0,
            ),
        ]
        sorted_table = sort_group_table_rows(
            table,
            "2026",
            group_slug="a",
            edition_matches=matches,
        )

        _apply_guaranteed_qualification_labels(sorted_table)

        self.assertEqual(sorted_table[0].team.id, leader.id)
        self.assertEqual(sorted_table[0].position_label, "Q")
        self.assertEqual(sorted_table[1].position_label, "Q")
        self.assertIsNone(sorted_table[2].position_label)

    def test_close_three_way_tie_does_not_mark_anyone_qualified_early(self) -> None:
        team_a = _team(1, "Alpha")
        team_b = _team(2, "Bravo")
        team_c = _team(3, "Charlie")
        team_d = _team(4, "Delta")
        table = [
            _table_row(
                position=1,
                team=team_a,
                played_games=2,
                won=1,
                draw=1,
                lost=0,
                goals_for=3,
                goals_against=3,
            ),
            _table_row(
                position=2,
                team=team_b,
                played_games=2,
                won=1,
                draw=1,
                lost=0,
                goals_for=4,
                goals_against=2,
            ),
            _table_row(
                position=3,
                team=team_c,
                played_games=2,
                won=1,
                draw=0,
                lost=1,
                goals_for=2,
                goals_against=2,
            ),
            _table_row(
                position=4,
                team=team_d,
                played_games=2,
                won=0,
                draw=0,
                lost=2,
                goals_for=1,
                goals_against=3,
            ),
        ]
        matches = [
            _group_match(
                match_id=1,
                group="GROUP_A",
                home=team_a,
                away=team_b,
                home_score=2,
                away_score=0,
            ),
            _group_match(
                match_id=2,
                group="GROUP_A",
                home=team_b,
                away=team_c,
                home_score=1,
                away_score=0,
            ),
            _group_match(
                match_id=3,
                group="GROUP_A",
                home=team_c,
                away=team_a,
                home_score=1,
                away_score=0,
            ),
        ]
        sorted_table = sort_group_table_rows(
            table,
            "2026",
            group_slug="a",
            edition_matches=matches,
        )

        _apply_current_edition_qualification_labels({"a": sorted_table})

        self.assertIsNone(sorted_table[0].position_label)
        self.assertIsNone(sorted_table[1].position_label)

    def test_leader_clinches_when_head_to_head_beats_all_point_chasers(self) -> None:
        usa = _team(1, "USA")
        australia = _team(2, "Australia")
        paraguay = _team(3, "Paraguay")
        turkey = _team(4, "Turkey")
        table = [
            _table_row(
                position=1,
                team=usa,
                played_games=2,
                won=2,
                draw=0,
                lost=0,
                goals_for=6,
                goals_against=1,
            ),
            _table_row(
                position=2,
                team=australia,
                played_games=2,
                won=1,
                draw=0,
                lost=1,
                goals_for=3,
                goals_against=3,
            ),
            _table_row(
                position=3,
                team=paraguay,
                played_games=2,
                won=1,
                draw=0,
                lost=1,
                goals_for=2,
                goals_against=4,
            ),
            _table_row(
                position=4,
                team=turkey,
                played_games=2,
                won=0,
                draw=0,
                lost=2,
                goals_for=1,
                goals_against=4,
            ),
        ]
        matches = [
            _group_match(
                match_id=1,
                group="GROUP_D",
                home=usa,
                away=australia,
                home_score=2,
                away_score=1,
            ),
            _group_match(
                match_id=2,
                group="GROUP_D",
                home=usa,
                away=paraguay,
                home_score=4,
                away_score=0,
            ),
            _group_match(
                match_id=3,
                group="GROUP_D",
                home=australia,
                away=paraguay,
                home_score=0,
                away_score=0,
                finished=False,
            ),
            _group_match(
                match_id=4,
                group="GROUP_D",
                home=turkey,
                away=usa,
                home_score=0,
                away_score=0,
                finished=False,
            ),
        ]
        sorted_table = sort_group_table_rows(
            table,
            "2026",
            group_slug="d",
            edition_matches=matches,
        )

        _apply_guaranteed_qualification_labels(
            sorted_table,
            group_slug="d",
            group_matches=matches,
        )

        self.assertEqual(sorted_table[0].team.id, usa.id)
        self.assertEqual(sorted_table[0].position_label, "Q")
        self.assertIsNone(sorted_table[1].position_label)

    def test_points_tie_without_decisive_head_to_head_does_not_clinch_on_group_gd(
        self,
    ) -> None:
        canada = _team(1, "Canada")
        switzerland = _team(2, "Switzerland")
        bosnia = _team(3, "Bosnia-H.")
        qatar = _team(4, "Qatar")
        table = [
            _table_row(
                position=1,
                team=canada,
                played_games=2,
                won=1,
                draw=1,
                lost=0,
                goals_for=7,
                goals_against=1,
            ),
            _table_row(
                position=2,
                team=switzerland,
                played_games=2,
                won=1,
                draw=1,
                lost=0,
                goals_for=4,
                goals_against=1,
            ),
            _table_row(
                position=3,
                team=bosnia,
                played_games=2,
                won=0,
                draw=1,
                lost=1,
                goals_for=1,
                goals_against=4,
            ),
            _table_row(
                position=4,
                team=qatar,
                played_games=2,
                won=0,
                draw=1,
                lost=1,
                goals_for=1,
                goals_against=7,
            ),
        ]
        matches = [
            _group_match(
                match_id=1,
                group="GROUP_B",
                home=canada,
                away=switzerland,
                home_score=1,
                away_score=1,
            ),
            _group_match(
                match_id=2,
                group="GROUP_B",
                home=canada,
                away=bosnia,
                home_score=3,
                away_score=0,
            ),
            _group_match(
                match_id=3,
                group="GROUP_B",
                home=switzerland,
                away=qatar,
                home_score=2,
                away_score=0,
            ),
            _group_match(
                match_id=4,
                group="GROUP_B",
                home=bosnia,
                away=qatar,
                home_score=1,
                away_score=1,
                finished=False,
            ),
            _group_match(
                match_id=5,
                group="GROUP_B",
                home=canada,
                away=qatar,
                home_score=0,
                away_score=0,
                finished=False,
            ),
            _group_match(
                match_id=6,
                group="GROUP_B",
                home=switzerland,
                away=bosnia,
                home_score=0,
                away_score=0,
                finished=False,
            ),
        ]
        sorted_table = sort_group_table_rows(
            table,
            "2026",
            group_slug="b",
            edition_matches=matches,
        )

        _apply_guaranteed_qualification_labels(
            sorted_table,
            group_slug="b",
            group_matches=matches,
        )

        self.assertEqual(sorted_table[0].team.id, canada.id)
        self.assertIsNone(sorted_table[0].position_label)
        self.assertIsNone(sorted_table[1].position_label)


if __name__ == "__main__":
    unittest.main()
