// Time Logger — client glue (theme, command palette, keyboard shortcuts, submit confirm)
(function () {
  "use strict";

  const TICKETS = (function () {
    const el = document.getElementById("tickets-data");
    if (!el) return [];
    try { return JSON.parse(el.textContent || "[]"); } catch (e) { return []; }
  })();

  const COMMANDS = [
    { id: "seed",   label: "Auto-seed blocks from detected work", hint: "⇧S", run: autoSeed },
    { id: "submit", label: "Submit day to Jira & Sheets",          hint: "Ctrl+⏎", run: openSubmitConfirm },
    { id: "new",    label: "Add a new block manually",             hint: "N", run: focusAddBlock },
    { id: "prev",   label: "Go to previous day",                   hint: "[", run: () => clickNav("#nav-prev") },
    { id: "next",   label: "Go to next day",                       hint: "]", run: () => clickNav("#nav-next") },
    { id: "today",  label: "Jump to today",                        hint: "T", run: goToday },
    { id: "theme",  label: "Toggle light / dark theme",            hint: "",  run: toggleTheme },
  ];

  // ---------------- Theme ----------------
  function toggleTheme() {
    const root = document.documentElement;
    const cur = root.dataset.theme || "dark";
    const next = cur === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("tl.theme", next); } catch (e) {}
  }

  // ---------------- Editing helpers (step 5) ----------------
  function appendDesc(btn) {
    const form = btn.closest("form");
    const ta = form && form.querySelector('textarea[name="description"]');
    if (!ta) return;
    const text = btn.dataset.msg || "";
    ta.value = (ta.value ? ta.value.replace(/\s*$/, "") + "\n" : "") + text;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  // ---------------- Submit confirm ----------------
  function openSubmitConfirm() {
    const dlg = document.getElementById("submit-confirm");
    if (dlg && !dlg.open) dlg.showModal();
  }

  // ---------------- Navigation helpers ----------------
  function clickNav(selector) {
    const el = document.querySelector(selector);
    if (el) location.href = el.href;
  }
  function goToday() {
    const el = document.getElementById("nav-today");
    if (el) location.href = el.href;
  }
  function autoSeed() {
    const form = document.querySelector('form[action$="/seed"]');
    if (!form) return;
    const btn = form.querySelector("button");
    if (btn && !btn.disabled) form.submit();
  }
  function focusAddBlock() {
    const input = document.querySelector("#add-block-form input[type=time]");
    if (input) {
      input.focus();
      input.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // ---------------- Block selection + edit shortcut ----------------
  function rows() {
    return Array.from(document.querySelectorAll(".block-row"));
  }
  function draftableRows() {
    return rows().filter(r => !r.classList.contains("submitted"));
  }
  function stepSelection(dir) {
    const rs = rows();
    if (rs.length === 0) return;
    const curIdx = rs.findIndex(r => r.classList.contains("selected"));
    let nextIdx;
    if (curIdx === -1) nextIdx = dir > 0 ? 0 : rs.length - 1;
    else nextIdx = Math.max(0, Math.min(rs.length - 1, curIdx + dir));
    rs.forEach(r => r.classList.remove("selected"));
    rs[nextIdx].classList.add("selected");
    rs[nextIdx].scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function editSelectedBlock() {
    const selected = document.querySelector(".block-row.selected") || draftableRows()[0];
    if (!selected) return;
    const id = selected.dataset.blockId;
    const dlg = document.getElementById("edit-" + id);
    if (dlg && !dlg.open) dlg.showModal();
  }

  // Click-to-select
  document.addEventListener("click", (e) => {
    const row = e.target.closest(".block-row");
    if (!row) return;
    // Ignore clicks on action buttons / delete form
    if (e.target.closest(".block-actions")) return;
    rows().forEach(r => r.classList.remove("selected"));
    row.classList.add("selected");
  });

  // Double-click row → edit
  document.addEventListener("dblclick", (e) => {
    const row = e.target.closest(".block-row");
    if (!row) return;
    if (row.classList.contains("submitted")) return;
    const id = row.dataset.blockId;
    const dlg = document.getElementById("edit-" + id);
    if (dlg && !dlg.open) dlg.showModal();
  });

  // ---------------- Command palette ----------------
  let cmdkActive = 0;
  let cmdkFiltered = [];

  function _allItems() {
    const items = COMMANDS.map(c => ({ kind: "cmd", id: c.id, label: c.label, hint: c.hint, run: c.run }));
    TICKETS.forEach(t => items.push({
      kind: "ticket", id: t.key, label: t.key + " " + (t.summary || ""),
      hint: t.status || "", data: t,
    }));
    return items;
  }

  function openCmdk() {
    const dlg = document.getElementById("cmdk-modal");
    if (!dlg) return;
    const input = document.getElementById("cmdk-input");
    input.value = "";
    cmdkActive = 0;
    renderCmdk("");
    if (!dlg.open) dlg.showModal();
    setTimeout(() => input.focus(), 0);
  }

  function _fuzzy(item, q) {
    if (!q) return true;
    const haystack = item.label.toLowerCase();
    return q.toLowerCase().split(/\s+/).every(tok => haystack.includes(tok));
  }

  function renderCmdk(q) {
    const all = _allItems();
    cmdkFiltered = q ? all.filter(i => _fuzzy(i, q)) : all;
    const list = document.getElementById("cmdk-list");
    list.innerHTML = "";
    cmdkFiltered.slice(0, 40).forEach((it, i) => {
      const div = document.createElement("div");
      div.className = "combo-item" + (i === cmdkActive ? " active" : "");
      div.dataset.idx = i;
      if (it.kind === "ticket") {
        const key = document.createElement("span"); key.className = "key"; key.textContent = it.id;
        const sum = document.createElement("span"); sum.className = "sum"; sum.textContent = it.data.summary || "";
        const chip = document.createElement("span"); chip.className = "status-chip"; chip.textContent = it.hint || "";
        div.append(key, sum, chip);
      } else {
        const label = document.createElement("span"); label.style.flex = "1"; label.textContent = it.label;
        div.append(label);
        if (it.hint) {
          const h = document.createElement("span"); h.className = "status-chip"; h.textContent = it.hint;
          div.append(h);
        }
      }
      div.addEventListener("mousedown", (e) => { e.preventDefault(); executeCmdk(i); });
      list.appendChild(div);
    });
    if (cmdkFiltered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "combo-empty";
      empty.textContent = 'No matches for "' + q + '"';
      list.appendChild(empty);
    }
    // Scroll active item into view
    const activeEl = list.querySelector(".combo-item.active");
    if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
  }

  function executeCmdk(idx) {
    const item = cmdkFiltered[idx];
    const dlg = document.getElementById("cmdk-modal");
    if (dlg) dlg.close();
    if (!item) return;
    if (item.kind === "ticket") {
      showToast("Picked " + item.id);
    } else if (typeof item.run === "function") {
      item.run();
    }
  }

  const cmdkInput = document.getElementById("cmdk-input");
  if (cmdkInput) {
    cmdkInput.addEventListener("input", (e) => { cmdkActive = 0; renderCmdk(e.target.value); });
    cmdkInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { document.getElementById("cmdk-modal").close(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        cmdkActive = Math.min(cmdkFiltered.length - 1, cmdkActive + 1);
        renderCmdk(e.target.value);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        cmdkActive = Math.max(0, cmdkActive - 1);
        renderCmdk(e.target.value);
      } else if (e.key === "Enter") {
        e.preventDefault();
        executeCmdk(cmdkActive);
      }
    });
  }

  // ---------------- Toast ----------------
  function showToast(msg) {
    let wrap = document.querySelector(".toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div"); wrap.className = "toast-wrap";
      document.body.appendChild(wrap);
    }
    const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 2200);
  }

  // ---------------- Global keyboard shortcuts ----------------
  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    const typing = tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable;
    const mod = e.metaKey || e.ctrlKey;
    const openDialog = document.querySelector("dialog[open]");

    // Command palette — works anywhere (the palette input itself handles nav once open)
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openCmdk();
      return;
    }

    // Ctrl/Cmd+Enter: submit the form of an open dialog, otherwise open submit confirm
    if (mod && e.key === "Enter") {
      e.preventDefault();
      if (openDialog) {
        const form = openDialog.querySelector("form[method='post'], form[action]");
        if (form) form.requestSubmit();
      } else {
        openSubmitConfirm();
      }
      return;
    }

    // All remaining shortcuts are disabled while typing or while a dialog is open
    if (typing || openDialog) return;

    switch (e.key) {
      case "j":
      case "ArrowDown": e.preventDefault(); stepSelection(+1); return;
      case "k":
      case "ArrowUp":   e.preventDefault(); stepSelection(-1); return;
      case "e":
      case "E":         editSelectedBlock(); return;
      case "[":         clickNav("#nav-prev"); return;
      case "]":         clickNav("#nav-next"); return;
      case "t":
      case "T":         goToday(); return;
      case "n":
      case "N":         focusAddBlock(); return;
    }
    if (e.key === "S" && e.shiftKey) { autoSeed(); return; }
  });

  // Close dialogs when clicking the backdrop
  document.addEventListener("click", (e) => {
    const target = e.target;
    if (target.tagName === "DIALOG" && target.open) {
      const rect = target.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (!inside) target.close();
    }
  });

  // ---------------- Bulk ticket assignment ----------------
  function initBulkTicket() {
    const bar = document.getElementById("bulk-bar");
    const nLabel = document.getElementById("bulk-bar-n");
    const selectAll = document.getElementById("bulk-select-all");
    const clearBtn = document.getElementById("bulk-bar-clear");
    if (!bar || !nLabel) return;

    function rowChecks() { return Array.from(document.querySelectorAll(".bulk-row-check")); }
    function checkedRowChecks() { return rowChecks().filter(c => c.checked); }

    function update() {
      const n = checkedRowChecks().length;
      nLabel.textContent = String(n);
      bar.hidden = n === 0;
      if (selectAll) {
        const total = rowChecks().length;
        selectAll.checked = n > 0 && n === total;
        selectAll.indeterminate = n > 0 && n < total;
      }
    }

    document.addEventListener("change", (e) => {
      if (e.target && e.target.classList && e.target.classList.contains("bulk-row-check")) update();
    });

    if (selectAll) {
      selectAll.addEventListener("change", () => {
        rowChecks().forEach(c => { c.checked = selectAll.checked; });
        update();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        rowChecks().forEach(c => { c.checked = false; });
        update();
      });
    }

    update();
  }
  initBulkTicket();

  // ---------------- Tickets browser modal ----------------
  function initTicketsBrowser() {
    const input = document.getElementById("tickets-filter");
    const list = document.getElementById("tickets-list");
    const empty = document.getElementById("tickets-empty");
    const modal = document.getElementById("tickets-modal");
    if (!input || !list || !modal) return;

    function applyFilter() {
      const q = input.value.trim().toLowerCase();
      let visible = 0;
      list.querySelectorAll(".ticket-row").forEach(row => {
        const hay = row.dataset.search || "";
        const match = !q || hay.includes(q);
        row.style.display = match ? "" : "none";
        if (match) visible++;
      });
      if (empty) empty.style.display = visible === 0 ? "" : "none";
    }
    input.addEventListener("input", applyFilter);

    // Auto-focus the filter input when the modal opens.
    const obs = new MutationObserver(() => {
      if (modal.open) { input.value = ""; applyFilter(); setTimeout(() => input.focus(), 30); }
    });
    obs.observe(modal, { attributes: true, attributeFilter: ["open"] });
  }
  initTicketsBrowser();

  // ---------------- Ticket combobox (custom dropdown with status pills) ----------------
  function initTicketCombos() {
    const TICKETS_BY_KEY = Object.create(null);
    TICKETS.forEach(t => { TICKETS_BY_KEY[t.key] = t; });

    function escapeHtml(s) {
      return String(s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
    }

    function renderTrigger(combo, key) {
      const display = combo.querySelector(".ticket-combo-display");
      if (!display) return;
      const t = key ? TICKETS_BY_KEY[key] : null;
      if (t) {
        const cat = t.status_category || "unknown";
        display.innerHTML =
          '<span class="ticket-row-key">' + escapeHtml(t.key) + '</span>' +
          '<span class="status-pill pill-' + escapeHtml(cat) + '">' + escapeHtml(t.status || "?") + '</span>' +
          '<span class="ticket-combo-summary">' + escapeHtml(t.summary || "") + '</span>';
      } else {
        display.innerHTML = '<span class="ticket-combo-placeholder">— none —</span>';
      }
    }

    function closeAll(except) {
      document.querySelectorAll(".ticket-combo").forEach(c => {
        if (c === except) return;
        const panel = c.querySelector(".ticket-combo-panel");
        const trigger = c.querySelector(".ticket-combo-trigger");
        if (panel) panel.hidden = true;
        if (trigger) trigger.setAttribute("aria-expanded", "false");
      });
    }

    function applyFilter(combo) {
      const search = combo.querySelector(".ticket-combo-search");
      const rows = combo.querySelectorAll(".ticket-combo-row");
      const empty = combo.querySelector(".ticket-combo-empty");
      const q = (search.value || "").trim().toLowerCase();
      let visible = 0;
      rows.forEach(r => {
        if (!r.dataset.key && q) { r.style.display = "none"; return; }  // hide "— none —" while filtering
        const hay = r.dataset.search || "";
        const match = !q || hay.includes(q);
        r.style.display = match ? "" : "none";
        r.classList.remove("kbd-active");
        if (match) visible++;
      });
      if (empty) empty.hidden = visible > 0;
      const first = combo.querySelector(".ticket-combo-row:not([style*='display: none'])");
      if (first) first.classList.add("kbd-active");
    }

    function markSelected(combo, key) {
      combo.querySelectorAll(".ticket-combo-row").forEach(r => {
        r.classList.toggle("is-selected", (r.dataset.key || "") === (key || ""));
      });
    }

    function open(combo) {
      closeAll(combo);
      const panel = combo.querySelector(".ticket-combo-panel");
      const trigger = combo.querySelector(".ticket-combo-trigger");
      const search = combo.querySelector(".ticket-combo-search");
      panel.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      search.value = "";
      applyFilter(combo);
      markSelected(combo, combo.dataset.value || "");
      setTimeout(() => search.focus(), 20);
    }

    function close(combo) {
      const panel = combo.querySelector(".ticket-combo-panel");
      const trigger = combo.querySelector(".ticket-combo-trigger");
      panel.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    }

    function select(combo, key) {
      const input = combo.querySelector('input[type="hidden"]');
      combo.dataset.value = key || "";
      if (input) input.value = key || "";
      renderTrigger(combo, key || "");
      close(combo);
    }

    function activeRow(combo) {
      return combo.querySelector(".ticket-combo-row.kbd-active");
    }
    function visibleRows(combo) {
      return Array.from(combo.querySelectorAll(".ticket-combo-row"))
        .filter(r => r.style.display !== "none");
    }
    function moveActive(combo, dir) {
      const rows = visibleRows(combo);
      if (!rows.length) return;
      let idx = rows.findIndex(r => r.classList.contains("kbd-active"));
      idx = idx < 0 ? 0 : idx + dir;
      if (idx < 0) idx = rows.length - 1;
      if (idx >= rows.length) idx = 0;
      rows.forEach(r => r.classList.remove("kbd-active"));
      rows[idx].classList.add("kbd-active");
      rows[idx].scrollIntoView({ block: "nearest" });
    }

    document.querySelectorAll(".ticket-combo").forEach(combo => {
      const trigger = combo.querySelector(".ticket-combo-trigger");
      const search = combo.querySelector(".ticket-combo-search");
      const list = combo.querySelector(".ticket-combo-list");

      trigger.addEventListener("click", (e) => {
        e.preventDefault();
        const panel = combo.querySelector(".ticket-combo-panel");
        if (panel.hidden) open(combo); else close(combo);
      });

      search.addEventListener("input", () => applyFilter(combo));
      search.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); moveActive(combo, +1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(combo, -1); }
        else if (e.key === "Enter") {
          e.preventDefault();
          const row = activeRow(combo);
          if (row) select(combo, row.dataset.key || "");
        } else if (e.key === "Escape") {
          e.preventDefault();
          close(combo);
          trigger.focus();
        }
      });

      list.addEventListener("click", (e) => {
        const row = e.target.closest(".ticket-combo-row");
        if (!row) return;
        select(combo, row.dataset.key || "");
      });
    });

    // Close any open combo when clicking outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".ticket-combo")) closeAll(null);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAll(null);
    });
  }
  initTicketCombos();

  // ---------------- Markdown toolbar ----------------
  // Inserts markdown syntax at the cursor (or wraps the selection) in the
  // textarea identified by the parent toolbar's data-target attribute.
  function initMarkdownToolbars() {
    function getSel(ta) {
      return { start: ta.selectionStart, end: ta.selectionEnd, before: ta.value.slice(0, ta.selectionStart), middle: ta.value.slice(ta.selectionStart, ta.selectionEnd), after: ta.value.slice(ta.selectionEnd) };
    }

    function setVal(ta, before, middle, after, caretStart, caretEnd) {
      ta.value = before + middle + after;
      ta.focus();
      ta.setSelectionRange(caretStart, caretEnd);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function wrap(ta, left, right, placeholder) {
      const s = getSel(ta);
      const inner = s.middle || placeholder;
      const text = left + inner + right;
      setVal(ta, s.before, text, s.after, s.before.length + left.length, s.before.length + left.length + inner.length);
    }

    function linePrefix(ta, prefix, placeholder) {
      const s = getSel(ta);
      const lineStart = s.before.lastIndexOf("\n") + 1;
      const before = s.before.slice(0, lineStart);
      const linePart = s.before.slice(lineStart);
      const sel = s.middle || placeholder;
      const lines = (linePart + sel).split("\n");
      const out = lines.map((ln, i) => {
        if (prefix === "1. ") return (i + 1) + ". " + ln;
        return prefix + ln;
      }).join("\n");
      setVal(ta, before, out, s.after, before.length + out.length, before.length + out.length);
    }

    function applyAction(ta, action) {
      switch (action) {
        case "bold":      return wrap(ta, "**", "**", "bold text");
        case "italic":    return wrap(ta, "*", "*", "italic text");
        case "code":      return wrap(ta, "`", "`", "code");
        case "bullet":    return linePrefix(ta, "- ", "item");
        case "ordered":   return linePrefix(ta, "1. ", "item");
        case "heading":   return linePrefix(ta, "## ", "heading");
        case "quote":     return linePrefix(ta, "> ", "quote");
        case "codeblock": {
          const s = getSel(ta);
          const inner = s.middle || "code here";
          const block = "```\n" + inner + "\n```";
          return setVal(ta, s.before, block, s.after, s.before.length + 4, s.before.length + 4 + inner.length);
        }
        case "link": {
          const s = getSel(ta);
          const label = s.middle || "link text";
          const text = "[" + label + "](https://)";
          return setVal(ta, s.before, text, s.after, s.before.length + text.length - 9, s.before.length + text.length - 1);
        }
      }
    }

    document.querySelectorAll(".md-toolbar").forEach(bar => {
      const targetId = bar.dataset.target;
      const ta = document.getElementById(targetId);
      if (!ta) return;
      bar.querySelectorAll(".md-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          applyAction(ta, btn.dataset.md);
        });
      });
      // Ctrl/Cmd shortcuts scoped to this textarea
      ta.addEventListener("keydown", (e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && (e.key === "b" || e.key === "B")) { e.preventDefault(); applyAction(ta, "bold"); return; }
        if (mod && (e.key === "i" || e.key === "I")) { e.preventDefault(); applyAction(ta, "italic"); return; }
        if (e.key === "Enter" && !e.shiftKey && !mod) handleListContinuation(ta, e);
      });
    });
  }

  // Auto-continue bullet / numbered / quote lines on Enter, like Jira's editor.
  // Empty marker on its own line cancels the list (exits to a blank paragraph).
  function handleListContinuation(ta, event) {
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start !== end) return;  // selection — let default handler take it
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(start);
    const lineStart = before.lastIndexOf("\n") + 1;
    const currentLine = before.slice(lineStart);

    const bullet  = currentLine.match(/^(\s*)([-*+])(\s+)(.*)$/);
    const ordered = currentLine.match(/^(\s*)(\d+)\.(\s+)(.*)$/);
    const quote   = currentLine.match(/^(\s*)(>)(\s+)(.*)$/);
    const m = bullet || ordered || quote;
    if (!m) return;

    const [, indent, marker, sep, rest] = m;
    event.preventDefault();

    // Empty list item / quote → drop the marker and exit the list.
    if (!rest.trim()) {
      const newBefore = before.slice(0, lineStart);
      ta.value = newBefore + "\n" + after;
      const caret = newBefore.length + 1;
      ta.setSelectionRange(caret, caret);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    // Continue the list. For ordered lists, increment the number.
    let nextMarker;
    if (ordered) nextMarker = (parseInt(marker, 10) + 1) + ".";
    else nextMarker = marker;
    const insert = "\n" + indent + nextMarker + sep;
    ta.value = before + insert + after;
    const caret = before.length + insert.length;
    ta.setSelectionRange(caret, caret);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  initMarkdownToolbars();

  // ---------------- v2 ribbon — zoom pills + drag-to-create ----------------
  function initRibbonV2() {
    const ribbon = document.getElementById("ribbon");
    const track = document.getElementById("ribbon-track");
    if (!ribbon || !track) return;

    // Read the initial window from the active zoom pill (12h by default = 07:00–19:00).
    let windowStart = 7 * 60;
    let windowEnd = 19 * 60;

    function windowSpan() { return Math.max(1, windowEnd - windowStart); }

    function hmToMin(hm) {
      if (!hm || !hm.includes(":")) return NaN;
      const [h, m] = hm.split(":").map(n => parseInt(n, 10));
      return h * 60 + m;
    }
    function minToHm(min) {
      const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
      const h = Math.floor(m / 60);
      const mm = m % 60;
      return String(h).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
    }

    function clampPctRange(startMin, endMin) {
      const s = Math.max(startMin, windowStart);
      const e = Math.min(endMin, windowEnd);
      if (e <= s) return null;
      const left = ((s - windowStart) / windowSpan()) * 100;
      const width = ((e - s) / windowSpan()) * 100;
      return { left, width };
    }

    function repositionBars(rootSelector, hasWidth) {
      ribbon.querySelectorAll(rootSelector).forEach(el => {
        const sm = hmToMin(el.dataset.startHm);
        const em = hmToMin(el.dataset.endHm);
        if (isNaN(sm)) {
          // git marker (single point)
          const m = hmToMin(el.dataset.hm);
          if (isNaN(m) || m < windowStart || m > windowEnd) { el.style.display = "none"; return; }
          el.style.display = "";
          el.style.left = (((m - windowStart) / windowSpan()) * 100) + "%";
          return;
        }
        const range = clampPctRange(sm, em);
        if (!range) { el.style.display = "none"; return; }
        el.style.display = "";
        el.style.left = range.left + "%";
        if (hasWidth) el.style.width = range.width + "%";
      });
    }

    function repositionHours() {
      const hoursEl = document.getElementById("ribbon-hours");
      if (!hoursEl) return;
      hoursEl.querySelectorAll(".ribbon-hour, .ribbon-label").forEach(el => {
        const h = parseInt(el.dataset.hour, 10);
        if (isNaN(h)) return;
        const m = h * 60;
        if (m < windowStart || m > windowEnd) { el.style.display = "none"; return; }
        el.style.display = "";
        el.style.left = (((m - windowStart) / windowSpan()) * 100) + "%";
      });
    }

    function repositionNow() {
      const now = document.getElementById("ribbon-now");
      if (!now) return;
      const d = new Date();
      const m = d.getHours() * 60 + d.getMinutes();
      if (m < windowStart || m > windowEnd) { now.style.display = "none"; return; }
      now.style.display = "";
      now.style.left = (((m - windowStart) / windowSpan()) * 100) + "%";
    }

    function applyZoom(startMin, endMin) {
      windowStart = startMin;
      windowEnd = endMin;
      repositionBars(".seg-bar", true);
      repositionBars(".draft-bar", true);
      repositionBars(".git-marker", false);
      repositionHours();
      repositionNow();
    }

    // Wire zoom pills.
    document.querySelectorAll(".zoom-pill").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".zoom-pill").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const s = parseInt(btn.dataset.startMin, 10);
        const e = parseInt(btn.dataset.endMin, 10);
        if (!isNaN(s) && !isNaN(e)) applyZoom(s, e);
      });
    });

    // Drag-to-create. Mousedown on empty track area, mouseup → POST to /day/{ds}/block.
    let dragging = false;
    let dragStartX = 0;
    let dragStartMin = 0;
    const ghost = document.getElementById("ribbon-ghost");
    const form = document.getElementById("ribbon-drag-form");

    function trackXToMin(clientX) {
      const r = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      return windowStart + pct * windowSpan();
    }
    function snap5(m) { return Math.round(m / 5) * 5; }
    function minToPct(m) { return ((m - windowStart) / windowSpan()) * 100; }

    track.addEventListener("mousedown", (e) => {
      // Don't start a drag on top of an existing segment/draft/marker.
      if (e.target !== track) return;
      if (e.button !== 0) return;
      dragging = true;
      dragStartX = e.clientX;
      dragStartMin = trackXToMin(e.clientX);
      ribbon.classList.add("is-dragging");
      ghost.hidden = false;
      ghost.style.left = minToPct(dragStartMin) + "%";
      ghost.style.width = "0%";
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const cur = trackXToMin(e.clientX);
      const a = Math.min(cur, dragStartMin);
      const b = Math.max(cur, dragStartMin);
      ghost.style.left = minToPct(a) + "%";
      ghost.style.width = Math.max(0, minToPct(b) - minToPct(a)) + "%";
    });
    document.addEventListener("mouseup", (e) => {
      if (!dragging) return;
      dragging = false;
      ribbon.classList.remove("is-dragging");
      ghost.hidden = true;
      const cur = trackXToMin(e.clientX);
      const a = snap5(Math.min(cur, dragStartMin));
      const b = snap5(Math.max(cur, dragStartMin));
      if (b - a < 10) return;  // ignore short drags
      if (!form) return;
      form.querySelector('input[name="start"]').value = minToHm(a);
      form.querySelector('input[name="end"]').value = minToHm(b);
      form.submit();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && dragging) {
        dragging = false;
        ribbon.classList.remove("is-dragging");
        ghost.hidden = true;
      }
    });
  }
  initRibbonV2();

  // ---------------- v2 live clock (topbar) ----------------
  function initLiveClock() {
    const el = document.getElementById("live-clock-time");
    if (!el) return;
    function tick() {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      el.textContent = hh + ":" + mm;
    }
    tick();
    setInterval(tick, 30000);
  }
  initLiveClock();

  // Export a tiny API for inline onclick handlers
  window.TL = {
    toggleTheme,
    openCmdk,
    openSubmitConfirm,
    appendDesc,
  };
  window.appendDesc = appendDesc; // legacy inline reference
})();
