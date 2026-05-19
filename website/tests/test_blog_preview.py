from __future__ import annotations

import unittest

from website.utils.mermaid import disable_mermaid_autorun_markup
from website.utils.markdown_preview import build_markdown_preview, extract_first_mermaid_preview


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

    def test_extract_first_mermaid_preview_returns_first_mermaid_block(self) -> None:
        preview = extract_first_mermaid_preview(
            """```python
print('ignore')
```

```mermaid
graph TD
    Home --> Blog
```

```mermaid
graph TD
    Ignore --> Second
```
"""
        )

        self.assertEqual(preview, "graph TD\n    Home --> Blog")

    def test_extract_first_mermaid_preview_returns_none_when_missing(self) -> None:
        preview = extract_first_mermaid_preview("# Title\n\nNo diagram here.")

        self.assertIsNone(preview)

    def test_disable_mermaid_autorun_markup_rewrites_mermaid_class(self) -> None:
        html = '<div class="mermaid" id="abc">graph TD\nA --&gt; B</div>'

        result = disable_mermaid_autorun_markup(html)

        self.assertEqual(result, '<div class="mermaid-source" id="abc">graph TD\nA --&gt; B</div>')


if __name__ == "__main__":
    unittest.main()