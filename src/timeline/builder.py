from collections import Counter
from datetime import date, datetime, time

from .. import config, db
from . import classifier
from .models import Day, Segment

POLL_SECS = 30
MAX_SAMPLE_GAP_SECS = 10 * 60       # tolerate up to 10 min of silence before splitting a segment
MIN_SEGMENT_MINUTES = 5             # floor to filter noise; absorption handles brief distractions
SHORT_IDLE_ABSORB_MINUTES = 3       # idle <= this counts as a momentary pause, not a real break

APP_SUFFIX_PATTERNS = [
    " - Visual Studio Code",
    " - Cursor",
    " - PyCharm",
    " - IntelliJ IDEA",
    " - WebStorm",
    " - DataGrip",
    " - Google Chrome",
    " - Chrome",
    " - Mozilla Firefox",
    " — Mozilla Firefox",
    " - Firefox",
    " - Microsoft Edge",
    " - Microsoft Edge",
    " - Brave",
    " - Arc",
    " - Slack",
    " - Microsoft Teams",
    " - Discord",
    " - Zoom",
    " | Jira",
    " - Jira",
    " · Jira",
    " - Postman",
    " - Notion",
]

_TRIM_CHARS = " -—·|"


def _strip_app(title: str) -> str:
    t = (title or "").strip()
    lowered = t.lower()
    for suffix in APP_SUFFIX_PATTERNS:
        if lowered.endswith(suffix.lower()):
            t = t[: -len(suffix)].rstrip(_TRIM_CHARS)
            break
    return t


def _suggested_description(git_events: list[dict]) -> str:
    seen: set[str] = set()
    msgs: list[str] = []
    for e in git_events:
        if e.get("event_type") != "commit":
            continue
        m = (e.get("message") or "").strip()
        if not m or m in seen:
            continue
        seen.add(m)
        msgs.append(m)
    return "; ".join(msgs[:5])


def _day_bounds(target: date) -> tuple[int, int]:
    start = datetime.combine(target, time.min)
    end = datetime.combine(target, time.max)
    return int(start.timestamp()), int(end.timestamp()) + 1


def _state_key(sample: dict) -> tuple:
    if sample["idle"] >= config.idle_threshold():
        return ("idle",)
    return ("active", sample["project_label"], sample["ticket_key"])


def _merge_same_state(segments: list[Segment]) -> list[Segment]:
    out: list[Segment] = []
    for seg in segments:
        if (
            out
            and out[-1].kind == seg.kind
            and out[-1].project_label == seg.project_label
            and out[-1].ticket_key == seg.ticket_key
        ):
            prev = out[-1]
            prev.end = seg.end
            prev.minutes = max(1, round((prev.end - prev.start).total_seconds() / 60))
            merged_titles = list(dict.fromkeys(prev.top_titles + seg.top_titles))[:5]
            prev.top_titles = merged_titles
            prev.top_apps = list(dict.fromkeys(prev.top_apps + seg.top_apps))[:5]
            prev.git_events.extend(seg.git_events)
            prev.suggested_description = _suggested_description(prev.git_events)
        else:
            out.append(seg)
    return out


def _absorb_into_preceding_work(segments: list[Segment]) -> list[Segment]:
    """Fold unclassified and very-short idle segments into the immediately preceding work segment.

    - Unclassified active time (Chrome tab on Jira board, peek at Time Logger, etc.)
      always merges into the preceding work segment.
    - Very short idle (<= SHORT_IDLE_ABSORB_MINUTES) is treated as a momentary pause and
      absorbed too, so it doesn't break the attribution chain when work continues.
    - Long idle stays standalone — those are real breaks.
    - An unclassified or idle segment at the start of the day (no preceding work) stays standalone.
    """
    out: list[Segment] = []
    for seg in segments:
        is_brief_idle = seg.kind == "idle" and seg.minutes <= SHORT_IDLE_ABSORB_MINUTES
        absorb = (seg.kind == "unclassified" or is_brief_idle) and out and out[-1].kind == "work"
        if absorb:
            prev = out[-1]
            prev.end = seg.end
            prev.minutes = max(1, round((prev.end - prev.start).total_seconds() / 60))
            if seg.top_titles:
                prev.top_titles = list(dict.fromkeys(prev.top_titles + seg.top_titles))[:5]
            if seg.top_apps:
                prev.top_apps = list(dict.fromkeys(prev.top_apps + seg.top_apps))[:5]
            if seg.git_events:
                prev.git_events.extend(seg.git_events)
                prev.suggested_description = _suggested_description(prev.git_events)
        else:
            out.append(seg)
    return out


