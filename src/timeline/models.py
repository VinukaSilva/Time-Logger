from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class Segment:
    start: datetime
    end: datetime
    minutes: int
    kind: str                       # work | unclassified | idle
    project_label: str | None
    ticket_key: str | None
    top_titles: list[str] = field(default_factory=list)
    top_apps: list[str] = field(default_factory=list)
    git_events: list[dict] = field(default_factory=list)
    suggested_description: str = ""


@dataclass
class Day:
    date: str                       # YYYY-MM-DD
    segments: list[Segment] = field(default_factory=list)
    total_work_minutes: int = 0
    total_unclassified_minutes: int = 0
    total_idle_minutes: int = 0
    target_minutes: int = 480
