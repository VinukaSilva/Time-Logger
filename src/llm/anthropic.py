"""Anthropic Messages API client — for users with a team API key.

Uses the v1/messages endpoint with prompt caching disabled (single-shot polish
calls don't benefit from caching). Defaults to Haiku 4.5 because it's the
cheapest model that still does this task well; the user can switch in config.
"""
from __future__ import annotations

import logging
import time

import requests

from .client import LLMClient, LLMUnavailable

log = logging.getLogger(__name__)

_ENDPOINT = "https://api.anthropic.com/v1/messages"
_API_VERSION = "2023-06-01"
_RETRIABLE_STATUS = {429, 500, 502, 503, 529}
_MAX_RETRIES = 2
_BACKOFF_BASE_SECONDS = 4.0


class AnthropicClient(LLMClient):
    def __init__(self, api_key: str, model: str, max_output_tokens: int, temperature: float):
        self.api_key = api_key
        self.model = model
        self.max_output_tokens = max_output_tokens
        self.temperature = temperature
        self.session = requests.Session()
        self.session.headers.update({
            "x-api-key": api_key,
            "anthropic-version": _API_VERSION,
            "content-type": "application/json",
        })

    def polish(self, prompt: str) -> str:
        body = {
            "model": self.model,
            "max_tokens": self.max_output_tokens,
            "temperature": self.temperature,
            "messages": [{"role": "user", "content": prompt}],
        }
        for attempt in range(_MAX_RETRIES + 1):
            r = self.session.post(_ENDPOINT, json=body, timeout=60)
            if r.status_code in _RETRIABLE_STATUS and attempt < _MAX_RETRIES:
                # Honor Retry-After when present, otherwise exponential backoff.
                hdr = r.headers.get("retry-after")
                delay = float(hdr) if hdr and hdr.replace(".", "", 1).isdigit() else _BACKOFF_BASE_SECONDS * (2 ** attempt)
                log.info("anthropic %s on attempt %d, sleeping %.1fs", r.status_code, attempt + 1, delay)
                time.sleep(delay)
                continue
            if not r.ok:
                log.error("anthropic call failed %s: %s", r.status_code, r.text[:300])
                raise LLMUnavailable(f"Anthropic API {r.status_code}: {r.text[:200]}")
            data = r.json()
            blocks = data.get("content") or []
            text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
            if not text:
                stop = data.get("stop_reason", "unknown")
                raise LLMUnavailable(f"Anthropic returned empty content (stop_reason={stop})")
            return text
        raise LLMUnavailable("Anthropic retry budget exhausted")
