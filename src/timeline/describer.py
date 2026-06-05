from pathlib import Path

from .. import claude_history
from ..git_scanner import diffs


def _dedup(xs: list[str]) -> list[str]:
    seen = set()
    out = []
    for x in xs:
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _basename(p: str) -> str:
    if not p:
        return ""
    return Path(p).name


APP_NAMES = {
    "olk.exe": "Outlook",
    "outlook.exe": "Outlook",
    "chrome.exe": "Chrome",
    "msedge.exe": "Edge",
    "firefox.exe": "Firefox",
    "brave.exe": "Brave",
    "arc.exe": "Arc",
    "ssms.exe": "SSMS",
    "pbidesktop.exe": "Power BI",
    "code.exe": "VS Code",
    "cursor.exe": "Cursor",
    "windowsterminal.exe": "Terminal",
    "wt.exe": "Terminal",
    "powershell.exe": "PowerShell",
    "cmd.exe": "Command Prompt",
    "slack.exe": "Slack",
    "teams.exe": "Teams",
    "discord.exe": "Discord",
    "zoom.exe": "Zoom",
    "explorer.exe": "File Explorer",
}


def _friendly_app(proc: str) -> str:
    if not proc:
        return ""
    return APP_NAMES.get(proc.lower()) or proc


_NOISE_TITLES = {"", "new tab", "blank page", "untitled"}


def minimal_description(
    top_apps: list[str],
    top_titles: list[str] | None,
    project_label: str | None,
) -> str:
    """Description for blocks without a tracked repo.

    Names the app(s) and lists the page / window titles seen during the block —
    these are usually meaningful for browser tabs (Sheets / Databricks / Azure DF /
    Jira board) and email subjects (Outlook). The user fills in any extra detail.
    """
    apps = [_friendly_app(p) for p in (top_apps or []) if p]
    apps = list(dict.fromkeys(a for a in apps if a))[:3]
    apps_str = ", ".join(apps) if apps else "various apps"

    titles: list[str] = []
    seen: set[str] = set()
    for t in (top_titles or []):
        t = (t or "").strip()
        if not t or t.lower() in _NOISE_TITLES or t in seen:
            continue
        seen.add(t)
        titles.append(t)
        if len(titles) >= 6:
            break

    header = f"Worked in {apps_str}"
    if project_label:
        header += f" — {project_label}"

    if not titles:
        return header

    bullets = "\n".join(f"  • {t[:160]}" for t in titles)
    return f"{header}\n\nActivity:\n{bullets}"


