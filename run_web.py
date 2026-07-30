import sys

import uvicorn

from src import config


def _ensure_std_streams() -> None:
    """Give uvicorn real output streams when launched under pythonw.exe.

    pythonw has no console, so sys.stdout / sys.stderr are None. Uvicorn's
    logging writes to stdout on startup and crashes the process (exit 1) when
    it's None — which silently kills the service when auto-started at logon.
    Redirect both to logs/web.log so the server runs windowless and still
    leaves a trace.
    """
    if sys.stdout is not None and sys.stderr is not None:
        return
    logs = config.logs_dir()
    logs.mkdir(parents=True, exist_ok=True)
    f = open(logs / "web.log", "a", buffering=1, encoding="utf-8")
    if sys.stdout is None:
        sys.stdout = f
    if sys.stderr is None:
        sys.stderr = f


if __name__ == "__main__":
    _ensure_std_streams()
    uvicorn.run("src.web.app:app", host="127.0.0.1", port=5000, reload=False)
