/* global React, Icon, DATA */
const { useState, useMemo, useEffect, useRef } = React;

// ============================================================
// Ticket combobox (recent-first, fuzzy filter)
// ============================================================
const TicketCombo = ({ tickets, value, onChange, recent = [] }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(value || "");
  const [active, setActive] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const recentSet = new Set(recent);
  const filtered = tickets.filter(t => {
    if (!q) return true;
    const h = `${t.key} ${t.summary}`.toLowerCase();
    return q.toLowerCase().split(/\s+/).every(tok => h.includes(tok));
  });
  const recentItems = filtered.filter(t => recentSet.has(t.key));
  const otherItems  = filtered.filter(t => !recentSet.has(t.key));

  const pick = (t) => { onChange(t.key); setQ(`${t.key} · ${t.summary}`); setOpen(false); };

  return (
    <div className="combo" ref={ref}>
      <input
        className="input combo-input"
        value={q}
        placeholder="Search tickets by key or keyword…"
        onFocus={() => setOpen(true)}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a+1, filtered.length-1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a-1, 0)); }
          if (e.key === "Enter" && filtered[active]) { e.preventDefault(); pick(filtered[active]); }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <span className="combo-caret"><Icon name="chevD" size={12}/></span>
      {open && (
        <div className="combo-menu">
          {recentItems.length > 0 && <div className="combo-section">Recent</div>}
          {recentItems.map((t, i) => (
            <div key={t.key} className={`combo-item ${i === active ? "active" : ""}`} onMouseDown={() => pick(t)}>
              <span className="key">{t.key}</span>
              <span className="sum">{t.summary}</span>
              <span className="status-chip">{t.status}</span>
            </div>
          ))}
          {otherItems.length > 0 && <div className="combo-section">All tickets</div>}
          {otherItems.map((t, i) => (
            <div key={t.key} className="combo-item" onMouseDown={() => pick(t)}>
              <span className="key">{t.key}</span>
              <span className="sum">{t.summary}</span>
              <span className="status-chip">{t.status}</span>
            </div>
          ))}
          {filtered.length === 0 && <div className="combo-empty">No tickets match "{q}"</div>}
        </div>
      )}
    </div>
  );
};

