from __future__ import annotations

import unittest

from website.football.models import TableItem, Team
from website.football.world_cup_db import (
    _apply_current_edition_qualification_labels,
    _is_guaranteed_best_third_placed,
    _ThirdPlaceStats,
)


def _team(team_id: int, name: str) -> Team:
    return Team(id=team_id, name=name, short_name=name)


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


def _completed_group(
    slug: str,
    rows: list[tuple[int, str, int, int, int, int, int]],
) -> tuple[str, list[TableItem]]:
    table = [
        _table_row(
            position=index + 1,
            team=_team(team_id, name),
            played_games=3,
            won=won,
            draw=draw,
            lost=lost,
            goals_for=goals_for,
            goals_against=goals_against,
        )
        for index, (team_id, name, won, draw, lost, goals_for, goals_against) in enumerate(
            rows
        )
    ]
    return slug, table


class WorldCupBestThirdQualificationTests(unittest.TestCase):
    def test_top_two_still_receive_q_labels(self) -> None:
        _, table = _completed_group(
            "a",
            [
                (1, "Leader", 3, 0, 0, 9, 1),
                (2, "Runner", 2, 0, 1, 4, 3),
                (3, "Third", 1, 0, 1, 3, 5),
                (4, "Fourth", 0, 0, 1, 2, 8),
            ],
        )

        _apply_current_edition_qualification_labels({"a": table})

        self.assertEqual(table[0].position_label, "Q")
        self.assertEqual(table[1].position_label, "Q")

    def test_completed_third_in_top_eight_receives_q(self) -> None:
        third_stats = [
            (2, 0, 1, 5, 3),
            (2, 0, 1, 5, 4),
            (2, 0, 1, 4, 3),
            (2, 0, 1, 4, 4),
            (1, 1, 1, 4, 3),
            (1, 1, 1, 3, 2),
            (1, 1, 1, 3, 3),
            (1, 1, 1, 2, 1),
            (1, 0, 2, 3, 4),
            (1, 0, 2, 2, 3),
            (0, 1, 2, 2, 4),
            (0, 1, 2, 1, 3),
        ]
        group_tables = {
            slug: _completed_group(
                slug,
                [
                    (10 + index, f"{slug}-1", 3, 0, 0, 6, 1),
                    (20 + index, f"{slug}-2", 2, 0, 1, 4, 3),
                    (
                        30 + index,
                        f"{slug}-3",
                        won,
                        draw,
                        lost,
                        goals_for,
                        goals_against,
                    ),
                    (40 + index, f"{slug}-4", 0, 0, 3, 1, 7),
                ],
            )[1]
            for index, (slug, (won, draw, lost, goals_for, goals_against)) in enumerate(
                zip(
                    ("a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"),
                    third_stats,
                    strict=True,
                )
            )
        }

        _apply_current_edition_qualification_labels(group_tables)

        qualified_thirds = [
            table[2].team.display_name
            for table in group_tables.values()
            if table[2].position_label == "Q"
        ]
        self.assertEqual(
            qualified_thirds,
            [f"{slug}-3" for slug in ("a", "b", "c", "d", "e", "f", "g", "h")],
        )
        self.assertIsNone(group_tables["i"][2].position_label)
        self.assertIsNone(group_tables["l"][2].position_label)

    def test_locked_third_can_be_guaranteed_before_group_ends(self) -> None:
        locked_third_group = [
            _table_row(
                position=1,
                team=_team(1, "Leader"),
                played_games=2,
                won=2,
                draw=0,
                lost=0,
                goals_for=5,
                goals_against=1,
            ),
            _table_row(
                position=2,
                team=_team(2, "Runner"),
                played_games=2,
                won=1,
                draw=0,
                lost=1,
                goals_for=3,
                goals_against=3,
            ),
            _table_row(
                position=3,
                team=_team(3, "Locked Third"),
                played_games=2,
                won=1,
                draw=0,
                lost=1,
                goals_for=3,
                goals_against=4,
            ),
            _table_row(
                position=4,
                team=_team(4, "Chaser"),
                played_games=2,
                won=0,
                draw=0,
                lost=2,
                goals_for=1,
                goals_against=6,
            ),
        ]
        weak_competitor = [
            _table_row(
                position=1,
                team=_team(5, "Other Leader"),
                played_games=1,
                won=1,
                draw=0,
                lost=0,
                goals_for=2,
                goals_against=0,
            ),
            _table_row(
                position=2,
                team=_team(6, "Other Runner"),
                played_games=1,
                won=0,
                draw=1,
                lost=0,
                goals_for=1,
                goals_against=1,
            ),
            _table_row(
                position=3,
                team=_team(7, "Other Third"),
                played_games=1,
                won=0,
                draw=1,
                lost=0,
                goals_for=1,
                goals_against=1,
            ),
            _table_row(
                position=4,
                team=_team(8, "Other Fourth"),
                played_games=1,
                won=0,
                draw=0,
                lost=1,
                goals_for=0,
                goals_against=2,
            ),
        ]

        _apply_current_edition_qualification_labels(
            {
                "a": locked_third_group,
                "b": weak_competitor,
            }
        )

        self.assertEqual(locked_third_group[2].position_label, "Q")

    def test_unlocked_third_does_not_receive_q_during_group_play(self) -> None:
        open_group = [
            _table_row(
                position=1,
                team=_team(1, "Leader"),
                played_games=2,
                won=2,
                draw=0,
                lost=0,
                goals_for=4,
                goals_against=1,
            ),
            _table_row(
                position=2,
                team=_team(2, "Runner"),
                played_games=2,
                won=1,
                draw=0,
                lost=1,
                goals_for=3,
                goals_against=3,
            ),
            _table_row(
                position=3,
                team=_team(3, "Open Third"),
                played_games=2,
                won=1,
                draw=0,
                lost=1,
                goals_for=2,
                goals_against=3,
            ),
            _table_row(
                position=4,
                team=_team(4, "Chaser"),
                played_games=2,
                won=0,
                draw=1,
                lost=1,
                goals_for=2,
                goals_against=3,
            ),
        ]

        _apply_current_edition_qualification_labels({"a": open_group})

        self.assertIsNone(open_group[2].position_label)

    def test_guarantee_helper_requires_fewer_than_eight_better_thirds(self) -> None:
        candidate = _ThirdPlaceStats(points=3, goal_difference=0, goals_for=3)
        competitors = [
            _ThirdPlaceStats(points=points, goal_difference=0, goals_for=points)
            for points in range(10, 2, -1)
        ]

        self.assertFalse(
            _is_guaranteed_best_third_placed(
                candidate,
                competitors,
                use_goal_metrics=True,
            )
        )

        self.assertTrue(
            _is_guaranteed_best_third_placed(
                candidate,
                competitors[:7],
                use_goal_metrics=True,
            )
        )

    def test_third_place_q_uses_points_only_until_all_groups_finish(self) -> None:
        locked_third = [
            _table_row(
                position=1,
                team=_team(1, "Leader"),
                played_games=3,
                won=3,
                draw=0,
                lost=0,
                goals_for=5,
                goals_against=1,
            ),
            _table_row(
                position=2,
                team=_team(2, "Runner"),
                played_games=3,
                won=1,
                draw=1,
                lost=1,
                goals_for=3,
                goals_against=3,
            ),
            _table_row(
                position=3,
                team=_team(3, "Locked Third"),
                played_games=3,
                won=1,
                draw=1,
                lost=1,
                goals_for=2,
                goals_against=3,
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
        weaker_third = [
            _table_row(
                position=1,
                team=_team(5, "Other Leader"),
                played_games=2,
                won=2,
                draw=0,
                lost=0,
                goals_for=4,
                goals_against=1,
            ),
            _table_row(
                position=2,
                team=_team(6, "Other Runner"),
                played_games=2,
                won=1,
                draw=0,
                lost=1,
                goals_for=2,
                goals_against=2,
            ),
            _table_row(
                position=3,
                team=_team(7, "Other Third"),
                played_games=2,
                won=0,
                draw=1,
                lost=1,
                goals_for=1,
                goals_against=3,
            ),
            _table_row(
                position=4,
                team=_team(8, "Other Fourth"),
                played_games=2,
                won=0,
                draw=1,
                lost=1,
                goals_for=1,
                goals_against=2,
            ),
        ]

        _apply_current_edition_qualification_labels(
            {
                "a": locked_third,
                "b": weaker_third,
            }
        )

        self.assertEqual(locked_third[2].position_label, "Q")

    def test_third_place_comparison_ignores_goal_difference_until_enabled(self) -> None:
        from website.football.world_cup_db import _third_place_stats_are_better

        rival = _ThirdPlaceStats(points=4, goal_difference=5, goals_for=3, team_name="Rival")
        candidate = _ThirdPlaceStats(
            points=4, goal_difference=2, goals_for=4, team_name="Candidate"
        )

        self.assertFalse(
            _third_place_stats_are_better(
                rival,
                candidate,
                use_goal_metrics=False,
            )
        )
        self.assertTrue(
            _third_place_stats_are_better(
                rival,
                candidate,
                use_goal_metrics=True,
            )
        )


if __name__ == "__main__":
    unittest.main()
