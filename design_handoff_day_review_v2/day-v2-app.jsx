/* global React, ReactDOM, Icon, DATA, LOGOS, BrandLockup,
          TopBarV2, TopBarRow2, RibbonV2, CoverageStatsV2, BlocksV2,
          BigRing, Heatmap, KeyboardHelp,
          EditModal, SubmitModal, CommandPalette,
          TweaksPanel, useTweaks, TweakSection, TweakToggle, TweakRadio, TweakSlider, TweakColor, TweakSelect */
const { useState, useEffect, useMemo, useRef } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "accentHue": 35,
  "logo": "stack",
  "layout": "3col",
  "density": "comfortable",
  "showHeatmap": true,
  "showKeyboardHelp": true
}/*EDITMODE-END*/;

function AppV2() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const [date, setDate] = useState(DATA.TODAY);
  const [blocks, setBlocks] = useState(DATA.MOCK_BLOCKS);
  const [selectedId, setSelectedId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [showCmdk, setShowCmdk] = useState(false);
  const [flash, setFlash] = useState(null);
  const [toast, setToast] = useState(null);
  const [view, setView] = useState("Day");
  const [zoom, setZoom] = useState("day");

  // theme + hue applied to <html>
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = tweaks.theme;
    root.style.setProperty("--acc-h", String(tweaks.accentHue));
  }, [tweaks.theme, tweaks.accentHue]);

  const [now, setNow] = useState(14 * 60 + 52);
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
      if (e.key === "j" || e.key === "ArrowDown") { stepSelect(+1); return; }
      if (e.key === "k" || e.key === "ArrowUp")   { stepSelect(-1); return; }
      if (e.key === "e" && selectedId != null) { setExpandedId(id => id === selectedId ? null : selectedId); return; }
      if (e.key === "[" ) { setDate(d => shiftDate(d, -1)); return; }
      if (e.key === "]" ) { setDate(d => shiftDate(d, +1)); return; }
      if (e.key === "t") { setDate(DATA.TODAY); return; }
      if (e.key === "S" && e.shiftKey) { seedBlocks(); return; }
      if (e.key === "n") { addBlock("09:00", "09:30"); return; }
      if (e.key === "Escape") { setExpandedId(null); setShowSubmit(false); setShowCmdk(false); }
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
  const saveBlock = (id, form) => {
    setBlocks(bs => bs.map(b => b.id === id ? { ...b, ...form } : b));
    showToast(`Saved ${form.ticket || "(unassigned)"}`);
  };
  const deleteBlock = (id) => {
    setBlocks(bs => bs.filter(b => b.id !== id));
    showToast("Block deleted");
  };
  const addBlock = (start, end, ticket = "", project = "") => {
    const newB = { id: Date.now(), start, end, ticket, project, description: "", status: "draft", git: 0 };
    setBlocks(bs => [...bs, newB]);
    setSelectedId(newB.id);
    setExpandedId(newB.id);
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

  const submitDay = () => {
    const toSubmit = blocks.filter(b => b.status !== "submitted" && b.description.trim() && b.ticket);
    setBlocks(bs => bs.map(b => toSubmit.find(t => t.id === b.id) ? { ...b, status: "submitted" } : b));
    setFlash({ level: "ok", msg: `Nice — ${toSubmit.length} worklog${toSubmit.length===1?"":"s"} on their way to Jira, and the week's sheet is up to date.` });
    setShowSubmit(false);
  };

  // derived
  const draftMin = blocks.reduce((a,b) => a + (DATA.hmToMin(b.end) - DATA.hmToMin(b.start)), 0);
  const draftPct = Math.round(draftMin / 480 * 100);
  const syncedCount = blocks.filter(b => b.status === "submitted").length;

  // synthesized "last 7 days" series from heatmap (for sparkline)
  const weekHistory = useMemo(() => {
    const tail = DATA.MOCK_HEATMAP.slice(-7).map(v => Math.max(0, v));
    tail[tail.length - 1] = draftMin || tail[tail.length - 1];
    return tail;
  }, [draftMin]);

  return (
    <div className={`app app-v2 layout-${tweaks.layout} density-${tweaks.density}`}>
      <TopBarV2
        logoVariant={tweaks.logo}
        date={date}
        onCmdk={() => setShowCmdk(true)}
        onSeed={seedBlocks}
        onAdd={() => addBlock("09:00", "09:30")}
        onSubmit={() => setShowSubmit(true)}
        theme={tweaks.theme}
        onThemeToggle={() => setTweak("theme", tweaks.theme === "dark" ? "light" : "dark")}
        hasDrafts={blocks.some(b => b.status === "draft")}
        view={view}
        onViewChange={setView}
        draftPct={draftPct}
        draftMin={draftMin}
      />

      <TopBarRow2
        date={date} setDate={setDate}
        onSeed={seedBlocks}
        onAdd={() => addBlock("09:00", "09:30")}
        blocksCount={blocks.length}
        syncedCount={syncedCount}
      />

      <RibbonV2
        segments={DATA.MOCK_SEGMENTS}
        blocks={blocks}
        gitEvents={DATA.MOCK_GIT}
        now={now}
        onSelectBlock={(id) => { setSelectedId(id); }}
        selectedId={selectedId}
        zoom={zoom}
        setZoom={setZoom}
        onAddBlock={addBlock}
      />

      <main className="main main-v2">
        {flash && (
          <div className={`flash flash-friendly`}>
            <span className="flash-icon"><Icon name="sparkle" /></span>
            <span className="flash-msg">{flash.msg}</span>
            <button className="flash-close" onClick={() => setFlash(null)}><Icon name="x" size={12}/></button>
          </div>
        )}

        <CoverageStatsV2 segments={DATA.MOCK_SEGMENTS} blocks={blocks} weekHistory={weekHistory} />

        <section className="block-section">
          <div className="section-head">
            <div className="section-title">
              Time log
              <span className="count">{blocks.length} total · {syncedCount} synced · {blocks.filter(b => !b.description.trim() && b.status !== "submitted").length} empty</span>
            </div>
          </div>
          <BlocksV2
            blocks={blocks}
            tickets={DATA.MOCK_TICKETS}
            segments={DATA.MOCK_SEGMENTS}
            gitEvents={DATA.MOCK_GIT}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onSave={saveBlock}
            onDelete={deleteBlock}
            onAddBetween={addBlock}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
          />
        </section>
      </main>

      {tweaks.layout === "3col" && (
        <aside className="rail rail-v2">
          <div className="rail-section">
            <h4>Last 28 days</h4>
            <div className="rail-card">
              <Heatmap data={DATA.MOCK_HEATMAP} />
            </div>
          </div>
          <div className="rail-section">
            <h4>Sync targets</h4>
            <div className="rail-card">
              <div className="rail-kv"><span className="k">Jira</span><span className="v" style={{color:"var(--cool)"}}>●  connected</span></div>
              <div className="rail-kv"><span className="k">Sheets</span><span className="v" style={{color:"var(--cool)"}}>●  wk/2026-W17</span></div>
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
      )}

      {/* modals */}
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
        <TweakSection label="Brand" />
        <TweakRadio label="Logo" value={tweaks.logo}
                    options={["stack","arc","mono","clock","hourglass","carve"]}
                    onChange={v => setTweak("logo", v)} />

        <TweakSection label="Appearance" />
        <TweakRadio label="Theme" value={tweaks.theme} options={["dark","light"]}
                    onChange={v => setTweak("theme", v)} />
        <TweakSlider label="Accent hue" min={0} max={360} step={1}
                     value={tweaks.accentHue}
                     onChange={v => setTweak("accentHue", v)} unit="°" />
        <TweakRadio label="Density" value={tweaks.density}
                    options={["compact","comfortable","spacious"]}
                    onChange={v => setTweak("density", v)} />

        <TweakSection label="Layout" />
        <TweakRadio label="Shape" value={tweaks.layout}
                    options={["3col","single","timeline"]}
                    onChange={v => setTweak("layout", v)} />
        <TweakToggle label="Weekly heatmap" value={tweaks.showHeatmap}
                     onChange={v => setTweak("showHeatmap", v)} />
        <TweakToggle label="Keyboard help" value={tweaks.showKeyboardHelp}
                     onChange={v => setTweak("showKeyboardHelp", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<AppV2 />);
