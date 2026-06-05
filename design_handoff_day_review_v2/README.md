# Handoff: Day Review — v2 Redesign

## Overview

This handoff covers a redesign of the **Day Review** screen in **Time Logger** — the app surface where users review their detected work activity, draft time-log blocks, and submit worklogs to Jira + a weekly Google Sheet.

v2 builds on the original `day-redesign.html` (which is in the `design_handoff_day_review/` sibling folder) with significant changes across brand, layout, components, and interactions. See the **Diff vs v1** section for an at-a-glance list.

The web app lives at `Time Logger/run_web.py` + `Time Logger/src/`. v2 should replace the existing day review screen.

## About the Design Files

The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy directly. They use React 18 via Babel-standalone in the browser for the prototype only.

The task is to **recreate these designs in the existing Time Logger web app's environment** (Python web backend + whatever frontend framework `run_web.py` serves — check `Time Logger/src/web/` or similar), following its established patterns and libraries. If the existing day view is plain server-rendered HTML, port the design to that. If there is no UI framework convention yet, FastAPI + HTMX + a small amount of vanilla JS would be a reasonable fit given the rest of the project.

Translate the React state hooks in the prototype to whatever state mechanism the target uses (localStorage, server-rendered state with HTMX swaps, a small Alpine.js store, etc).

## Fidelity

**High-fidelity (hifi)** — pixel-perfect mockups with final colors, typography, spacing, interactions, copy. Recreate the UI as faithfully as possible. All measurements, color tokens, and typography scales are pinned in `day-redesign-v2.css` and documented below.

## Diff vs v1

| Area | v1 | v2 |
|---|---|---|
| Brand mark | Flat orange rounded square with abstract clock-hand notch | **6 logo directions** — see "Brand" section. Default = "Block Stack" (three stacked bars echoing the ribbon). Switchable via the Tweaks panel; `logo-canvas.html` shows all 6 on dark / light / accent backgrounds. |
| Top bar | Single row: brand · spacer · date nav · search button · theme · submit | **Two rows** — Row 1: brand + view tabs (Day/Week/Month) · persistent ⌘K search · inline draft-% progress pill · live wall clock · theme · submit. Row 2: date nav · counts · auto-seed · new block |
| Ribbon | Fixed 12-hour window, hover tooltips, 76px tall | **Taller (96px)**, zoom pills (12h / 4h / 1h), **drag-to-create** blocks by dragging on the track, pulsing now-line, gradient backdrop |
| Coverage stats | 5 equal-width stats in a row | **Hero stat** (Drafted) at 2.4× width with 7-day sparkline + target / vs-detected / 7-day-avg cluster, **+** 4 demoted small stats. Coverage cell uses a horizontal progress bar with 50/75/100% target marks instead of a number alone. |
| Blocks | Dense table (one row per block, 8 columns) | **Card list** (one card per block) with inline expand-to-edit (no modal for quick edits); status pills (DRAFT / SYNCED / EMPTY); the modal is still wired for power-edit (kept from v1) |
| Gap rows | Plain "16m unaccounted" with Fill-gap button | **Smart gap suggestion** — "Likely PLAT-118 — Generate SSH key active here" with one-click **Accept** to create the block pre-filled with the suggested ticket + project |
| Color | Single warm accent | **Two-accent system** — warm `--accent` (action / draft / yours) + cool `--cool` (synced / git / system-confirmed). Synced blocks, the synced status pill, and git markers are all cool teal. |
| Type | 11–22px scale | **Larger** — 11/13/14/17/22/30px, plus a 44px tier for future hero numbers |
| Layout | 1 layout (3-column with right rail) | **3 layouts** via Tweaks — `3col` (default), `single` (centered, no rail), `timeline` (full-bleed ribbon, no rail, taller ribbon) |
| Submit flash voice | "✓ Submitted N worklogs to Jira and appended to the week's sheet" | Warmer: "Nice — N worklogs on their way to Jira, and the week's sheet is up to date." |

---

## Screens / Views

There is one primary screen: **Day Review**. It has three render variants controlled by the `layout` tweak, but the content is the same.

### Layout — Three-column (default, `layout-3col`)

