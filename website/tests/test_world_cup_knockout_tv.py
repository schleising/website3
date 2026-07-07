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
    world_cup_knockout_tv_station,
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
        self.assertEqual(len(lookup), 33)
        self.assertEqual(
            lookup[frozenset({"south africa", "canada"})],
            "ITV",
        )
        self.assertEqual(
            lookup[frozenset({"germany", "paraguay"})],
            "BBC",
        )

    def test_csv_loads_quarter_final_broadcasters(self) -> None:
        lookup = _load_knockout_tv_lookup()
        self.assertEqual(
            lookup[frozenset({"france", "morocco"})],
            "ITV",
        )
        self.assertEqual(
            lookup[frozenset({"spain", "belgium"})],
            "BBC",
        )
        self.assertEqual(
            lookup[frozenset({"norway", "england"})],
            "ITV",
        )
        self.assertEqual(
            lookup[frozenset({"argentina", "switzerland"})],
            "ITV",
        )
        self.assertEqual(
            lookup[frozenset({"argentina", "colombia"})],
            "ITV",
        )

    def test_csv_loads_round_of_16_broadcasters(self) -> None:
        lookup = _load_knockout_tv_lookup()
        self.assertEqual(
            lookup[frozenset({"mexico", "england"})],
            "BBC",
        )
        self.assertEqual(
            lookup[frozenset({"argentina", "egypt"})],
            "ITV",
        )
        self.assertEqual(
            lookup[frozenset({"switzerland", "ghana"})],
            "ITV",
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

    def test_not_shown_for_group_stage(self) -> None:
        match = _knockout_match(
            stage="GROUP_STAGE",
            home=Team(id=1, name="Germany", short_name="Germany"),
            away=Team(id=2, name="Paraguay", short_name="Paraguay"),
        )
        self.assertIsNone(world_cup_knockout_tv_station(match))


if __name__ == "__main__":
    unittest.main()
