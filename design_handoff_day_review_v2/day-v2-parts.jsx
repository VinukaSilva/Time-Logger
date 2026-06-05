/* global React, Icon, DATA, Ring */
const { useState, useMemo, useEffect, useRef, useCallback } = React;

// ============================================================
// v2 TOP BAR
// Tabs (Day/Week/Month) · brand · persistent search · live clock · actions
// ============================================================
const TopBarV2 = ({ logoVariant, date, onCmdk, onSeed, onAdd, onSubmit, theme, onThemeToggle, hasDrafts, view, onViewChange, draftPct, draftMin }) => {
  // live clock — ticks every 30s for the page
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  const hh = clock.getHours().toString().padStart(2, "0");
  const mm = clock.getMinutes().toString().padStart(2, "0");

  return (
    <header className="topbar-v2">
      <div className="topbar-left">
        <BrandLockup variant={logoVariant} page={null} />
        <div className="view-tabs" role="tablist">
          {["Day","Week","Month"].map(v => (
            <button key={v}
                    className={`view-tab ${view === v ? "active" : ""}`}
                    onClick={() => onViewChange(v)}>{v}</button>
          ))}
        </div>
      </div>

      <button className="topbar-search" onClick={onCmdk} title="Command palette (⌘K)">
        <Icon name="search" size={14}/>
        <input readOnly placeholder="Jump to a ticket, command, or day…" />
        <span className="kbd">⌘</span><span className="kbd">K</span>
      </button>

      <div className="topbar-right">
        <div className="topbar-inline-progress" title={`${draftMin}m drafted today`}>
          <svg className="ring" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" fill="none" stroke="var(--border-2)" strokeWidth="3"/>
            <circle cx="12" cy="12" r="9" fill="none" stroke="var(--accent)" strokeWidth="3"
                    strokeDasharray={2*Math.PI*9}
                    strokeDashoffset={2*Math.PI*9 - (2*Math.PI*9 * Math.min(draftPct,100) / 100)}
                    strokeLinecap="round"
                    transform="rotate(-90 12 12)"/>
          </svg>
          <span className="pct">{draftPct}%</span>
          <span className="of">/ 8h</span>
        </div>
        <div className="live-clock">
          <div className="time">{hh}:{mm}</div>
          <div className="since"><span className="dot"></span>SAMPLING 30s</div>
        </div>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onThemeToggle} title="Toggle theme">
          <Icon name={theme === "dark" ? "sun" : "moon"} size={14}/>
        </button>
        <button className="btn btn-primary btn-sm" onClick={onSubmit} disabled={!hasDrafts}>
          <Icon name="send" size={12}/> Submit
          <span className="kbd" style={{borderColor:"rgba(0,0,0,0.2)", background:"rgba(0,0,0,0.15)", color:"var(--accent-fg)"}}>⌘⏎</span>
        </button>
      </div>
    </header>
  );
};

// Row 2 of the top: date nav + section actions
const TopBarRow2 = ({ date, setDate, onSeed, onAdd, blocksCount, syncedCount }) => {
  const d = new Date(date + "T00:00");
  const dow = d.toLocaleDateString("en-US", { weekday: "long" });
  const rest = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return (
    <div className="topbar-row2">
      <div className="date-nav">
        <button className="date-nav-btn" onClick={() => {
          const nd = new Date(date + "T00:00"); nd.setDate(nd.getDate() - 1); setDate(nd.toISOString().slice(0,10));
        }}><Icon name="chevL" size={14}/></button>
        <label className="date-label">
          <span className="dow">{dow.slice(0,3)}</span>
          <span>{rest}</span>
          {DATA.isToday(date) && <span className="today-pill">TODAY</span>}
          <input type="date" className="date-input" value={date} onChange={e => setDate(e.target.value)} />
        </label>
        <button className="date-nav-btn" onClick={() => {
          const nd = new Date(date + "T00:00"); nd.setDate(nd.getDate() + 1); setDate(nd.toISOString().slice(0,10));
        }}><Icon name="chevR" size={14}/></button>
      </div>

      <div className="topbar-spacer"></div>

      <span style={{fontSize: "var(--fs-sm)", color: "var(--muted)"}}>
        <strong style={{color: "var(--text)", fontWeight: 600}}>{blocksCount}</strong> blocks · <strong style={{color: "var(--cool)", fontWeight: 600}}>{syncedCount}</strong> synced
      </span>

      <button className="btn btn-sm" onClick={onSeed} title="Auto-seed (⇧S)">
        <Icon name="sparkle" size={12}/> Auto-seed <span className="kbd">⇧S</span>
      </button>
      <button className="btn btn-sm" onClick={onAdd} title="New block (N)">
        <Icon name="plus" size={12}/> New block
      </button>
    </div>
  );
};

