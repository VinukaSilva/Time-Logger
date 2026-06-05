import logging
import time as time_mod
from datetime import datetime

from .. import db
from ..jira_client.client import JiraClient
from ..sheets_client.client import SheetsClient
from . import blocks_service

log = logging.getLogger(__name__)


def _ticket_summary_lookup() -> dict[str, tuple[str, str]]:
    with db.connect() as conn:
        rows = conn.execute("SELECT key, summary, project_key FROM jira_tickets_cache").fetchall()
    return {r["key"]: (r["summary"] or "", r["project_key"] or "") for r in rows}


def submit_day(date_str: str) -> dict:
    blocks = blocks_service.list_for_date(date_str)
    drafts = [b for b in blocks if b["status"] == "draft"]
    missing_ticket = [b for b in drafts if not b["ticket_key"]]
    ready = [b for b in drafts if b["ticket_key"]]

    if not drafts:
        return {"submitted": 0, "failed": 0, "skipped": 0, "errors": ["No draft blocks to submit."]}

    jira = JiraClient()
    sheets = SheetsClient()
    sheets.ensure_sheet()
    summaries = _ticket_summary_lookup()

    submitted = 0
    failed = 0
    errors: list[str] = []

    for b in ready:
        try:
            started = datetime.fromtimestamp(b["start_ts"])
            description = b["description"] or f"Work on {b['ticket_key']}"
            result = jira.add_worklog(b["ticket_key"], started, b["minutes"], description)
            worklog_id = str(result.get("id", ""))

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
                    (worklog_id, now, now, now, b["id"]),
                )
            submitted += 1
            log.info("submitted block %s (%s, %dm)", b["id"], b["ticket_key"], b["minutes"])
        except Exception as e:
            failed += 1
            errors.append(f"Block {b['id']} ({b['ticket_key']}): {e}")
            log.exception("submit failed for block %s", b["id"])

    skipped = len(missing_ticket)
    if missing_ticket:
        errors.append(f"{skipped} block(s) skipped: no ticket selected.")

    return {"submitted": submitted, "failed": failed, "skipped": skipped, "errors": errors}
