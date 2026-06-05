from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .routes import router

BASE = Path(__file__).parent


def create_app() -> FastAPI:
    app = FastAPI(title="Time Logger")
    app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")
    app.include_router(router)
    return app


app = create_app()
