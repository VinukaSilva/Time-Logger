import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Iterator

log = logging.getLogger(__name__)

HOME_CLAUDE = Path.home() / ".claude" / "projects"


def candidate_dirs_for_path(path: str) -> set[str]:
    r"""Claude Code encodes a local cwd by replacing `:`, `\`, `/`, and spaces with `-`.

    Return the set of plausible project-dir names for a local absolute path,
    including both drive-letter casings (Windows drives are case-insensitive).
    """
    if not path:
        return set()

    def enc(p: str) -> str:
        return "".join("-" if c in (":", "\\", "/", " ") else c for c in p)

    out = {enc(path)}
    if len(path) > 1 and path[1] == ":":
        out.add(enc(path[0].swapcase() + path[1:]))
    return out


def _parse_ts(s: str) -> int | None:
    if not s:
        return None
    try:
        return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())
    except Exception:
        return None


def iter_events(start_ts: int, end_ts: int, project_dirs: set[str] | None = None) -> Iterator[dict]:
    """Yield Claude Code events (user prompts + tool_use calls) within [start_ts, end_ts).

    If ``project_dirs`` is given, only read sessions from those project directories
    (use this to scope to the project the block belongs to; otherwise Claude Code
    activity from unrelated projects would leak into the description).
    """
    if not HOME_CLAUDE.exists():
        return
    for project_dir in HOME_CLAUDE.iterdir():
        if not project_dir.is_dir():
            continue
        if project_dirs is not None and project_dir.name not in project_dirs:
            continue
        for jsonl in project_dir.glob("*.jsonl"):
            try:
                st = jsonl.stat()
                if st.st_mtime < start_ts - 3600:
                    continue
            except OSError:
                continue
            try:
                with jsonl.open("r", encoding="utf-8", errors="replace") as f:
                    for line in f:
                        if not line.strip():
                            continue
                        try:
                            row = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        ts = _parse_ts(row.get("timestamp", ""))
                        if not ts or ts < start_ts or ts >= end_ts:
                            continue
                        kind = row.get("type")
                        msg = row.get("message") or {}
                        content = msg.get("content")

                        if kind == "user":
                            if isinstance(content, str):
                                text = content.strip()
                            elif isinstance(content, list):
                                parts = [
                                    b.get("text", "")
                                    for b in content
                                    if isinstance(b, dict) and b.get("type") == "text"
                                ]
                                text = "\n".join(parts).strip()
                            else:
                                text = ""
                            if not text or text.startswith("<") or text.startswith("[Request"):
                                continue
                            yield {
                                "ts": ts,
                                "project_dir": project_dir.name,
                                "kind": "prompt",
                                "text": text[:600],
                            }
                            continue

                        if kind != "assistant" or not isinstance(content, list):
                            continue
                        for block in content:
                            if not isinstance(block, dict) or block.get("type") != "tool_use":
                                continue
                            yield {
                                "ts": ts,
                                "project_dir": project_dir.name,
                                "kind": "tool",
                                "tool": block.get("name"),
                                "input": block.get("input") or {},
                            }
            except Exception:
                log.exception("error reading %s", jsonl)
                continue


def summarize(events: list[dict]) -> dict:
    """Bucket tool_use events for description synthesis."""
    files_edited: list[str] = []
    files_written: list[str] = []
    files_read: list[str] = []
    bash_cmds: list[str] = []
    searches: list[str] = []

    for e in events:
        tool = (e.get("tool") or "").strip()
        inp = e.get("input") or {}
        if tool in ("Edit", "MultiEdit"):
            fp = inp.get("file_path")
            if fp and fp not in files_edited:
                files_edited.append(fp)
        elif tool == "Write":
            fp = inp.get("file_path")
            if fp and fp not in files_written:
                files_written.append(fp)
        elif tool == "Read":
            fp = inp.get("file_path")
            if fp and fp not in files_read:
                files_read.append(fp)
        elif tool == "Bash":
            cmd = (inp.get("command") or "").strip()
            if cmd:
                bash_cmds.append(cmd)
        elif tool == "Grep":
            q = (inp.get("pattern") or "").strip()
            if q:
                searches.append(q)

    return {
        "files_edited": files_edited,
        "files_written": files_written,
        "files_read": files_read,
        "bash_cmds": bash_cmds,
        "searches": searches,
        "event_count": len(events),
    }