```
┌─────────────────────────────────────────────────────────────────────┐
│  TOP BAR (row 1) — sticky                                           │
├─────────────────────────────────────────────────────────────────────┤
│  TOP BAR (row 2) — date + section actions                           │
├─────────────────────────────────────────────────────────────────────┤
│  RIBBON                                                             │
├──────────────────────────────────────────────────┬──────────────────┤
│  MAIN                                            │  RIGHT RAIL      │
│    Coverage hero + small stats                   │   28-day heatmap │
│    Time-log block cards                          │   Sync targets   │
│                                                  │   Keyboard help  │
└──────────────────────────────────────────────────┴──────────────────┘
```

- Grid: `grid-template-columns: 1fr 320px` for `main` + `rail`
- Top bar + row 2 + ribbon span both columns (`grid-area: topbar / row2 / ribbon`)
- Below 1100px viewport width, collapses to a single column with the rail stacked at the bottom

### Layout — Single column (`layout-single`)

- `grid-template-columns: minmax(0, 1100px)`, `justify-content: center`
- Rail is hidden (`.rail { display: none }`)
- Content max width 1100px, side padding 32px

### Layout — Timeline-first (`layout-timeline`)

- Full-bleed ribbon, no rail
- Ribbon is taller — 124px overall, 52px track, draft row at top 68px height 18px
- Main content below ribbon, full width

---

## Top Bar — Row 1

Sticky, `position: sticky; top: 0; z-index: 40`, with `backdrop-filter: saturate(1.4) blur(10px)`.

Grid: `auto minmax(0, 1fr) auto`, gap 18px, padding `12px 24px`.

### Left cluster (brand + view tabs)
- `display: flex; align-items: center; gap: 18px; flex-shrink: 0; white-space: nowrap`
- **BrandLockup**: logo SVG at 26px + wordmark "Time Logger" at 14px / weight 700 / letter-spacing -0.02em. See "Brand" section.
- **View tabs** segmented control:
  - Container: `padding: 2px; background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-sm) /* 6px */`
  - 3 buttons: "Day" | "Week" | "Month"; height 26px, padding `0 12px`, font-size 13px, weight 500
  - Active state: background `var(--bg-2)`, color `var(--text)`, inner shadow `inset 0 0 0 1px var(--border-2)` + outer `0 1px 2px rgba(0,0,0,0.2)`
  - "Day" is the only active route in this redesign; Week/Month are stubs

### Center (persistent search)
- `<button>` styled to look like an input. Clicking it opens the ⌘K command palette modal.
- `display: flex; align-items: center; gap: 8px; max-width: 440px; margin: 0 auto; height: 32px; padding: 0 12px`
- `background: var(--panel); border: 1px solid var(--border); border-radius: 6px`
- Search icon (14px) + placeholder "Jump to a ticket, command, or day…" + `⌘ K` kbd hint right-aligned

### Right cluster (progress + clock + actions)
- `display: flex; align-items: center; gap: 10px`

**Inline progress pill**
- Pill: `background: var(--panel); border: 1px solid var(--border); border-radius: 99px; padding: 6px 10px; gap: 10px`
- 22×22 SVG ring (orange arc on dark track) + bold % + small "/ 8h" caption (mono, muted)
- Mirrors the hero stat — gives draft-% visibility regardless of scroll position

**Live clock** (mono)
- 2 lines, right-aligned, line-height 1, min-width 64px
- Top: `HH:MM` 14px weight 600 tabular-nums
- Bottom: 10px mono uppercase `● SAMPLING 30s` — the green dot is `var(--ok)` and pulses with a 2.4s ease-in-out fade

**Theme toggle** — ghost icon button (sun / moon), 28px square

**Submit button** — primary button with `Submit` label + `⌘⏎` kbd hint; disabled when no drafts exist

---

## Top Bar — Row 2

Single row, `padding: 8px 24px; gap: 12px; border-bottom: 1px solid var(--border)`.

Contents (left to right):
- **Date nav** — same as v1: chevron-left button · "Mon April 24, 2026" date label with hidden `<input type="date">` overlay (click to open native date picker) · TODAY pill (orange) when date is today · chevron-right button
- **Spacer** (flex 1)
- **Counts text** — "`5` blocks · `1` synced" — `5` bold white, `1` bold in cool teal
- **Auto-seed** button — small, `<Icon sparkle/>` + label + `⇧S` kbd
- **New block** button — small, `+` + label

