/* global React, Icon, DATA */

const { useState, useMemo, useEffect, useRef } = React;

// ============================================================
// Timeline ribbon
// ============================================================
const TimelineRibbon = ({ segments, blocks, gitEvents, now, onSelectBlock, selectedId }) => {
  const startMin = 7 * 60;   // 07:00
  const endMin   = 19 * 60;  // 19:00
  const span = endMin - startMin;
  const pct = (m) => ((m - startMin) / span) * 100;
  const [hover, setHover] = useState(null);

  return (
    <div className="ribbon-wrap">
      <div className="ribbon-head">
        <div className="ribbon-title">
          <Icon name="clock" size={12} />
          Detected activity · {DATA.fmtDur(segments.filter(s => s.kind === "work").reduce((a,s)=>a+s.minutes,0))} worked
        </div>
        <div className="ribbon-legend">
          <span className="leg"><span className="leg-chip leg-work"></span>Work</span>
          <span className="leg"><span className="leg-chip leg-unc"></span>Unclassified</span>
          <span className="leg"><span className="leg-chip leg-idle"></span>Idle</span>
          <span className="leg"><span className="leg-chip leg-draft"></span>Drafted block</span>
          <span className="leg"><span className="leg-chip leg-git"></span>Commit</span>
        </div>
      </div>
      <div className="ribbon" onMouseLeave={() => setHover(null)}>
        <div className="ribbon-track">
          {segments.map((s, i) => {
            const a = DATA.hmToMin(s.start);
            const b = DATA.hmToMin(s.end);
            return (
              <div
                key={i}
                className={`seg-bar ${s.kind}`}
                style={{ left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%` }}
                onMouseEnter={(e) => setHover({ x: e.clientX, title: `${s.start}–${s.end}`, sub: s.ticket ? `${s.ticket} · ${s.title || s.kind}` : s.title || s.kind })}
              />
            );
          })}
        </div>

        <div className="draft-row">
          {blocks.map(b => {
            const a = DATA.hmToMin(b.start);
            const bb = DATA.hmToMin(b.end);
            return (
              <div
                key={b.id}
                className={`draft-bar ${b.status}`}
                style={{ left: `${pct(a)}%`, width: `${pct(bb) - pct(a)}%` }}
                onClick={() => onSelectBlock(b.id)}
                onMouseEnter={(e) => setHover({ x: e.clientX, title: `${b.start}–${b.end}`, sub: `${b.ticket || "—"}` })}
              />
            );
          })}
        </div>

        <div className="git-row">
          {gitEvents.map((g, i) => (
            <div
              key={i}
              className="git-marker"
              style={{ left: `${pct(DATA.hmToMin(g.t))}%` }}
              title={`${g.t}  ${g.sha}  ${g.msg}`}
              onMouseEnter={(e) => setHover({ x: e.clientX, title: `commit ${g.sha}`, sub: g.msg })}
            />
          ))}
        </div>

        <div className="ribbon-hours">
          {Array.from({ length: 13 }).map((_, i) => {
            const m = startMin + i * 60;
            return (
              <div key={i}>
                <div className={`ribbon-hour ${i % 2 === 0 ? "major" : ""}`} style={{ left: `${pct(m)}%` }} />
                <div className="ribbon-label" style={{ left: `${pct(m)}%` }}>{String(7 + i).padStart(2, "0")}</div>
              </div>
            );
          })}
        </div>

        {now && now >= startMin && now <= endMin && (
          <div className="ribbon-now" style={{ left: `${pct(now)}%` }} />
        )}

        {hover && (
          <div className="ribbon-tooltip" style={{ left: hover.x - 20, top: 0 }}>
            <strong>{hover.title}</strong> — {hover.sub}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// Coverage stats
// ============================================================
const Ring = ({ size = 40, stroke = 4, pct = 0, trackStroke }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg className="progress-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle className="track" cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={stroke} />
      <circle className="fill" cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={stroke}
              strokeDasharray={c} strokeDashoffset={c - (c * Math.min(pct, 100) / 100)}
              strokeLinecap="round"
              transform={`rotate(-90 ${size/2} ${size/2})`} />
    </svg>
  );
};

const CoverageStats = ({ segments, blocks, target = 480 }) => {
  const workMin = segments.filter(s => s.kind === "work").reduce((a,s)=>a+s.minutes, 0);
  const idleMin = segments.filter(s => s.kind === "idle").reduce((a,s)=>a+s.minutes, 0);
  const uncMin  = segments.filter(s => s.kind === "unclassified").reduce((a,s)=>a+s.minutes, 0);
  const draftMin = blocks.reduce((a,b) => a + (DATA.hmToMin(b.end) - DATA.hmToMin(b.start)), 0);
  const pct = Math.round((draftMin / target) * 100);
  const delta = draftMin - workMin;
  return (
    <div className="coverage">
      <div className="stat stat-ring">
        <Ring pct={pct} size={44} stroke={5} />
        <div className="stat-ring-body">
          <div className="stat-label">Drafted</div>
          <div className="stat-value">{DATA.fmtDur(draftMin)}</div>
          <div className="stat-sub">{pct}% of 8h target</div>
        </div>
      </div>
      <div className="stat">
        <div className="stat-label"><Icon name="play" size={10}/>Detected work</div>
        <div className="stat-value">{DATA.fmtDur(workMin)}</div>
        <div className="stat-sub">{segments.filter(s => s.kind === "work").length} segments</div>
      </div>
      <div className="stat">
        <div className="stat-label"><Icon name="alert" size={10}/>Unclassified</div>
        <div className="stat-value">{DATA.fmtDur(uncMin)}</div>
        <div className="stat-sub">needs review</div>
      </div>
      <div className="stat">
        <div className="stat-label"><Icon name="moon" size={10}/>Idle</div>
        <div className="stat-value">{DATA.fmtDur(idleMin)}</div>
        <div className="stat-sub">away from keyboard</div>
      </div>
      <div className="stat">
        <div className="stat-label"><Icon name="sparkle" size={10}/>Coverage</div>
        <div className="stat-value">{Math.round((draftMin / Math.max(workMin,1)) * 100)}%</div>
        <div className={`stat-sub stat-delta ${delta < 0 ? "neg" : ""}`}>
          {delta >= 0 ? `+${DATA.fmtDur(delta)} vs detected` : `${DATA.fmtDur(-delta)} uncovered`}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Blocks table
// ============================================================
const BlocksTable = ({ blocks, tickets, selectedId, onSelect, onEdit, onDelete, onAddBetween }) => {
  const sorted = [...blocks].sort((a, b) => DATA.hmToMin(a.start) - DATA.hmToMin(b.start));
  const rows = [];
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    rows.push(<BlockRow key={b.id} block={b} tickets={tickets} selected={selectedId === b.id}
                        onSelect={onSelect} onEdit={onEdit} onDelete={onDelete} />);
    const next = sorted[i + 1];
    if (next) {
      const gap = DATA.hmToMin(next.start) - DATA.hmToMin(b.end);
      if (gap >= 10) {
        rows.push(
          <div className="gap-row" key={`gap-${i}`}>
            <span className="gap-label">Gap · {b.end}–{next.start} · {gap}m unaccounted</span>
            <div className="gap-actions">
              <button className="btn btn-xs" onClick={() => onAddBetween(b.end, next.start)}>
                <Icon name="plus" size={10}/> Fill gap
              </button>
            </div>
          </div>
        );
      }
    }
  }

  return (
    <div className="blocks">
      <div className="blocks-head">
        <div></div>
        <div>Time</div>
        <div style={{ textAlign: "right" }}>Dur</div>
        <div>Ticket</div>
        <div>Description</div>
        <div>Project</div>
        <div>Badges</div>
        <div style={{ textAlign: "right" }}>Actions</div>
      </div>
      {blocks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-art"></div>
          <h4>No blocks yet for this day</h4>
          <p>Click <strong>Auto-seed</strong> to create drafts from detected work, or add a block manually.</p>
        </div>
      ) : rows}
    </div>
  );
};

const BlockRow = ({ block, tickets, selected, onSelect, onEdit, onDelete }) => {
  const t = tickets.find(t => t.key === block.ticket);
  const mins = DATA.hmToMin(block.end) - DATA.hmToMin(block.start);
  const hasDesc = !!block.description.trim();
  const emptyDesc = !hasDesc;
  return (
    <div className={`block-row ${selected ? "selected" : ""} ${block.status === "submitted" ? "submitted" : ""}`}
         onClick={() => onSelect(block.id)}
         onDoubleClick={() => onEdit(block)}>
      <div className={`block-status-dot ${block.status === "submitted" ? "submitted" : emptyDesc ? "empty" : ""}`} />
      <div className="block-time">
        <span>{block.start}</span><span className="sep">→</span><span>{block.end}</span>
      </div>
      <div className="block-mins">{mins}m</div>
      <div className="block-ticket">
        {block.ticket ? (
          <>
            <span className="ticket-key">{block.ticket}</span>
            {t && <span className="ticket-summary">{t.summary}</span>}
          </>
        ) : (
          <span className="ticket-key none">— no ticket —</span>
        )}
      </div>
      <div className={`block-desc ${emptyDesc ? "placeholder" : ""}`}>
        {hasDesc ? block.description : "Add a technical summary…"}
      </div>
      <div className="block-project">
        <span className="project-dot"></span>{block.project || "—"}
      </div>
      <div className="block-badges">
        {block.status === "submitted" && <span className="badge" style={{ background: "var(--ok-soft)", color: "var(--ok)" }}>SYNCED</span>}
        {block.git > 0 && <span className="badge git"><Icon name="git" size={9}/>{block.git}</span>}
        {emptyDesc && block.status !== "submitted" && <span className="badge gap">EMPTY</span>}
      </div>
      <div className="block-actions" onClick={e => e.stopPropagation()}>
        <button className="btn btn-xs btn-icon" onClick={() => onEdit(block)} title="Edit (E)"><Icon name="edit" size={11}/></button>
        <button className="btn btn-xs btn-icon" title="Split (S)"><Icon name="split" size={11}/></button>
        {block.status !== "submitted" && (
          <button className="btn btn-xs btn-icon" onClick={() => onDelete(block.id)} title="Delete (⌫)"><Icon name="trash" size={11}/></button>
        )}
      </div>
    </div>
  );
};

// ============================================================
// Detected segments (collapsible)
// ============================================================
const DetectedSegments = ({ segments }) => {
  const [open, setOpen] = useState(true);
  return (
    <div className={`segments-wrap ${open ? "" : "collapsed"}`}>
      <div className="segments-head" onClick={() => setOpen(!open)}>
        <span>Detected activity · {segments.length} segments</span>
        <Icon name="chevD" size={12} className="toggle" />
      </div>
      <div className="seglist">
        {segments.filter(s => s.minutes >= 15).map((s, i) => (
          <div key={i} className={`seg ${s.kind}`}>
            <div className="seg-stripe"></div>
            <div className="time">{s.start}–{s.end}</div>
            <div className="mins">{s.minutes}m</div>
            <div className={`ticket ${s.ticket ? "" : "none"}`}>{s.ticket || "—"}</div>
            <div className="title">{s.title || <span style={{color:"var(--muted-2)"}}>(idle)</span>}</div>
            <div className="block-badges">
              {s.kind === "work" && <span className="badge">{s.project}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ============================================================
// Right rail
// ============================================================
const BigRing = ({ pct, draftPct, target, draftMin }) => {
  const r = 38, stroke = 7;
  const c = 2 * Math.PI * r;
  return (
    <div className="big-ring">
      <svg viewBox="0 0 88 88">
        <circle className="track" cx="44" cy="44" r={r} fill="none" strokeWidth={stroke}/>
        <circle className="fill-draft" cx="44" cy="44" r={r} fill="none" strokeWidth={stroke}
                strokeDasharray={c} strokeDashoffset={c - (c * Math.min(draftPct, 100) / 100)}
                strokeLinecap="round" transform="rotate(-90 44 44)" />
        <circle className="fill" cx="44" cy="44" r={r} fill="none" strokeWidth={stroke}
                strokeDasharray={c} strokeDashoffset={c - (c * Math.min(pct, 100) / 100)}
                strokeLinecap="round" transform="rotate(-90 44 44)" />
      </svg>
      <div className="big-ring-body">
        <div className="pct">{pct}%</div>
        <div className="sub">of {DATA.fmtDur(target)} target</div>
        <div className="target">{DATA.fmtDur(draftMin)} drafted</div>
      </div>
    </div>
  );
};

const Heatmap = ({ data, onPick, selectedIso }) => {
  // 28 cells ending today; grid is 7 columns x 4 rows, with a label column
  const dows = ["M","T","W","T","F","S","S"];
  return (
    <div>
      <div className="heatmap">
        <div></div>
        {dows.map((d, i) => <div key={i} className="heatmap-dow" style={{textAlign:"center"}}>{d}</div>)}
        {[0,1,2,3].map(row => (
          <React.Fragment key={row}>
            <div className="heatmap-dow">{row === 3 ? "now" : `-${(3-row)*7}d`}</div>
            {[0,1,2,3,4,5,6].map(col => {
              const idx = row * 7 + col;
              const v = data[idx];
              const isFuture = row === 3 && col > 4;
              const level = v == null || v < 0 ? "empty" : v === 0 ? "" : v < 240 ? "l1" : v < 400 ? "l2" : v < 470 ? "l3" : "l4";
              const today = row === 3 && col === 4;
              return (
                <div key={col}
                     className={`heatmap-cell ${level} ${today ? "today" : ""} ${isFuture ? "empty" : ""}`}
                     title={v != null && v >= 0 ? `${DATA.fmtDur(v)} logged` : "no data"} />
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="heatmap-labels"><span>Less</span><span>More</span></div>
    </div>
  );
};

const KeyboardHelp = () => {
  const rows = [
    ["Command palette", ["⌘","K"]],
    ["Next / prev block", ["J","K"]],
    ["Edit selected", ["E"]],
    ["Submit day", ["⌘","⏎"]],
    ["Prev / next day", ["[","]"]],
    ["Auto-seed", ["⇧","S"]],
    ["Focus ticket", ["T"]],
    ["Toggle help", ["?"]],
  ];
  return (
    <div className="kbd-list">
      {rows.map(([label, keys]) => (
        <div className="kbd-row" key={label}>
          <span>{label}</span>
          <span className="keys">{keys.map((k,i) => <span className="kbd" key={i}>{k}</span>)}</span>
        </div>
      ))}
    </div>
  );
};

Object.assign(window, { TimelineRibbon, CoverageStats, BlocksTable, DetectedSegments, BigRing, Heatmap, KeyboardHelp, Ring });
