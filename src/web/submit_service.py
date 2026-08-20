import logging
import time as time_mod
from datetime import datetime

from .. import config, db
from ..jira_client.client import JiraClient
from . import blocks_service

log = logging.getLogger(__name__)


def _ticket_summary_lookup() -> dict[str, tuple[str, str]]:
    with db.connect() as conn:
        rows = conn.execute("SELECT key, summary, project_key FROM jira_tickets_cache").fetchall()
    return {r["key"]: (r["summary"] or "", r["project_key"] or "") for r in rows}


def submit_day(date_str: str, block_ids: list[int] | None = None) -> dict:
    """Push draft blocks for a day to Jira (and the sheet, when configured).

    `block_ids` narrows the push to specific blocks — used by the per-block "Log"
    button and the bulk bar. Blocks missing a ticket *or* a description are
    skipped, which is what the submit dialog tells the user will happen.
    """
    blocks = blocks_service.list_for_date(date_str)
    drafts = [b for b in blocks if b["status"] == "draft"]
    if block_ids is not None:
        wanted = {int(i) for i in block_ids}
        drafts = [b for b in drafts if b["id"] in wanted]
    not_ready = [b for b in drafts if not blocks_service.is_ready(b)]
    ready = [b for b in drafts if blocks_service.is_ready(b)]

    if not drafts:
        return {"submitted": 0, "failed": 0, "skipped": 0, "errors": ["No draft blocks to submit."]}

    jira = JiraClient()

    # Google Sheets is optional — skip gracefully if not configured or libs missing.
    sheets = None
    if config.sheets_configured() and config.sheet_id():
        try:
            from ..sheets_client.client import SheetsClient
            sheets = SheetsClient()
            sheets.ensure_sheet()
        except Exception as exc:
            log.warning("sheets unavailable, skipping: %s", exc)
            sheets = None

    summaries = _ticket_summary_lookup()

    submitted = 0
    failed = 0
    errors: list[str] = []

    for b in ready:
        try:
            started = datetime.fromtimestamp(b["start_ts"]).astimezone()
            description = b["description"] or f"Work on {b['ticket_key']}"
            result = jira.add_worklog(b["ticket_key"], started, b["minutes"], description)
            worklog_id = str(result.get("id", ""))

            sheet_row_ts = None
            if sheets:
                try:
                    summary, _ = summaries.get(b["ticket_key"], ("", ""))
                    end_dt = datetime.fromtimestamp(b["end_ts"])
                    sheets.append_row(
                        [
                            date_str,
                            started.strftime("%H:%M"),
                            end_dt.strftime("%H:%M"),
                            b["minutes"],
                            b["ticket_key"],
                            summary,
                            description,
                            b["project_label"] or "",
                            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        ]
                    )
                    sheet_row_ts = int(time_mod.time())
                except Exception as exc:
                    log.warning("sheets append failed for block %s: %s", b["id"], exc)

            now = int(time_mod.time())
            with db.connect() as conn:
                conn.execute(
                    """UPDATE time_blocks
                       SET status = 'submitted',
                           jira_worklog_id = ?,
                           sheet_row_appended_at = ?,
                           submitted_at = ?,
                           updated_at = ?
                       WHERE id = ?""",
                    (worklog_id, sheet_row_ts, now, now, b["id"]),
                )
            submitted += 1
            log.info("submitted block %s (%s, %dm)", b["id"], b["ticket_key"], b["minutes"])
        except Exception as e:
            failed += 1
            errors.append(f"Block {b['id']} ({b['ticket_key']}): {e}")
            log.exception("submit failed for block %s", b["id"])

    skipped = len(not_ready)
    if not_ready:
        no_ticket = sum(1 for b in not_ready if not b["ticket_key"])
        no_desc = skipped - no_ticket
        reasons = []
        if no_ticket:
            reasons.append(f"{no_ticket} with no ticket")
        if no_desc:
            reasons.append(f"{no_desc} with no description")
        errors.append(f"{skipped} block(s) skipped: {', '.join(reasons)}.")

    return {"submitted": submitted, "failed": failed, "skipped": skipped, "errors": errors}
