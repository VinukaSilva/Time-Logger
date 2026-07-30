import logging
import math
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from .. import config, db, kv
from ..timeline.builder import build_day
from . import blocks_service, submit_service

log = logging.getLogger(__name__)

router = APIRouter()
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
templates.env.cache = None

JIRA_AUTO_REFRESH_SECONDS = 15 * 60
_jira_refresh_lock = threading.Lock()
_jira_refresh_in_progress = False
_jira_last_attempt_ts = 0


def _maybe_refresh_jira_async() -> None:
    """Kick off a background Jira cache refresh if the cache is stale.

    Non-blocking: page render uses whatever is currently cached; freshly-fetched
    tickets show up on the next reload. Debounced so concurrent requests don't
    pile up duplicate fetches, and so a failing refresh doesn't hammer Jira.
    """
    global _jira_refresh_in_progress, _jira_last_attempt_ts
    now = int(time.time())
    raw = kv.get("jira_last_refresh_ts")
    try:
        last_ok = int(raw) if raw else 0
    except ValueError:
        last_ok = 0
    if now - last_ok < JIRA_AUTO_REFRESH_SECONDS:
        return
    with _jira_refresh_lock:
        if _jira_refresh_in_progress:
            return
        if now - _jira_last_attempt_ts < JIRA_AUTO_REFRESH_SECONDS:
            return
        _jira_refresh_in_progress = True
        _jira_last_attempt_ts = now

    def _run() -> None:
        global _jira_refresh_in_progress
        try:
            from ..jira_client.client import JiraClient
            n = JiraClient().cache_my_tickets()
            log.info("auto jira refresh: cached %d tickets", n)
        except Exception:
            log.exception("auto jira refresh failed")
        finally:
            with _jira_refresh_lock:
                _jira_refresh_in_progress = False

    threading.Thread(target=_run, daemon=True).start()

RIBBON_START_MIN = 7 * 60
RIBBON_END_MIN = 19 * 60
RIBBON_SPAN = RIBBON_END_MIN - RIBBON_START_MIN
TARGET_MINUTES = 8 * 60

BIG_RING_R = 38.0
BIG_RING_STROKE = 7
BIG_RING_CIRC = 2 * math.pi * BIG_RING_R


def _ts_to_hm(ts: int) -> str:
    return datetime.fromtimestamp(int(ts)).strftime("%H:%M")


def _fmt_dur(minutes: int) -> str:
    m = max(0, int(minutes or 0))
    if m == 0:
        return "0m"
    h, mm = divmod(m, 60)
    if h == 0:
        return f"{mm}m"
    if mm == 0:
        return f"{h}h"
    return f"{h}h {mm:02d}m"


def _fmt_ago(ts: int) -> str:
    secs = int(time.time()) - int(ts)
    if secs < 60:
        return f"{secs}s ago"
    if secs < 3600:
        return f"{secs // 60}m ago"
    if secs < 86400:
        return f"{secs // 3600}h ago"
    return f"{secs // 86400}d ago"


templates.env.filters["ts_to_hm"] = _ts_to_hm
templates.env.filters["fmt_dur"] = _fmt_dur


def _parse_date(ds: str) -> date:
    return datetime.strptime(ds, "%Y-%m-%d").date()


def _hm_to_ts(ds: str, hm: str) -> int:
    return int(datetime.strptime(f"{ds} {hm}", "%Y-%m-%d %H:%M").timestamp())


def _dt_to_day_minutes(dt: datetime) -> int:
    return dt.hour * 60 + dt.minute


def _ribbon_pct(day_minutes: float) -> float:
    return ((day_minutes - RIBBON_START_MIN) / RIBBON_SPAN) * 100


def _ribbon_bar(start_min: int, end_min: int) -> dict | None:
    a = max(RIBBON_START_MIN, start_min)
    b = min(RIBBON_END_MIN, end_min)
    if b <= a:
        return None
    return {"left_pct": round(_ribbon_pct(a), 3), "width_pct": round(_ribbon_pct(b) - _ribbon_pct(a), 3)}


