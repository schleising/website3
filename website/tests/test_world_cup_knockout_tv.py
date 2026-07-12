"""UK TV station lookup for World Cup knockout match cards."""

from __future__ import annotations

import copy
import unittest

from website.football.models import Match, Team
from website.football.world_cup_utils import (
    _load_knockout_tv_kickoff_lookup,
    _load_knockout_tv_lookup,
    _normalise_tv_team_name,
    world_cup_knockout_tv_logo_label,
    world_cup_knockout_tv_logo_url,
    world_cup_knockout_tv_logos,
    world_cup_knockout_tv_station,
    world_cup_knockout_tv_stations,
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


def _knockout_match(
    *,
    stage: str,
    home: Team,
    away: Team,
    utc_date: str = "2026-06-28T19:00:00Z",
) -> Match:
    payload = copy.deepcopy(_MATCH_TEMPLATE)
    payload.update(
        {
            "id": 1,
            "stage": stage,
            "utcDate": utc_date,
            "homeTeam": home.model_dump(by_alias=True),
            "awayTeam": away.model_dump(by_alias=True),
        }
    )
    return Match.model_validate(payload)


class WorldCupKnockoutTvTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        _load_knockout_tv_lookup.cache_clear()
        _load_knockout_tv_kickoff_lookup.cache_clear()

    def test_csv_loads_round_of_32_broadcasters(self) -> None:
        lookup = _load_knockout_tv_lookup()
        self.assertEqual(len(lookup), 110)
        self.assertEqual(
            lookup[("LAST_32", frozenset({"south africa", "canada"}))],
            ("ITV",),
        )
        self.assertEqual(
            lookup[("LAST_32", frozenset({"germany", "paraguay"}))],
            ("BBC",),
        )

    def test_csv_loads_group_stage_broadcasters(self) -> None:
        lookup = _load_knockout_tv_lookup()
        self.assertEqual(
            lookup[("GROUP_STAGE", frozenset({"mexico", "south africa"}))],
            ("ITV",),
        )
        self.assertEqual(
            lookup[("GROUP_STAGE", frozenset({"czechia", "south korea"}))],
            ("ITV",),
        )
        self.assertEqual(
            lookup[("GROUP_STAGE", frozenset({"usa", "paraguay"}))],
            ("BBC",),
        )
        self.assertEqual(
            lookup[("GROUP_STAGE", frozenset({"germany", "curacao"}))],
            ("ITV",),
        )
        self.assertEqual(
            lookup[("GROUP_STAGE", frozenset({"portugal", "dr congo"}))],
            ("BBC",),
        )
        self.assertEqual(
            lookup[("GROUP_STAGE", frozenset({"spain", "cape verde"}))],
            ("ITV",),
        )

    def test_csv_loads_semi_final_broadcasters(self) -> None:
        lookup = _load_knockout_tv_lookup()
        self.assertEqual(
            lookup[("SEMI_FINALS", frozenset({"france", "spain"}))],
            ("ITV",),
        )
        self.assertEqual(
            lookup[("SEMI_FINALS", frozenset({"england", "argentina"}))],
            ("BBC",),
        )
        self.assertEqual(
            lookup[("SEMI_FINALS", frozenset({"england", "switzerland"}))],
            ("BBC",),
        )

    def test_csv_loads_quarter_final_broadcasters(self) -> None:
        lookup = _load_knockout_tv_lookup()
        self.assertEqual(
            lookup[("QUARTER_FINALS", frozenset({"france", "morocco"}))],
            ("ITV",),
        )
        self.assertEqual(
            lookup[("QUARTER_FINALS", frozenset({"spain", "belgium"}))],
            ("BBC",),
        )
        self.assertEqual(
            lookup[("QUARTER_FINALS", frozenset({"norway", "england"}))],
            ("ITV",),
        )
        self.assertEqual(
            lookup[("QUARTER_FINALS", frozenset({"argentina", "switzerland"}))],
            ("ITV",),
        )
        self.assertEqual(
            lookup[("QUARTER_FINALS", frozenset({"argentina", "colombia"}))],
            ("ITV",),
        )

    def test_csv_loads_round_of_16_broadcasters(self) -> None:
        lookup = _load_knockout_tv_lookup()
        self.assertEqual(
            lookup[("LAST_16", frozenset({"mexico", "england"}))],
            ("BBC",),
        )
        self.assertEqual(
            lookup[("LAST_16", frozenset({"argentina", "egypt"}))],
            ("ITV",),
        )
        self.assertEqual(
            lookup[("LAST_16", frozenset({"switzerland", "ghana"}))],
            ("ITV",),
        )

    def test_team_name_aliases(self) -> None:
        self.assertEqual(_normalise_tv_team_name("Côte d'Ivoire"), "ivory coast")
        self.assertEqual(_normalise_tv_team_name("United States"), "usa")
        self.assertEqual(_normalise_tv_team_name("Bosnia-Herzegovina"), "bosnia herzegovina")

    def test_lookup_on_knockout_match(self) -> None:
        match = _knockout_match(
            stage="LAST_32",
            home=Team(id=1, name="Germany", short_name="Germany"),
            away=Team(id=2, name="Paraguay", short_name="Paraguay"),
        )
        self.assertEqual(world_cup_knockout_tv_station(match), "BBC")
        self.assertEqual(
            world_cup_knockout_tv_logo_url(match),
            "/images/football/tv_logos/bbc_one.svg",
        )
        self.assertEqual(world_cup_knockout_tv_logo_label(match), "BBC One")

    def test_itv_logo_url(self) -> None:
        match = _knockout_match(
            stage="LAST_32",
            home=Team(id=1, name="South Africa", short_name="South Africa"),
            away=Team(id=2, name="Canada", short_name="Canada"),
        )
        self.assertEqual(
            world_cup_knockout_tv_logo_url(match),
            "/images/football/tv_logos/itv_one.svg",
        )
        self.assertEqual(world_cup_knockout_tv_logo_label(match), "ITV")

    def test_last_16_lookup_on_knockout_match(self) -> None:
        match = _knockout_match(
            stage="LAST_16",
            home=Team(id=1, name="Mexico", short_name="Mexico"),
            away=Team(id=2, name="England", short_name="England"),
        )
        self.assertEqual(world_cup_knockout_tv_station(match), "BBC")
        self.assertEqual(
            world_cup_knockout_tv_logo_url(match),
            "/images/football/tv_logos/bbc_one.svg",
        )

    def test_last_16_lookup_uses_kickoff_when_both_teams_unresolved(self) -> None:
        match = _knockout_match(
            stage="LAST_16",
            home=Team(name="Winner Match 85", short_name="Winner Match 85"),
            away=Team(name="Winner Match 86", short_name="Winner Match 86"),
            utc_date="2026-07-07T16:00:00Z",
        )
        self.assertEqual(world_cup_knockout_tv_station(match), "ITV")
        self.assertEqual(
            world_cup_knockout_tv_logo_url(match),
            "/images/football/tv_logos/itv_one.svg",
        )

    def test_last_16_lookup_uses_kickoff_when_one_team_unresolved(self) -> None:
        match = _knockout_match(
            stage="LAST_16",
            home=Team(id=1, name="Switzerland", short_name="Switzerland"),
            away=Team(name="Winner Match 87", short_name="Winner Match 87"),
            utc_date="2026-07-07T20:00:00Z",
        )
        self.assertEqual(world_cup_knockout_tv_station(match), "ITV")
        self.assertEqual(
            world_cup_knockout_tv_logo_url(match),
            "/images/football/tv_logos/itv_one.svg",
        )

    def test_quarter_final_lookup_on_knockout_match(self) -> None:
        match = _knockout_match(
            stage="QUARTER_FINALS",
            home=Team(id=1, name="France", short_name="France"),
            away=Team(id=2, name="Morocco", short_name="Morocco"),
        )
        self.assertEqual(world_cup_knockout_tv_station(match), "ITV")
        self.assertEqual(
            world_cup_knockout_tv_logo_url(match),
            "/images/football/tv_logos/itv_one.svg",
        )

    def test_quarter_final_lookup_uses_kickoff_when_teams_unresolved(self) -> None:
        match = _knockout_match(
            stage="QUARTER_FINALS",
            home=Team(),
            away=Team(),
            utc_date="2026-07-09T20:00:00Z",
        )
        self.assertEqual(world_cup_knockout_tv_station(match), "ITV")
        self.assertEqual(
            world_cup_knockout_tv_logo_url(match),
            "/images/football/tv_logos/itv_one.svg",
        )

    def test_quarter_final_lookup_matches_either_slash_alternative(self) -> None:
        match = _knockout_match(
            stage="QUARTER_FINALS",
            home=Team(id=1, name="Argentina", short_name="Argentina"),
            away=Team(id=2, name="Colombia", short_name="Colombia"),
            utc_date="2026-07-12T01:00:00Z",
        )
        self.assertEqual(world_cup_knockout_tv_station(match), "ITV")

    def test_semi_final_lookup_on_knockout_match(self) -> None:
        match = _knockout_match(
            stage="SEMI_FINALS",
            home=Team(id=1, name="France", short_name="France"),
            away=Team(id=2, name="Spain", short_name="Spain"),
            utc_date="2026-07-14T19:00:00Z",
        )
        self.assertEqual(world_cup_knockout_tv_station(match), "ITV")
        self.assertEqual(
            world_cup_knockout_tv_logo_url(match),
            "/images/football/tv_logos/itv_one.svg",
        )

    def test_semi_final_lookup_matches_either_slash_alternative(self) -> None:
        match = _knockout_match(
            stage="SEMI_FINALS",
            home=Team(id=1, name="England", short_name="England"),
            away=Team(id=2, name="Switzerland", short_name="Switzerland"),
            utc_date="2026-07-15T19:00:00Z",
        )
        self.assertEqual(world_cup_knockout_tv_station(match), "BBC")
        self.assertEqual(
            world_cup_knockout_tv_logo_url(match),
            "/images/football/tv_logos/bbc_one.svg",
        )

    def test_final_is_bbc_and_itv(self) -> None:
        match = _knockout_match(
            stage="FINAL",
            home=Team(),
            away=Team(),
            utc_date="2026-07-19T19:00:00Z",
        )
        self.assertEqual(world_cup_knockout_tv_stations(match), ("BBC", "ITV"))
        logos = world_cup_knockout_tv_logos(match)
        self.assertEqual(
            [logo.url for logo in logos],
            [
                "/images/football/tv_logos/bbc_one.svg",
                "/images/football/tv_logos/itv_one.svg",
            ],
        )
        self.assertEqual(
            [logo.label for logo in logos],
            ["BBC One", "ITV"],
        )

    def test_third_place_is_bbc(self) -> None:
        match = _knockout_match(
            stage="THIRD_PLACE",
            home=Team(),
            away=Team(),
            utc_date="2026-07-18T21:00:00Z",
        )
        self.assertEqual(world_cup_knockout_tv_stations(match), ("BBC",))
        self.assertEqual(world_cup_knockout_tv_station(match), "BBC")
        self.assertEqual(
            world_cup_knockout_tv_logo_url(match),
            "/images/football/tv_logos/bbc_one.svg",
        )

    def test_not_shown_for_group_stage(self) -> None:
        match = _knockout_match(
            stage="GROUP_STAGE",
            home=Team(id=1, name="Germany", short_name="Germany"),
            away=Team(id=2, name="Paraguay", short_name="Paraguay"),
        )
        self.assertIsNone(world_cup_knockout_tv_station(match))

    def test_group_stage_lookup_on_match(self) -> None:
        match = _knockout_match(
            stage="GROUP_STAGE",
            home=Team(id=1, name="Mexico", short_name="Mexico"),
            away=Team(id=2, name="South Africa", short_name="South Africa"),
            utc_date="2026-06-11T19:00:00Z",
        )
        self.assertEqual(world_cup_knockout_tv_stations(match), ("ITV",))
        self.assertEqual(
            world_cup_knockout_tv_logo_url(match),
            "/images/football/tv_logos/itv_one.svg",
        )

    def test_group_stage_lookup_uses_team_aliases(self) -> None:
        match = _knockout_match(
            stage="GROUP_STAGE",
            home=Team(id=1, name="United States", short_name="USA"),
            away=Team(id=2, name="Paraguay", short_name="Paraguay"),
            utc_date="2026-06-13T01:00:00Z",
        )
        self.assertEqual(world_cup_knockout_tv_stations(match), ("BBC",))

    def test_group_stage_lookup_for_shared_kickoff_slot(self) -> None:
        canada = _knockout_match(
            stage="GROUP_STAGE",
            home=Team(id=1, name="Canada", short_name="Canada"),
            away=Team(id=2, name="Switzerland", short_name="Switzerland"),
            utc_date="2026-06-24T19:00:00Z",
        )
        bosnia = _knockout_match(
            stage="GROUP_STAGE",
            home=Team(id=3, name="Bosnia-Herzegovina", short_name="Bosnia"),
            away=Team(id=4, name="Qatar", short_name="Qatar"),
            utc_date="2026-06-24T19:00:00Z",
        )
        self.assertEqual(world_cup_knockout_tv_stations(canada), ("ITV",))
        self.assertEqual(world_cup_knockout_tv_stations(bosnia), ("ITV",))

    def test_not_shown_for_group_playoff(self) -> None:
        match = _knockout_match(
            stage="GROUP_PLAYOFF",
            home=Team(id=1, name="Germany", short_name="Germany"),
            away=Team(id=2, name="Paraguay", short_name="Paraguay"),
        )
        self.assertIsNone(world_cup_knockout_tv_station(match))


if __name__ == "__main__":
    unittest.main()
