from __future__ import annotations

import re


_MARKDOWN_TABLE_DIVIDER_RE = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$")


def build_markdown_preview(text: str, max_length: int = 220) -> str:
    if text.strip() == "":
        return "No preview available."

    plain_text = _strip_non_preview_markdown_blocks(text)
    plain_text = re.sub(r"`{1,3}[^`]*`{1,3}", " ", plain_text)
    plain_text = re.sub(r"!\[[^\]]*\]\([^\)]*\)", " ", plain_text)
    plain_text = re.sub(r"\[[^\]]*\]\([^\)]*\)", " ", plain_text)
    plain_text = re.sub(r"^[#>\-\*\s]+", "", plain_text, flags=re.MULTILINE)
    plain_text = re.sub(r"\s+", " ", plain_text).strip()

    if plain_text == "":
        return "No preview available."

    if len(plain_text) <= max_length:
        return plain_text

    clipped = plain_text[:max_length].rsplit(" ", 1)[0].strip()
    if clipped == "":
        clipped = plain_text[:max_length].strip()
    return f"{clipped}..."


def _strip_non_preview_markdown_blocks(text: str) -> str:
    filtered_lines: list[str] = []
    lines = text.splitlines()
    in_fenced_block = False
    fence_char = ""
    line_index = 0

    while line_index < len(lines):
        line = lines[line_index]
        stripped_line = line.strip()
        fence_match = re.match(r"^(```+|~~~+)", stripped_line)

        if fence_match is not None:
            current_fence_char = fence_match.group(1)[0]
            if not in_fenced_block:
                in_fenced_block = True
                fence_char = current_fence_char
            elif current_fence_char == fence_char:
                in_fenced_block = False
                fence_char = ""
            line_index += 1
            continue

        if in_fenced_block:
            line_index += 1
            continue

        next_line = lines[line_index + 1].strip() if line_index + 1 < len(lines) else ""
        if "|" in stripped_line and _MARKDOWN_TABLE_DIVIDER_RE.match(next_line):
            line_index += 2
            while line_index < len(lines) and _looks_like_markdown_table_row(lines[line_index]):
                line_index += 1
            continue

        filtered_lines.append(line)
        line_index += 1

    return "\n".join(filtered_lines)


def _looks_like_markdown_table_row(line: str) -> bool:
    stripped_line = line.strip()
    return stripped_line != "" and "|" in stripped_line