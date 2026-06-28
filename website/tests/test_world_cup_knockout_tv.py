"""UK TV station lookup for World Cup knockout match cards."""

from __future__ import annotations

import copy
import unittest

from website.football.models import Match, Team
from website.football.world_cup_utils import (
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
) -> Match:
    payload = copy.deepcopy(_MATCH_TEMPLATE)
    payload.update(
        {
            "id": 1,
            "stage": stage,
            "utcDate": "2026-06-28T19:00:00Z",
            "homeTeam": home.model_dump(by_alias=True),
            "awayTeam": away.model_dump(by_alias=True),
        }
    )
    return Match.model_validate(payload)


class WorldCupKnockoutTvTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        _load_knockout_tv_lookup.cache_clear()

    def test_csv_loads_round_of_32_broadcasters(self) -> None:
        lookup = _load_knockout_tv_lookup()
        self.assertEqual(len(lookup), 16)
        self.assertEqual(
            lookup[frozenset({"south africa", "canada"})],
            "ITV",
        )
        self.assertEqual(
            lookup[frozenset({"germany", "paraguay"})],
            "BBC",
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

    def test_not_shown_for_group_stage(self) -> None:
        match = _knockout_match(
            stage="GROUP_STAGE",
            home=Team(id=1, name="Germany", short_name="Germany"),
            away=Team(id=2, name="Paraguay", short_name="Paraguay"),
        )
        self.assertIsNone(world_cup_knockout_tv_station(match))


if __name__ == "__main__":
    unittest.main()