def _heatmap(anchor: date) -> list[list[dict]]:
    today = date.today()
    today_iso = today.isoformat()
    anchor_iso = anchor.isoformat()
    monday_this_week = today - timedelta(days=today.weekday())

    all_dates: list[str] = []
    grid: list[list[dict]] = []
    for row in range(4):
        weeks_ago = 3 - row
        week_monday = monday_this_week - timedelta(weeks=weeks_ago)
        row_cells: list[dict] = []
        for col in range(7):
            d = week_monday + timedelta(days=col)
            iso = d.isoformat()
            all_dates.append(iso)
            row_cells.append({"date": iso, "row": row, "col": col})
        grid.append(row_cells)

    totals: dict[str, int] = {}
    submitted_counts: dict[str, int] = {}
    block_counts: dict[str, int] = {}
    if all_dates:
        placeholders = ",".join(["?"] * len(all_dates))
        with db.connect() as conn:
            rows = conn.execute(
                f"SELECT date, "
                f"COALESCE(SUM(minutes), 0) AS total, "
                f"COUNT(*) AS blocks, "
                f"SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS submitted "
                f"FROM time_blocks WHERE date IN ({placeholders}) GROUP BY date",
                all_dates,
            ).fetchall()
        for r in rows:
            totals[r["date"]] = int(r["total"] or 0)
            submitted_counts[r["date"]] = int(r["submitted"] or 0)
            block_counts[r["date"]] = int(r["blocks"] or 0)

    for row in grid:
        for cell in row:
            m = totals.get(cell["date"], 0)
            is_future = cell["date"] > today_iso
            if is_future:
                level = "empty"
            elif m == 0:
                level = ""
            elif m < 240:
                level = "l1"
            elif m < 400:
                level = "l2"
            elif m < 470:
                level = "l3"
            else:
                level = "l4"
            cell["minutes"] = m
            cell["level"] = level
            # Day-completion state: green tick only when *every* block is
            # submitted; yellow warning when some are still pending. A day with
            # zero submitted blocks gets no mark.
            n_blocks = block_counts.get(cell["date"], 0)
            n_submitted = submitted_counts.get(cell["date"], 0)
            if n_blocks > 0 and n_submitted >= n_blocks:
                cell["submit_state"] = "complete"
            elif n_submitted > 0:
                # Some blocks logged but not all — the day is only partially done.
                # Days with zero submitted keep the normal orange activity shading.
                cell["submit_state"] = "partial"
            else:
                cell["submit_state"] = ""
            cell["pending"] = max(0, n_blocks - n_submitted)
            cell["is_future"] = is_future
            cell["is_today"] = cell["date"] == today_iso
            cell["is_selected"] = cell["date"] == anchor_iso
    return grid


def _sync_status(target: date) -> dict:
    last_scan_ts = None
    with db.connect() as conn:
        row = conn.execute("SELECT MAX(ts) AS ts FROM git_events").fetchone()
        if row and row["ts"]:
            last_scan_ts = int(row["ts"])
    sheet_id = kv.get("google_sheet_id")
    iso = target.isocalendar()
    week_label = f"wk/{iso[0]}-W{iso[1]:02d}"

    jira_refresh_ts = None
    raw = kv.get("jira_last_refresh_ts")
    if raw:
        try:
            jira_refresh_ts = int(raw)
        except ValueError:
            jira_refresh_ts = None
    with db.connect() as conn:
        row = conn.execute("SELECT COUNT(*) AS n FROM jira_tickets_cache").fetchone()
        ticket_count = int(row["n"]) if row else 0

    return {
        "jira_ok": bool(config.jira_token()),
        "jira_label": "connected" if config.jira_token() else "no token",
        "jira_refresh_label": _fmt_ago(jira_refresh_ts) if jira_refresh_ts else "never",
        "jira_ticket_count": ticket_count,
        "sheets_ok": bool(sheet_id),
        "sheets_label": week_label if sheet_id else "no sheet",
        "collector_label": f"sampling {config.poll_interval()}s",
        "last_scan_label": _fmt_ago(last_scan_ts) if last_scan_ts else "never",
    }


