import logging
import time
from datetime import datetime
from typing import Iterable

import requests

from .. import config, db, kv
from .adf import markdown_to_adf

log = logging.getLogger(__name__)

DEFAULT_JQL = "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC"
RECENT_CLOSED_JQL = "assignee = currentUser() AND statusCategory = Done AND resolved >= -30d ORDER BY updated DESC"
# Catches tickets handed off to QA after implementation: once reassigned away
# from us we drop off the assignee queries above, but we're added as a
# watcher, so this keeps them time-loggable until they're actually Done.
WATCHER_JQL = "watcher = currentUser() AND statusCategory != Done ORDER BY updated DESC"
WATCHER_RECENT_CLOSED_JQL = "watcher = currentUser() AND statusCategory = Done AND resolved >= -30d ORDER BY updated DESC"


class JiraClient:
    def __init__(self) -> None:
        self.base = config.jira_base_url()
        self.auth = (config.jira_email(), config.jira_token())
        if not self.auth[0] or not self.auth[1]:
            raise RuntimeError("JIRA_EMAIL or JIRA_API_TOKEN missing from .env")
        self.session = requests.Session()
        self.session.auth = self.auth
        self.session.headers.update({"Accept": "application/json", "Content-Type": "application/json"})

    def myself(self) -> dict:
        r = self.session.get(f"{self.base}/rest/api/3/myself", timeout=20)
        r.raise_for_status()
        return r.json()

    def search(self, jql: str, fields: Iterable[str] = ("summary", "status", "project"), page_size: int = 100) -> list[dict]:
        issues: list[dict] = []
        next_token: str | None = None
        while True:
            body = {"jql": jql, "fields": list(fields), "maxResults": page_size}
            if next_token:
                body["nextPageToken"] = next_token
            r = self.session.post(f"{self.base}/rest/api/3/search/jql", json=body, timeout=30)
            if r.status_code == 404:
                params = {"jql": jql, "fields": ",".join(fields), "maxResults": page_size, "startAt": len(issues)}
                r = self.session.get(f"{self.base}/rest/api/3/search", params=params, timeout=30)
                r.raise_for_status()
                data = r.json()
                issues.extend(data.get("issues", []))
                if data.get("startAt", 0) + len(data.get("issues", [])) >= data.get("total", 0):
                    break
                continue
            r.raise_for_status()
            data = r.json()
            issues.extend(data.get("issues", []))
            next_token = data.get("nextPageToken")
            if not next_token or not data.get("issues"):
                break
        return issues

    def my_tickets(self) -> list[dict]:
        queries = [DEFAULT_JQL, RECENT_CLOSED_JQL, WATCHER_JQL, WATCHER_RECENT_CLOSED_JQL] + config.jira_extra_jql()
        seen: set[str] = set()
        out: list[dict] = []
        for jql in queries:
            try:
                issues = self.search(jql)
            except Exception:
                log.exception("jira search failed for jql=%r", jql)
                continue
            for iss in issues:
                if iss["key"] in seen:
                    continue
                seen.add(iss["key"])
                out.append(iss)
        return out

    def cache_my_tickets(self) -> int:
        tickets = self.my_tickets()
        now = int(time.time())
        with db.connect() as conn:
            conn.execute("DELETE FROM jira_tickets_cache")
            for iss in tickets:
                key = iss["key"]
                fields = iss.get("fields", {}) or {}
                summary = fields.get("summary") or ""
                status_obj = fields.get("status") or {}
                status = status_obj.get("name") or ""
                status_category = ((status_obj.get("statusCategory") or {}).get("key") or "").lower()
                project_key = (fields.get("project") or {}).get("key") or key.split("-", 1)[0]
                url = f"{self.base}/browse/{key}"
                conn.execute(
                    "INSERT OR REPLACE INTO jira_tickets_cache (key, summary, status, status_category, project_key, url, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (key, summary, status, status_category, project_key, url, now),
                )
        kv.set("jira_last_refresh_ts", str(now))
        return len(tickets)

    def add_worklog(self, issue_key: str, started: datetime, minutes: int, comment: str) -> dict:
        if started.tzinfo is None:
            started_str = started.strftime("%Y-%m-%dT%H:%M:%S.000+0000")
        else:
            started_str = started.strftime("%Y-%m-%dT%H:%M:%S.000%z")
        body = {
            "started": started_str,
            "timeSpentSeconds": minutes * 60,
            "comment": markdown_to_adf(comment),
        }
        r = self.session.post(f"{self.base}/rest/api/3/issue/{issue_key}/worklog", json=body, timeout=30)
        if not r.ok:
            detail = r.text[:500]
            log.error("worklog failed %s %s: %s", issue_key, r.status_code, detail)
            raise RuntimeError(f"{r.status_code} from Jira: {detail}")
        return r.json()