def gather_signals(
    start_ts: int,
    end_ts: int,
    project_label: str | None,
    repo_path: str | None,
    git_events: list[dict],
    top_titles: list[str] | None = None,
) -> dict:
    """Collect every available signal about what was done in this block.

    The returned dict is the single source of truth for both the structured
    formatter (`format_signals`) and the LLM synthesizer (`describer_llm`).
    """
    commits_in = [e for e in git_events if e.get("event_type") == "commit"]
    commits = [
        {
            "sha": (c.get("commit_sha") or "")[:7],
            "message": c.get("message") or "",
            "files": diffs.commit_files(repo_path, c.get("commit_sha") or "") if repo_path else [],
        }
        for c in commits_in
    ]

    if repo_path:
        project_dirs = claude_history.candidate_dirs_for_path(repo_path)
        claude_events = list(
            claude_history.iter_events(start_ts, end_ts, project_dirs=project_dirs)
        )
    else:
        # No repo backing this block (custom project / unclassified) — Claude Code
        # cannot be reliably scoped, so omit it entirely rather than leak unrelated
        # session content from other projects.
        claude_events = []
    prompts = [e for e in claude_events if e.get("kind") == "prompt"]
    tool_events = [e for e in claude_events if e.get("kind") == "tool"]
    cc = claude_history.summarize(tool_events)

    working_tree = (
        diffs.recent_working_tree_files(repo_path, start_ts, end_ts) if repo_path else []
    )

    duration_min = max(1, (end_ts - start_ts) // 60)

    return {
        "project_label": project_label or "",
        "duration_min": duration_min,
        "commits": commits,
        "claude_prompts": [p["text"] for p in prompts][:10],
        "claude_files_edited": cc["files_edited"][:15],
        "claude_files_written": cc["files_written"][:10],
        "claude_files_read": cc["files_read"][:15],
        "claude_bash_cmds": cc["bash_cmds"][:10],
        "claude_searches": cc["searches"][:5],
        "working_tree_files": working_tree,
        "top_titles": (top_titles or [])[:8],
    }


def format_signals(signals: dict) -> str:
    """Structured-bullet description from a signals dict (used as LLM fallback)."""
    commits = signals["commits"]
    prompts = signals["claude_prompts"]
    project_label = signals["project_label"]

    committed_files = _dedup([f for c in commits for f in (c.get("files") or [])])
    all_files_full = _dedup(
        committed_files
        + signals["working_tree_files"]
        + signals["claude_files_edited"]
        + signals["claude_files_written"]
    )
    all_file_names = _dedup([_basename(p) for p in all_files_full])

    lines: list[str] = []

    if len(commits) == 1:
        lines.append(commits[0]["message"])
    elif commits:
        lines.append(f"{len(commits)} commits on {project_label or 'the project'}")
    elif prompts:
        first = (prompts[0] or "").splitlines()[0].strip()
        lines.append(first[:200])
    elif project_label:
        lines.append(f"Work on {project_label}")
    else:
        lines.append("Work session")

    intent: list[str] = []
    seen_prefixes: set[str] = set()
    for p in prompts:
        first_line = (p or "").splitlines()[0].strip()
        if not first_line:
            continue
        key = first_line.lower()[:45]
        if key in seen_prefixes:
            continue
        seen_prefixes.add(key)
        intent.append(first_line[:180])
        if len(intent) >= 5:
            break
    if intent and (commits or len(intent) > 1):
        lines.append("")
        lines.append("Session prompts:")
        for p in intent[:5]:
            lines.append(f"  • {p}")

    activity_bullets: list[str] = []
    if signals["claude_files_edited"]:
        names = _dedup([_basename(f) for f in signals["claude_files_edited"]])[:10]
        activity_bullets.append(f"Edited: {', '.join(names)}")
    if signals["claude_files_written"]:
        names = _dedup([_basename(f) for f in signals["claude_files_written"]])[:8]
        activity_bullets.append(f"Created/wrote: {', '.join(names)}")
    for cmd in signals["claude_bash_cmds"][:4]:
        activity_bullets.append(f"Ran: {cmd[:140]}")
    for q in signals["claude_searches"][:2]:
        activity_bullets.append(f'Searched: "{q[:80]}"')
    if activity_bullets:
        lines.append("")
        lines.append("Worked on (via Claude Code):")
        for b in activity_bullets:
            lines.append(f"  • {b}")

    claude_basenames = {
        _basename(f) for f in (signals["claude_files_edited"] + signals["claude_files_written"])
    }
    fresh_tree = [
        f for f in signals["working_tree_files"]
        if f not in committed_files and _basename(f) not in claude_basenames
    ]
    if fresh_tree:
        lines.append("")
        lines.append("Modified files in the repo:")
        for f in fresh_tree[:8]:
            lines.append(f"  • {f}")

    if len(commits) > 1:
        lines.append("")
        lines.append("Commits:")
        for c in commits:
            lines.append(f"  • {c['sha']}  {c['message']}")

    if all_file_names:
        lines.append("")
        lines.append(f"Files: {', '.join(all_file_names[:12])}")

    observed = _dedup([t for t in signals["top_titles"] if t])
    if observed and not commits and not activity_bullets and not fresh_tree:
        lines.append("")
        lines.append("Observed during the block:")
        for t in observed[:5]:
            lines.append(f"  • {t[:140]}")

    return "\n".join(lines).strip()


def describe(
    start_ts: int,
    end_ts: int,
    project_label: str | None,
    repo_path: str | None,
    git_events: list[dict],
    top_titles: list[str] | None = None,
) -> str:
    """Backwards-compat: gather signals and produce structured description."""
    return format_signals(
        gather_signals(start_ts, end_ts, project_label, repo_path, git_events, top_titles)
    )
