from __future__ import annotations

import re
import string
from secrets import choice

from markdown.extensions import Extension
from markdown.preprocessors import Preprocessor

MERMAID_CLASS_RE = re.compile(r"\bmermaid\b")
MERMAID_FENCE_START_RE = re.compile(
    r"^(?P<fence_char>[~`]){3}[ \t]*[Mm]ermaid[ \t]*$"
)


def disable_mermaid_autorun_markup(html: str) -> str:
    return MERMAID_CLASS_RE.sub("mermaid-source", html)


def _strip_nonprintable(value: str) -> str:
    return "".join(character for character in value if character in string.printable)


def _unique_mermaid_id() -> str:
    return "".join(choice(string.ascii_letters) for _ in range(16))


class MermaidPreprocessor(Preprocessor):
    """Convert ```mermaid / ~~~mermaid fences into <div class="mermaid"> blocks."""

    def run(self, lines: list[str]) -> list[str]:
        new_lines: list[str] = []
        previous_line = ""
        fence_char = ""
        in_mermaid_code = False

        for line in lines:
            start_match = None if in_mermaid_code else MERMAID_FENCE_START_RE.match(line)
            end_match = None

            if in_mermaid_code:
                end_match = re.match(rf"^[{re.escape(fence_char)}]{{3}}[ \t]*$", line)
                if end_match is not None:
                    in_mermaid_code = False

            if start_match is not None:
                in_mermaid_code = True
                fence_char = start_match.group("fence_char")
                if not re.match(r"^[ \t]*$", previous_line):
                    new_lines.append("")
                new_lines.append(
                    f'<div class="mermaid" id="{_unique_mermaid_id()}">'
                )
            elif end_match is not None:
                new_lines.append("</div>")
                new_lines.append("")
            elif in_mermaid_code:
                new_lines.append(_strip_nonprintable(line).strip())
            else:
                new_lines.append(line)

            previous_line = line

        return new_lines


class MermaidExtension(Extension):
    def extendMarkdown(self, md) -> None:
        md.preprocessors.register(MermaidPreprocessor(md), "mermaid", 35)


def makeExtension(**kwargs) -> MermaidExtension:
    return MermaidExtension(**kwargs)
