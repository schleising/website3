from __future__ import annotations

import unittest

from website.toaster.files import TOASTER_DIR, TOASTER_FILES, WEBSITE_ROOT, resolve_toaster_file


class ToasterFilesTests(unittest.TestCase):
    def test_expected_files_resolve(self) -> None:
        for filename in TOASTER_FILES:
            resolved = resolve_toaster_file(filename)
            self.assertIsNotNone(resolved, filename)
            assert resolved is not None
            file_path, media_type = resolved
            self.assertTrue(file_path.is_file(), filename)
            self.assertEqual(media_type, TOASTER_FILES[filename])
            self.assertEqual(file_path.parent, TOASTER_DIR.resolve())

    def test_index_is_standalone_and_uses_relative_assets(self) -> None:
        html = (TOASTER_DIR / "index.html").read_text(encoding="utf-8")
        self.assertIn("Tree Viewer", html)
        self.assertIn('src="./app.js"', html)
        self.assertIn('href="./styles.css"', html)
        self.assertIn("noindex", html)
        self.assertNotIn('href="/"', html)
        self.assertNotIn("home-card", html)

    def test_script_loads_graph_relatively(self) -> None:
        script = (TOASTER_DIR / "app.js").read_text(encoding="utf-8")
        self.assertIn("./graph.json", script)

    def test_unknown_and_traversal_names_are_rejected(self) -> None:
        self.assertIsNone(resolve_toaster_file("missing.txt"))
        self.assertIsNone(resolve_toaster_file("../index.py"))
        self.assertIsNone(resolve_toaster_file("index.py"))
        self.assertIsNone(resolve_toaster_file(""))

    def test_site_templates_do_not_link_to_toaster(self) -> None:
        templates_dir = WEBSITE_ROOT / "templates"
        for path in templates_dir.rglob("*.html"):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("/toaster", text, path.name)
