/* global React */
// Mock data + helpers shared across modules.

const TODAY = "2026-04-24";

// Simple inline icons — no external deps.
const Icon = ({ name, size = 14, className = "" }) => {
  const s = size;
  const common = { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round", className: "i " + className };
  const paths = {
    chevL: <polyline points="15 18 9 12 15 6" />,
    chevR: <polyline points="9 18 15 12 9 6" />,
    chevD: <polyline points="6 9 12 15 18 9" />,
    cal: <><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></>,
    play: <polygon points="6 3 20 12 6 21 6 3" />,
    check: <polyline points="20 6 9 17 4 12" />,
    x: <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    plus: <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
    edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    trash: <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6M10 3h4a1 1 0 0 1 1 1v2H9V4a1 1 0 0 1 1-1z"/></>,
    search: <><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></>,
    moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
    send: <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,
    keyboard: <><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"/></>,
    sparkle: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/></>,
    git: <><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M6 8v6a4 4 0 0 0 4 4h6"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>,
    info: <><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>,
    alert: <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
    menu: <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>,
    cmd: <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/>,
    split: <><path d="M3 12h6l3-3 3 6 3-3h3"/></>,
    merge: <><path d="M8 6V4M8 4h8M8 4L3 9M16 4l5 5M12 13v7"/></>,
    dot: <circle cx="12" cy="12" r="3" />,
    circle: <circle cx="12" cy="12" r="9" />,
    gear: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
};

// ------- Mock data (represents what the backend would send) -------
const MOCK_TICKETS = [
  { key: "CORE-482", summary: "OAuth refresh loop when token expires during long idle", status: "In Progress", project_key: "CORE" },
  { key: "CORE-501", summary: "Migrate Jira worklog push to v3 REST endpoint", status: "In Progress", project_key: "CORE" },
  { key: "CORE-477", summary: "Add retry/backoff for Google Sheets append", status: "To Do", project_key: "CORE" },
  { key: "PLAT-118", summary: "Provision prod VM and document SSH key conversion", status: "In Review", project_key: "PLAT" },
  { key: "PLAT-120", summary: "Runbook: rotating service account credentials", status: "To Do", project_key: "PLAT" },
  { key: "DATA-33",  summary: "Timeline builder: merge contiguous same-state segments", status: "Done", project_key: "DATA" },
  { key: "DATA-44",  summary: "Classifier: recognize WebStorm + DataGrip window suffixes", status: "In Progress", project_key: "DATA" },
  { key: "WEB-12",   summary: "Review UI: draggable gap-fill blocks", status: "To Do", project_key: "WEB" },
  { key: "WEB-9",    summary: "Review UI: keyboard shortcuts + command palette", status: "To Do", project_key: "WEB" },
];

// Mock day: activity segments + blocks + git events for 2026-04-24
const MOCK_SEGMENTS = [
  { start: "08:42", end: "09:18", kind: "work",         project: "CORE",  ticket: "CORE-482", title: "timeline/builder.py — Cursor", minutes: 36 },
  { start: "09:18", end: "09:34", kind: "unclassified", project: null,    ticket: null,       title: "Inbox (47) · you@work — Chrome", minutes: 16 },
  { start: "09:34", end: "10:52", kind: "work",         project: "CORE",  ticket: "CORE-482", title: "routes.py — Cursor",          minutes: 78 },
  { start: "10:52", end: "11:08", kind: "idle",         project: null,    ticket: null,       title: "",                              minutes: 16 },
  { start: "11:08", end: "12:20", kind: "work",         project: "PLAT",  ticket: "PLAT-118", title: "Generate SSH key — PowerShell", minutes: 72 },
  { start: "12:20", end: "13:05", kind: "idle",         project: null,    ticket: null,       title: "",                              minutes: 45 },
  { start: "13:05", end: "14:12", kind: "work",         project: "DATA",  ticket: "DATA-44",  title: "classifier.py — Cursor",       minutes: 67 },
  { start: "14:12", end: "14:28", kind: "unclassified", project: null,    ticket: null,       title: "Slack — #eng-infra",            minutes: 16 },
  { start: "14:28", end: "15:44", kind: "work",         project: "WEB",   ticket: "WEB-9",    title: "day.html — Cursor",            minutes: 76 },
  { start: "15:44", end: "16:00", kind: "idle",         project: null,    ticket: null,       title: "",                              minutes: 16 },
  { start: "16:00", end: "17:32", kind: "work",         project: "CORE",  ticket: "CORE-501", title: "jira_client/client.py — Cursor", minutes: 92 },
];

const MOCK_GIT = [
  { t: "09:52", repo: "time-logger",   sha: "a1f3c2", msg: "fix(auth): guard token refresh when reauth prompt races" },
  { t: "10:41", repo: "time-logger",   sha: "b7e912", msg: "refactor(timeline): merge adjacent same-state segments" },
  { t: "13:48", repo: "classifier",    sha: "c2d004", msg: "feat(classifier): detect DataGrip + WebStorm suffixes" },
  { t: "14:58", repo: "time-logger",   sha: "d1a9f2", msg: "wip(ui): day view skeleton + coverage ring" },
  { t: "17:19", repo: "jira-adapter",  sha: "e88bb1", msg: "feat(jira): swap worklog push to v3 REST endpoint" },
];

const MOCK_BLOCKS = [
  { id: 1, start: "08:42", end: "10:52", ticket: "CORE-482", project: "CORE", description: "Reproduced the OAuth refresh loop locally by forcing idle > 30m, traced the issue to overlapping refresh + reauth prompts. Added a single-flight guard in the middleware and covered with a regression test.", status: "draft", git: 2 },
  { id: 2, start: "11:08", end: "12:20", ticket: "PLAT-118", project: "PLAT", description: "Converted the Putty .ppk to OpenSSH .pem with puttygen -O private-openssh, validated with ssh-keygen -l, wired it into the runbook under /ops/ssh.md.", status: "draft", git: 0 },
  { id: 3, start: "13:05", end: "14:12", ticket: "DATA-44",  project: "DATA", description: "", status: "draft", git: 1 },
  { id: 4, start: "14:28", end: "15:44", ticket: "WEB-9",    project: "WEB",  description: "Scaffolded the command palette (⌘K), fuzzy ticket match, keyboard routing, and wired recent-tickets list from the local cache.", status: "draft", git: 1 },
  { id: 5, start: "16:00", end: "17:32", ticket: "CORE-501", project: "CORE", description: "Swapped the worklog push from v2 /api to v3 REST. Updated the serializer to emit ADF for description, added an idempotency key derived from (date, start_ts).", status: "submitted", git: 1 },
];

// 28-day heatmap (minutes per day). -1 = no data / future.
const MOCK_HEATMAP = [
  420, 380, 460, 410, 430, 0, 0,
  445, 410, 395, 440, 460, 0, 0,
  430, 0,   410, 440, 420, 0, 0,
  410, 395, 425, 450, 480, 0, 0,
];

// helpers
const hmToMin = (hm) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
const minToHm = (m) => `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
const fmtDur = (mins) => `${Math.floor(mins/60)}h ${String(mins%60).padStart(2,"0")}m`;
const fmtDate = (iso) => {
  const d = new Date(iso + "T00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};
const isToday = (iso) => iso === TODAY;

const DATA = {
  TODAY, MOCK_TICKETS, MOCK_SEGMENTS, MOCK_GIT, MOCK_BLOCKS, MOCK_HEATMAP,
  hmToMin, minToHm, fmtDur, fmtDate, isToday,
};

Object.assign(window, { Icon, DATA });