---

## Ribbon

Wrap: `padding: 14px 24px 18px; background: linear-gradient(180deg, var(--bg) 0%, var(--bg-2) 100%); border-bottom: 1px solid var(--border)`.

### Head
- Left: "**Today's timeline**" (text 14px) + sub "7H 01M DETECTED · 5 DRAFTS · 5 COMMITS" (11px mono uppercase muted, letter-spacing 0.08em)
- Right: legend (Work / Unclassified / Idle / Commit chips) + zoom pills

### Zoom pills
- Container: pill (border-radius 99px), padding 2px, background `var(--panel)`
- Buttons: "12h" | "4h" | "1h" (the day option is labeled "12h" in the UI), height 22px, padding `0 10px`, mono 11px
- Active state same pattern as view-tabs

### Ribbon body
- Height 96px, `padding: 8px 0 26px`
- Visible time window depends on zoom: day = 07:00–19:00, 4h = 09:00–13:00, 1h = 10:00–11:00
- 3 horizontal layers from top:
  1. **Track** — full-width, 36px tall, `border-radius: 8px`, holds `seg-bar` segments
     - `.seg-bar.work` — solid `var(--accent)` (orange)
     - `.seg-bar.unclassified` — `var(--warn)` at 0.78 opacity
     - `.seg-bar.idle` — `var(--muted-2)` at 0.22 opacity
  2. **Draft row** — at `top: 50px`, height 14px, holds dashed-border draft bars
     - `.draft-bar` (draft status) — `background: var(--accent-soft); border: 1.5px dashed var(--accent); border-radius: 4px`
     - `.draft-bar.submitted` — `background: var(--cool-soft); border: 1.5px solid var(--cool)` (no dash)
  3. **Git markers** — same `top: 50px`, 10×10 circles, cool teal, 2px ring of bg color to lift off the track
- **Hour ticks + labels** at bottom — mono 10px, labels positioned at percentage of window
- **Now line** — full-height (top: -4px, bottom: 14px), 2px wide, orange, `box-shadow: 0 0 14px var(--accent), 0 0 28px var(--accent)`, pulses opacity 1↔0.6 on a 2s loop
- **Drag-to-create** — clicking + dragging on empty track area shows a ghost block (`.ghost-block`); on mouseup, if drag > 10 minutes, calls `onAddBlock(startHm, endHm)` rounded to nearest 5 minutes. The block opens expanded for immediate edit. Bottom-of-ribbon hint "drag the track to draft a block" (10px mono uppercase muted) fades in on hover.
- **Tooltip on hover** — small dark card with bold range + subtitle, follows cursor (`left: clientX - 20; top: 0`)

---

## Main — Coverage stats

Grid container `.coverage-v2`:
- `grid-template-columns: minmax(420px, 2.4fr) repeat(4, minmax(0, 1fr))`
- `gap: 1px; background: var(--border)` to fake cell borders
- `border-radius: 8px; overflow: hidden`
- Below 1280px, hero collapses to full width and the 4 small stats wrap to a 4-col row below

### Hero — "Drafted today"

- `min-height: 130px; padding: 20px 24px`
- Background: `var(--bg)` + radial gradient `var(--hero-glow)` = `radial-gradient(120% 80% at 0% 0%, oklch(0.72 0.17 var(--acc-h) / 0.16), transparent 70%)`
- Grid: `auto 1fr` (ring + body); sparkline is absolutely positioned top-right

**Ring** (left): 76×76 SVG
- Track: `circle r=32 stroke="var(--border-2)" stroke-width="6"`
- Fill: `circle r=32 stroke="var(--accent)" stroke-width="6"`, `stroke-dasharray = 2π·32`, `stroke-dashoffset = c - (c × pct / 100)`, rotated -90°, `stroke-linecap: round`
- Transition: `stroke-dashoffset 0.7s var(--ease)`

