"""Configuration loader.

User config + DB + logs live INSIDE the project folder by default. Everything
the app needs (config.yaml, .env, db/, logs/, secrets/) sits next to the code,
so the whole tool is one self-contained directory.

If you'd rather keep personal data outside the repo (Windows AppData style,
multi-user machine, etc.) set `TIMELOGGER_HOME=<absolute path>` in your
environment and the loader will look there instead.

Either way, none of these files are committed — `.gitignore` excludes them.
"""
import os
from pathlib import Path

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent


def _user_home() -> Path:
    """Where personal config + data lives. Defaults to the project root so
    every user-state file sits next to the code. Override with
    TIMELOGGER_HOME=<absolute path> to relocate (e.g. to %LOCALAPPDATA%)."""
    override = os.environ.get("TIMELOGGER_HOME")
    if override:
        return Path(override).expanduser().resolve()
    return ROOT


USER_HOME = _user_home()
USER_HOME.mkdir(parents=True, exist_ok=True)


# Load .env from USER_HOME.
_env_path = USER_HOME / ".env"
if _env_path.exists():
    load_dotenv(_env_path)


_cfg: dict | None = None
_cfg_path: Path | None = None


def _config_path() -> Path:
    global _cfg_path
    if _cfg_path is not None:
        return _cfg_path
    user_cfg = USER_HOME / "config.yaml"
    if not user_cfg.exists():
        raise FileNotFoundError(
            f"No config.yaml found at:\n  {user_cfg}\n\n"
            f"Run `python run_setup.py` to create one, or copy the template:\n"
            f'  copy "{ROOT / "config.example.yaml"}" "{user_cfg}"'
        )
    _cfg_path = user_cfg
    return user_cfg


def load() -> dict:
    global _cfg
    if _cfg is None:
        with open(_config_path(), "r", encoding="utf-8") as f:
            _cfg = yaml.safe_load(f)
    return _cfg


def is_configured() -> bool:
    """True iff a config.yaml exists at the expected location. Used by the
    web onboarding middleware to detect fresh-clone state and redirect to
    /setup before any request can hit code that assumes config is loaded."""
    return (USER_HOME / "config.yaml").exists()


def invalidate_cache() -> None:
    """Drop the in-memory cached config so the next `load()` re-reads from disk.
    Called by the web setup handler after writing config.yaml so the running
    process picks up the new values without a restart."""
    global _cfg, _cfg_path
    _cfg = None
    _cfg_path = None


def _resolve_path(raw: str) -> Path:
    """Absolute paths are used as-is; relative paths are resolved against
    USER_HOME (which defaults to the project root)."""
    p = Path(raw).expanduser()
    if p.is_absolute():
        return p.resolve()
    return (USER_HOME / p).resolve()


def db_path() -> Path:
    return _resolve_path(load()["paths"]["db"])


def logs_dir() -> Path:
    return _resolve_path(load()["paths"]["logs"])


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
    raw = os.environ.get("GOOGLE_OAUTH_CLIENT_JSON", "./secrets/google_oauth_client.json")
    return _resolve_path(raw)


def sheet_id() -> str | None:
    return load()["sheets"].get("sheet_id")


def sheet_title() -> str:
    return load()["sheets"].get("sheet_title", "Jira Time Log")
