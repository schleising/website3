"""2026 World Cup stadium and host city lookup for match cards."""

from __future__ import annotations

import copy
import unittest

from website.football.models import Match, Team
from website.football.world_cup_utils import (
    _load_stadium_lookup,
    world_cup_match_stadium_venue,
    world_cup_match_venue_label,
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
    "stage": "GROUP_STAGE",
    "group": "GROUP_E",
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


def _match(
    *,
    stage: str,
    utc_date: str,
    home: Team,
    away: Team,
    group: str | None = "GROUP_E",
) -> Match:
    payload = copy.deepcopy(_MATCH_TEMPLATE)
    payload.update(
        {
            "id": 1,
            "stage": stage,
            "utcDate": utc_date,
            "group": group,
            "homeTeam": home.model_dump(by_alias=True),
            "awayTeam": away.model_dump(by_alias=True),
        }
    )
    return Match.model_validate(payload)


class WorldCupStadiumTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        _load_stadium_lookup.cache_clear()

    def test_csv_loads_2026_venues(self) -> None:
        lookup = _load_stadium_lookup()
        self.assertGreater(len(lookup.by_team_pair), 90)
        self.assertGreater(len(lookup.by_feeder_pair), 0)

    def test_group_match_resolves_by_teams(self) -> None:
        match = _match(
            stage="GROUP_STAGE",
            utc_date="2026-06-14T17:00:00Z",
            home=Team(id=1, name="Germany", short_name="Germany"),
            away=Team(id=2, name="Curaçao", short_name="Curacao"),
            group="GROUP_E",
        )

        venue = world_cup_match_stadium_venue(match)

        self.assertIsNotNone(venue)
        assert venue is not None
        self.assertEqual(venue.stadium, "Houston Stadium")
        self.assertEqual(venue.host_city, "Houston")
        self.assertEqual(
            world_cup_match_venue_label(match),
            "Houston Stadium, Houston",
        )

    def test_last_32_england_congo_dr_resolves_atlanta(self) -> None:
        match = _match(
            stage="LAST_32",
            utc_date="2026-07-01T16:00:00Z",
            home=Team(id=1, name="England", short_name="England"),
            away=Team(id=2, name="Congo DR", short_name="Congo DR"),
            group=None,
        )

        venue = world_cup_match_stadium_venue(match)

        self.assertIsNotNone(venue)
        assert venue is not None
        self.assertEqual(venue.stadium, "Atlanta Stadium")
        self.assertEqual(venue.host_city, "Atlanta")

    def test_knockout_feeder_labels_resolve_quarter_final_venue(self) -> None:
        match = _match(
            stage="QUARTER_FINALS",
            utc_date="2026-07-09T20:00:00Z",
            home=Team(name="Winner Match 89", short_name="W89"),
            away=Team(name="Winner Match 90", short_name="W90"),
            group=None,
        )

        venue = world_cup_match_stadium_venue(match)

        self.assertIsNotNone(venue)
        assert venue is not None
        self.assertEqual(venue.stadium, "Boston Stadium")
        self.assertEqual(venue.host_city, "Foxborough")


if __name__ == "__main__":
    unittest.main()