**Body**
- Label "DRAFTED TODAY" — 11px uppercase muted weight 600 letter-spacing 0.08em
- Value — `7h 17m` at 30px weight 700, tabular-nums, letter-spacing -0.025em, plus a pill `91%` at 14px in `var(--accent-soft)` background, color `var(--accent)`, border-radius 99px, padding 2px 8px
- Sub row — flex gap 18px wrap, three groups of (10px uppercase label + 13px mono value):
  - "Target / 8h 00m"
  - "Vs detected / +0h 16m" (color `var(--ok)` if positive, `var(--warn)` if negative)
  - "7-day avg / 6h 11m"

**Sparkline** (absolutely positioned, top: 22px, right: 22px)
- 140×36 SVG, preserveAspectRatio="none"
- Path d = 7 points across the width; `area` path closes to bottom of svg
- `.line` — stroke `var(--accent)`, 1.5px
- `.area` — fill `var(--accent)`, opacity 0.16
- `.dot` — fill `var(--accent)`, r=2.5 at last point
- Label above: "7-day · drafted" — 9px uppercase muted

### Small stats — 4 cells

Each: `padding: 14px 16px; background: var(--bg)`, vertical stack of label + value + sub.
- Label: 11px uppercase muted weight 600, icon at 10px on the left
- Value: 22px weight 600, tabular-nums, line-height 1.1
- Sub: 11px muted

Cells:
1. **Detected work** — "7h 01m" / "6 segments"
2. **Unclassified** — "0h 32m" / "needs review"
3. **Idle** — "1h 17m" / "away from kb"
4. **Coverage** — "104%" / **coverage bar** instead of caption:
   - 6px tall pill bar, full width, background `var(--panel-2)`, border-radius 99px
   - `.fill` — orange, animated width to `min(100, draftMin / workMin × 100)`
   - 3 vertical `.mark` lines at 50%, 75%, 100% — 1px wide, 2px tall overflow above/below, color `var(--border-3)`

---

## Main — Time log blocks

Section head: "Time log" (14px weight 600) + count "5 total · 1 synced · 1 empty" (11px muted)

Container: `.blocks-v2` — flex column, gap 8px.

### Block card

Container: `.block-card`
- Background `var(--panel)`, border 1px `var(--border)`, border-radius 8px
- Hover: `border-color: var(--border-2); transform: translateY(-1px); box-shadow: var(--shadow-sm)`
- Selected: `border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ghost)`
- Submitted: `background: var(--bg-2); border-color: var(--cool-soft)`; ticket key turns cool teal

#### Card head (always visible)

Grid: `auto 1fr auto auto`, gap 14px, padding `12px 16px`, cursor pointer.

1. **Time block** (mono, tabular-nums)
   - Range "08:42 → 10:52" — 14px weight 600 color text, letter-spacing -0.01em
   - Duration "130m" — 11px muted, margin-top 2px

2. **Meta** (vertical stack, gap 4px)
   - Row 1: ticket key (14px weight 700 accent mono letter-spacing -0.01em) + summary (13px text-2, ellipsis on overflow)
   - Row 2: description preview (13px text-2, single line ellipsis); if empty, "Add a technical summary…" in muted-2 italic

3. **Badges** (`.block-badges-v2`)
   - Optional git badge — `[git-icon] N`, cool background `var(--cool-ghost)`, color `var(--cool)`, mono 10px weight 600, 20px tall, padding 0 7px
   - Optional project badge — same shape but in `var(--panel-2)` color muted
   - **Status pill** — 22px tall, rounded full, 10px weight 700 uppercase letter-spacing 0.06em, with a 5px dot before the label using `currentColor`
     - `.draft` — orange-soft bg, orange text
     - `.synced` — cool-soft bg, cool text
     - `.empty` — danger-soft bg, danger text

4. **Actions** — `opacity: 0`, becomes 1 on hover or when selected. Edit (expand) + Delete icon buttons.

#### Inline editor (expands within card)

Border-top + `background: var(--bg-2); padding: 14px 16px 12px`, two-col grid (1fr 1fr), gap 12px.

Cells:
- **Time window** — two `<input type="time">` side-by-side (start + end), mono, tabular-nums, focus ring uses `accent-soft`
- **Ticket** — `TicketCombo` (search input with dropdown of tickets, recents first, fuzzy filter)
- **Description** (full width, grid-column: 1 / -1) — `<textarea>` mono 13px line-height 1.5, min-height 76px. Below: **suggestion chips** from git commits in the block's time window — clicking a chip appends the commit message to the description.
- **Editor footer** (full width) — left: kbd hint "`Esc` close · `⌘`+`⏎` save"; right: Cancel + Save (primary, with check icon)