// ============================================================
// Edit modal
// ============================================================
const EditModal = ({ block, tickets, gitEvents, segments, onSave, onClose, onDelete }) => {
  const [form, setForm] = useState({
    start: block.start,
    end: block.end,
    ticket: block.ticket || "",
    description: block.description || "",
    project: block.project || "",
  });
  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v }));
  const mins = Math.max(1, DATA.hmToMin(form.end) - DATA.hmToMin(form.start));

  // collect context (git commits + segment titles) inside the block's time window
  const ctxGit = gitEvents.filter(g => DATA.hmToMin(g.t) >= DATA.hmToMin(block.start) && DATA.hmToMin(g.t) <= DATA.hmToMin(block.end));
  const ctxSegs = segments.filter(s =>
    s.kind === "work" &&
    DATA.hmToMin(s.start) >= DATA.hmToMin(block.start) - 5 &&
    DATA.hmToMin(s.end) <= DATA.hmToMin(block.end) + 5
  );

  const taRef = useRef();
  useEffect(() => { taRef.current && taRef.current.focus(); }, []);
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); if ((e.metaKey||e.ctrlKey) && e.key === "Enter") onSave(form); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [form]);

  const appendSuggestion = (text) => {
    setForm(f => ({ ...f, description: (f.description ? f.description + "\n" : "") + text }));
    taRef.current && taRef.current.focus();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>Edit block</h3>
            <div className="meta">{form.start} – {form.end} · {mins}m · {block.project || "unassigned"}</div>
          </div>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}><Icon name="x"/></button>
        </div>

        <div className="modal-body">
          <div className="row2">
            <div className="field">
              <label className="field-label">Start</label>
              <input className="input" type="time" value={form.start} onChange={e => set("start")(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">End</label>
              <input className="input" type="time" value={form.end} onChange={e => set("end")(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Duration</label>
              <input className="input" readOnly value={`${mins}m (${DATA.fmtDur(mins)})`} />
            </div>
          </div>

          <div className="field">
            <label className="field-label">Ticket <span className="hint">— type to fuzzy-search; recent tickets appear first</span></label>
            <TicketCombo tickets={tickets} value={form.ticket ? `${form.ticket} · ${tickets.find(t=>t.key===form.ticket)?.summary||""}` : ""}
                         onChange={set("ticket")} recent={["CORE-482", "PLAT-118", "WEB-9"]} />
          </div>

          <div className="field">
            <label className="field-label">
              Description <span className="hint">— technical summary, like a commit / MR message</span>
            </label>
            <textarea ref={taRef} className="textarea mono" rows={7}
                      placeholder="e.g. Traced the OAuth refresh loop to overlapping token refresh + reauth prompts during long idle. Added a single-flight guard in the middleware and covered with a regression test."
                      value={form.description} onChange={e => set("description")(e.target.value)} />
            {ctxGit.length > 0 && (
              <div className="suggestions">
                <span style={{ fontSize: "var(--fs-xs)", color: "var(--muted)", marginRight: 2 }}>Suggest from commits:</span>
                {ctxGit.map(g => (
                  <button key={g.sha} className="suggest-chip" onClick={() => appendSuggestion(g.msg)}>
                    <span className="pre">{g.sha}</span> {g.msg.length > 54 ? g.msg.slice(0,54)+"…" : g.msg}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="edit-context">
            <h5>Context in this window</h5>
            {ctxSegs.length > 0 ? (
              <ul>
                {ctxSegs.slice(0, 5).map((s, i) => (
                  <li key={i}><span className="t">{s.start}</span><span>{s.title || "(no title)"}</span></li>
                ))}
              </ul>
            ) : <div style={{ color: "var(--muted)", fontSize: "var(--fs-xs)" }}>No detected segments in this window.</div>}
            {ctxGit.length > 0 && (
              <ul>
                {ctxGit.map((g, i) => (
                  <li key={i}><span className="t">{g.t}</span><span className="c">{g.sha}</span><span>{g.msg}</span></li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="modal-foot">
          <div className="left">
            {block.status !== "submitted" && (
              <button className="btn btn-sm" onClick={() => { onDelete(block.id); onClose(); }}>
                <Icon name="trash" size={11}/> Delete
              </button>
            )}
          </div>
          <div className="right">
            <span className="modal-hint"><span className="kbd">Esc</span> to cancel · <span className="kbd">⌘</span><span className="kbd">⏎</span> to save</span>
            <button className="btn btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={() => onSave(form)}>
              <Icon name="check" size={11}/> Save block
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Submit confirmation modal
// ============================================================
const SubmitModal = ({ blocks, tickets, date, onConfirm, onClose }) => {
  const drafts = blocks.filter(b => b.status !== "submitted");
  const empty  = drafts.filter(b => !b.description.trim() || !b.ticket);
  const total  = drafts.reduce((a, b) => a + (DATA.hmToMin(b.end) - DATA.hmToMin(b.start)), 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>Submit to Jira & Google Sheets</h3>
            <div className="meta">{date} · {drafts.length} draft block{drafts.length !== 1 ? "s" : ""}</div>
          </div>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}><Icon name="x"/></button>
        </div>
        <div className="modal-body">
          <div className="submit-summary">
            <div><span className="label">Blocks</span><span className="value">{drafts.length}</span></div>
            <div><span className="label">Total time</span><span className="value">{DATA.fmtDur(total)}</span></div>
            <div><span className="label">Issues</span><span className="value">{new Set(drafts.map(d => d.ticket).filter(Boolean)).size}</span></div>
          </div>

          {empty.length > 0 && (
            <div className="flash flash-error">
              <span className="flash-icon"><Icon name="alert" /></span>
              <span className="flash-msg">{empty.length} block{empty.length > 1 ? "s are" : " is"} missing a ticket or description. You can still submit, but they'll be skipped.</span>
            </div>
          )}

          <div className="submit-list">
            {drafts.map(b => {
              const t = tickets.find(t => t.key === b.ticket);
              const skip = !b.description.trim() || !b.ticket;
              return (
                <div className="submit-item" key={b.id}>
                  <Icon name={skip ? "alert" : "check"} size={14} className={skip ? "" : ""} />
                  <span className="mono">{b.start}–{b.end}</span>
                  <span className="k">{b.ticket || <span style={{color:"var(--muted-2)"}}>no ticket</span>}</span>
                  <span className="d">{b.description || <em style={{color:"var(--muted-2)"}}>missing description</em>}</span>
                  <span className="target">Jira · Sheets</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="modal-foot">
          <div className="left">
            <span className="modal-hint">Pushes Jira worklog + appends a row to the weekly sheet. Idempotent by (date, start_ts).</span>
          </div>
          <div className="right">
            <button className="btn btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={onConfirm}>
              <Icon name="send" size={11}/> Submit {drafts.length - empty.length} block{(drafts.length - empty.length) !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// Command palette (⌘K)
// ============================================================
const CommandPalette = ({ tickets, onClose, onPickTicket, onRunCommand }) => {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const ref = useRef();
  useEffect(() => { ref.current && ref.current.focus(); }, []);

  const cmds = [
    { kind: "cmd", id: "seed",     label: "Auto-seed blocks from detected work", hint: "⇧S" },
    { kind: "cmd", id: "submit",   label: "Submit day to Jira & Sheets",          hint: "⌘⏎" },
    { kind: "cmd", id: "new",      label: "Add a new block manually",             hint: "N" },
    { kind: "cmd", id: "prev",     label: "Go to previous day",                   hint: "[" },
    { kind: "cmd", id: "next",     label: "Go to next day",                       hint: "]" },
    { kind: "cmd", id: "today",    label: "Jump to today",                        hint: "T" },
    { kind: "cmd", id: "theme",    label: "Toggle light / dark theme",            hint: "" },
    ...tickets.map(t => ({ kind: "ticket", id: t.key, label: `${t.key} · ${t.summary}`, hint: t.status, data: t })),
  ];
  const filtered = q
    ? cmds.filter(c => c.label.toLowerCase().includes(q.toLowerCase()))
    : cmds;

  return (
    <div className="cmdk-backdrop" onClick={onClose}>
      <div className="cmdk" onClick={e => e.stopPropagation()}>
        <div className="cmdk-input-wrap">
          <Icon name="search" size={16} />
          <input ref={ref} className="cmdk-input" placeholder="Type a command, ticket, or keyword…"
                 value={q} onChange={e => { setQ(e.target.value); setI(0); }}
                 onKeyDown={e => {
                   if (e.key === "Escape") onClose();
                   if (e.key === "ArrowDown") { e.preventDefault(); setI(x => Math.min(x+1, filtered.length-1)); }
                   if (e.key === "ArrowUp")   { e.preventDefault(); setI(x => Math.max(x-1, 0)); }
                   if (e.key === "Enter" && filtered[i]) {
                     if (filtered[i].kind === "ticket") onPickTicket(filtered[i].data);
                     else onRunCommand(filtered[i].id);
                     onClose();
                   }
                 }}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="cmdk-list">
          {filtered.slice(0, 40).map((c, idx) => (
            <div key={c.id} className={`combo-item ${idx === i ? "active" : ""}`}
                 onMouseDown={() => {
                   if (c.kind === "ticket") onPickTicket(c.data);
                   else onRunCommand(c.id);
                   onClose();
                 }}>
              {c.kind === "ticket"
                ? <><span className="key">{c.id}</span><span className="sum">{c.data.summary}</span><span className="status-chip">{c.hint}</span></>
                : <><Icon name="play" size={11} /><span style={{ flex: 1 }}>{c.label}</span>{c.hint && <span className="status-chip">{c.hint}</span>}</>
              }
            </div>
          ))}
          {filtered.length === 0 && <div className="combo-empty">No matches for "{q}"</div>}
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { EditModal, SubmitModal, CommandPalette, TicketCombo });
