"""First-run web onboarding routes.

Reachable at /setup whenever `config.is_configured()` is False (the middleware
in `app.py` redirects every other request here). After the user submits the
form successfully, we write config.yaml + .env atomically and redirect back
to the day view.

These routes share their logic with the CLI wizard via `src.setup.wizard`
(see `validate_jira_credentials`, `write_yaml`, `write_env`, etc.) so the
two surfaces stay in sync.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from .. import config
from ..setup import wizard
from ..setup.discover import default_label_for, find_git_repos

log = logging.getLogger(__name__)

router = APIRouter()
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
templates.env.cache = None


@router.get("/setup", response_class=HTMLResponse)
def setup_page(request: Request) -> HTMLResponse:
    """Render the first-run onboarding page with detected defaults."""
    existing_cfg = wizard.load_existing_config() if hasattr(wizard, "load_existing_config") else wizard._load_existing_config()
    existing_env = wizard.load_existing_env() if hasattr(wizard, "load_existing_env") else wizard._load_existing_env()

    detected_email = wizard.git_global("user.email")
    detected_name = wizard.git_global("user.name")
    has_claude = wizard.claude_code_on_path()

    return templates.TemplateResponse(
        request,
        "setup.html",
        {
            "request": request,
            "user_home": str(config.USER_HOME),
            "project_root": str(config.ROOT),
            "already_configured": config.is_configured(),
            "detected_email": detected_email,
            "detected_name": detected_name,
            "has_claude": has_claude,
            "existing_cfg": existing_cfg or {},
            "existing_env": existing_env or {},
        },
    )


@router.post("/setup/probe-repos")
async def probe_repos(request: Request) -> JSONResponse:
    """AJAX endpoint: given a parent path, return the git repos found under
    it (up to 3 levels deep, skipping noise dirs)."""
    body = await request.json()
    parent = (body.get("parent") or "").strip()
    if not parent:
        return JSONResponse({"ok": False, "error": "Missing parent path."}, status_code=400)
    p = Path(parent).expanduser()
    if not p.exists():
        return JSONResponse({"ok": False, "error": f"Path doesn't exist: {p}"}, status_code=400)
    if (p / ".git").is_dir():
        # Parent itself is a repo.
        return JSONResponse({"ok": True, "repos": [{"path": str(p.resolve()), "label": default_label_for(p)}]})
    found = find_git_repos(p)
    return JSONResponse({
        "ok": True,
        "repos": [{"path": str(r), "label": default_label_for(r)} for r in found],
    })


@router.post("/setup/test-jira")
async def test_jira(request: Request) -> JSONResponse:
    """AJAX endpoint: validate Jira credentials by calling /myself."""
    body = await request.json()
    result = wizard.validate_jira_credentials(
        body.get("base_url", ""),
        body.get("email", ""),
        body.get("token", ""),
    )
    return JSONResponse(result)


@router.post("/setup")
async def submit_setup(
    request: Request,
    git_emails: str = Form(""),
    repo_paths: list[str] = Form(default=[]),
    repo_labels: list[str] = Form(default=[]),
    jira_base_url: str = Form(""),
    jira_email: str = Form(""),
    jira_token: str = Form(""),
    llm_provider: str = Form("off"),
    llm_model: str = Form(""),
    anthropic_api_key: str = Form(""),
    gemini_api_key: str = Form(""),
    sheets_enabled: str = Form(""),
    google_oauth_path: str = Form("./secrets/google_oauth_client.json"),
):
    """Final submit: validate inputs, write config.yaml + .env, redirect to
    the day view. The middleware will stop intercepting once is_configured()
    becomes True."""
    # Validation — we're lenient so the user isn't locked out of fixing bad
    # entries from this page (re-submit overwrites).
    errors: list[str] = []
    if not jira_base_url.strip():
        errors.append("Jira base URL is required.")
    if not repo_paths:
        errors.append("Pick at least one git repo to track.")
    if len(repo_paths) != len(repo_labels):
        errors.append("Internal error: repo paths and labels don't match.")
    if errors:
        # Re-render with the supplied values + error list.
        return templates.TemplateResponse(
            request,
            "setup.html",
            {
                "request": request,
                "user_home": str(config.USER_HOME),
                "project_root": str(config.ROOT),
                "already_configured": config.is_configured(),
                "detected_email": jira_email or wizard.git_global("user.email"),
                "detected_name": wizard.git_global("user.name"),
                "has_claude": wizard.claude_code_on_path(),
                "existing_cfg": {},
                "existing_env": {},
                "errors": errors,
            },
            status_code=400,
        )

    # Build the config dict.
    emails = [e.strip().lower() for e in git_emails.replace(",", "\n").splitlines() if e.strip() and "@" in e]
    repos = [
        {"path": p.strip(), "label": (l or default_label_for(Path(p))).strip()}
        for p, l in zip(repo_paths, repo_labels)
        if p.strip()
    ]

    cfg: dict[str, Any] = {
        "repos": repos,
        "collector": {
            "poll_interval_seconds": 30,
            "idle_threshold_seconds": 300,
            "excluded_processes": [],
        },
        "llm": {
            "provider": llm_provider,
            "model": llm_model or {
                "anthropic": "claude-haiku-4-5",
                "gemini": "gemini-2.5-flash-lite",
                "claude_code": "claude-haiku-4-5",
                "off": "claude-haiku-4-5",
            }.get(llm_provider, "claude-haiku-4-5"),
            "max_output_tokens": 800,
            "temperature": 0.3,
        },
        "git": {"author_emails": emails},
        "jira": {"base_url": jira_base_url.strip().rstrip("/")},
        "sheets": {
            "sheet_id": None,
            "sheet_title": "Jira Time Log",
        },
        "paths": {"db": "db/timelogger.sqlite", "logs": "logs"},
    }

    env: dict[str, str] = {
        "JIRA_EMAIL": jira_email.strip(),
        "JIRA_API_TOKEN": jira_token.strip(),
        "GOOGLE_OAUTH_CLIENT_JSON": google_oauth_path.strip() or "./secrets/google_oauth_client.json",
        "GEMINI_API_KEY": gemini_api_key.strip(),
        "ANTHROPIC_API_KEY": anthropic_api_key.strip(),
    }

    cfg_path = config.USER_HOME / "config.yaml"
    env_path = config.USER_HOME / ".env"

    # Use the same atomic-write helpers the CLI wizard uses.
    wizard._write_yaml(cfg_path, cfg)
    wizard._write_env(env_path, env)
    log.info("setup complete: wrote %s and %s", cfg_path, env_path)

    # Re-read .env into the current process so the new values take effect
    # without restarting (load_dotenv has `override` for this).
    from dotenv import load_dotenv
    load_dotenv(env_path, override=True)
    config.invalidate_cache()

    return RedirectResponse("/", status_code=303)
