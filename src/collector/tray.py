import logging
import threading
import time
from logging.handlers import RotatingFileHandler

import pystray
from PIL import Image, ImageDraw

from .. import config, db, kv
from ..git_scanner import scanner as git_scanner
from . import window_watcher

log = logging.getLogger("collector")

_stop = threading.Event()
_paused = threading.Event()


def _setup_logging() -> None:
    logs = config.logs_dir()
    logs.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(logs / "collector.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    handler.setFormatter(fmt)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)


def _make_icon(paused: bool = False) -> Image.Image:
    img = Image.new("RGB", (64, 64), (25, 30, 45))
    d = ImageDraw.Draw(img)
    color = (180, 180, 180) if paused else (100, 200, 255)
    d.ellipse((6, 6, 58, 58), fill=color)
    d.line((32, 16, 32, 34), fill=(20, 20, 20), width=4)
    d.line((32, 34, 46, 42), fill=(20, 20, 20), width=4)
    return img


def _collect_once() -> None:
    idle = window_watcher.idle_seconds()
    aw = window_watcher.active_window()
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO activity (ts, process_name, window_title, pid, idle_seconds) VALUES (?, ?, ?, ?, ?)",
            (int(time.time()), aw["process_name"], aw["window_title"], aw["pid"], idle),
        )


def _collect_loop() -> None:
    interval = config.poll_interval()
    while not _stop.is_set():
        if not _paused.is_set():
            try:
                _collect_once()
            except Exception:
                log.exception("collector sample failed")
        _stop.wait(interval)


GIT_SCAN_INTERVAL_SECONDS = 30 * 60
JIRA_REFRESH_INTERVAL_SECONDS = 30 * 60


def _git_scan_loop() -> None:
    while not _stop.is_set():
        if not _paused.is_set():
            try:
                result = git_scanner.scan_all()
                if result["total"]:
                    log.info("git scan: %d new commits", result["total"])
            except Exception:
                log.exception("git scan failed")
        _stop.wait(GIT_SCAN_INTERVAL_SECONDS)


def _jira_refresh_loop() -> None:
    # initial small delay so we don't slam Jira on tray boot
    _stop.wait(60)
    while not _stop.is_set():
        if not _paused.is_set():
            try:
                from ..jira_client.client import JiraClient
                n = JiraClient().cache_my_tickets()
                log.info("jira refresh: cached %d tickets", n)
            except Exception:
                log.exception("jira refresh failed")
        _stop.wait(JIRA_REFRESH_INTERVAL_SECONDS)


def _toggle_pause(icon, _item) -> None:
    if _paused.is_set():
        _paused.clear()
        icon.icon = _make_icon(paused=False)
        icon.title = "Time Logger - running"
        log.info("collector resumed")
    else:
        _paused.set()
        icon.icon = _make_icon(paused=True)
        icon.title = "Time Logger - paused"
        log.info("collector paused")


def _quit(icon, _item) -> None:
    log.info("collector quitting")
    _stop.set()
    icon.stop()


def run() -> None:
    _setup_logging()
    db.init()
    log.info("collector starting, poll=%ss, db=%s", config.poll_interval(), config.db_path())

    threading.Thread(target=_collect_loop, daemon=True).start()
    threading.Thread(target=_git_scan_loop, daemon=True).start()
    threading.Thread(target=_jira_refresh_loop, daemon=True).start()

    menu = pystray.Menu(
        pystray.MenuItem(lambda item: "Resume" if _paused.is_set() else "Pause", _toggle_pause),
        pystray.MenuItem("Quit", _quit),
    )
    icon = pystray.Icon("TimeLogger", _make_icon(False), "Time Logger - running", menu)
    icon.run()
