import os
from pathlib import Path

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

_cfg: dict | None = None


def load() -> dict:
    global _cfg
    if _cfg is None:
        with open(ROOT / "config.yaml", "r", encoding="utf-8") as f:
            _cfg = yaml.safe_load(f)
    return _cfg


def db_path() -> Path:
    return (ROOT / load()["paths"]["db"]).resolve()


def logs_dir() -> Path:
    return (ROOT / load()["paths"]["logs"]).resolve()


def repos() -> list[dict]:
    return load()["repos"]


def custom_projects() -> list[dict]:
    return load().get("projects") or []


def poll_interval() -> int:
    return int(load()["collector"]["poll_interval_seconds"])


def idle_threshold() -> int:
    return int(load()["collector"]["idle_threshold_seconds"])


def excluded_processes() -> set[str]:
    raw = load()["collector"].get("excluded_processes") or []
    return {str(p).strip().lower() for p in raw if p}


def jira_base_url() -> str:
    return load()["jira"]["base_url"].rstrip("/")


def jira_extra_jql() -> list[str]:
    raw = load().get("jira", {}).get("extra_jql") or []
    return [str(q).strip() for q in raw if str(q).strip()]


def git_author_emails() -> set[str]:
    """Lower-cased set of commit-author emails to count toward the user's
    activity. Empty set means "no filter — count every commit"."""
    raw = load().get("git", {}).get("author_emails") or []
    return {str(e).strip().lower() for e in raw if str(e).strip()}


def llm_provider() -> str:
    return str(load().get("llm", {}).get("provider") or "off").strip().lower()


def llm_model() -> str:
    return str(load().get("llm", {}).get("model") or "gemini-2.0-flash").strip()


def llm_max_output_tokens() -> int:
    return int(load().get("llm", {}).get("max_output_tokens") or 800)


def llm_temperature() -> float:
    return float(load().get("llm", {}).get("temperature") or 0.3)


def gemini_api_key() -> str:
    return os.environ.get("GEMINI_API_KEY", "")


def anthropic_api_key() -> str:
    return os.environ.get("ANTHROPIC_API_KEY", "")


def claude_code_path() -> str:
    """Optional override for the `claude` CLI binary (Windows + WSL paths differ)."""
    return os.environ.get("CLAUDE_CODE_BIN", "claude")


def jira_email() -> str:
    return os.environ.get("JIRA_EMAIL", "")


def jira_token() -> str:
    return os.environ.get("JIRA_API_TOKEN", "")


def google_oauth_client_path() -> Path:
    return (ROOT / os.environ.get("GOOGLE_OAUTH_CLIENT_JSON", "./secrets/google_oauth_client.json")).resolve()


def sheet_id() -> str | None:
    return load()["sheets"].get("sheet_id")


def sheet_title() -> str:
    return load()["sheets"].get("sheet_title", "Jira Time Log")