Selecting + saving updates the block in place; collapsing the editor reveals the updated head.

---

## Main — Smart gap row

Between two adjacent blocks where the gap is ≥ 10 minutes, render a `.gap-card` between them.

Container: `padding: 10px 14px; border: 1px dashed var(--border-2); border-radius: 8px`, diagonal striped background `repeating-linear-gradient(-45deg, transparent 0 8px, var(--hover) 8px 16px)`.

Grid: `auto 1fr auto`, gap 14px, items aligned center.

1. **Time + duration**
   - "Gap · 10:52–11:08" — mono 13px tabular-nums color text-2 weight 500
   - "16m unaccounted" — span inside, color `var(--warn)`, margin-left 8px, weight 600

2. **Suggestion** — heuristic:
   - Look at detected segments that fall in `[gap.start, gap.end]` and have a `ticket`. Take the first.
   - Otherwise look at git events in the window. Surface "N commit(s) in window" with no specific ticket.
   - Otherwise "no detected activity".
   - Format: "Likely **PLAT-118** — *Generate SSH key active here*"
   - Key in `var(--accent)` weight 600; reason in italic Inter 11px muted

3. **Actions**
   - "Accept" button (xs) — only if a ticket suggestion exists. Clicking creates a block from `gap.start` → `gap.end` pre-filled with that ticket + project.
   - "Fill gap" button (xs, plain) — creates an empty block in the gap and opens it expanded for edit.

---

## Right rail (3col layout only)

- Width 320px, `padding: 16px 18px 48px; border-left: 1px solid var(--border); background: var(--bg-2)`
- Sections, each: section header (`<h4>`) — 11px uppercase muted weight 600 letter-spacing 0.08em — + `.rail-card` (panel with border, padding 12px 14px, border-radius 8px)

Sections in order:
1. **Last 28 days** — heatmap grid (7 cols × 4 rows, day-of-week labels)
   - Cell sizing: aspect-ratio 1; gap 3px
   - Levels by minutes logged: empty (no data), 0 = panel-2, 1 = accent at 0.22, 2 = 0.42, 3 = 0.65, 4 = full accent
   - Today gets a 1.5px solid outline in `var(--text)` color
2. **Sync targets** — 4 key-value rows separated by dashed top border
   - "Jira · ● connected" (cool)
   - "Sheets · ● wk/2026-W17" (cool)
   - "Collector · ● sampling 30s" (ok)
   - "Last git scan · 2m ago"
3. **Keyboard** — list of shortcuts (label + kbd keys)

---

## Brand

**6 logo directions live in `day-v2-logos.jsx`** and are switchable via the Tweaks panel. The selected logo renders in the topbar via `<BrandLockup variant={logo} />`. See `logo-canvas.html` for a full canvas showing all 6 on dark / light / accent-tinted backgrounds plus favicon sizes.

| id | Name | Description |
|---|---|---|
| `stack` (default) | Block Stack | 3 stacked horizontal bars (widths 20/13/17, varying opacities) — echoes the ribbon segments |
| `arc` | Progress Arc | A ring with a percentage-filled arc and a center dot — doubles as a live coverage indicator. Could animate from 0% to today's draft pct on mount/day-change. |
| `mono` | TL Monogram | Rounded square in accent with a T-shape carved out by accent-fg strokes |
| `clock` | Wedge Clock | A clock circle with a 12-to-4-o'clock wedge filled in accent + a center pip |
| `hourglass` | Hourglass | Two stacked Z-shape wedges forming an hourglass-like form |
| `carve` | Carved Clock | The original v1 mark refined — clock face carved out, both hour and minute hands visible |

All marks use `var(--accent)` / `var(--accent-fg)` and respond to theme + accent-hue tweak.

