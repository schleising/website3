import re


MERMAID_CLASS_RE = re.compile(r'\bmermaid\b')


def disable_mermaid_autorun_markup(html: str) -> str:
    return MERMAID_CLASS_RE.sub("mermaid-source", html)