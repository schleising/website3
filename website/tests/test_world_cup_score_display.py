"""World Cup knockout score display for extra time and penalties."""

from __future__ import annotations

import copy
import unittest

from website.football.models import Match
from website.football.world_cup_utils import (
    knockout_winner_side,
    world_cup_display_score,
    world_cup_score_annotation,
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
    "status": "FINISHED",
    "minute": None,
    "injuryTime": None,
    "matchday": None,
    "stage": "LAST_16",
    "id": 1,
    "utcDate": "2026-07-05T20:00:00Z",
    "lastUpdated": "2026-07-05T12:00:00Z",
    "odds": {"msg": ""},
    "referees": [],
    "homeTeam": {"id": 1, "name": "Home", "shortName": "HOM"},
    "awayTeam": {"id": 2, "name": "Away", "shortName": "AWY"},
}


def _finished_match(score: dict) -> Match:
    payload = copy.deepcopy(_MATCH_TEMPLATE)
    payload["score"] = score
    return Match.model_validate(payload)


class WorldCupScoreDisplayTests(unittest.TestCase):
    def test_api_extra_time_finish_shows_post_et_score_and_aet(self) -> None:
        match = _finished_match(
            {
                "winner": "HOME_TEAM",
                "duration": "EXTRA_TIME",
                "fullTime": {"homeTeam": 2, "awayTeam": 1},
                "halfTime": {"homeTeam": 1, "awayTeam": 0},
                "regularTime": {"homeTeam": 1, "awayTeam": 1},
                "extraTime": {"homeTeam": 1, "awayTeam": 0},
            }
        )

        self.assertEqual(world_cup_display_score(match), (2, 1))
        self.assertEqual(world_cup_score_annotation(match), "(aet)")
        self.assertEqual(knockout_winner_side(match), "home")

    def test_api_penalty_shootout_shows_post_et_score_and_pens(self) -> None:
        match = _finished_match(
            {
                "winner": "HOME_TEAM",
                "duration": "PENALTY_SHOOTOUT",
                "fullTime": {"homeTeam": 7, "awayTeam": 6},
                "halfTime": {"homeTeam": 1, "awayTeam": 1},
                "regularTime": {"homeTeam": 1, "awayTeam": 1},
                "extraTime": {"homeTeam": 0, "awayTeam": 0},
                "penalties": {"homeTeam": 6, "awayTeam": 5},
            }
        )

        self.assertEqual(world_cup_display_score(match), (1, 1))
        self.assertEqual(world_cup_score_annotation(match), "(6-5 pens)")
        self.assertEqual(knockout_winner_side(match), "home")

    def test_openfootball_extra_time_finish_unchanged(self) -> None:
        match = _finished_match(
            {
                "winner": "HOME_TEAM",
                "duration": "EXTRA_TIME",
                "fullTime": {"home": 1, "away": 1},
                "halfTime": {"home": 1, "away": 0},
                "extraTime": {"home": 2, "away": 1},
            }
        )

        self.assertEqual(world_cup_display_score(match), (2, 1))
        self.assertEqual(world_cup_score_annotation(match), "(aet)")
        self.assertEqual(knockout_winner_side(match), "home")

    def test_openfootball_penalty_shootout_unchanged(self) -> None:
        match = _finished_match(
            {
                "winner": "HOME_TEAM",
                "duration": "PENALTY_SHOOTOUT",
                "fullTime": {"home": 1, "away": 1},
                "halfTime": {"home": 1, "away": 0},
                "extraTime": {"home": 1, "away": 1},
                "penalties": {"home": 4, "away": 3},
            }
        )

        self.assertEqual(world_cup_display_score(match), (1, 1))
        self.assertEqual(world_cup_score_annotation(match), "(4-3 pens)")
        self.assertEqual(knockout_winner_side(match), "home")

    def test_regular_time_finish_unchanged(self) -> None:
        match = _finished_match(
            {
                "winner": "HOME_TEAM",
                "duration": "REGULAR",
                "fullTime": {"home": 2, "away": 1},
                "halfTime": {"home": 1, "away": 0},
            }
        )

        self.assertEqual(world_cup_display_score(match), (2, 1))
        self.assertIsNone(world_cup_score_annotation(match))
        self.assertEqual(knockout_winner_side(match), "home")


if __name__ == "__main__":
    unittest.main()
