"""Claude Code CLI client — uses the user's team seat (no API key needed).

Spawns `claude -p` per polish call and passes the prompt via stdin to avoid
command-line escaping issues with long, structured input. Output is the model
response on stdout; we strip and return it.

Tradeoffs vs. a pure HTTP provider:
  - ~3–6 s of CLI cold-start per call (vs. ~1 s for a direct HTTP API hit).
  - Bills against the user's Claude Code subscription quota, not metered API
    credit. Sonnet / Opus quality.
  - Inherits whichever account is logged in to `claude` on the host.
"""
from __future__ import annotations

import logging
import shutil
import subprocess

from .client import LLMClient, LLMUnavailable

log = logging.getLogger(__name__)

# Generous per-call ceiling: a 5–10 KB prompt + cold-start + thinking.
_TIMEOUT_SECONDS = 120


class ClaudeCodeClient(LLMClient):
    def __init__(self, binary: str):
        # Resolve to an absolute path so subprocess doesn't go through cmd.exe's
        # PATH lookup on every call.
        self.binary = shutil.which(binary) or binary

    def polish(self, prompt: str) -> str:
        try:
            r = subprocess.run(
                [self.binary, "-p"],
                input=prompt,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=_TIMEOUT_SECONDS,
            )
        except FileNotFoundError as e:
            raise LLMUnavailable(
                f"Claude CLI not found at {self.binary!r}. Set CLAUDE_CODE_BIN in .env "
                "or install Claude Code."
            ) from e
        except subprocess.TimeoutExpired as e:
            raise LLMUnavailable(f"Claude CLI timed out after {_TIMEOUT_SECONDS}s") from e

        if r.returncode != 0:
            stderr = (r.stderr or "").strip()[:300]
            log.error("claude CLI exited %s: %s", r.returncode, stderr)
            raise LLMUnavailable(f"Claude CLI exit {r.returncode}: {stderr or '(no stderr)'}")

        text = (r.stdout or "").strip()
        if not text:
            raise LLMUnavailable("Claude CLI returned empty output")
        return text