def build_day(target: date) -> Day:
    start_ts, end_ts = _day_bounds(target)
    with db.connect() as conn:
        raw = conn.execute(
            "SELECT ts, process_name, window_title, idle_seconds FROM activity WHERE ts >= ? AND ts < ? ORDER BY ts",
            (start_ts, end_ts),
        ).fetchall()
        git_rows = conn.execute(
            "SELECT ts, repo_path, event_type, commit_sha, message FROM git_events WHERE ts >= ? AND ts < ? ORDER BY ts",
            (start_ts, end_ts),
        ).fetchall()
    git_events = [dict(r) for r in git_rows]

    if not raw:
        return Day(date=target.isoformat())

    known_keys = classifier.known_ticket_keys()
    tokens = classifier.repo_tokens()
    custom_rules = classifier.custom_project_rules()

    excluded = config.excluded_processes()

    samples: list[dict] = []
    for r in raw:
        proc = (r["process_name"] or "")
        c = classifier.classify(r["window_title"] or "", proc, known_keys, tokens, custom_rules=custom_rules)
        # Excluded processes (e.g. personal browsers) are treated as idle so they
        # never accumulate work or unclassified time, but the raw sample is kept
        # in the activity log in case the exclude list changes later.
        idle_secs = r["idle_seconds"] or 0
        if proc.lower() in excluded:
            idle_secs = max(idle_secs, 99999)
        samples.append(
            {
                "ts": r["ts"],
                "title": r["window_title"] or "",
                "process": proc,
                "idle": idle_secs,
                "project_label": c["project_label"],
                "ticket_key": c["ticket_key"],
                "app_kind": c["app_kind"],
            }
        )

    groups: list[list[dict]] = []
    for s in samples:
        if not groups:
            groups.append([s])
            continue
        prev = groups[-1][-1]
        gap = s["ts"] - prev["ts"]
        if _state_key(s) == _state_key(prev) and gap <= MAX_SAMPLE_GAP_SECS:
            groups[-1].append(s)
        else:
            groups.append([s])

    segments: list[Segment] = []
    for g in groups:
        start_t = g[0]["ts"]
        end_t = g[-1]["ts"] + POLL_SECS
        minutes = max(1, round((end_t - start_t) / 60))
        first = g[0]
        state = _state_key(first)
        if state[0] == "idle":
            kind = "idle"
            project = None
            ticket = None
        elif first["project_label"]:
            kind = "work"
            project = first["project_label"]
            ticket = first["ticket_key"]
        else:
            kind = "unclassified"
            project = None
            ticket = first["ticket_key"]

        title_counts = Counter(_strip_app(s["title"]) for s in g if s["title"])
        app_counts = Counter(s["process"] for s in g if s["process"])
        seg_git = [e for e in git_events if start_t <= e["ts"] < end_t]
        top_titles = [t for t, _ in title_counts.most_common(5) if t]

        segments.append(
            Segment(
                start=datetime.fromtimestamp(start_t),
                end=datetime.fromtimestamp(end_t),
                minutes=minutes,
                kind=kind,
                project_label=project,
                ticket_key=ticket,
                top_titles=top_titles,
                top_apps=[a for a, _ in app_counts.most_common(3)],
                git_events=seg_git,
                suggested_description=_suggested_description(seg_git),
            )
        )

    segments = _merge_same_state(segments)
    segments = _absorb_into_preceding_work(segments)
    segments = _merge_same_state(segments)
    segments = [s for s in segments if s.minutes >= MIN_SEGMENT_MINUTES]

    # Note: rich descriptions (Claude Code mining, git stats) are NOT computed here.
    # They're built on demand at seed time inside `blocks_service._describe_segment`.
    # Per-page-load build_day used to take ~12s on a full day; this keeps it under 1s.
    # `seg.suggested_description` retains the cheap commit-message-only fallback set
    # during initial segment construction, which is used only if the rich path raises.

    total_work = sum(s.minutes for s in segments if s.kind == "work")
    total_unclassified = sum(s.minutes for s in segments if s.kind == "unclassified")
    total_idle = sum(s.minutes for s in segments if s.kind == "idle")

    return Day(
        date=target.isoformat(),
        segments=segments,
        total_work_minutes=total_work,
        total_unclassified_minutes=total_unclassified,
        total_idle_minutes=total_idle,
    )
