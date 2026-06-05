from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from .. import config
from .routes import router
from .setup_routes import router as setup_router

BASE = Path(__file__).parent

# Paths that should remain reachable even before the user has run setup.
_OPEN_PREFIXES = ("/setup", "/static", "/openapi.json", "/docs", "/redoc")


def create_app() -> FastAPI:
    app = FastAPI(title="Time Logger")
    app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")

    @app.middleware("http")
    async def gate_unconfigured(request: Request, call_next):
        """First-run gate: if no config.yaml exists yet, send every request
        to the web setup page until the user finishes onboarding."""
        if not config.is_configured():
            path = request.url.path
            if not any(path == p or path.startswith(p + "/") or path.startswith(p) for p in _OPEN_PREFIXES):
                return RedirectResponse("/setup", status_code=303)
        return await call_next(request)

    app.include_router(setup_router)
    app.include_router(router)
    return app


app = create_app()
