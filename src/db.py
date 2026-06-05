import sqlite3
from contextlib import contextmanager

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    process_name TEXT,
    window_title TEXT,
    pid INTEGER,
    idle_seconds INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity(ts);

CREATE TABLE IF NOT EXISTS git_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    repo_path TEXT NOT NULL,
    event_type TEXT NOT NULL,
    commit_sha TEXT,
    branch TEXT,
    file_path TEXT,
    message TEXT,
    author_email TEXT
);
CREATE INDEX IF NOT EXISTS idx_git_events_ts ON git_events(ts);
CREATE INDEX IF NOT EXISTS idx_git_events_repo ON git_events(repo_path);

CREATE TABLE IF NOT EXISTS time_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    project_label TEXT,
    ticket_key TEXT,
    description TEXT,
    minutes INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    jira_worklog_id TEXT,
    sheet_row_appended_at INTEGER,
    submitted_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blocks_date ON time_blocks(date);

CREATE TABLE IF NOT EXISTS jira_tickets_cache (
    key TEXT PRIMARY KEY,
    summary TEXT,
    status TEXT,
    status_category TEXT,
    project_key TEXT,
    url TEXT,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""


def init() -> None:
    path = config.db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.executescript(SCHEMA)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(jira_tickets_cache)")}
        if "status_category" not in cols:
            conn.execute("ALTER TABLE jira_tickets_cache ADD COLUMN status_category TEXT")
        git_cols = {r[1] for r in conn.execute("PRAGMA table_info(git_events)")}
        if "author_email" not in git_cols:
            conn.execute("ALTER TABLE git_events ADD COLUMN author_email TEXT")


@contextmanager
def connect():
    init()
    conn = sqlite3.connect(config.db_path())
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
