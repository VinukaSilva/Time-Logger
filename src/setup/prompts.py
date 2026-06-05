"""Tiny CLI prompt helpers used by the setup wizard.

Kept dependency-free (stdlib only) so the wizard runs cleanly on a fresh
venv without pulling in `rich` / `questionary` / `prompt_toolkit` etc.
"""
from __future__ import annotations

import getpass
import sys
from typing import Sequence


# Visual primitives -----------------------------------------------------------


def print_step(n: int, total: int, title: str) -> None:
    print()
    print(f"━━ Step {n}/{total} — {title} " + "━" * max(2, 60 - len(title)))


def print_header(title: str) -> None:
    print()
    print("━" * 70)
    print(f"  {title}")
    print("━" * 70)


def print_done(msg: str = "Done.") -> None:
    print(f"  ✓ {msg}")


def print_warn(msg: str) -> None:
    print(f"  ! {msg}", file=sys.stderr)


# Input primitives ------------------------------------------------------------


def ask(prompt: str, default: str | None = None, allow_empty: bool = False) -> str:
    """Plain-text prompt. Press Enter to accept the default."""
    hint = f" [{default}]" if default else ""
    while True:
        try:
            raw = input(f"  {prompt}{hint}: ").strip()
        except EOFError:
            raw = ""
        if raw:
            return raw
        if default is not None:
            return default
        if allow_empty:
            return ""
        print_warn("Required. Please enter a value.")


def ask_secret(prompt: str, default: str | None = None) -> str:
    """Secret prompt. Input is not echoed. Press Enter to keep the previous value
    (when `default` is supplied — shown as `[••••]`)."""
    hint = " [keep existing]" if default else ""
    while True:
        raw = getpass.getpass(f"  {prompt}{hint}: ").strip()
        if raw:
            return raw
        if default is not None:
            return default
        print_warn("Required. Please enter a value.")


def ask_yes_no(prompt: str, default: bool = False) -> bool:
    default_label = "Y/n" if default else "y/N"
    while True:
        try:
            raw = input(f"  {prompt} [{default_label}]: ").strip().lower()
        except EOFError:
            raw = ""
        if not raw:
            return default
        if raw in ("y", "yes"):
            return True
        if raw in ("n", "no"):
            return False
        print_warn("Please answer y or n.")


def ask_choice(prompt: str, options: Sequence[str], default_idx: int = 0) -> int:
    """Numbered choice prompt. Returns the 0-based index of the chosen option."""
    print(f"  {prompt}")
    for i, opt in enumerate(options, start=1):
        marker = " *" if i - 1 == default_idx else "  "
        print(f"    {marker}[{i}] {opt}")
    while True:
        try:
            raw = input(f"  Pick [{default_idx + 1}]: ").strip()
        except EOFError:
            raw = ""
        if not raw:
            return default_idx
        try:
            idx = int(raw) - 1
        except ValueError:
            print_warn(f"Enter a number 1..{len(options)}.")
            continue
        if 0 <= idx < len(options):
            return idx
        print_warn(f"Pick a number between 1 and {len(options)}.")


def ask_multi_choice(prompt: str, options: Sequence[str]) -> list[int]:
    """Multi-select. User types e.g. `1,3,5` or `all` or `none`. Returns list
    of 0-based indices."""
    print(f"  {prompt}")
    for i, opt in enumerate(options, start=1):
        print(f"    [{i}] {opt}")
    while True:
        try:
            raw = input("  Pick (e.g. 1,3 or all or none): ").strip().lower()
        except EOFError:
            raw = ""
        if raw in ("", "all"):
            return list(range(len(options)))
        if raw == "none":
            return []
        try:
            idxs = sorted({int(s) - 1 for s in raw.replace(" ", "").split(",") if s})
        except ValueError:
            print_warn("Use numbers separated by commas, or `all` / `none`.")
            continue
        if all(0 <= i < len(options) for i in idxs):
            return idxs
        print_warn(f"Numbers must be between 1 and {len(options)}.")
