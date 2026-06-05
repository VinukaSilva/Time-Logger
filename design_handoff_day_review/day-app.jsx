/* global React, ReactDOM, Icon, DATA, TimelineRibbon, CoverageStats, BlocksTable, DetectedSegments, BigRing, Heatmap, KeyboardHelp, EditModal, SubmitModal, CommandPalette, TweaksPanel, useTweaks, TweakSection, TweakToggle, TweakRadio, TweakSlider, TweakColor */
const { useState, useEffect, useMemo, useRef } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "accentHue": 35,
  "density": "comfortable",
  "showHeatmap": true,
  "showKeyboardHelp": true,
  "showRibbon": true,
  "ringStyle": "dual"
}/*EDITMODE-END*/;

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // state
  const [date, setDate] = useState(DATA.TODAY);
  const [blocks, setBlocks] = useState(DATA.MOCK_BLOCKS);
  const [selectedId, setSelectedId] = useState(null);
  const [editingBlock, setEditingBlock] = useState(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [showCmdk, setShowCmdk] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [flash, setFlash] = useState(null);
  const [toast, setToast] = useState(null);

  // theme + hue applied to <html>
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = tweaks.theme;
    root.style.setProperty("--acc-h", String(tweaks.accentHue));
  }, [tweaks.theme, tweaks.accentHue]);

  // "now" indicator
  const [now, setNow] = useState(14 * 60 + 52); // 14:52 in minutes (demo)
  useEffect(() => {
    const t = setInterval(() => setNow(n => Math.min(19*60, n + 1)), 60000);
    return () => clearInterval(t);
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    const h = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select";
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setShowCmdk(true); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); setShowSubmit(true); return; }
      if (typing) return;
      if (e.key === "?") { setShowHelp(h => !h); return; }
      if (e.key === "j" || e.key === "ArrowDown") { stepSelect(+1); return; }
      if (e.key === "k" || e.key === "ArrowUp")   { stepSelect(-1); return; }
      if (e.key === "e" && selectedId != null) { const b = blocks.find(x => x.id === selectedId); if (b) setEditingBlock(b); return; }
      if (e.key === "[" ) { setDate(d => shiftDate(d, -1)); return; }
      if (e.key === "]" ) { setDate(d => shiftDate(d, +1)); return; }
      if (e.key === "t") { setDate(DATA.TODAY); return; }
      if (e.key === "S" && e.shiftKey) { seedBlocks(); return; }
      if (e.key === "n") { addBlock("09:00", "09:30"); return; }
      if (e.key === "Escape") { setEditingBlock(null); setShowSubmit(false); setShowCmdk(false); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selectedId, blocks]);

  const stepSelect = (dir) => {
    const sorted = [...blocks].sort((a,b) => DATA.hmToMin(a.start) - DATA.hmToMin(b.start));
    if (sorted.length === 0) return;
    const idx = Math.max(0, sorted.findIndex(b => b.id === selectedId));
    const next = sorted[Math.min(Math.max(idx + dir, 0), sorted.length - 1)];
    setSelectedId(next.id);
  };

  const shiftDate = (iso, delta) => {
    const d = new Date(iso + "T00:00");
    d.setDate(d.getDate() + delta);
    return d.toISOString().slice(0, 10);
  };

  // CRUD
  const saveBlock = (form) => {
    setBlocks(bs => bs.map(b => b.id === editingBlock.id ? { ...b, ...form } : b));
    showToast(`Saved block ${form.ticket || "(unassigned)"}`);
    setEditingBlock(null);
  };
  const deleteBlock = (id) => {
    setBlocks(bs => bs.filter(b => b.id !== id));
    showToast("Block deleted");
  };
  const addBlock = (start, end) => {
    const newB = { id: Date.now(), start, end, ticket: "", project: "", description: "", status: "draft", git: 0 };
    setBlocks(bs => [...bs, newB]);
    setEditingBlock(newB);
  };
  const seedBlocks = () => {
    const drafts = DATA.MOCK_SEGMENTS
      .filter(s => s.kind === "work" && s.minutes >= 30)
      .map((s, i) => ({ id: 1000 + i, start: s.start, end: s.end, ticket: s.ticket || "", project: s.project || "", description: "", status: "draft", git: 0 }));
    setBlocks(drafts);
    showToast(`Seeded ${drafts.length} drafts from detected activity`);
  };
  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  // submit
  const submitDay = () => {
    const toSubmit = blocks.filter(b => b.status !== "submitted" && b.description.trim() && b.ticket);
    setBlocks(bs => bs.map(b => toSubmit.find(t => t.id === b.id) ? { ...b, status: "submitted" } : b));
    setFlash({ level: "ok", msg: `✓ Submitted ${toSubmit.length} worklogs to Jira and appended to the week's sheet.` });
    setShowSubmit(false);
  };

  // density class
  const densityClass = `density-${tweaks.density}`;

  return (
    <div className={`app ${densityClass}`}>
      <TopBar date={date} setDate={setDate}
              onCmdk={() => setShowCmdk(true)}
              onSeed={seedBlocks}
              onAdd={() => addBlock("09:00", "09:30")}
              onSubmit={() => setShowSubmit(true)}
              theme={tweaks.theme} onThemeToggle={() => setTweak("theme", tweaks.theme === "dark" ? "light" : "dark")}
              hasDrafts={blocks.some(b => b.status === "draft")}/>

      {tweaks.showRibbon && (
        <TimelineRibbon
          segments={DATA.MOCK_SEGMENTS}
          blocks={blocks}
          gitEvents={DATA.MOCK_GIT}
          now={now}
          onSelectBlock={setSelectedId}
          selectedId={selectedId}
        />
      )}

      <main className="main">
        {flash && (
          <div className={`flash flash-${flash.level}`}>
            <span className="flash-icon"><Icon name={flash.level === "ok" ? "check" : "alert"} /></span>
            <span className="flash-msg">{flash.msg}</span>
            <button className="flash-close" onClick={() => setFlash(null)}><Icon name="x" size={12}/></button>
          </div>
        )}

        <CoverageStats segments={DATA.MOCK_SEGMENTS} blocks={blocks} />

        <section className="block-section">
          <div className="section-head">
            <div className="section-title">
              Time log blocks
              <span className="count">{blocks.length} total · {blocks.filter(b => b.status === "submitted").length} synced</span>
            </div>
            <div className="section-actions">
              <button className="btn btn-sm" onClick={seedBlocks} title="Shift+S">
                <Icon name="sparkle" size={11}/> Auto-seed <span className="kbd">⇧S</span>
              </button>
              <button className="btn btn-sm" onClick={() => addBlock("09:00", "09:30")} title="N">
                <Icon name="plus" size={11}/> Add block
              </button>
            </div>
          </div>
          <BlocksTable
            blocks={blocks}
            tickets={DATA.MOCK_TICKETS}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onEdit={setEditingBlock}
            onDelete={deleteBlock}
            onAddBetween={addBlock}
          />
        </section>

        <section className="block-section">
          <div className="section-head">
            <div className="section-title">
              Detected activity
              <span className="count">From window-watcher samples, merged by state</span>
            </div>
          </div>
          <DetectedSegments segments={DATA.MOCK_SEGMENTS} />
        </section>
      </main>

      <aside className="rail">
        <div className="rail-section">
          <h4>Day progress</h4>
          <div className="rail-card">
            {(() => {
              const workMin = DATA.MOCK_SEGMENTS.filter(s => s.kind === "work").reduce((a,s)=>a+s.minutes, 0);
              const draftMin = blocks.reduce((a,b) => a + (DATA.hmToMin(b.end) - DATA.hmToMin(b.start)), 0);
              const target = 480;
              return <BigRing pct={Math.round(draftMin/target*100)} draftPct={Math.round(workMin/target*100)} target={target} draftMin={draftMin} />;
            })()}
          </div>
        </div>

        {tweaks.showHeatmap && (
          <div className="rail-section">
            <h4>Last 28 days</h4>
            <div className="rail-card">
              <Heatmap data={DATA.MOCK_HEATMAP} />
            </div>
          </div>
        )}

        <div className="rail-section">
          <h4>Sync targets</h4>
          <div className="rail-card">
            <div className="rail-kv"><span className="k">Jira</span><span className="v" style={{color:"var(--ok)"}}>●  connected</span></div>
            <div className="rail-kv"><span className="k">Sheets</span><span className="v" style={{color:"var(--ok)"}}>●  wk/2026-W17</span></div>
            <div className="rail-kv"><span className="k">Collector</span><span className="v" style={{color:"var(--ok)"}}>●  sampling 30s</span></div>
            <div className="rail-kv"><span className="k">Last git scan</span><span className="v">2m ago</span></div>
          </div>
        </div>

        {tweaks.showKeyboardHelp && (
          <div className="rail-section">
            <h4>Keyboard</h4>
            <div className="rail-card">
              <KeyboardHelp />
            </div>
          </div>
        )}
      </aside>

      {/* modals */}
      {editingBlock && (
        <EditModal
          block={editingBlock}
          tickets={DATA.MOCK_TICKETS}
          gitEvents={DATA.MOCK_GIT}
          segments={DATA.MOCK_SEGMENTS}
          onSave={saveBlock}
          onClose={() => setEditingBlock(null)}
          onDelete={deleteBlock}
        />
      )}
      {showSubmit && (
        <SubmitModal
          blocks={blocks}
          tickets={DATA.MOCK_TICKETS}
          date={date}
          onConfirm={submitDay}
          onClose={() => setShowSubmit(false)}
        />
      )}
      {showCmdk && (
        <CommandPalette
          tickets={DATA.MOCK_TICKETS}
          onClose={() => setShowCmdk(false)}
          onPickTicket={(t) => showToast(`Picked ${t.key}`)}
          onRunCommand={(id) => {
            if (id === "seed") seedBlocks();
            if (id === "submit") setShowSubmit(true);
            if (id === "new") addBlock("09:00", "09:30");
            if (id === "prev") setDate(d => shiftDate(d, -1));
            if (id === "next") setDate(d => shiftDate(d, +1));
            if (id === "today") setDate(DATA.TODAY);
            if (id === "theme") setTweak("theme", tweaks.theme === "dark" ? "light" : "dark");
          }}
        />
      )}

      {toast && <div className="toast-wrap"><div className="toast"><Icon name="check" size={12}/> {toast}</div></div>}

      <TweaksPanel>
        <TweakSection label="Appearance" />
        <TweakRadio label="Theme" value={tweaks.theme} options={["dark","light"]}
                    onChange={v => setTweak("theme", v)} />
        <TweakSlider label="Accent hue" min={0} max={360} step={1} value={tweaks.accentHue} onChange={v => setTweak("accentHue", v)} unit="°" />
        <TweakRadio label="Density" value={tweaks.density} options={["compact","comfortable","spacious"]}
                    onChange={v => setTweak("density", v)} />
        <TweakSection label="Layout" />
        <TweakToggle label="Timeline ribbon" value={tweaks.showRibbon} onChange={v => setTweak("showRibbon", v)} />
        <TweakToggle label="Weekly heatmap" value={tweaks.showHeatmap} onChange={v => setTweak("showHeatmap", v)} />
        <TweakToggle label="Keyboard help" value={tweaks.showKeyboardHelp} onChange={v => setTweak("showKeyboardHelp", v)} />
      </TweaksPanel>
    </div>
  );
}

