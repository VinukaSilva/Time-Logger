"""Markdown → Atlassian Document Format (ADF) converter.

Targets the worklog comment field. Supports the formatting subset that fits
short technical notes: paragraphs, headings, bullet / ordered lists,
blockquotes, code blocks, horizontal rules, hard breaks, and inline marks
(bold, italic, code, strike, link). Emojis stay as unicode text — they
render natively in Jira.
"""
from __future__ import annotations

from typing import Any

from markdown_it import MarkdownIt
from markdown_it.token import Token

_md = MarkdownIt("commonmark", {"breaks": True, "linkify": True})


def _empty_doc() -> dict[str, Any]:
    return {"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": []}]}


_CODE_EXCLUDES = {"em", "link", "strike", "strong", "subsup", "textColor", "underline"}


def _normalize_marks(marks: list[dict]) -> list[dict]:
    """ADF rejects illegal mark combinations (e.g. code+strong) and refuses the
    whole document with a 400. The `code` mark in particular excludes most
    other inline marks — when both are present, keep `code` and drop the rest."""
    if any(m.get("type") == "code" for m in marks):
        return [m for m in marks if m.get("type") not in _CODE_EXCLUDES]
    return marks


def _text_node(text: str, marks: list[dict] | None = None) -> dict[str, Any]:
    node: dict[str, Any] = {"type": "text", "text": text}
    if marks:
        cleaned = _normalize_marks(marks)
        if cleaned:
            node["marks"] = cleaned
    return node


def _inline_to_adf(token: Token) -> list[dict]:
    """Convert one `inline` token's children into a list of ADF inline nodes."""
    out: list[dict] = []
    marks: list[dict] = []

    def push_mark(name: str, attrs: dict | None = None) -> None:
        m: dict[str, Any] = {"type": name}
        if attrs:
            m["attrs"] = attrs
        marks.append(m)

    def pop_mark(name: str) -> None:
        for i in range(len(marks) - 1, -1, -1):
            if marks[i]["type"] == name:
                marks.pop(i)
                return

    for child in token.children or []:
        t = child.type
        if t == "text":
            if child.content:
                out.append(_text_node(child.content, list(marks) if marks else None))
        elif t == "softbreak":
            # Treat soft line wrap as a single space inside a paragraph.
            if out and out[-1].get("type") == "text" and not out[-1]["text"].endswith(" "):
                out[-1]["text"] += " "
        elif t == "hardbreak":
            out.append({"type": "hardBreak"})
        elif t == "strong_open":
            push_mark("strong")
        elif t == "strong_close":
            pop_mark("strong")
        elif t == "em_open":
            push_mark("em")
        elif t == "em_close":
            pop_mark("em")
        elif t == "s_open":
            push_mark("strike")
        elif t == "s_close":
            pop_mark("strike")
        elif t == "code_inline":
            extra = list(marks) + [{"type": "code"}]
            out.append(_text_node(child.content or "", extra))
        elif t == "link_open":
            href = (child.attrs or {}).get("href", "")
            push_mark("link", {"href": href})
        elif t == "link_close":
            pop_mark("link")
        # Anything else (images, html_inline, etc.) — skip silently.
    return out


def _consume_block(tokens: list[Token], i: int) -> tuple[dict | None, int]:
    """Read one block-level construct starting at index i, return (node, next_index)."""
    tok = tokens[i]
    t = tok.type

    if t == "paragraph_open":
        inline = tokens[i + 1]
        content = _inline_to_adf(inline) if inline.type == "inline" else []
        # ADF rejects empty `content`; emit empty paragraph as {} or omit content.
        node: dict[str, Any] = {"type": "paragraph"}
        if content:
            node["content"] = content
        return node, i + 3  # paragraph_open, inline, paragraph_close

    if t == "heading_open":
        level = int(tok.tag[1]) if tok.tag and tok.tag.startswith("h") else 1
        inline = tokens[i + 1]
        content = _inline_to_adf(inline) if inline.type == "inline" else []
        node = {"type": "heading", "attrs": {"level": level}}
        if content:
            node["content"] = content
        return node, i + 3

    if t == "bullet_list_open":
        return _consume_list(tokens, i, "bulletList", "bullet_list_close")

    if t == "ordered_list_open":
        return _consume_list(tokens, i, "orderedList", "ordered_list_close")

    if t == "blockquote_open":
        children, j = _consume_until(tokens, i + 1, "blockquote_close")
        return {"type": "blockquote", "content": children or [{"type": "paragraph"}]}, j + 1

    if t == "code_block" or t == "fence":
        lang = (tok.info or "").strip().split()[0] if tok.info else ""
        text = tok.content.rstrip("\n")
        node = {"type": "codeBlock"}
        if lang:
            node["attrs"] = {"language": lang}
        if text:
            node["content"] = [{"type": "text", "text": text}]
        return node, i + 1

    if t == "hr":
        return {"type": "rule"}, i + 1

    # Unknown / unhandled block — skip past it conservatively.
    return None, i + 1


def _consume_list(tokens: list[Token], i: int, adf_type: str, close_type: str) -> tuple[dict, int]:
    items: list[dict] = []
    j = i + 1
    while j < len(tokens) and tokens[j].type != close_type:
        if tokens[j].type == "list_item_open":
            children, k = _consume_until(tokens, j + 1, "list_item_close")
            items.append({"type": "listItem", "content": children or [{"type": "paragraph"}]})
            j = k + 1
        else:
            j += 1
    return {"type": adf_type, "content": items}, j + 1


def _consume_until(tokens: list[Token], i: int, close_type: str) -> tuple[list[dict], int]:
    children: list[dict] = []
    j = i
    while j < len(tokens) and tokens[j].type != close_type:
        node, j_next = _consume_block(tokens, j)
        if node is not None:
            children.append(node)
        j = j_next
    return children, j


def markdown_to_adf(text: str) -> dict[str, Any]:
    """Parse markdown source into an ADF document. Falls back to an empty
    paragraph for blank input or any parse error."""
    if not text or not text.strip():
        return _empty_doc()
    try:
        tokens = _md.parse(text)
        content, _ = _consume_until(tokens, 0, close_type="__never__")
        if not content:
            content = [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]
        return {"type": "doc", "version": 1, "content": content}
    except Exception:
        return {
            "type": "doc",
            "version": 1,
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
        }
