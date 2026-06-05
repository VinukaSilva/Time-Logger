"""Google Gemini client over the generativelanguage REST endpoint.

Uses the public AI Studio API (free tier with a personal Google account). No
extra Python dependency beyond `requests`.
"""
from __future__ import annotations

import logging
import re
import time

import requests

from .client import LLMClient, LLMUnavailable

log = logging.getLogger(__name__)

_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
_RETRIABLE_STATUS = {429, 503}
_MAX_RETRIES = 2
_RETRY_CAP_SECONDS = 30.0
_FALLBACK_RETRY_SECONDS = 15.0


def _parse_retry_delay(response: requests.Response) -> float | None:
    """Extract Gemini's suggested retry delay from a 429/503 response body."""
    try:
        details = response.json().get("error", {}).get("details", [])
    except Exception:
        return None
    for d in details:
        if str(d.get("@type", "")).endswith("RetryInfo"):
            m = re.match(r"(\d+(?:\.\d+)?)s", str(d.get("retryDelay", "")))
            if m:
                return float(m.group(1))
    return None


class GeminiClient(LLMClient):
    # Free-tier cap is 15 RPM; pace at ~12 RPM to leave headroom.
    min_call_interval_seconds = 4.0

    def __init__(self, api_key: str, model: str, max_output_tokens: int, temperature: float):
        self.api_key = api_key
        self.model = model
        self.max_output_tokens = max_output_tokens
        self.temperature = temperature
        self.session = requests.Session()

    def polish(self, prompt: str) -> str:
        url = _ENDPOINT.format(model=self.model)
        body = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "maxOutputTokens": self.max_output_tokens,
                "temperature": self.temperature,
            },
        }
        for attempt in range(_MAX_RETRIES + 1):
            r = self.session.post(url, params={"key": self.api_key}, json=body, timeout=30)
            if r.status_code in _RETRIABLE_STATUS and attempt < _MAX_RETRIES:
                delay = _parse_retry_delay(r) or _FALLBACK_RETRY_SECONDS
                delay = min(delay, _RETRY_CAP_SECONDS)
                log.info("gemini %s on attempt %d, sleeping %.1fs before retry",
                         r.status_code, attempt + 1, delay)
                time.sleep(delay)
                continue
            if not r.ok:
                log.error("gemini call failed %s: %s", r.status_code, r.text[:300])
                raise LLMUnavailable(f"Gemini API {r.status_code}: {r.text[:200]}")
            data = r.json()
            candidates = data.get("candidates") or []
            if not candidates:
                reason = (data.get("promptFeedback") or {}).get("blockReason", "no candidates")
                raise LLMUnavailable(f"Gemini returned no output ({reason})")
            parts = ((candidates[0].get("content") or {}).get("parts") or [])
            text = "".join(p.get("text", "") for p in parts).strip()
            if not text:
                raise LLMUnavailable("Gemini returned empty text")
            return text
        # Loop exited without returning — should not happen, but be explicit.
        raise LLMUnavailable("Gemini retry budget exhausted")
