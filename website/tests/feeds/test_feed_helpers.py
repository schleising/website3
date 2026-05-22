from __future__ import annotations

import importlib
import importlib.util
import ipaddress
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


WEBSITE_ROOT = Path(__file__).resolve().parents[2]
FEED_UTILS_PATH = WEBSITE_ROOT / "feeds" / "feed_utils.py"
HTML_SANITIZER_PATH = WEBSITE_ROOT / "utils" / "html_sanitizer.py"

if str(WEBSITE_ROOT.parent) not in sys.path:
    sys.path.insert(0, str(WEBSITE_ROOT.parent))

feed_utils_spec = importlib.util.spec_from_file_location(
    "feed_utils_for_tests",
    FEED_UTILS_PATH,
)
if feed_utils_spec is None or feed_utils_spec.loader is None:
    raise RuntimeError("Failed to load feed_utils module for tests.")

feed_utils = importlib.util.module_from_spec(feed_utils_spec)
feed_utils_spec.loader.exec_module(feed_utils)

html_sanitizer_spec = importlib.util.spec_from_file_location(
    "html_sanitizer_for_tests",
    HTML_SANITIZER_PATH,
)
if html_sanitizer_spec is None or html_sanitizer_spec.loader is None:
    raise RuntimeError("Failed to load html_sanitizer module for tests.")

html_sanitizer = importlib.util.module_from_spec(html_sanitizer_spec)
html_sanitizer_spec.loader.exec_module(html_sanitizer)

deterministic_category_color = feed_utils.deterministic_category_color
is_public_http_url = feed_utils.is_public_http_url
normalize_color_hex = feed_utils.normalize_color_hex
normalize_feed_url = feed_utils.normalize_feed_url
parse_opml_entries = feed_utils.parse_opml_entries
truncate_html_to_paragraphs = feed_utils.truncate_html_to_paragraphs
sanitize_html = html_sanitizer.sanitize_html


class FeedHelperTests(unittest.TestCase):
    def test_normalize_feed_url_canonicalizes_host_and_query(self) -> None:
        normalized = normalize_feed_url("HTTPS://Example.COM/news/feed/?b=2&a=1")
        self.assertEqual(normalized, "https://example.com/news/feed?a=1&b=2")

    def test_normalize_feed_url_rejects_non_http_scheme(self) -> None:
        with self.assertRaises(ValueError):
            normalize_feed_url("ftp://example.com/feed.xml")

    def test_normalize_feed_url_requires_host(self) -> None:
        with self.assertRaises(ValueError):
            normalize_feed_url("https:///feed.xml")

    def test_is_public_http_url_rejects_localhost_and_private_literals(self) -> None:
        self.assertFalse(is_public_http_url("http://localhost/feed.xml"))
        self.assertFalse(is_public_http_url("http://127.0.0.1/feed.xml"))
        self.assertFalse(is_public_http_url("https://10.0.0.5/feed.xml"))

    def test_is_public_http_url_uses_dns_resolution_for_hostnames(self) -> None:
        feed_utils._resolve_hostname_addresses.cache_clear()
        with patch.object(
            feed_utils,
            "_resolve_hostname_addresses",
            return_value=(ipaddress.ip_address("8.8.8.8"),),
        ):
            self.assertTrue(is_public_http_url("https://public.example/feed.xml"))

        with patch.object(
            feed_utils,
            "_resolve_hostname_addresses",
            return_value=(ipaddress.ip_address("10.0.0.7"),),
        ):
            self.assertFalse(is_public_http_url("https://internal.example/feed.xml"))

    def test_normalize_color_hex_accepts_case_insensitive_input(self) -> None:
        self.assertEqual(normalize_color_hex("#aBc123"), "#ABC123")
        self.assertEqual(normalize_color_hex("f0f0f0"), "#F0F0F0")

    def test_normalize_color_hex_rejects_invalid_values(self) -> None:
        with self.assertRaises(ValueError):
            normalize_color_hex("#12")

        with self.assertRaises(ValueError):
            normalize_color_hex("#GGGGGG")

    def test_deterministic_category_color_stable_for_same_name(self) -> None:
        first = deterministic_category_color("Technology")
        second = deterministic_category_color("technology")
        self.assertEqual(first, second)

    def test_parse_opml_entries_with_nested_categories(self) -> None:
        opml_content = b"""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<opml version=\"2.0\">
  <body>
    <outline text=\"Tech\">
      <outline text=\"Example Feed\" xmlUrl=\"https://example.com/feed.xml\" />
    </outline>
    <outline text=\"News Feed\" xmlUrl=\"https://news.example.com/rss\" />
  </body>
</opml>
"""

        entries, errors = parse_opml_entries(opml_content)

        self.assertEqual(errors, [])
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0], ("https://example.com/feed.xml", "Example Feed", "Tech"))
        self.assertEqual(entries[1], ("https://news.example.com/rss", "News Feed", ""))

    def test_parse_opml_entries_raises_on_invalid_xml(self) -> None:
        with self.assertRaises(ValueError):
            parse_opml_entries(b"<opml><body><outline>")

    def test_parse_opml_entries_rejects_entity_expansion(self) -> None:
        opml_content = b"""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE opml [
<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]>
<opml version=\"2.0\">
    <body>
        <outline text=\"Example\" xmlUrl=\"https://example.com/feed.xml\">&xxe;</outline>
    </body>
</opml>
"""

        with self.assertRaises(ValueError):
            parse_opml_entries(opml_content)

    def test_parse_opml_entries_with_default_namespace(self) -> None:
        opml_content = b"""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<opml xmlns=\"http://www.w3.org/2005/Atom\" version=\"2.0\">
  <body>
    <outline text=\"Tech\">
      <outline text=\"Example Feed\" xmlUrl=\"https://example.com/feed.xml\" />
    </outline>
  </body>
</opml>
"""

        entries, errors = parse_opml_entries(opml_content)

        self.assertEqual(errors, [])
        self.assertEqual(entries, [("https://example.com/feed.xml", "Example Feed", "Tech")])


