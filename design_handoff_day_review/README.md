# Handoff: Time Logger — Day Review UI Redesign

## Overview
This package contains a high-fidelity redesign of the **Day Review** screen of the Time Logger — the single view where users review detected activity, edit their drafted time blocks, fill gaps, and submit worklogs to Jira + Google Sheets.

The existing UI (`src/web/templates/day.html` + `src/web/static/style.css`) works but feels dated: low information density, heavy card chrome, native `<dialog>` modal, no keyboard support, no contextual help inside the edit dialog. This redesign keeps the **same data flow and routes** (FastAPI + Jinja + HTMX) but replaces the visual layer with a dense, keyboard-first, Superhuman/Height-style interface.

## About the Design Files
The files in this bundle are **design references created in HTML/React** — prototypes demonstrating intended look, layout, and interactive behavior. They are **not** production code to drop into `src/web/static/` verbatim.

Your task is to **recreate these designs inside the existing FastAPI + Jinja2 + HTMX stack**. Translate the React components into Jinja partials + small amounts of vanilla JS/Alpine/HTMX, reusing the real routes in `src/web/routes.py`, the models from `src/timeline/models.py`, and the data already served by `_day_context()` in `routes.py`.

If the team decides the interactive needs (⌘K palette, fuzzy combobox, keyboard nav) justify a heavier front-end, swapping in Alpine.js or a small React island is acceptable — but the default path is to stick with the current HTMX/Jinja architecture.

## Fidelity
**High-fidelity.** Colors, type, spacing, border-radii, iconography, modal layouts, and micro-interactions are all final. Recreate pixel-perfectly.

## Files in this bundle
- `day-redesign.html` — app shell (loads React + CSS + JSX modules)
- `day-redesign.css` — all design tokens + layout (authoritative for colors/spacing/type)
- `day-data.jsx` — mock data shaped to mirror real backend output + inline `Icon` component
- `day-parts.jsx` — `TimelineRibbon`, `CoverageStats`, `BlocksTable`, `DetectedSegments`, `BigRing`, `Heatmap`, `KeyboardHelp`
- `day-modals.jsx` — `EditModal`, `SubmitModal`, `CommandPalette`, `TicketCombo`
- `day-app.jsx` — composition root, keyboard routing, state, Tweaks wiring
- `tweaks-panel.jsx` — design-mode tweaks shell (NOT for production)

Open `day-redesign.html` in a browser to interact with the design. Toggle the Tweaks panel to try light mode / different accent hues / density variants.

---

## Screens / Views

### 1. Top Bar
- **Purpose**: Identity, date navigation, global actions
- **Layout**: Sticky flex row, 10px vertical / 20px horizontal padding, 1px bottom border, `backdrop-filter: saturate(1.4) blur(8px)`
- **Components**:
  - Brand mark (20×20 gradient square with diagonal hand) + "Time Logger / Day review" text, 13px Inter 600
  - Spacer (`flex: 1`)
  - Date nav pill: `< [Thu · April 24, 2026  TODAY] >` with hidden native `<input type="date">` overlaying the label for click-to-pick
  - Search button (opens ⌘K), ghost theme toggle (sun/moon), primary **Submit** button with embedded `⌘⏎` kbd

### 2. Timeline Ribbon (full-width, under top bar)
- **Purpose**: At-a-glance comparison of detected activity vs drafted coverage, with git commits as anchor points
- **Layout**: 76px tall; horizontal timeline from **07:00–19:00**
  - Row 1 (28px): segment bars (`work` = amber solid, `unclassified` = warn amber lighter, `idle` = 22% muted gray)
  - Row 2 (10px, overlapping below): drafted blocks as dashed amber outlines (or solid OK-green if submitted), plus absolute-positioned git commit dots (info-blue, 8×8 circle with 2px bg-colored halo)
  - Hour grid lines every hour (major every 2h), labels 10px JetBrains Mono
  - Red "now" indicator (2px amber bar + dot) at current time