function TopBar({ date, setDate, onCmdk, onSeed, onAdd, onSubmit, theme, onThemeToggle, hasDrafts }) {
  const d = new Date(date + "T00:00");
  const dow = d.toLocaleDateString("en-US", { weekday: "long" });
  const rest = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark"></div>
        Time Logger
        <span className="brand-sep">/</span>
        <span className="brand-page">Day review</span>
      </div>

      <div className="topbar-spacer"></div>

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

      <div className="topbar-actions">
        <button className="btn btn-sm" onClick={onCmdk} title="Command palette (⌘K)">
          <Icon name="search" size={12}/>
          <span style={{color:"var(--muted)"}}>Search</span>
          <span className="kbd">⌘</span><span className="kbd">K</span>
        </button>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onThemeToggle} title="Toggle theme">
          <Icon name={theme === "dark" ? "sun" : "moon"} size={14}/>
        </button>
        <button className="btn btn-primary btn-sm" onClick={onSubmit} disabled={!hasDrafts}>
          <Icon name="send" size={11}/> Submit
          <span className="kbd" style={{borderColor:"rgba(0,0,0,0.2)", background:"rgba(0,0,0,0.15)", color:"var(--accent-fg)"}}>⌘⏎</span>
        </button>
      </div>
    </header>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
