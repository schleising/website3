"""Path matching for a manual Converter cover-art refresh."""

from __future__ import annotations

import unittest

from tools.converter.cover_art_runtime import source_path_matching_cover_art


class CoverArtRefreshPathTests(unittest.TestCase):
    def test_matches_film_basename_and_cache_key(self) -> None:
        path = "/Media/Films/1917 (2019)/1917 (2019) Bluray-1080p.mkv"
        matched = source_path_matching_cover_art(
            [path],
            "film:1917:2019",
            "1917 (2019) Bluray-1080p.mkv",
        )
        self.assertEqual(matched, path)

    def test_rejects_same_basename_with_a_different_key(self) -> None:
        first = "/Media/Films/1917 (2019)/1917 (2019) Bluray-1080p.mkv"
        second = "/Media/Films/1917 (2018)/1917 (2019) Bluray-1080p.mkv"
        matched = source_path_matching_cover_art(
            [first, second],
            "film:1917:2018",
            "1917 (2019) Bluray-1080p.mkv",
        )
        self.assertEqual(matched, second)

    def test_tv_episode_matches_the_series_key(self) -> None:
        path = (
            "/Media/TV/100 Foot Wave/Season 1/"
            "100 Foot Wave - S01E01 - Chapter I WEBDL-1080p.mkv"
        )
        matched = source_path_matching_cover_art(
            [path],
            "tvshow:100-foot-wave",
            "100 Foot Wave - S01E01 - Chapter I WEBDL-1080p.mkv",
        )
        self.assertEqual(matched, path)

    def test_ignores_other_basenames_and_blank_input(self) -> None:
        path = "/Media/Films/1917 (2019)/1917 (2019) Bluray-1080p.mkv"
        self.assertIsNone(
            source_path_matching_cover_art(
                [path],
                "film:1917:2019",
                "Other (2019).mkv",
            )
        )
        self.assertIsNone(source_path_matching_cover_art([path], "", path))
        self.assertIsNone(source_path_matching_cover_art([path], "film:1917:2019", "  "))
