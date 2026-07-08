import logging
import time as time_mod

from .. import config, db
from ..llm import LLMUnavailable
from ..timeline import describer
from . import polish_service

log = logging.getLogger(__name__)


def list_for_date(date_str: str) -> list[dict]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM time_blocks WHERE date = ? ORDER BY start_ts",
            (date_str,),
        ).fetchall()
    return [dict(r) for r in rows]


def get(block_id: int) -> dict | None:
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM time_blocks WHERE id = ?", (block_id,)).fetchone()
    return dict(row) if row else None


def create(
    date_str: str,
    start_ts: int,
    end_ts: int,
    project_label: str | None,
    ticket_key: str | None,
    description: str,
) -> int:
    minutes = max(1, round((end_ts - start_ts) / 60))
    now = int(time_mod.time())
    with db.connect() as conn:
        cur = conn.execute(
            """INSERT INTO time_blocks
               (date, start_ts, end_ts, project_label, ticket_key, description, minutes, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)""",
            (date_str, start_ts, end_ts, project_label, ticket_key, description, minutes, now, now),
        )
        return cur.lastrowid


def update(
    block_id: int,
    *,
    start_ts: int | None = None,
    end_ts: int | None = None,
    project_label: str | None = None,
    ticket_key: str | None = None,
    description: str | None = None,
) -> None:
    current = get(block_id)
    if not current:
        return
    new_start = start_ts if start_ts is not None else current["start_ts"]
    new_end = end_ts if end_ts is not None else current["end_ts"]
    new_minutes = max(1, round((new_end - new_start) / 60))
    now = int(time_mod.time())
    with db.connect() as conn:
        conn.execute(
            """UPDATE time_blocks
               SET start_ts = ?, end_ts = ?, minutes = ?,
                   project_label = COALESCE(?, project_label),
                   ticket_key = ?,
                   description = COALESCE(?, description),
                   updated_at = ?
               WHERE id = ?""",
            (new_start, new_end, new_minutes, project_label, ticket_key, description, now, block_id),
        )


def bulk_set_ticket(block_ids: list[int], ticket_key: str | None) -> int:
    """Set ticket_key on multiple draft blocks at once. Returns rows updated.

    Submitted blocks are skipped — they're already in Jira and shouldn't be
    silently retargeted.
    """
    ids = [int(i) for i in block_ids if i]
    if not ids:
        return 0
    now = int(time_mod.time())
    placeholders = ",".join("?" * len(ids))
    with db.connect() as conn:
        cur = conn.execute(
            f"""UPDATE time_blocks
                SET ticket_key = ?, updated_at = ?
                WHERE id IN ({placeholders}) AND status = 'draft'""",
            (ticket_key or None, now, *ids),
        )
        return cur.rowcount or 0


def delete(block_id: int) -> None:
    with db.connect() as conn:
        conn.execute("DELETE FROM time_blocks WHERE id = ? AND status = 'draft'", (block_id,))


def delete_all_drafts(date_str: str) -> int:
    with db.connect() as conn:
        cur = conn.execute("DELETE FROM time_blocks WHERE date = ? AND status = 'draft'", (date_str,))
        return cur.rowcount or 0


def _describe_segment(seg, llm_enabled: bool) -> tuple[str, bool, bool, str | None]:
    """Build the stored description for a segment.

    Returns `(text, polished, attempted, error)`:
      - polished:  the stored text came from the LLM rewrite
      - attempted: an LLM call was actually made (False when no repo / no key)
      - error:     short message when an attempted call failed (None otherwise)
    """
    repo_path = None
    for r in config.repos():
        if r.get("label") == seg.project_label:
            repo_path = r.get("path")
            break

    if not repo_path:
        if llm_enabled and seg.top_titles:
            signals = describer.gather_signals(
                int(seg.start.timestamp()),
                int(seg.end.timestamp()),
                seg.project_label,
                None,
                seg.git_events,
                top_titles=seg.top_titles,
            )
            structured = describer.minimal_description(seg.top_apps, seg.top_titles, seg.project_label)
            try:
                return polish_service.polish_signals(signals, structured), True, True, None
            except LLMUnavailable as e:
                log.warning("polish unavailable for %s-%s, using minimal fallback: %s", seg.start, seg.end, e)
            except Exception as e:
                log.exception("polish failed for no-repo segment %s-%s", seg.start, seg.end)
        return describer.minimal_description(seg.top_apps, seg.top_titles, seg.project_label), False, False, None

    signals = describer.gather_signals(
        int(seg.start.timestamp()),
        int(seg.end.timestamp()),
        seg.project_label,
        repo_path,
        seg.git_events,
        top_titles=seg.top_titles,
    )
    structured = describer.format_signals(signals)
    if not llm_enabled:
        return structured, False, False, None
    try:
        return polish_service.polish_signals(signals, structured), True, True, None
    except LLMUnavailable as e:
        log.warning("polish unavailable for %s-%s, using structured fallback: %s",
                    seg.start, seg.end, e)
        return structured, False, True, str(e)
    except Exception as e:
        log.exception("polish failed for segment %s-%s", seg.start, seg.end)
        return structured, False, True, f"{type(e).__name__}: {e}"