- **Tooltip**: appears on hover, small dark card with time range + ticket/title/commit message

### 3. Coverage Stats Strip
- **Purpose**: 5-up summary of the day
- **Layout**: `grid-template-columns: repeat(5, 1fr)` with 1px dividers; each cell has 12px/14px padding
- **Cells**: Drafted (with 44×44 progress ring), Detected work, Unclassified, Idle, Coverage (% + delta)
- Value type is 18px 600 weight, tabular-nums, letter-spacing -0.02em

### 4. Time Log Blocks (primary editor)
- **Purpose**: The actual editable list
- **Layout**: Table inside a rounded 8px panel with 1px border
- **Row grid**: `28px 110px 58px 118px 1.25fr 1fr 86px 92px` for `status-dot | time | dur | ticket | desc | project | badges | actions`
- **Status dot**: 8×8 colored dot — amber (draft), OK (submitted), red with halo (missing description)
- **Time**: JetBrains Mono, tabular-nums, `08:42 → 10:52` with muted `→`
- **Ticket column**: key (amber mono 600) + 11px muted summary
- **Description**: single-line ellipsis at 13px; placeholder italic muted if empty
- **Badges**: small uppercase mono chips — `SYNCED`, `⎇2` (git count), `EMPTY`
- **Actions**: icon buttons (edit, split, delete) that fade in on hover / when row is selected
- **Selected row**: amber-ghost bg + 2px left-accent bar
- **Gap rows** between blocks: diagonal-striped `-45deg` repeating gradient, mono muted text "Gap · 12:20–13:05 · 45m unaccounted" with "Fill gap" chip button

### 5. Detected Activity (collapsible panel)
- **Purpose**: The raw, unfiltered segment list — preserves the transparency of the old UI
- **Layout**: Same panel style. Header row is clickable, caret rotates -90° when collapsed.
- **Row grid**: `6px stripe | 100px time | 50px mins | 120px ticket | 1fr title | badges`
- Stripe color maps to segment kind

### 6. Right Rail (fixed 320px, collapses below panel at ≤1100px)
- **Day progress card**: 88×88 SVG with nested rings — outer pale amber (detected work / target), inner solid amber (drafted / target) + big 22px percent display + "6h 40m drafted" subtitle
- **Last 28 days heatmap**: 7×4 grid (M-S columns, most recent row labeled "now"). Cells use amber with 4 opacity steps (`l1` .22, `l2` .42, `l3` .65, `l4` full)
- **Sync targets card**: key/value pairs — Jira ● connected, Sheets ● wk/2026-W17, Collector ● sampling 30s, Last git scan · 2m ago
- **Keyboard help card**: list of shortcuts with `kbd` chips

### 7. Edit Block Modal
- **Width**: 760px, rounded 12px, shadow `0 20px 50px -20px rgba(0,0,0,0.6)`
- **Head**: title + meta line (`08:42 – 10:52 · 130m · CORE`), × button
- **Body**:
  - 3-column grid: Start / End / Duration (readonly)
  - **Ticket combobox**: input with live fuzzy filter; dropdown has "Recent" section (pre-seeded with last-used tickets) + "All tickets" section; each item shows key (mono amber), summary, Jira status chip. Arrow keys + Enter + Esc fully wired.
  - **Description textarea**: JetBrains Mono, min-height 160px, 7 rows default. Below it, **commit-suggestion chips** pulled from `Segment.git_events` that fall within the block's time window — clicking a chip appends the commit message to the description.
  - **Context panel** (`.edit-context`): bordered card listing detected window titles + commits inside this block's time window
- **Foot**: left = Delete (drafts only); right = Esc/⌘⏎ hint + Cancel + Save block
- ⌘⏎ saves, Esc closes

