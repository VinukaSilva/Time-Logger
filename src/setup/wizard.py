"""Interactive setup wizard for Time Logger.

Walks a new user through:
  1. Git identity → used as the commit-author filter for description signals
  2. Tracked git repos → discover under user-supplied parent paths
  3. Atlassian Jira → base URL + email + API token, validated by /myself
  4. LLM polish → claude_code (default) / anthropic / gemini / off
  5. Google Sheets → optional; only enables the weekly worklog appender

Writes `config.yaml` + `.env` atomically into the Time Logger home directory
(project folder by default; see `src.config.USER_HOME`). Re-runnable — if a
config already exists, each step proposes the current value as the default.

Usage:
    python run_setup.py
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path

import yaml
from dotenv import dotenv_values

from .. import config
from .discover import default_label_for, find_git_repos
from .prompts import (
    ask, ask_choice, ask_multi_choice, ask_secret, ask_yes_no,
    print_done, print_header, print_step, print_warn,
)

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# File I/O helpers
# ---------------------------------------------------------------------------


def _atomic_write(path: Path, content: str) -> None:
    """Write to a sibling .tmp file then atomic-rename. On Windows os.replace
    handles atomic rename even over an existing file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)


def _write_yaml(path: Path, data: dict) -> None:
    text = yaml.safe_dump(data, sort_keys=False, default_flow_style=False, indent=2, allow_unicode=True)
    _atomic_write(path, text)


def _write_env(path: Path, env: dict[str, str]) -> None:
    lines = [
        "# Time Logger environment — written by `python run_setup.py`.",
        "# Hand-edit if you need to; the wizard re-reads on next run.",
        "",
        "# --- Jira ---",
        f"JIRA_EMAIL={env.get('JIRA_EMAIL', '')}",
        f"JIRA_API_TOKEN={env.get('JIRA_API_TOKEN', '')}",
        "",
        "# --- Google Sheets (optional) ---",
        f"GOOGLE_OAUTH_CLIENT_JSON={env.get('GOOGLE_OAUTH_CLIENT_JSON', './secrets/google_oauth_client.json')}",
        "",
        "# --- LLM polish (optional) ---",
        f"GEMINI_API_KEY={env.get('GEMINI_API_KEY', '')}",
        f"ANTHROPIC_API_KEY={env.get('ANTHROPIC_API_KEY', '')}",
    ]
    if env.get("CLAUDE_CODE_BIN"):
        lines.append(f"CLAUDE_CODE_BIN={env['CLAUDE_CODE_BIN']}")
    lines.append("")
    _atomic_write(path, "\n".join(lines))


