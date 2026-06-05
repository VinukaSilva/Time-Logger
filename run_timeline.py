import sys
from datetime import date, datetime

from src.timeline.builder import build_day


def main() -> None:
    target = date.today()
    if len(sys.argv) > 1:
        target = datetime.strptime(sys.argv[1], "%Y-%m-%d").date()
    day = build_day(target)
    print(f"Date: {day.date}")
    print(f"Work: {day.total_work_minutes} min ({day.total_work_minutes/60:.1f}h)  target={day.target_minutes//60}h")
    print(f"Unclassified: {day.total_unclassified_minutes} min   Idle: {day.total_idle_minutes} min")
    print(f"Segments: {len(day.segments)}")
    print("-" * 100)
    for s in day.segments:
        tag = {"work": "    ", "unclassified": "  ??", "idle": "idle"}[s.kind]
        project = s.project_label or "-"
        ticket = s.ticket_key or "-"
        title = s.top_titles[0][:80] if s.top_titles else ""
        git_note = ""
        if s.git_events:
            commits = sum(1 for e in s.git_events if e["event_type"] == "commit")
            if commits:
                git_note = f"  [+{commits} commit(s)]"
        print(f"[{tag}] {s.start:%H:%M}-{s.end:%H:%M}  {s.minutes:>3}m  {project:<22}  {ticket:<14}  {title}{git_note}")


if __name__ == "__main__":
    main()