def seed_from_segments(date_str: str, segments) -> dict:
    """Seed draft blocks from both work and standalone unclassified segments.

    Returns a result dict the route uses to build a clear flash:
      - created:     total blocks inserted
      - attempted:   segments where an LLM call was actually made
      - polished:    segments where the LLM rewrite succeeded
      - llm_enabled: whether a client is configured at all
      - errors:      up to 3 unique error messages from failed polish calls

    LLM failures fall back silently to the structured formatter so seeding
    never aborts; the counters above let the caller surface what happened.
    """
    existing = list_for_date(date_str)
    if any(b["status"] == "draft" for b in existing):
        return {"created": 0, "polished": 0, "attempted": 0,
                "llm_enabled": polish_service.is_enabled(), "errors": []}
    llm_enabled = polish_service.is_enabled()
    repo_labels = {r.get("label") for r in config.repos() if r.get("label")}
    created = 0
    attempted = 0
    polished = 0
    errors: list[str] = []
    # Some providers (Gemini free tier, 15 RPM) need request spacing. Others
    # (Claude Code CLI, Anthropic API) don't — let each client declare its own
    # required throttle and skip the sleep otherwise.
    inter_call_delay = polish_service.min_call_interval()
    for seg in segments:
        if seg.kind not in ("work", "unclassified"):
            continue
        will_attempt = llm_enabled and seg.project_label in repo_labels
        if will_attempt and attempted > 0 and inter_call_delay > 0:
            time_mod.sleep(inter_call_delay)
        try:
            desc, was_polished, was_attempted, err = _describe_segment(seg, llm_enabled)
        except Exception:
            log.exception("description failed for segment %s-%s", seg.start, seg.end)
            desc, was_polished, was_attempted, err = (seg.suggested_description or "", False, False, None)
        create(
            date_str,
            int(seg.start.timestamp()),
            int(seg.end.timestamp()),
            seg.project_label,
            seg.ticket_key,
            desc,
        )
        created += 1
        if was_attempted:
            attempted += 1
        if was_polished:
            polished += 1
        if err and err not in errors and len(errors) < 3:
            errors.append(err)
    return {"created": created, "polished": polished, "attempted": attempted,
            "llm_enabled": llm_enabled, "errors": errors}


# Backwards-compat alias
seed_from_work_segments = seed_from_segments


def suggest_for_gap(start_ts: int, end_ts: int, segments) -> dict | None:
    """Suggest a ticket / fill for a gap window.

    Heuristic (in priority order):
      1. A detected segment that overlaps the gap and has a ticket_key → use it.
      2. A detected segment that overlaps the gap with a project_label → use the
         most recent ticket cached for that project.
      3. Git commits in the window → mention the count, no specific ticket.
      4. No detected activity → return None.

    Returns {ticket: str|None, project: str|None, reason: str} or None.
    """
    if end_ts <= start_ts:
        return None
    overlapping = [s for s in segments
                   if int(s.end.timestamp()) > start_ts and int(s.start.timestamp()) < end_ts
                   and s.kind in ("work", "unclassified")]
    # 1. Direct ticket on a segment.
    for s in overlapping:
        if getattr(s, "ticket_key", None):
            title = (s.top_titles[0] if s.top_titles else "") or s.kind
            return {
                "ticket": s.ticket_key,
                "project": s.project_label,
                "reason": (title[:60] + "…" if len(title) > 60 else title) + " active here",
            }
    # 2. Project label on a segment → look up most recent ticket for that project.
    for s in overlapping:
        if getattr(s, "project_label", None):
            with db.connect() as conn:
                row = conn.execute(
                    "SELECT key FROM jira_tickets_cache WHERE project_key = ? "
                    "OR key LIKE ? ORDER BY updated_at DESC LIMIT 1",
                    (s.project_label[:10].upper(), s.project_label[:3].upper() + "-%"),
                ).fetchone()
            if row:
                return {
                    "ticket": row["key"],
                    "project": s.project_label,
                    "reason": f"project {s.project_label} active here",
                }
    # 3. Git activity but no ticket.
    git_count = 0
    for s in overlapping:
        git_count += len([e for e in (s.git_events or []) if e.get("event_type") == "commit"])
    if git_count:
        return {"ticket": None, "project": None, "reason": f"{git_count} commit{'s' if git_count != 1 else ''} in window"}
    return None


def cached_tickets() -> list[dict]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT key, summary, status, status_category, project_key, url FROM jira_tickets_cache ORDER BY updated_at DESC, key"
        ).fetchall()
    return [dict(r) for r in rows]