def _load_existing_config() -> dict:
    cfg_path = config.USER_HOME / "config.yaml"
    if not cfg_path.exists():
        return {}
    try:
        with open(cfg_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except Exception:
        return {}


def _load_existing_env() -> dict[str, str]:
    env_path = config.USER_HOME / ".env"
    if not env_path.exists():
        return {}
    return {k: v or "" for k, v in dotenv_values(env_path).items()}


def git_global(key: str) -> str:
    """Read a `git config --global` value or empty string."""
    try:
        r = subprocess.run(["git", "config", "--global", key], capture_output=True, text=True, timeout=5)
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""


def claude_code_on_path() -> bool:
    """Return True if a `claude` CLI is reachable on PATH."""
    try:
        r = subprocess.run(["claude", "--version"], capture_output=True, text=True, timeout=5)
        return r.returncode == 0
    except Exception:
        return False


# Back-compat aliases — the underscore versions used to be private; keep them
# pointing at the public ones so any external code that imported them still works.
_git_global = git_global
_claude_code_on_path = claude_code_on_path


# Public re-exports (kept underscore-private internally for organisation).
def load_existing_config() -> dict:
    """Return the current config.yaml as a dict, or {} if it doesn't exist."""
    return _load_existing_config()


def load_existing_env() -> dict[str, str]:
    """Return the current .env as a dict, or {} if it doesn't exist."""
    return _load_existing_env()


def validate_jira_credentials(base_url: str, email: str, token: str, timeout: int = 15) -> dict:
    """Hit /rest/api/3/myself to test creds. Returns {ok, display_name, email}
    on success, {ok=False, status, detail} on failure. Used by both the CLI
    wizard and the web onboarding 'Test connection' button."""
    import requests
    base_url = (base_url or "").rstrip("/")
    if not base_url or not email or not token:
        return {"ok": False, "status": 0, "detail": "Missing base URL, email, or token."}
    try:
        r = requests.get(
            f"{base_url}/rest/api/3/myself",
            auth=(email, token),
            headers={"Accept": "application/json"},
            timeout=timeout,
        )
    except Exception as e:
        return {"ok": False, "status": 0, "detail": f"Could not reach Jira: {e}"}
    if not r.ok:
        return {"ok": False, "status": r.status_code, "detail": r.text[:200]}
    me = r.json()
    return {
        "ok": True,
        "display_name": me.get("displayName", ""),
        "email": me.get("emailAddress", ""),
    }


# ---------------------------------------------------------------------------
# Wizard steps
# ---------------------------------------------------------------------------


TOTAL_STEPS = 5


def step_git_identity(existing_cfg: dict) -> list[str]:
    print_step(1, TOTAL_STEPS, "Your git author email")
    print("    Time Logger only counts commits authored by you toward block")
    print("    descriptions. Add one or more emails (work, personal, GitHub noreply).")

    current = (existing_cfg.get("git", {}) or {}).get("author_emails") or []
    detected = git_global("user.email")
    if detected and detected not in current:
        current = current + [detected]
    elif not current and detected:
        current = [detected]

    if current:
        print(f"    Currently configured: {', '.join(current)}")
    if detected:
        print(f"    Detected from `git config --global user.email`: {detected}")

    emails: list[str] = []
    while True:
        default = (current[len(emails)] if len(emails) < len(current) else None) or (detected if not emails else None)
        prompt = f"Email #{len(emails) + 1} (press Enter to finish)" if emails else "First author email"
        e = ask(prompt, default=default, allow_empty=True)
        if not e:
            break
        if "@" not in e:
            print_warn("Doesn't look like an email; try again.")
            continue
        emails.append(e.lower())
    print_done(f"{len(emails)} author email{'s' if len(emails) != 1 else ''} configured")
    return emails


def step_repos(existing_cfg: dict) -> list[dict]:
    print_step(2, TOTAL_STEPS, "Tracked git repositories")
    print("    Time Logger watches these repos for commits + working-tree changes")
    print("    when seeding block descriptions. Enter a parent directory and the")
    print("    wizard will discover git repos under it (up to 3 levels deep).")

    existing = existing_cfg.get("repos") or []
    if existing:
        print()
        print("    Currently tracked:")
        for r in existing:
            print(f"      - {r.get('label','?'):<24} {r.get('path','?')}")
        if not ask_yes_no("Replace these with a fresh selection?", default=False):
            return existing

    tracked: list[dict] = []
    while True:
        path_str = ask("Parent path to scan (Enter to finish)", allow_empty=True)
        if not path_str:
            break
        parent = Path(path_str).expanduser()
        if not parent.exists():
            print_warn(f"Path doesn't exist: {parent}")
            continue
        # If the path IS a repo, just add it.
        if (parent / ".git").is_dir():
            label = ask(f"Label for {parent}", default=default_label_for(parent))
            tracked.append({"path": str(parent.resolve()), "label": label})
            print_done(f"Added {label}")
            continue

        repos = find_git_repos(parent)
        if not repos:
            print_warn(f"No git repos found under {parent}.")
            continue

        labels = [f"{default_label_for(r)}  ({r})" for r in repos]
        picks = ask_multi_choice("Which repos to track?", labels)
        for i in picks:
            label = ask(f"Label for {repos[i]}", default=default_label_for(repos[i]))
            tracked.append({"path": str(repos[i]), "label": label})

        print_done(f"{len(picks)} added from {parent}")

    print_done(f"{len(tracked)} repo{'s' if len(tracked) != 1 else ''} tracked")
    return tracked


def step_jira(existing_cfg: dict, existing_env: dict[str, str]) -> tuple[str, str, str]:
    print_step(3, TOTAL_STEPS, "Atlassian Jira")
    base_default = (existing_cfg.get("jira", {}) or {}).get("base_url") or ""
    base_url = ask("Atlassian base URL (e.g. https://your-org.atlassian.net)", default=base_default or None)
    base_url = base_url.rstrip("/")

    email_default = existing_env.get("JIRA_EMAIL") or ""
    email = ask("Atlassian email (account you sign in to Jira with)", default=email_default or None)

    print("    Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens")
    token_default = existing_env.get("JIRA_API_TOKEN") or ""
    token = ask_secret("API token", default=token_default or None)

    # Validate by calling /myself (shared helper, also used by web onboarding).
    result = validate_jira_credentials(base_url, email, token)
    if result["ok"]:
        print_done(f"authenticated as {result['display_name']} ({result['email']})")
    elif result["status"]:
        print_warn(f"Jira responded {result['status']}. Token / email may be wrong, but values were saved.")
    else:
        print_warn(f"{result['detail']} Values saved; check connectivity later.")

    return base_url, email, token


def step_llm(existing_cfg: dict, existing_env: dict[str, str]) -> tuple[str, str, dict[str, str]]:
    print_step(4, TOTAL_STEPS, "LLM description polish (optional)")
    print("    When enabled, auto-seeded block descriptions get rewritten by an LLM")
    print("    into MR-style markdown. Pick one provider or skip.")

    has_claude = claude_code_on_path()
    current = (existing_cfg.get("llm", {}) or {}).get("provider") or ("claude_code" if has_claude else "off")
    options = [
        f"claude_code   — local `claude` CLI (no API key){'  [detected]' if has_claude else '  [not found]'}",
        "anthropic     — Anthropic API (needs ANTHROPIC_API_KEY)",
        "gemini        — Google AI Studio free tier (needs GEMINI_API_KEY)",
        "off           — disabled, use structured fallback",
    ]
    keys = ["claude_code", "anthropic", "gemini", "off"]
    default_idx = keys.index(current) if current in keys else 0
    idx = ask_choice("Provider", options, default_idx=default_idx)
    provider = keys[idx]

    model_default = (existing_cfg.get("llm", {}) or {}).get("model") or {
        "anthropic": "claude-haiku-4-5",
        "gemini": "gemini-2.5-flash-lite",
        "claude_code": "claude-haiku-4-5",
        "off": "claude-haiku-4-5",
    }[provider]

    env_updates: dict[str, str] = {}

    if provider == "anthropic":
        model_default = ask("Model name", default=model_default)
        print("    Get a key from https://console.anthropic.com")
        key = ask_secret("ANTHROPIC_API_KEY", default=existing_env.get("ANTHROPIC_API_KEY") or None)
        env_updates["ANTHROPIC_API_KEY"] = key
    elif provider == "gemini":
        model_default = ask("Model name", default=model_default)
        print("    Get a free-tier key from https://aistudio.google.com/app/apikey")
        key = ask_secret("GEMINI_API_KEY", default=existing_env.get("GEMINI_API_KEY") or None)
        env_updates["GEMINI_API_KEY"] = key
    elif provider == "claude_code" and not has_claude:
        print_warn("`claude` CLI not on PATH. Install Claude Code or pick a different provider.")
        if not ask_yes_no("Save provider=claude_code anyway (will fall back to structured at runtime)?", default=False):
            provider = "off"

    print_done(f"provider: {provider}")
    return provider, model_default, env_updates


def step_sheets(existing_cfg: dict, existing_env: dict[str, str]) -> tuple[str | None, str]:
    print_step(5, TOTAL_STEPS, "Google Sheets weekly log (optional)")
    print("    Time Logger can append every submitted worklog to a weekly Google Sheet")
    print("    as a backup. Requires a Google OAuth client JSON. Skip if you don't need it.")
    if not ask_yes_no("Enable Sheets integration?", default=False):
        sid_default = (existing_cfg.get("sheets", {}) or {}).get("sheet_id")
        title_default = (existing_cfg.get("sheets", {}) or {}).get("sheet_title", "Jira Time Log")
        return sid_default, title_default

    print("    Set up an OAuth client at https://console.cloud.google.com/apis/credentials")
    print("    Create a 'Desktop app' OAuth client ID and download the JSON.")
    default_json = existing_env.get("GOOGLE_OAUTH_CLIENT_JSON") or "./secrets/google_oauth_client.json"
    json_path = ask("Path to your OAuth client JSON", default=default_json)
    title = ask("Sheet title", default=(existing_cfg.get("sheets", {}) or {}).get("sheet_title", "Jira Time Log"))
    return None, title  # sheet_id is filled in on first submit by SheetsClient.ensure_sheet()


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def run() -> int:
    logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    print_header("Time Logger — interactive setup")
    print(f"  Config home:   {config.USER_HOME}")
    print(f"  Project root:  {config.ROOT}")
    if config.USER_HOME != config.ROOT:
        print(f"  (TIMELOGGER_HOME is set; writing config + .env to the override path)")

    existing_cfg = _load_existing_config()
    existing_env = _load_existing_env()
    if existing_cfg:
        print()
        print("  An existing config.yaml was found. Each step will propose your current")
        print("  values as the default — press Enter to keep them.")

    try:
        author_emails = step_git_identity(existing_cfg)
        repos = step_repos(existing_cfg)
        base_url, jira_email, jira_token = step_jira(existing_cfg, existing_env)
        llm_provider, llm_model, llm_env = step_llm(existing_cfg, existing_env)
        sheet_id, sheet_title = step_sheets(existing_cfg, existing_env)
    except (KeyboardInterrupt, EOFError):
        print()
        print_warn("Setup interrupted. Nothing has been written.")
        return 1

    # Merge existing-but-untouched fields so we don't lose user customizations.
    new_cfg: dict = dict(existing_cfg)
    new_cfg["repos"] = repos
    new_cfg["collector"] = new_cfg.get("collector") or {
        "poll_interval_seconds": 30,
        "idle_threshold_seconds": 300,
        "excluded_processes": [],
    }
    new_cfg["llm"] = {
        **(existing_cfg.get("llm") or {}),
        "provider": llm_provider,
        "model": llm_model,
        "max_output_tokens": (existing_cfg.get("llm") or {}).get("max_output_tokens", 800),
        "temperature": (existing_cfg.get("llm") or {}).get("temperature", 0.3),
    }
    new_cfg["git"] = {"author_emails": author_emails}
    new_cfg["jira"] = {
        **(existing_cfg.get("jira") or {}),
        "base_url": base_url,
    }
    new_cfg["sheets"] = {
        **(existing_cfg.get("sheets") or {}),
        "sheet_id": sheet_id,
        "sheet_title": sheet_title,
    }
    new_cfg["paths"] = new_cfg.get("paths") or {"db": "db/timelogger.sqlite", "logs": "logs"}

    new_env = dict(existing_env)
    new_env["JIRA_EMAIL"] = jira_email
    new_env["JIRA_API_TOKEN"] = jira_token
    new_env.update(llm_env)

    print_header("Summary")
    print(f"  config.yaml   → {config.USER_HOME / 'config.yaml'}")
    print(f"  .env          → {config.USER_HOME / '.env'}")
    print(f"  Repos:        {len(repos)}")
    print(f"  Jira:         {base_url} ({jira_email or '?'})")
    print(f"  LLM:          {llm_provider}" + (f"  ({llm_model})" if llm_provider != "off" else ""))
    print(f"  Sheets:       {'enabled' if sheet_id is not None or sheet_title else 'disabled'}")
    if not ask_yes_no("Write these values?", default=True):
        print_warn("Aborted. Nothing has been written.")
        return 1

    _write_yaml(config.USER_HOME / "config.yaml", new_cfg)
    _write_env(config.USER_HOME / ".env", new_env)

    print()
    print_done("Setup complete.")
    print("  Next:")
    print("    python run_collector.py     — start the activity tray")
    print("    python run_web.py           — open the review UI at http://127.0.0.1:5000")
    return 0


if __name__ == "__main__":
    sys.exit(run())
