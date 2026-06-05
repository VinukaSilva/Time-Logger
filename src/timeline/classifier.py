import re
from pathlib import Path

from .. import config, db

JIRA_KEY_RE = re.compile(r"\b([A-Z][A-Z0-9_]{1,9}-\d{1,6})\b")


def known_ticket_keys() -> set[str]:
    with db.connect() as conn:
        rows = conn.execute("SELECT key FROM jira_tickets_cache").fetchall()
    return {r["key"] for r in rows}


def repo_tokens() -> list[tuple[str, str]]:
    tokens: list[tuple[str, str]] = []
    for r in config.repos():
        basename = Path(r["path"]).name.lower()
        tokens.append((basename, r["label"]))
    return tokens


def custom_project_rules() -> list[dict]:
    """Return [{label, keywords (lower), processes (lower)}] from config.yaml `projects`."""
    out: list[dict] = []
    for p in config.custom_projects():
        label = (p.get("label") or "").strip()
        if not label:
            continue
        keywords = [str(k).strip().lower() for k in (p.get("keywords") or []) if k]
        processes = [str(pr).strip().lower() for pr in (p.get("processes") or []) if pr]
        if not keywords and not processes:
            continue
        out.append({"label": label, "keywords": keywords, "processes": processes})
    return out


def _app_kind(process_name: str, title: str) -> str | None:
    pn = (process_name or "").lower()
    wt = (title or "").lower()
    if "code.exe" in pn or "cursor" in pn or "idea" in pn or "pycharm" in pn:
        return "editor"
    if pn in {"chrome.exe", "firefox.exe", "msedge.exe", "brave.exe", "arc.exe"}:
        return "browser"
    if "slack" in pn or "teams" in pn or "discord" in pn or "zoom" in pn:
        return "chat"
    if pn in {"windowsterminal.exe", "cmd.exe", "powershell.exe", "wt.exe"} or "bash" in pn:
        return "terminal"
    return None


def classify(
    window_title: str,
    process_name: str,
    known_keys: set[str],
    tokens: list[tuple[str, str]],
    custom_rules: list[dict] | None = None,
) -> dict:
    wt = window_title or ""
    wt_lower = wt.lower()
    pn_lower = (process_name or "").lower()
    result = {
        "project_label": None,
        "ticket_key": None,
        "app_kind": _app_kind(process_name, wt),
    }

    # Custom project rules first (more specific intent)
    for rule in custom_rules or []:
        if pn_lower and pn_lower in rule["processes"]:
            result["project_label"] = rule["label"]
            break
        if any(kw and kw in wt_lower for kw in rule["keywords"]):
            result["project_label"] = rule["label"]
            break

    # Fall back to repo basename matching
    if not result["project_label"]:
        for token, label in tokens:
            if token and token in wt_lower:
                result["project_label"] = label
                break

    m = JIRA_KEY_RE.search(wt)
    if m and m.group(1) in known_keys:
        result["ticket_key"] = m.group(1)
    return result
