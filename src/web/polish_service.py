"""LLM polish for auto-seeded block descriptions.

Given a signals dict (see `describer.gather_signals`), build a prompt that asks
the configured LLM to produce a clean, MR-style markdown summary, and return
its text. Designed to fail soft — the caller falls back to the structured
formatter when this raises.
"""
from __future__ import annotations

import logging

from ..llm import LLMUnavailable, get_client

log = logging.getLogger(__name__)


def _build_prompt(signals: dict, current: str) -> str:
    duration = signals.get("duration_min", 0)
    project = signals.get("project_label") or "(unspecified)"
    commits = signals.get("commits") or []
    prompts = signals.get("claude_prompts") or []
    files_edited = signals.get("claude_files_edited") or []
    files_written = signals.get("claude_files_written") or []
    files_read = signals.get("claude_files_read") or []
    bash_cmds = signals.get("claude_bash_cmds") or []
    searches = signals.get("claude_searches") or []
    working_tree = signals.get("working_tree_files") or []
    titles = signals.get("top_titles") or []

    parts: list[str] = []
    parts.append(
        "You are generating a Jira worklog description for a software-engineering work session.\n"
        "Rules (follow strictly):\n"
        "- Write in passive voice (e.g. 'Fixed X', 'Reviewed Y', 'Tested Z', 'Checked A').\n"
        "- Do NOT use first person (no 'I', 'we', 'my').\n"
        "- Do NOT use third person ('the developer', 'the engineer', 'he', 'she').\n"
        "- Do NOT use speculation words: 'likely', 'probably', 'may have', 'seems to', 'appears to', 'possibly'.\n"
        "- Do NOT include meta-commentary about the nature of the session.\n"
        "- Do NOT mention the absence of commits, code changes, or any signals — if nothing was coded, describe the activity from the browser pages instead.\n"
        "- When code signals are present (commits, files, Claude tasks), describe them specifically.\n"
        "- When only browser/app pages are available, use the page names to write concrete worklog entries — e.g. 'Reviewed chat UI on Knowledge Hive', 'Tested admin panel', 'Checked pipeline run in ADF'. Treat page titles as direct evidence of what was reviewed or tested.\n"
        "- Be concise and factual. 3–8 bullet points is ideal."
    )
    parts.append(f"Project: {project}")
    parts.append(f"Duration: {duration} minutes")

    if commits:
        parts.append("\nCommits in this window:")
        for c in commits[:8]:
            msg = (c.get("message") or "").strip().splitlines()[0]
            files = c.get("files") or []
            file_hint = f" — files: {', '.join(files[:6])}" if files else ""
            parts.append(f"  - {c.get('sha','')} {msg}{file_hint}")

    if prompts:
        parts.append("\nQuestions / tasks asked of Claude Code (paraphrasing what the developer wanted):")
        for p in prompts[:8]:
            parts.append(f"  - {p[:280]}")

    if files_written:
        parts.append("\nFiles written (via Claude Code): " + ", ".join(files_written[:10]))
    if files_edited:
        parts.append("Files edited (via Claude Code): " + ", ".join(files_edited[:10]))
    if files_read:
        parts.append("Files read for context: " + ", ".join(files_read[:10]))
    if bash_cmds:
        parts.append("Shell commands run: " + " | ".join(bash_cmds[:6]))
    if searches:
        parts.append("Code searches: " + " | ".join(searches[:4]))
    if working_tree:
        parts.append("Uncommitted working-tree changes touched: " + ", ".join(working_tree[:10]))
    adf_pipelines = signals.get("adf_pipelines") or []
    if adf_pipelines:
        parts.append("Azure Data Factory pipelines accessed: " + ", ".join(adf_pipelines))
    if titles:
        parts.append("Browser/app pages open during this session: " + " | ".join(t[:80] for t in titles[:8]))

    if current and current.strip():
        parts.append("\nExisting structured draft (refine or replace, do not copy meta-commentary):")
        parts.append("```\n" + current.strip() + "\n```")

    parts.append(
        "\nOutput the Jira worklog description in markdown only. Use short bullet points. "
        "Mention specific files, commits, or functions where relevant. "
        "No preamble, no 'Summary:' heading, no sign-off, no invented details. "
        "Output the description only."
    )
    return "\n".join(parts)


def polish_signals(signals: dict, current: str = "") -> str:
    """Run the configured LLM on the gathered signals and return polished markdown.

    Raises LLMUnavailable when no client is configured or the call fails. The
    caller is expected to catch this and fall back to the structured formatter.
    """
    client = get_client()
    if client is None:
        raise LLMUnavailable("LLM polish disabled (no provider configured or API key missing).")
    prompt = _build_prompt(signals, current)
    log.info("polish prompt %d chars, %d commits, %d prompts",
             len(prompt), len(signals.get("commits") or []), len(signals.get("claude_prompts") or []))
    return client.polish(prompt)


def is_enabled() -> bool:
    """True if an LLM client is currently configured and usable."""
    return get_client() is not None


def min_call_interval() -> float:
    """Provider-recommended sleep (seconds) between successive polish calls."""
    c = get_client()
    return float(getattr(c, "min_call_interval_seconds", 0.0)) if c else 0.0
