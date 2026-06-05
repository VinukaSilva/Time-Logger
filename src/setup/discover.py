"""Discover git repos under a user-supplied parent directory.

Per project rule, we never auto-enumerate drives — only the path the user
explicitly types. From there we walk a bounded depth, treating a directory
as a repo if it contains a `.git/` folder, and stopping recursion once
we hit one (so a parent repo doesn't get duplicated by nested submodules).
"""
from __future__ import annotations

from pathlib import Path


def find_git_repos(parent: Path, max_depth: int = 3) -> list[Path]:
    """Return all repos found under `parent` up to `max_depth` levels down.

    `parent` itself is treated as a repo if it has a `.git/`.
    Hidden / system directories (`.venv`, `node_modules`, `__pycache__`,
    `dist`, `build`) are skipped to keep the scan snappy.
    """
    skip_names = {
        ".venv", "venv", "env", "node_modules", "__pycache__",
        "dist", "build", ".pytest_cache", ".mypy_cache", ".ruff_cache",
        ".idea", ".vscode", "site-packages",
    }
    found: list[Path] = []

    def _walk(d: Path, depth: int) -> None:
        try:
            entries = list(d.iterdir())
        except (PermissionError, OSError):
            return
        if (d / ".git").is_dir():
            found.append(d.resolve())
            return  # don't descend into a found repo
        if depth >= max_depth:
            return
        for child in entries:
            if not child.is_dir():
                continue
            if child.name.startswith(".") and child.name != ".git":
                continue
            if child.name in skip_names:
                continue
            _walk(child, depth + 1)

    if not parent.exists():
        return []
    _walk(parent, 0)
    return sorted(found)


def default_label_for(repo: Path) -> str:
    """Suggest a human label from the repo path — basename, but if it equals
    the parent (e.g. `foo/foo`) just use `foo` instead of `foo (foo)`."""
    name = repo.name
    parent = repo.parent.name
    if parent and parent != name and parent not in (".", ""):
        return f"{parent} / {name}"
    return name