def _day_context(request: Request, ds: str, flash: dict | None = None) -> dict:
    _maybe_refresh_jira_async()
    target = _parse_date(ds)
    day = build_day(target)
    blocks = blocks_service.list_for_date(ds)
    tickets = blocks_service.cached_tickets()
    drafted_minutes = sum(b["minutes"] for b in blocks)

    all_commits = [
        e for seg in day.segments for e in (seg.git_events or [])
        if e.get("event_type") == "commit"
    ]
    commit_events = [
        {
            "ts": e["ts"],
            "hm": datetime.fromtimestamp(e["ts"]).strftime("%H:%M"),
            "commit_sha": e.get("commit_sha") or "",
            "message": e.get("message") or "",
        }
        for e in all_commits
    ]

    for b in blocks:
        b["git_count"] = sum(1 for e in commit_events if b["start_ts"] <= e["ts"] < b["end_ts"])
        b["git_events"] = [e for e in commit_events if b["start_ts"] <= e["ts"] < b["end_ts"]]
        b["start_hm"] = _ts_to_hm(b["start_ts"])
        b["end_hm"] = _ts_to_hm(b["end_ts"])

    ticket_summary_by_key = {t["key"]: t["summary"] or "" for t in tickets}
    for b in blocks:
        b["ticket_summary"] = ticket_summary_by_key.get(b["ticket_key"] or "", "")

    draft_blocks = [b for b in blocks if b["status"] == "draft"]
    draft_total = sum(b["minutes"] for b in draft_blocks)
    draft_issues = len({b["ticket_key"] for b in draft_blocks if b["ticket_key"]})
    empty_drafts = [b for b in draft_blocks if not (b["ticket_key"] and (b["description"] or "").strip())]
    submittable = [b for b in draft_blocks if b["ticket_key"] and (b["description"] or "").strip()]

    block_context_segments: dict[int, list[dict]] = {}
    for b in blocks:
        ctx: list[dict] = []
        for s in day.segments:
            s_start = int(s.start.timestamp())
            s_end = int(s.end.timestamp())
            if s_end > b["start_ts"] and s_start < b["end_ts"]:
                ctx.append({
                    "hm": s.start.strftime("%H:%M"),
                    "title": (s.top_titles[0] if s.top_titles else ""),
                    "kind": s.kind,
                    "minutes": s.minutes,
                })
        block_context_segments[b["id"]] = ctx[:5]

    ribbon_segments: list[dict] = []
    for s in day.segments:
        pos = _ribbon_bar(_dt_to_day_minutes(s.start), _dt_to_day_minutes(s.end))
        if not pos:
            continue
        ribbon_segments.append({
            "kind": s.kind,
            "left_pct": pos["left_pct"],
            "width_pct": pos["width_pct"],
            "start_hm": s.start.strftime("%H:%M"),
            "end_hm": s.end.strftime("%H:%M"),
            "title": s.top_titles[0] if s.top_titles else s.kind,
            "ticket": s.ticket_key or "",
        })

    ribbon_drafts: list[dict] = []
    for b in blocks:
        s_min = _dt_to_day_minutes(datetime.fromtimestamp(b["start_ts"]))
        e_min = _dt_to_day_minutes(datetime.fromtimestamp(b["end_ts"]))
        pos = _ribbon_bar(s_min, e_min)
        if not pos:
            continue
        ribbon_drafts.append({
            "status": b["status"],
            "left_pct": pos["left_pct"],
            "width_pct": pos["width_pct"],
            "start_hm": _ts_to_hm(b["start_ts"]),
            "end_hm": _ts_to_hm(b["end_ts"]),
            "ticket": b["ticket_key"] or "",
        })

    ribbon_commits: list[dict] = []
    for e in commit_events:
        cm = _dt_to_day_minutes(datetime.fromtimestamp(e["ts"]))
        if not (RIBBON_START_MIN <= cm <= RIBBON_END_MIN):
            continue
        ribbon_commits.append({
            "left_pct": round(_ribbon_pct(cm), 3),
            "hm": e["hm"],
            "sha": e["commit_sha"][:7],
            "message": e["message"],
        })

    ribbon_hours = [
        {"pct": round(_ribbon_pct(h * 60), 3), "label": f"{h:02d}", "major": (h - 7) % 2 == 0}
        for h in range(7, 20)
    ]

    now_pct: float | None = None
    if ds == date.today().isoformat():
        now = datetime.now()
        now_min = now.hour * 60 + now.minute
        if RIBBON_START_MIN <= now_min <= RIBBON_END_MIN:
            now_pct = round(_ribbon_pct(now_min), 3)

    work_min = day.total_work_minutes
    unc_min = day.total_unclassified_minutes
    idle_min = day.total_idle_minutes
    drafted_pct = round((drafted_minutes / TARGET_MINUTES) * 100) if TARGET_MINUTES else 0
    coverage_pct = round((drafted_minutes / max(work_min, 1)) * 100)
    delta = drafted_minutes - work_min

    ring_r = 19.5
    ring_circ = 2 * math.pi * ring_r
    ring_offset = ring_circ - (ring_circ * min(drafted_pct, 100) / 100)

    work_pct_of_target = round((work_min / TARGET_MINUTES) * 100) if TARGET_MINUTES else 0
    big_ring_fill_offset = BIG_RING_CIRC - (BIG_RING_CIRC * min(work_pct_of_target, 100) / 100)
    big_ring_draft_offset = BIG_RING_CIRC - (BIG_RING_CIRC * min(drafted_pct, 100) / 100)

    work_segments_count = sum(1 for s in day.segments if s.kind == "work")
    dow_short = target.strftime("%a")
    formatted_date = f"{target.strftime('%B')} {target.day}, {target.year}"

    heatmap = _heatmap(target)
    sync = _sync_status(target)

    # v2: 7-day drafted-minutes series ending on `target` for the hero sparkline.
    # Derived from the existing heatmap; no new query.
    flat = [cell for row in heatmap for cell in row if not cell.get("is_future")]
    flat.sort(key=lambda c: c["date"])
    target_iso = target.isoformat()
    target_idx = next((i for i, c in enumerate(flat) if c["date"] == target_iso), len(flat) - 1)
    sparkline_7d_minutes = [c["minutes"] for c in flat[max(0, target_idx - 6): target_idx + 1]]
    # Pad on the left if we don't have 7 days of history yet.
    while len(sparkline_7d_minutes) < 7:
        sparkline_7d_minutes.insert(0, 0)
    avg_7d_minutes = round(sum(sparkline_7d_minutes) / max(1, len(sparkline_7d_minutes)))

    submitted_count = sum(1 for b in blocks if b["status"] == "submitted")

    # v2: smart-gap suggestions, keyed by the start_ts of the FOLLOWING block
    # (the natural gap identifier in the template loop). Only computed for
    # gaps of >= 10 minutes — same threshold as the template uses.
    gap_suggestions: dict[int, dict] = {}
    for prev, b in zip(blocks, blocks[1:]):
        if b["start_ts"] - prev["end_ts"] >= 600:
            sugg = blocks_service.suggest_for_gap(prev["end_ts"], b["start_ts"], day.segments)
            if sugg:
                gap_suggestions[b["start_ts"]] = sugg

    # v2 sparkline path data — 7 points across a 140x36 viewport. Empty/zero days
    # collapse to the baseline; scaling reserves a 10% top margin so the line
    # never touches the top edge.
    spark_w, spark_h = 140, 36
    spark_max = max(sparkline_7d_minutes + [TARGET_MINUTES // 2]) or 1
    spark_points: list[tuple[float, float]] = []
    n = len(sparkline_7d_minutes)
    for i, m in enumerate(sparkline_7d_minutes):
        x = (i / max(1, n - 1)) * spark_w
        y = spark_h - (m / spark_max) * spark_h * 0.9 - 2
        spark_points.append((round(x, 2), round(y, 2)))
    spark_line_d = "M " + " L ".join(f"{x},{y}" for x, y in spark_points) if spark_points else ""
    spark_area_d = (
        spark_line_d + f" L {spark_w},{spark_h} L 0,{spark_h} Z"
        if spark_points else ""
    )
    spark_dot_xy = spark_points[-1] if spark_points else (spark_w, spark_h)

    return {
        "request": request,
        "date": ds,
        "prev": (target - timedelta(days=1)).isoformat(),
        "next": (target + timedelta(days=1)).isoformat(),
        "today": date.today().isoformat(),
        "day": day,
        "blocks": blocks,
        "tickets": tickets,
        "drafted_minutes": drafted_minutes,
        "flash": flash,

        "dow_short": dow_short,
        "formatted_date": formatted_date,

        "ribbon_segments": ribbon_segments,
        "ribbon_drafts": ribbon_drafts,
        "ribbon_commits": ribbon_commits,
        "ribbon_hours": ribbon_hours,
        "now_pct": now_pct,

        "work_min": work_min,
        "unc_min": unc_min,
        "idle_min": idle_min,
        "work_min_fmt": _fmt_dur(work_min),
        "unc_min_fmt": _fmt_dur(unc_min),
        "idle_min_fmt": _fmt_dur(idle_min),
        "drafted_min_fmt": _fmt_dur(drafted_minutes),
        "drafted_pct": drafted_pct,
        "coverage_pct": coverage_pct,
        "delta_mins": delta,
        "delta_fmt": _fmt_dur(abs(delta)),
        "ring_circ": round(ring_circ, 3),
        "ring_offset": round(ring_offset, 3),
        "work_segments_count": work_segments_count,

        "big_ring_r": BIG_RING_R,
        "big_ring_stroke": BIG_RING_STROKE,
        "big_ring_circ": round(BIG_RING_CIRC, 3),
        "big_ring_fill_offset": round(big_ring_fill_offset, 3),
        "big_ring_draft_offset": round(big_ring_draft_offset, 3),

        "block_context_segments": block_context_segments,
        "heatmap": heatmap,
        "sync": sync,

        "draft_blocks": draft_blocks,
        "draft_count": len(draft_blocks),
        "draft_total_fmt": _fmt_dur(draft_total),
        "draft_issues": draft_issues,
        "empty_drafts_count": len(empty_drafts),
        "submittable_count": len(submittable),

        # v2 additions (consumed by the redesigned topbar / hero stat)
        "submitted_count": submitted_count,
        "target_minutes": TARGET_MINUTES,
        "sparkline_7d_minutes": sparkline_7d_minutes,
        "avg_7d_minutes": avg_7d_minutes,
        "avg_7d_fmt": _fmt_dur(avg_7d_minutes),
        "spark_line_d": spark_line_d,
        "spark_area_d": spark_area_d,
        "spark_dot_x": spark_dot_xy[0],
        "spark_dot_y": spark_dot_xy[1],
        "gap_suggestions": gap_suggestions,
    }


@router.get("/", response_class=HTMLResponse)
def root() -> RedirectResponse:
    return RedirectResponse(f"/day/{date.today().isoformat()}")


@router.get("/day/{ds}", response_class=HTMLResponse)
def day_view(request: Request, ds: str) -> HTMLResponse:
    return templates.TemplateResponse(request, "day.html", _day_context(request, ds))


@router.get("/metrics/last28")
def metrics_last28(anchor: str | None = None) -> JSONResponse:
    target = _parse_date(anchor) if anchor else date.today()
    return JSONResponse({"grid": _heatmap(target)})


@router.post("/day/{ds}/seed", response_class=HTMLResponse)
def seed(request: Request, ds: str) -> HTMLResponse:
    day = build_day(_parse_date(ds))
    result = blocks_service.seed_from_work_segments(ds, day.segments)
    created = result["created"]
    attempted = result["attempted"]
    polished = result["polished"]
    llm_enabled = result["llm_enabled"]
    errors = result.get("errors") or []

    if created == 0:
        flash = {"level": "error", "message": "Nothing to seed — either no detected work, or blocks already exist for this day."}
        return templates.TemplateResponse(request, "day.html", _day_context(request, ds, flash=flash))

    block_word = "block" if created == 1 else "blocks"
    header = f"Seeded {created} {block_word}."

    if not llm_enabled:
        line2 = "AI polish: OFF — set GEMINI_API_KEY in .env and restart to enable."
        level = "ok"
    elif attempted == 0:
        line2 = "AI polish: NOT RUN — no segments had a tracked git repo to mine signals from."
        level = "ok"
    elif polished == attempted:
        line2 = f"AI polish: SUCCESS — all {polished} repo-backed {('block' if polished == 1 else 'blocks')} were rewritten by Gemini."
        level = "ok"
    elif polished == 0:
        line2 = f"AI polish: FAILED for all {attempted} attempts — used structured fallback. First error: {errors[0] if errors else 'unknown'}"
        level = "error"
    else:
        failed = attempted - polished
        line2 = f"AI polish: PARTIAL — {polished} of {attempted} succeeded, {failed} fell back to structured. First error: {errors[0] if errors else 'unknown'}"
        level = "error"

    flash = {"level": level, "message": header + "\n" + line2}
    return templates.TemplateResponse(request, "day.html", _day_context(request, ds, flash=flash))


@router.post("/day/{ds}/block", response_class=HTMLResponse)
def add_block(
    request: Request,
    ds: str,
    start: str = Form(...),
    end: str = Form(...),
    ticket_key: str = Form(""),
    description: str = Form(""),
    project_label: str = Form(""),
) -> HTMLResponse:
    start_ts = _hm_to_ts(ds, start)
    end_ts = _hm_to_ts(ds, end)
    if end_ts <= start_ts:
        return HTMLResponse("<p class='error'>End time must be after start.</p>", status_code=400)
    blocks_service.create(ds, start_ts, end_ts, project_label or None, ticket_key or None, description)
    return RedirectResponse(f"/day/{ds}", status_code=303)


@router.post("/block/{block_id}", response_class=HTMLResponse)
def update_block(
    request: Request,
    block_id: int,
    ds: str = Form(...),
    start: str = Form(...),
    end: str = Form(...),
    ticket_key: str = Form(""),
    description: str = Form(""),
    project_label: str = Form(""),
) -> HTMLResponse:
    start_ts = _hm_to_ts(ds, start)
    end_ts = _hm_to_ts(ds, end)
    if end_ts <= start_ts:
        return HTMLResponse("<p class='error'>End time must be after start.</p>", status_code=400)
    blocks_service.update(
        block_id,
        start_ts=start_ts,
        end_ts=end_ts,
        ticket_key=ticket_key or None,
        description=description,
        project_label=project_label or None,
    )
    return RedirectResponse(f"/day/{ds}#block-{block_id}", status_code=303)


@router.post("/block/{block_id}/delete", response_class=HTMLResponse)
def delete_block(block_id: int, ds: str = Form(...)) -> RedirectResponse:
    blocks_service.delete(block_id)
    return RedirectResponse(f"/day/{ds}", status_code=303)


@router.post("/day/{ds}/discard_all", response_class=HTMLResponse)
def discard_all(ds: str) -> RedirectResponse:
    blocks_service.delete_all_drafts(ds)
    return RedirectResponse(f"/day/{ds}", status_code=303)


@router.post("/tickets/refresh", response_class=HTMLResponse)
def refresh_tickets(request: Request, ds: str = Form(...)) -> HTMLResponse:
    try:
        from ..jira_client.client import JiraClient
        n = JiraClient().cache_my_tickets()
        flash = {"level": "ok", "message": f"Jira refreshed: {n} tickets cached."}
    except Exception as exc:
        log.exception("manual jira refresh failed")
        flash = {"level": "error", "message": f"Jira refresh failed: {exc}"}
    return templates.TemplateResponse(request, "day.html", _day_context(request, ds, flash=flash))


@router.post("/day/{ds}/bulk_ticket", response_class=HTMLResponse)
def bulk_set_ticket(
    request: Request,
    ds: str,
    block_ids: list[int] = Form(default=[]),
    ticket_key: str = Form(""),
) -> HTMLResponse:
    """Apply one ticket key to multiple draft blocks in a single click."""
    key = ticket_key.strip() or None
    if not block_ids:
        flash = {"level": "error", "message": "No blocks selected."}
    else:
        n = blocks_service.bulk_set_ticket(block_ids, key)
        label = key or "— none —"
        flash = {"level": "ok", "message": f"Ticket set to {label} on {n} block{'s' if n != 1 else ''}."}
    return templates.TemplateResponse(request, "day.html", _day_context(request, ds, flash=flash))


@router.post("/day/{ds}/submit", response_class=HTMLResponse)
def submit(request: Request, ds: str) -> HTMLResponse:
    result = submit_service.submit_day(ds)
    level = "error" if result["failed"] or (result["skipped"] and not result["submitted"]) else "ok"
    msg_lines = [f"Submitted: {result['submitted']}   Failed: {result['failed']}   Skipped: {result['skipped']}"]
    msg_lines.extend(result["errors"])
    flash = {"level": level, "message": "\n".join(msg_lines)}
    return templates.TemplateResponse(request, "day.html", _day_context(request, ds, flash=flash))