### 8. Submit Confirmation Modal
- **Width**: 620px
- **Summary grid**: Blocks / Total time / Issues count
- **Warning flash** if any drafts lack ticket or description
- **Per-block list**: each item = check-or-alert icon + time + ticket key + description (ellipsized) + target label ("Jira · Sheets")
- **Foot hint**: "Idempotent by (date, start_ts)"

### 9. Command Palette (⌘K)
- Centered modal, 560px, 14vh from top
- Input row with search icon + placeholder "Type a command, ticket, or keyword…" + `esc` kbd
- Results list mixes commands (with hint column showing shortcut) and tickets (with status chip)
- Fuzzy filter, arrow-key navigation, Enter to execute

---

## Interactions & Behavior

### Keyboard shortcuts (all implemented in the prototype)
| Key | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Open command palette |
| `⌘⏎` | Open submit modal |
| `J` / `↓` | Select next block |
| `K` / `↑` | Select previous block |
| `E` | Edit selected block |
| `[` / `]` | Previous / next day |
| `T` | Jump to today |
| `⇧S` | Auto-seed blocks from detected work |
| `N` | New block |
| `?` | Toggle keyboard help |
| `Esc` | Close modal / palette |

### Animations (all CSS, `cubic-bezier(0.2, 0.7, 0.2, 1)`)
- Modal backdrop: `fade 0.15s`
- Modal body: `slide 0.18s` (6px translate + 0.99 scale)
- Block row hover: background 0.1s
- Progress ring: stroke-dashoffset 0.6s
- Date picker, buttons: 0.12s on all transitions

### Form validation
- End time must be after start time (server-side today; surface inline in modal)
- Drafts without ticket or description can still be saved, but the submit modal flags them and the backend skips them at push time

---

## Design Tokens (authoritative)

### Colors — Dark theme (default)
```
--bg:        #0a0b0d
--bg-2:      #0f1114
--panel:     #14171c
--panel-2:   #191d23
--panel-3:   #20252d
--border:    rgba(255,255,255,0.07)
--border-2:  rgba(255,255,255,0.11)
--border-3:  rgba(255,255,255,0.18)
--text:      #e8ebef
--text-2:    #b5bcc6
--muted:     #7a8390
--muted-2:   #565e69
```

### Colors — Light theme
```
--bg:        #f8f7f4
--bg-2:      #ffffff
--panel:     #ffffff
--panel-2:   #f4f2ee
--panel-3:   #ebe8e1
--border:    rgba(24,20,10,0.08)
--text:      #17181b
--muted:     #6b7280
```

### Accent (amber)
Parametric via `--acc-h: 35` hue:
```
--accent:        oklch(0.72 0.17 35)     ≈ #f59e0b
--accent-strong: oklch(0.66 0.19 35)     ≈ #e08c07
--accent-soft:   oklch(0.72 0.17 35 / 0.18)
--accent-ghost:  oklch(0.72 0.17 35 / 0.08)
--accent-fg:     #1a1407  (dark) / #ffffff (light)
```

### Status
```
--ok:      oklch(0.74 0.13 155)   ≈ #5dc48f
--warn:    oklch(0.78 0.14 75)    ≈ #f4bf6d
--danger:  oklch(0.67 0.17 25)    ≈ #e06464
--info:    oklch(0.72 0.10 230)   ≈ #7aa9d8
```

### Typography
- UI: `"Inter", -apple-system, "Segoe UI", Roboto, sans-serif` with OpenType features `cv11, ss01, ss03`
- Mono: `"JetBrains Mono", ui-monospace, "SF Mono", monospace`
- Scale: 11 / 12 / **13** / 15 / 18 / 22 px
- Base line-height 1.5, body letter-spacing 0; large values use `letter-spacing: -0.02em`

### Radii
```
--r-xs: 4px  --r-sm: 6px  --r-md: 8px  --r-lg: 12px
```

### Shadows
```
--shadow-sm: 0 1px 2px rgba(0,0,0,0.3)
--shadow-lg: 0 20px 50px -20px rgba(0,0,0,0.6), 0 8px 18px -10px rgba(0,0,0,0.55)
```

