"""Tiny provider-agnostic LLM client used for block-description polish.

Each provider implements `polish(prompt) -> str`. Callers use `get_client()` and
treat a `None` return (or `LLMUnavailable` raise) as "fall back to the structured
output." This keeps the rest of the app unaware of which provider is wired up.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod

from .. import config

log = logging.getLogger(__name__)


class LLMUnavailable(RuntimeError):
    """Raised when the configured provider is disabled or missing credentials."""


class LLMClient(ABC):
    # Seconds the seed loop should sleep between calls to keep this provider
    # under its rate limit. Gemini free tier (15 RPM) needs ~4s; CLI and
    # Anthropic don't need a baseline throttle.
    min_call_interval_seconds: float = 0.0

    @abstractmethod
    def polish(self, prompt: str) -> str:
        """Send `prompt`, return the model's text response. Raises on failure."""


def get_client() -> LLMClient | None:
    """Return a ready-to-use client, or None when LLM polish is off / unconfigured."""
    provider = config.llm_provider()
    if provider in ("", "off", "none", "disabled"):
        return None

    if provider == "gemini":
        from .gemini import GeminiClient
        key = config.gemini_api_key()
        if not key:
            log.info("llm provider=gemini but GEMINI_API_KEY is empty — disabling")
            return None
        return GeminiClient(
            api_key=key,
            model=config.llm_model(),
            max_output_tokens=config.llm_max_output_tokens(),
            temperature=config.llm_temperature(),
        )

    if provider == "anthropic":
        from .anthropic import AnthropicClient
        key = config.anthropic_api_key()
        if not key:
            log.info("llm provider=anthropic but ANTHROPIC_API_KEY is empty — disabling")
            return None
        return AnthropicClient(
            api_key=key,
            model=config.llm_model(),
            max_output_tokens=config.llm_max_output_tokens(),
            temperature=config.llm_temperature(),
        )

    if provider in ("claude_code", "claude-code", "cli"):
        from .claude_code import ClaudeCodeClient
        return ClaudeCodeClient(binary=config.claude_code_path())

    log.warning("unknown llm provider: %r", provider)
    return None