For production, pick **one** of the six and remove the rest. Default recommendation: `stack` (it ties the brand to the product's central artifact, the timeline ribbon).

The wordmark "Time Logger" should be Inter weight 700, 14px, letter-spacing -0.02em next to the mark with a 10px gap. Page breadcrumb optional (`/ Day review`).

---

## Interactions & Behavior

### Keyboard shortcuts (global)
- `⌘K` / `⌃K` — open command palette
- `⌘⏎` / `⌃⏎` — open submit modal
- `j` / `↓` — select next block
- `k` / `↑` — select previous block
- `e` — toggle inline edit on the selected block
- `[` — previous day
- `]` — next day
- `t` — jump to today
- `⇧S` — auto-seed
- `n` — new empty block (defaults to 09:00–09:30)
- `?` — toggle keyboard help (originally; can be omitted in v2)
- `Esc` — close any open modal / collapse the editor

Suppress all single-key shortcuts when typing in an input/textarea/select.

### Ribbon
- Hovering a segment / draft bar / git marker shows a floating tooltip
- Clicking a draft bar selects the block (sets `selectedId`)
- Mousedown on empty track area + drag horizontally + mouseup creates a new block snapped to 5-minute boundaries (minimum 10 minutes)
- Zoom pills swap the visible window (12h / 4h / 1h); segments outside the window are not rendered

### Block card
- Click anywhere on the head — selects + toggles expand
- Hover — actions appear, card lifts 1px with subtle shadow
- Expand editor — focuses the description textarea on mount
- Save — commits form values to the block, collapses the editor, fires a toast "Saved CORE-482"
- Delete — removes the block (only available when not submitted), fires "Block deleted" toast

### Smart gap
- "Accept" — creates a block in the gap window pre-filled with the suggested ticket + project
- "Fill gap" — creates a blank block in the gap window and opens the editor

### Submit flow
- Top-right Submit button (or ⌘⏎) opens the submit modal — shows count + total minutes + ticket count summary, a warning if any drafts are missing a ticket or description (they'll be skipped), and a list of items being submitted
- Confirm — marks all valid drafts as `submitted`, closes modal, surfaces a flash banner with the friendly "Nice — N worklogs on their way to Jira, and the week's sheet is up to date." message
- Backend hook: same as v1 — `POST /api/day/<date>/submit` would push Jira worklogs (v3 REST) and append to the sheet; idempotency key derived from `(date, start_ts)`

### Live clock
- Updates every 30 seconds. Pulled from `new Date()` client-side in the mock.
- Format: `HH:MM` 24-hour, zero-padded. Sub-line shows the collector status with a pulsing dot. In production this could be a real "last sample" indicator pulled from the collector.

### Theme toggle
- Persists via the Tweaks panel `__edit_mode_set_keys` mechanism in the prototype. In production, persist to user preference / localStorage.
- Light theme has separate token values; cards become white with subtle shadows instead of dark panel.

### Tweaks panel
- Prototype-only — the live panel for switching logo, layout, theme, accent hue, density.
- Do not ship in production. The values it controls should be:
  - `logo` — pick **one** in production (recommended `stack`)
  - `theme` — user setting (toggle in topbar persists it)
  - `accentHue` — fixed in production at `35` (warm orange)
  - `layout` — pick **one** in production (recommended `3col` for desktop, reflow to `single` < 1100px)
  - `density` — could be a user setting, or fixed at `comfortable`
  - `showHeatmap` / `showKeyboardHelp` — fixed visible in production

---

## State Management

Translate from the prototype's `useState` hooks:

| State | Type | Notes |
|---|---|---|
| `date` | `string` ISO date `YYYY-MM-DD` | Drives all data loaded for the day |
| `blocks` | `Block[]` | The user's drafted/submitted blocks |
| `selectedId` | `number \| null` | Currently selected block, for keyboard nav + ribbon highlight |
| `expandedId` | `number \| null` | Which block has its inline editor open; only one at a time |
| `showSubmit` | `boolean` | Submit modal open |
| `showCmdk` | `boolean` | Command palette open |
| `flash` | `{level, msg} \| null` | Top-of-main banner after submit |
| `toast` | `string \| null` | Bottom-center transient toast |
| `view` | `"Day" \| "Week" \| "Month"` | Active top-tab |
| `zoom` | `"day" \| "4h" \| "1h"` | Ribbon zoom level |
| `now` | `number` (minutes since midnight) | For the now-line; ticks every minute |

Block shape:
```ts
{
  id: number,
  start: "HH:MM",
  end: "HH:MM",
  ticket: string,         // e.g. "CORE-482"
  project: string,        // e.g. "CORE"
  description: string,
  status: "draft" | "submitted",
  git: number,            // count of commits in the block's time window
}
```

Source-of-truth data shape (see `day-data.jsx`):
- `MOCK_TICKETS` — `{key, summary, status, project_key}[]` from Jira
- `MOCK_SEGMENTS` — `{start, end, kind: "work"|"unclassified"|"idle", project, ticket, title, minutes}[]` from the collector + classifier
- `MOCK_GIT` — `{t: "HH:MM", repo, sha, msg}[]` from the git scanner
- `MOCK_HEATMAP` — `number[]` of 28 daily totals (-1 = no data / future)

---

## Design Tokens

All tokens defined in `:root` of `day-redesign.css` (imported as a base by `day-redesign-v2.css`), then overridden / extended in `day-redesign-v2.css`.

### Colors — dark theme (default)

| Token | Value | Use |
|---|---|---|
| `--accent` | `oklch(0.72 0.17 35)` ≈ `#E58A57` | Primary action / draft / yours |
| `--accent-strong` | `oklch(0.66 0.19 35)` | Pressed accent |
| `--accent-soft` | accent @ 0.18 alpha | Status pill bg, draft bar bg |
| `--accent-ghost` | accent @ 0.08 alpha | Selected row tint, focus ring fill |
| `--accent-fg` | `#1a1407` | Text on accent bg |
| `--cool` | `oklch(0.72 0.12 196)` ≈ `#5CB7C6` | **Synced / git / system-confirmed** — new in v2 |
| `--cool-strong` | `oklch(0.66 0.14 196)` | Pressed cool |
| `--cool-soft` | cool @ 0.18 alpha | Synced status pill bg |
| `--cool-ghost` | cool @ 0.08 alpha | Git badge bg |
| `--ok` | `oklch(0.74 0.13 155)` | System status (collector) |
| `--warn` | `oklch(0.78 0.14 75)` | Unclassified, "uncovered" deltas |
| `--danger` | `oklch(0.67 0.17 25)` | Empty status, errors |
| `--info` | `oklch(0.72 0.1 230)` | Legacy git color (replaced by `--cool` in v2) |
| `--bg` | `#0a0b0d` | Page background |
| `--bg-2` | `#0f1114` | Submitted card bg, table head bg |
| `--panel` | `#14171c` | Card background |
| `--panel-2` | `#191d23` | Inner panel, kbd bg |
| `--panel-3` | `#20252d` | Tooltip bg, toast bg |
| `--hover` | `rgba(255,255,255,0.035)` | Row hover |
| `--hover-2` | `rgba(255,255,255,0.06)` | Button hover |
| `--border` | `rgba(255,255,255,0.07)` | Default border |
| `--border-2` | `rgba(255,255,255,0.11)` | Stronger border |
| `--border-3` | `rgba(255,255,255,0.18)` | Strongest border, coverage marks |
| `--text` | `#e8ebef` | Primary text |
| `--text-2` | `#b5bcc6` | Secondary text |
| `--muted` | `#7a8390` | Labels, captions |
| `--muted-2` | `#565e69` | Placeholders |

Light theme — see `[data-theme="light"]` block in `day-redesign.css` + overrides in `day-redesign-v2.css`.

### Spacing scale

| Token | Value | Use |
|---|---|---|
| `--r-xs` | 4px | tabs, kbd |
| `--r-sm` | 6px | buttons, inputs, panels |
| `--r-md` | 8px | cards, ribbon track |
| `--r-lg` | 12px | modals |

Padding scale used (not tokenized but consistent): 6, 8, 10, 12, 14, 16, 18, 20, 22, 24px.

### Typography

| Token | v2 value | Was |
|---|---|---|
| `--fs-xs` | 11px | 11 |
| `--fs-sm` | 13px | 12 |
| `--fs-md` | 14px | 13 |
| `--fs-lg` | 17px | 15 |
| `--fs-xl` | 22px | 18 |
| `--fs-2xl` | 30px | 22 |
| `--fs-3xl` | 44px | — (new, unused in current designs but reserved for future hero numbers) |

Fonts (load both):
- `--font-ui: "Inter", -apple-system, "Segoe UI", Roboto, sans-serif` — body, headings
- `--font-mono: "JetBrains Mono", ui-monospace, "SF Mono", monospace` — all times, durations, ticket keys, project keys, sync key/value rows

Use `font-feature-settings: "cv11", "ss01", "ss03"` on body for Inter's stylistic alternates.

### Shadows
- `--shadow-sm: 0 1px 2px rgba(0,0,0,0.3)` — card hover lift
- `--shadow-lg: 0 20px 50px -20px rgba(0,0,0,0.6), 0 8px 18px -10px rgba(0,0,0,0.55)` — modals, dropdowns

### Easing
- `--ease: cubic-bezier(0.2, 0.7, 0.2, 1)` — used by all transitions (12–700ms range)

---

## Assets

- **Fonts**: Inter (400/500/600/700/800) + JetBrains Mono (400/500/600), both via Google Fonts
- **Icons**: hand-rolled inline SVGs in `day-data.jsx` (`Icon` component). Translate to your icon library (Lucide is a near 1:1 match for the styles used: chevron, clock, play, check, x, plus, edit, trash, search, sun, moon, send, sparkle, git-branch, alert-triangle, command, info). Stroke 1.75px, lineCap round, lineJoin round.
- **Logos**: 6 SVGs in `day-v2-logos.jsx`. For production, export the chosen one as `logo.svg` and use as a static asset.
- **Heatmap, ring, sparkline**: all rendered as inline SVGs, no images

---

## Files in this bundle

- `day-redesign-v2.html` — entry point
- `day-redesign-v2.css` — **the v2 stylesheet**; imports `day-redesign.css` and layers overrides + new component CSS. The single most important file to study for measurements & colors.
- `day-redesign.css` — the v1 base stylesheet (still imported by v2 for the foundational tokens + modal/segment/heatmap styles that were kept as-is)
- `day-v2-app.jsx` — top-level React component for v2: state, keyboard shortcuts, layout switching, modal wiring
- `day-v2-parts.jsx` — v2 components: `TopBarV2`, `TopBarRow2`, `RibbonV2`, `CoverageStatsV2`, `BlocksV2`, `BlockCard`
- `day-v2-logos.jsx` — 6 logo SVGs + `BrandLockup`
- `day-parts.jsx` — v1 components still used in v2 (the `Heatmap`, `KeyboardHelp`, `Ring` helpers, and `BigRing` — referenced but largely superseded)
- `day-modals.jsx` — `EditModal` (kept from v1 as power-edit fallback, though the inline editor is the primary surface in v2), `SubmitModal`, `CommandPalette`, `TicketCombo`
- `day-data.jsx` — mock data, `Icon` component, time helpers
- `tweaks-panel.jsx` — prototype-only tweak panel; do not ship
- `logo-canvas.html` + `design-canvas.jsx` — auxiliary canvas to compare all 6 logo directions

## Suggested implementation order

1. Tokens (CSS variables in your stylesheet of choice)
2. Brand mark (pick one of the 6, export to SVG)
3. Top bar row 1 + row 2 (no live behavior yet; static)
4. Ribbon (segments + draft bars + git markers; zoom + drag come last)
5. Coverage stats (hero + 4 small)
6. Block card (collapsed state only)
7. Block card inline editor + ticket combo + commit suggestions
8. Smart gap row + suggestion heuristic
9. Submit + Command palette modals (port from v1)
10. Keyboard shortcuts + selection nav
11. Ribbon zoom + drag-to-create
12. Light theme polish + alt layouts (single, timeline) if needed

## Anything else?

- The v1 right-rail "Day progress" big-ring component is removed in v2 — its job is taken by the topbar inline progress pill + the hero stat ring. Don't reintroduce it.
- The v1 "Detected activity" collapsible segment list is also removed from v2 main — the data still informs the ribbon, smart gap suggestions, and the in-modal context panel. If users miss the explicit list, consider adding it under the timeline as a collapsed accordion.
- The v2 Submit flash uses `.flash-friendly` (accent-tinted, sparkle icon) rather than `.flash-ok` (green). Keep the warmer voice in the copy.