class TruncateHtmlToParagraphsTests(unittest.TestCase):
    def test_returns_unchanged_when_five_or_fewer_paragraphs(self) -> None:
        html = "<p>One</p><p>Two</p><p>Three</p><p>Four</p><p>Five</p>"
        self.assertEqual(truncate_html_to_paragraphs(html), html)

    def test_truncates_after_fifth_paragraph(self) -> None:
        html = "<p>One</p><p>Two</p><p>Three</p><p>Four</p><p>Five</p><p>Six</p>"
        result = truncate_html_to_paragraphs(html)
        self.assertEqual(result, "<p>One</p><p>Two</p><p>Three</p><p>Four</p><p>Five</p>")

    def test_returns_unchanged_when_no_paragraphs(self) -> None:
        html = "<div>No paragraphs here</div>"
        self.assertEqual(truncate_html_to_paragraphs(html), html)

    def test_custom_max_paragraphs(self) -> None:
        html = "<p>A</p><p>B</p><p>C</p><p>D</p>"
        self.assertEqual(truncate_html_to_paragraphs(html, max_paragraphs=2), "<p>A</p><p>B</p>")

    def test_case_insensitive_close_tag(self) -> None:
        html = "<p>One</P><p>Two</P><p>Three</P><p>Four</P><p>Five</P><p>Six</P>"
        result = truncate_html_to_paragraphs(html)
        self.assertEqual(result, "<p>One</P><p>Two</P><p>Three</P><p>Four</P><p>Five</P>")


class FeedDbHelperTests(unittest.TestCase):
    def test_resolve_head_probe_limit_caps_at_max(self) -> None:
        from website.feeds.feed_db import HEAD_PROBE_MAX_LIMIT, resolve_head_probe_limit

        self.assertEqual(resolve_head_probe_limit(10), 20)
        self.assertEqual(resolve_head_probe_limit(20), HEAD_PROBE_MAX_LIMIT)

    def test_invalidate_category_counts_cache_clears_user_entry(self) -> None:
        from website.feeds import feed_db
        from website.feeds.models import FeedCategoryListResponse

        feed_db._category_counts_cache["test-user"] = (
            feed_db.utc_now(),
            FeedCategoryListResponse(
                all_unread_count=1,
                recently_read_count=0,
                saved_count=0,
                categories=[],
            ),
        )

        feed_db.invalidate_category_counts_cache("test-user")
        self.assertNotIn("test-user", feed_db._category_counts_cache)


class HtmlSanitizerTests(unittest.TestCase):
    def test_restores_missing_spaces_around_inline_tags_between_words(self) -> None:
        html = (
            '<p>It occurs after the events of<em><a href="https://example.com/mando" '
            'target="_blank">The Mandalorian</a></em>TV series.</p>'
        )

        result = sanitize_html(html, allow_inline_styles=True)

        self.assertIn("events of <em><a", result)
        self.assertIn("</a></em> TV series.", result)


if __name__ == "__main__":
    unittest.main()
