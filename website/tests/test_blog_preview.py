from __future__ import annotations

import unittest

from website.utils.markdown_preview import build_markdown_preview


class BlogPreviewTests(unittest.TestCase):
    def test_markdown_preview_skips_mermaid_fence(self) -> None:
        preview = build_markdown_preview(
            """```mermaid
graph TD
    A[Start] --> B[Finish]
```

This post explains the result after the diagram.
"""
        )

        self.assertEqual(preview, "This post explains the result after the diagram.")

    def test_markdown_preview_skips_markdown_tables(self) -> None:
        preview = build_markdown_preview(
            """| Team | Points |
| --- | ---: |
| Alpha | 10 |
| Beta | 8 |

League positions tightened after the weekend fixtures.
"""
        )

        self.assertEqual(preview, "League positions tightened after the weekend fixtures.")


if __name__ == "__main__":
    unittest.main()