import logging
import time
from datetime import datetime, timedelta, timezone

from git import InvalidGitRepositoryError, NoSuchPathError, Repo

from .. import config, db

log = logging.getLogger(__name__)

LOOKBACK_DAYS = 90


def _seen_shas(conn, repo_path: str, since_ts: int) -> set[str]:
    rows = conn.execute(
        "SELECT commit_sha FROM git_events WHERE repo_path = ? AND event_type = 'commit' AND ts >= ?",
        (repo_path, since_ts),
    ).fetchall()
    return {r["commit_sha"] for r in rows if r["commit_sha"]}


def _current_branch(repo: Repo) -> str | None:
    try:
        return repo.active_branch.name
    except (TypeError, Exception):
        return None


def _scan_repo(repo_cfg: dict, conn) -> int:
    path = repo_cfg["path"]
    label = repo_cfg.get("label", path)
    try:
        repo = Repo(path)
    except (InvalidGitRepositoryError, NoSuchPathError) as e:
        log.warning("skip %s: %s", path, e)
        return 0

    since = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
    since_iso = since.isoformat()
    since_ts = int(since.timestamp())
    seen = _seen_shas(conn, path, since_ts)
    # Empty set means "no filter" (pre-v2 behavior); a populated set restricts
    # description signals to the user's own commits.
    author_filter = config.git_author_emails()

    inserted = 0
    skipped_other_authors = 0
    try:
        for commit in repo.iter_commits(all=True, since=since_iso):
            if commit.hexsha in seen:
                continue
            author_email = (commit.author.email or "").strip().lower()
            if author_filter and author_email not in author_filter:
                skipped_other_authors += 1
                continue
            seen.add(commit.hexsha)
            ts = int(commit.authored_date)
            message = (commit.message or "").strip().split("\n", 1)[0][:500]
            conn.execute(
                "INSERT INTO git_events (ts, repo_path, event_type, commit_sha, message, author_email) "
                "VALUES (?, ?, 'commit', ?, ?, ?)",
                (ts, path, commit.hexsha, message, author_email),
            )
            inserted += 1
    except Exception:
        log.exception("error iterating commits in %s", path)
    if skipped_other_authors:
        log.info("scan %s: skipped %d commit(s) by other authors", label, skipped_other_authors)

    try:
        if repo.is_dirty(untracked_files=True):
            unstaged = len(repo.index.diff(None))
            staged = len(repo.index.diff("HEAD")) if not repo.head.is_detached else 0
            untracked = len(repo.untracked_files)
            conn.execute(
                "INSERT INTO git_events (ts, repo_path, event_type, branch, message) VALUES (?, ?, 'working_tree', ?, ?)",
                (int(time.time()), path, _current_branch(repo), f"unstaged={unstaged} staged={staged} untracked={untracked}"),
            )
    except Exception:
        log.exception("error snapshotting working tree for %s", path)

    log.info("scanned %s: %d new commits", label, inserted)
    return inserted


def scan_all() -> dict:
    total = 0
    per_repo: dict[str, int] = {}
    with db.connect() as conn:
        for repo_cfg in config.repos():
            try:
                n = _scan_repo(repo_cfg, conn)
                per_repo[repo_cfg["path"]] = n
                total += n
            except Exception:
                log.exception("error scanning %s", repo_cfg.get("path"))
                per_repo[repo_cfg["path"]] = -1
    return {"total": total, "per_repo": per_repo}