// ============================================================
// v2 RIBBON — taller, zoom levels, drag-to-create, sticky
// ============================================================
const RibbonV2 = ({ segments, blocks, gitEvents, now, onSelectBlock, selectedId, zoom, setZoom, onAddBlock }) => {
  // zoom drives the time window
  const windows = {
    "day": { start: 7*60, end: 19*60, ticks: 12 },
    "4h":  { start: 9*60, end: 13*60, ticks: 4  },
    "1h":  { start: 10*60, end: 11*60, ticks: 4 },
  };
  const w = windows[zoom];
  const span = w.end - w.start;
  const pct = (m) => ((m - w.start) / span) * 100;
  const clamp = (m) => Math.max(w.start, Math.min(w.end, m));
  const [hover, setHover] = useState(null);

  // drag-to-create
  const trackRef = useRef(null);
  const [drag, setDrag] = useState(null);

  const onTrackMouseDown = (e) => {
    if (e.target.closest(".draft-bar, .git-marker")) return;
    const rect = trackRef.current.getBoundingClientRect();
    const startMin = w.start + ((e.clientX - rect.left) / rect.width) * span;
    setDrag({ x0: e.clientX, m0: clamp(startMin), m1: clamp(startMin) });
  };
  useEffect(() => {
    if (!drag) return;
    const onMove = (e) => {
      const rect = trackRef.current.getBoundingClientRect();
      const m1 = clamp(w.start + ((e.clientX - rect.left) / rect.width) * span);
      setDrag(d => d && ({ ...d, m1 }));
    };
    const onUp = () => {
      const lo = Math.min(drag.m0, drag.m1);
      const hi = Math.max(drag.m0, drag.m1);
      if (hi - lo >= 10) {
        onAddBlock(DATA.minToHm(Math.round(lo / 5) * 5), DATA.minToHm(Math.round(hi / 5) * 5));
      }
      setDrag(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, w.start, span]);

  const workMin = segments.filter(s => s.kind === "work").reduce((a,s)=>a+s.minutes, 0);

  return (
    <div className="ribbon-wrap-v2">
      <div className="ribbon-head-v2">
        <div className="ribbon-title-v2">
          <strong>Today's timeline</strong>
          <span className="sub">{DATA.fmtDur(workMin)} detected · {blocks.length} drafts · {gitEvents.length} commits</span>
        </div>
        <div style={{display:"flex", alignItems:"center", gap:12}}>
          <div className="ribbon-legend">
            <span className="leg"><span className="leg-chip leg-work"></span>Work</span>
            <span className="leg"><span className="leg-chip leg-unc"></span>Unclassified</span>
            <span className="leg"><span className="leg-chip leg-idle"></span>Idle</span>
            <span className="leg"><span className="leg-chip" style={{background:"var(--cool)", borderRadius:"50%"}}></span>Commit</span>
          </div>
          <div className="zoom-pills">
            {["day","4h","1h"].map(z => (
              <button key={z} className={`zoom-pill ${zoom === z ? "active" : ""}`} onClick={() => setZoom(z)}>
                {z === "day" ? "12h" : z}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="ribbon ribbon-v2" ref={trackRef}
           onMouseLeave={() => setHover(null)}
           onMouseDown={onTrackMouseDown}>
        <div className="ribbon-track">
          {segments.map((s, i) => {
            const a = DATA.hmToMin(s.start);
            const b = DATA.hmToMin(s.end);
            if (b < w.start || a > w.end) return null;
            const left = Math.max(0, pct(a));
            const right = Math.min(100, pct(b));
            return (
              <div key={i}
                   className={`seg-bar ${s.kind}`}
                   style={{ left: `${left}%`, width: `${right - left}%` }}
                   onMouseEnter={(e) => setHover({ x: e.clientX, title: `${s.start}–${s.end}`, sub: s.ticket ? `${s.ticket} · ${s.title || s.kind}` : s.title || s.kind })}
              />
            );
          })}
        </div>

        <div className="draft-row">
          {blocks.map(b => {
            const a = DATA.hmToMin(b.start);
            const bb = DATA.hmToMin(b.end);
            if (bb < w.start || a > w.end) return null;
            const left = Math.max(0, pct(a));
            const right = Math.min(100, pct(bb));
            return (
              <div key={b.id}
                   className={`draft-bar ${b.status} ${selectedId === b.id ? "selected" : ""}`}
                   style={{ left: `${left}%`, width: `${right - left}%` }}
                   onClick={() => onSelectBlock(b.id)}
                   onMouseEnter={(e) => setHover({ x: e.clientX, title: `${b.start}–${b.end}`, sub: `${b.ticket || "—"}` })}
              />
            );
          })}
        </div>

        <div className="git-row">
          {gitEvents.map((g, i) => {
            const m = DATA.hmToMin(g.t);
            if (m < w.start || m > w.end) return null;
            return (
              <div key={i}
                   className="git-marker"
                   style={{ left: `${pct(m)}%` }}
                   onMouseEnter={(e) => setHover({ x: e.clientX, title: `commit ${g.sha}`, sub: g.msg })}
              />
            );
          })}
        </div>

        <div className="ribbon-hours">
          {Array.from({ length: w.ticks + 1 }).map((_, i) => {
            const m = w.start + (i / w.ticks) * span;
            const hh = Math.floor(m / 60);
            const mn = Math.round(m % 60);
            return (
              <div key={i}>
                <div className={`ribbon-hour ${i % 2 === 0 ? "major" : ""}`} style={{ left: `${(i / w.ticks)*100}%` }} />
                <div className="ribbon-label" style={{ left: `${(i / w.ticks)*100}%` }}>
                  {String(hh).padStart(2,"0")}{mn ? ":" + String(mn).padStart(2,"0") : ""}
                </div>
              </div>
            );
          })}
        </div>

        {now && now >= w.start && now <= w.end && (
          <div className="ribbon-now" style={{ left: `${pct(now)}%` }} />
        )}

        {drag && (() => {
          const lo = Math.min(drag.m0, drag.m1), hi = Math.max(drag.m0, drag.m1);
          return <div className="ghost-block" style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }} />;
        })()}

        <div className="drag-hint">drag the track to draft a block</div>

        {hover && !drag && (
          <div className="ribbon-tooltip" style={{ left: hover.x - 20, top: 0 }}>
            <strong>{hover.title}</strong> — {hover.sub}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// v2 HERO STAT — large drafted card + small cluster
// ============================================================
const CoverageStatsV2 = ({ segments, blocks, weekHistory, target = 480 }) => {
  const workMin = segments.filter(s => s.kind === "work").reduce((a,s)=>a+s.minutes, 0);
  const idleMin = segments.filter(s => s.kind === "idle").reduce((a,s)=>a+s.minutes, 0);
  const uncMin  = segments.filter(s => s.kind === "unclassified").reduce((a,s)=>a+s.minutes, 0);
  const draftMin = blocks.reduce((a,b) => a + (DATA.hmToMin(b.end) - DATA.hmToMin(b.start)), 0);
  const pct = Math.round((draftMin / target) * 100);
  const delta = draftMin - workMin;

  // hero ring (bigger)
  const r = 32, c = 2 * Math.PI * r;

  // sparkline of last 7 days
  const series = weekHistory; // array of minutes
  const maxY = Math.max(...series, target);
  const minY = 0;
  const pts = series.map((v, i) => {
    const x = (i / (series.length - 1)) * 140;
    const y = 36 - ((v - minY) / (maxY - minY)) * 32;
    return [x, y];
  });
  const dPath = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0] + "," + p[1]).join(" ");
  const aPath = dPath + ` L140,36 L0,36 Z`;
  const last = pts[pts.length - 1];

  return (
    <div className="coverage-v2">
      <div className="stat-hero">
        <svg className="hero-ring" viewBox="0 0 76 76">
          <circle cx="38" cy="38" r={r} fill="none" stroke="var(--border-2)" strokeWidth="6"/>
          <circle cx="38" cy="38" r={r} fill="none" stroke="var(--accent)" strokeWidth="6"
                  strokeDasharray={c}
                  strokeDashoffset={c - (c * Math.min(pct, 100) / 100)}
                  strokeLinecap="round"
                  transform="rotate(-90 38 38)"
                  style={{transition:"stroke-dashoffset 0.7s var(--ease)"}}/>
        </svg>
        <div className="hero-body">
          <div className="hero-label">Drafted today</div>
          <div className="hero-value">
            {DATA.fmtDur(draftMin)}
            <span className="pct">{pct}%</span>
          </div>
          <div className="hero-sub">
            <span>Target<span className="k">{DATA.fmtDur(target)}</span></span>
            <span>vs detected<span className="k" style={{color: delta < 0 ? "var(--warn)" : "var(--ok)"}}>{delta >= 0 ? "+" : ""}{DATA.fmtDur(Math.abs(delta))}</span></span>
            <span>7-day avg<span className="k">{DATA.fmtDur(Math.round(series.reduce((a,b)=>a+b,0)/series.length))}</span></span>
          </div>
        </div>
        <div className="hero-spark-label">7-day · drafted</div>
        <svg className="hero-spark" viewBox="0 0 140 36" preserveAspectRatio="none">
          <path className="area" d={aPath}/>
          <path className="line" d={dPath}/>
          {last && <circle className="dot" cx={last[0]} cy={last[1]} r="2.5"/>}
        </svg>
      </div>

      <div className="stat-v2">
        <div className="label"><Icon name="play" size={10}/> Detected work</div>
        <div className="value">{DATA.fmtDur(workMin)}</div>
        <div className="sub">{segments.filter(s => s.kind === "work").length} segments</div>
      </div>
      <div className="stat-v2">
        <div className="label"><Icon name="alert" size={10}/> Unclassified</div>
        <div className="value">{DATA.fmtDur(uncMin)}</div>
        <div className="sub">needs review</div>
      </div>
      <div className="stat-v2">
        <div className="label"><Icon name="moon" size={10}/> Idle</div>
        <div className="value">{DATA.fmtDur(idleMin)}</div>
        <div className="sub">away from kb</div>
      </div>
      <div className="stat-v2">
        <div className="label"><Icon name="sparkle" size={10}/> Coverage</div>
        <div className="value">{Math.round((draftMin / Math.max(workMin, 1)) * 100)}%</div>
        <div className="coverage-bar">
          <div className="fill" style={{width: `${Math.min(100, Math.round((draftMin / Math.max(workMin, 1)) * 100))}%`}}></div>
          <div className="mark" style={{left: "50%"}}></div>
          <div className="mark" style={{left: "75%"}}></div>
          <div className="mark" style={{left: "100%"}}></div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// v2 BLOCK CARDS — inline editor expands within card
// ============================================================
const BlocksV2 = ({ blocks, tickets, segments, gitEvents, selectedId, onSelect, onSave, onDelete, onAddBetween, expandedId, setExpandedId }) => {
  const sorted = useMemo(() => [...blocks].sort((a,b) => DATA.hmToMin(a.start) - DATA.hmToMin(b.start)), [blocks]);
  const rows = [];
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    rows.push(
      <BlockCard key={b.id}
                 block={b} tickets={tickets} segments={segments} gitEvents={gitEvents}
                 selected={selectedId === b.id}
                 expanded={expandedId === b.id}
                 onSelect={onSelect}
                 onToggleExpand={() => setExpandedId(expandedId === b.id ? null : b.id)}
                 onSave={onSave}
                 onDelete={onDelete}/>
    );
    const next = sorted[i + 1];
    if (next) {
      const gap = DATA.hmToMin(next.start) - DATA.hmToMin(b.end);
      if (gap >= 10) {
        // suggest a ticket — heuristic: look for git commits or detected segments in the window
        const inWindow = (m) => m >= DATA.hmToMin(b.end) && m <= DATA.hmToMin(next.start);
        const segs = segments.filter(s => s.kind === "work" && inWindow(DATA.hmToMin(s.start)) && s.ticket);
        const commits = gitEvents.filter(g => inWindow(DATA.hmToMin(g.t)));
        const suggested = segs[0]?.ticket || commits.find(c => c.repo)?.repo;
        const reason = segs.length > 0
          ? `${segs[0].title.split(" — ")[0]} active here`
          : commits.length > 0
            ? `${commits.length} commit${commits.length>1?"s":""} in window`
            : "no detected activity";

        rows.push(
          <div className="gap-card" key={`gap-${i}`}>
            <span className="gap-time">
              Gap · {b.end}–{next.start} <span className="duration">{gap}m unaccounted</span>
            </span>
            <span className="gap-suggest">
              {suggested && segs[0]?.ticket
                ? <>Likely <span className="key">{segs[0].ticket}</span> <span className="reason">— {reason}</span></>
                : <span className="reason">— {reason}</span>}
            </span>
            <div style={{display:"flex", gap:6}}>
              {suggested && segs[0]?.ticket && (
                <button className="btn btn-xs" onClick={() => onAddBetween(b.end, next.start, segs[0].ticket, segs[0].project)}>
                  <Icon name="check" size={10}/> Accept
                </button>
              )}
              <button className="btn btn-xs" onClick={() => onAddBetween(b.end, next.start)}>
                <Icon name="plus" size={10}/> Fill gap
              </button>
            </div>
          </div>
        );
      }
    }
  }
  if (blocks.length === 0) {
    return (
      <div className="block-card" style={{padding: "44px 24px", textAlign:"center"}}>
        <div className="empty-art" style={{margin:"0 auto 14px"}}></div>
        <h4 style={{margin:0, fontSize:"var(--fs-lg)", fontWeight: 600}}>No blocks yet for this day</h4>
        <p style={{margin:"6px 0 0", color:"var(--muted)", fontSize:"var(--fs-sm)"}}>
          Click <strong>Auto-seed</strong> above to draft from detected work, drag on the ribbon, or add a block manually.
        </p>
      </div>
    );
  }
  return <div className="blocks-v2">{rows}</div>;
};

const BlockCard = ({ block, tickets, segments, gitEvents, selected, expanded, onSelect, onToggleExpand, onSave, onDelete }) => {
  const t = tickets.find(t => t.key === block.ticket);
  const mins = DATA.hmToMin(block.end) - DATA.hmToMin(block.start);
  const hasDesc = !!block.description.trim();
  const emptyDesc = !hasDesc;

  const status = block.status === "submitted" ? "synced"
                : emptyDesc ? "empty"
                : "draft";

  const [form, setForm] = useState({
    start: block.start, end: block.end,
    ticket: block.ticket || "", description: block.description || "",
    project: block.project || ""
  });
  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v }));

  // sync form to block when block changes externally
  useEffect(() => {
    setForm({ start: block.start, end: block.end, ticket: block.ticket || "", description: block.description || "", project: block.project || "" });
  }, [block.id, block.start, block.end, block.ticket, block.description]);

  const ctxGit = gitEvents.filter(g => DATA.hmToMin(g.t) >= DATA.hmToMin(block.start) && DATA.hmToMin(g.t) <= DATA.hmToMin(block.end));

  const save = (e) => {
    e?.stopPropagation();
    onSave(block.id, form);
    onToggleExpand();
  };

  return (
    <div className={`block-card ${selected ? "selected" : ""} ${block.status === "submitted" ? "submitted" : ""}`}
         onClick={() => onSelect(block.id)}>
      <div className="block-card-head" onClick={(e) => { e.stopPropagation(); onSelect(block.id); onToggleExpand(); }}>
        <div className="block-time-block">
          <div className="range">{block.start} → {block.end}</div>
          <div className="dur">{mins}m</div>
        </div>
        <div className="block-meta">
          <div className="block-meta-row1">
            {block.ticket
              ? <>
                  <span className="ticket-key">{block.ticket}</span>
                  {t && <span className="ticket-summary">{t.summary}</span>}
                </>
              : <span className="ticket-key" style={{color:"var(--danger)"}}>— no ticket —</span>}
          </div>
          <div className={`desc-preview ${emptyDesc ? "placeholder" : ""}`}>
            {hasDesc ? block.description : "Add a technical summary…"}
          </div>
        </div>
        <div className="block-badges-v2">
          {block.git > 0 && <span className="badge-v2 git"><Icon name="git" size={9}/>{block.git}</span>}
          {block.project && <span className="badge-v2">{block.project}</span>}
          <span className={`status-pill ${status}`}>{status}</span>
        </div>
        <div className="block-card-actions" onClick={e => e.stopPropagation()}>
          <button className="btn btn-xs btn-icon" onClick={onToggleExpand} title={expanded ? "Collapse" : "Expand"}>
            <Icon name={expanded ? "chevD" : "edit"} size={11}/>
          </button>
          {block.status !== "submitted" && (
            <button className="btn btn-xs btn-icon" onClick={() => onDelete(block.id)} title="Delete">
              <Icon name="trash" size={11}/>
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="block-card-editor" onClick={e => e.stopPropagation()}>
          <div className="field">
            <label className="field-label">Time window</label>
            <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:8}}>
              <input className="input" type="time" value={form.start} onChange={e => set("start")(e.target.value)} />
              <input className="input" type="time" value={form.end} onChange={e => set("end")(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label className="field-label">Ticket</label>
            <TicketCombo tickets={tickets}
                         value={form.ticket ? `${form.ticket} · ${tickets.find(t=>t.key===form.ticket)?.summary||""}` : ""}
                         onChange={(k) => {
                           const tk = tickets.find(t => t.key === k);
                           setForm(f => ({ ...f, ticket: k, project: tk?.project_key || f.project }));
                         }}
                         recent={["CORE-482","PLAT-118","WEB-9"]}/>
          </div>
          <div className="field editor-full">
            <label className="field-label">Description <span className="hint">— write it like a commit message</span></label>
            <textarea className="textarea mono"
                      placeholder="What did you actually do? Anchor it in the change, not the activity."
                      value={form.description}
                      onChange={e => set("description")(e.target.value)}/>
            {ctxGit.length > 0 && (
              <div className="suggestions">
                <span style={{fontSize:"var(--fs-xs)", color:"var(--muted)"}}>From commits:</span>
                {ctxGit.map(g => (
                  <button key={g.sha} className="suggest-chip"
                          onClick={() => setForm(f => ({ ...f, description: (f.description ? f.description + "\n" : "") + g.msg }))}>
                    <span className="pre">{g.sha}</span> {g.msg.length > 60 ? g.msg.slice(0,60)+"…" : g.msg}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="editor-foot">
            <span className="editor-hint">
              <span className="kbd">Esc</span> close · <span className="kbd">⌘</span><span className="kbd">⏎</span> save
            </span>
            <div style={{display:"flex", gap:6}}>
              <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={save}>
                <Icon name="check" size={11}/> Save block
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

Object.assign(window, { TopBarV2, TopBarRow2, RibbonV2, CoverageStatsV2, BlocksV2, BlockCard });
