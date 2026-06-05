import logging
from pathlib import Path

from git import InvalidGitRepositoryError, NoSuchPathError, Repo

log = logging.getLogger(__name__)


def commit_files(repo_path: str, sha: str) -> list[str]:
    if not repo_path or not sha:
        return []
    try:
        repo = Repo(repo_path)
        commit = repo.commit(sha)
        return list(commit.stats.files.keys())[:15]
    except (InvalidGitRepositoryError, NoSuchPathError, ValueError):
        return []
    except Exception:
        log.exception("diff failed for %s @ %s", repo_path, sha)
        return []


def recent_working_tree_files(repo_path: str, start_ts: int, end_ts: int, max_files: int = 15) -> list[str]:
    """Files in the repo's working tree whose mtime falls within [start_ts, end_ts).

    Uses git status (staged/unstaged/untracked) as the candidate set to keep the
    scan bounded — much faster than walking the whole repo.
    """
    if not repo_path:
        return []
    try:
        repo = Repo(repo_path)
    except (InvalidGitRepositoryError, NoSuchPathError, ValueError):
        return []

    candidates: set[str] = set()
    try:
        for item in repo.index.diff(None):
            if item.a_path:
                candidates.add(item.a_path)
    except Exception:
        pass
    try:
        if not repo.head.is_detached:
            for item in repo.index.diff("HEAD"):
                if item.a_path:
                    candidates.add(item.a_path)
    except Exception:
        pass
    try:
        candidates.update(repo.untracked_files)
    except Exception:
        pass

    if not candidates:
        return []

    root = Path(repo_path)
    hits: list[tuple[float, str]] = []
    for rel in candidates:
        f = root / rel
        try:
            mt = f.stat().st_mtime
        except OSError:
            continue
        if start_ts <= mt < end_ts:
            hits.append((mt, str(rel).replace("\\", "/")))
    hits.sort(reverse=True)
    return [p for _, p in hits[:max_files]]