### Spacing
Follows a 2/4/6/8/10/12/14/16/20 px progression. Grid dividers use 1px solid `--border`.

---

## Backend Mapping (ties to existing code)

| UI element | Maps to |
|---|---|
| Top bar date pill, `[` `]` | existing `/day/{ds}` route; `prev`, `next`, `today` in `_day_context()` |
| Coverage stats | `day.total_work_minutes`, `day.total_idle_minutes`, `drafted_minutes` already in context |
| Timeline ribbon segment bars | `day.segments` (Segment dataclass from `src/timeline/models.py`) |
| Timeline git commit dots | derive from `Segment.git_events` (already joined in `builder.py`) |
| Blocks table rows | `blocks` from `blocks_service.list_for_date(ds)` |
| Ticket combobox data | `tickets` from `blocks_service.cached_tickets()` |
| Auto-seed button | existing POST `/day/{ds}/seed` |
| Add block form | existing POST `/day/{ds}/block` |
| Edit modal Save | existing POST `/block/{block_id}` |
| Edit modal Delete | existing POST `/block/{block_id}/delete` |
| Submit button | existing POST `/day/{ds}/submit` |
| Commit suggestion chips | `Segment.git_events` inside the block's `[start_ts, end_ts)` window. The current `_suggested_description` in `builder.py` joins them with `"; "` — instead, expose them as a list so the UI can offer them as individual chips. |
| Empty-block warning in submit modal | matches existing skip logic in `submit_service.submit_day` |

### New pieces needed
- **Weekly heatmap data**: new lightweight aggregate endpoint, e.g. `GET /metrics/last28` returning `[{date, minutes_drafted, minutes_submitted}]`
- **Keyboard shortcut routing**: add a small `static/keys.js` that reads `data-action` attributes and dispatches HTMX requests or DOM focus
- **⌘K command palette**: can be a small Alpine component or vanilla JS listing tickets from `cached_tickets` and commands as hardcoded entries

---

## Recommended implementation order
1. Port tokens to `style.css` as CSS custom properties (copy `:root` + `[data-theme=light]` blocks verbatim)
2. Rebuild the blocks table as a Jinja macro with the new grid — this alone is the biggest perceived quality jump
3. Add the coverage stats strip (simple Jinja math, no JS)
4. Add the timeline ribbon (server-rendered SVG or divs positioned by `left: %` — no JS needed for display; hover tooltips can be pure CSS)
5. Redesign the edit modal (can stay as `<dialog>`; just restyle)
6. Add command palette (Alpine.js recommended)
7. Add keyboard shortcut routing
8. Add submit confirmation modal (replace current direct-POST button with a confirm step)
9. Wire the 28-day heatmap (new endpoint)
10. Add light/dark toggle (`data-theme` attr on `<html>` + localStorage)

## Assets
No external image assets. All iconography is inline SVG in `Icon` component of `day-data.jsx` — port to a small Jinja macro `{% macro icon(name) %}` or keep as inline SVGs in templates.

Fonts are loaded from Google Fonts in `day-redesign.html`:
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

## Out of scope for this handoff (asked about but deferred)
- Drag-to-resize blocks on the ribbon
- Split / merge interactions (icons are in the table, behavior unimplemented)
- First-run / empty-state screen for "collector not running"
- Back-dating UX beyond the existing date picker

---

## Open questions for the developer
1. **HTMX vs Alpine.js vs React island**: the prototype is React for convenience. The existing app is HTMX. I recommend: keep HTMX for CRUD, add Alpine.js (6kb) for the palette/combobox/keyboard routing. Confirm before starting.
2. **Theme persistence**: localStorage is fine, or add a user setting in `kv.py`?
3. **Heatmap range**: 28 days (4 weeks) shown in the mock. If you want 12 weeks like GitHub, say so — the grid generalizes trivially.
