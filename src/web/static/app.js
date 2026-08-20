// Time Logger — client glue.
//
// Mutations on the day view go through htmx: the server re-renders the whole day
// and the client swaps only the live regions (#day-live and the out-of-band
// siblings listed in OOB_REGIONS). Nothing navigates, so the scroll position, the
// selected block and an in-progress review session all survive a save — which is
// what the "saves in place" promise in the editor is about.
//
// Anything that binds to swapped-in elements has to be re-bound afterwards; those
// initialisers live in initDynamic() and run again on every htmx:afterSettle.
// Document-level listeners are registered once, at the bottom.
(function () {
  "use strict";

  const OOB_REGIONS = "#topbar-live,#ribbon-live,#rail-live,#modals-live";

  const TICKETS = (function () {
    const el = document.getElementById("tickets-data");
    if (!el) return [];
    try { return JSON.parse(el.textContent || "[]"); } catch (e) { return []; }
  })();

  const COMMANDS = [
    { id: "review", label: "Review every draft in order",           hint: "R", run: () => startReview() },
    { id: "seed",   label: "Auto-seed blocks from detected work",   hint: "⇧S", run: autoSeed },
    { id: "submit", label: "Submit day to Jira & Sheets",           hint: "Ctrl+⏎", run: openSubmitConfirm },
    { id: "new",    label: "Add a new block manually",              hint: "N", run: focusAddBlock },
    { id: "undo",   label: "Undo the last change",                  hint: "Ctrl+Z", run: () => undo() },
    { id: "prev",   label: "Go to previous day",                    hint: "[", run: () => clickNav("#nav-prev") },
    { id: "next",   label: "Go to next day",                        hint: "]", run: () => clickNav("#nav-next") },
    { id: "today",  label: "Jump to today",                         hint: "T", run: goToday },
    { id: "theme",  label: "Toggle light / dark theme",             hint: "",  run: toggleTheme },
  ];

  // ---------------- Live-region state that has to outlive a swap ----------------
  let selectedId = null;        // block id carrying the .selected ring
  let review = null;            // { ids: [...] } while a review session is running
  let advanceFrom = null;       // block id whose save should open the next draft
  let savedScrollY = null;      // scroll position captured before a mutation
  let ribbonZoom = "day";       // active ribbon zoom pill

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

  // ---------------- Live POST (for actions with no markup of their own) ----------------
  // Builds a throwaway htmx-wired form so drags and dynamic actions land in the
  // same in-place-swap path as the declarative buttons.
  function livePost(url, values) {
    const f = document.createElement("form");
    f.method = "post";
    f.action = url;
    f.hidden = true;
    f.setAttribute("hx-post", url);
    f.setAttribute("hx-target", "#day-live");
    f.setAttribute("hx-swap", "outerHTML");
    f.setAttribute("hx-select", "#day-live");
    f.setAttribute("hx-select-oob", OOB_REGIONS);
    Object.keys(values || {}).forEach(k => {
      const i = document.createElement("input");
      i.type = "hidden";
      i.name = k;
      i.value = String(values[k]);
      f.appendChild(i);
    });
    document.body.appendChild(f);
    if (window.htmx) {
      f.addEventListener("htmx:afterRequest", () => f.remove());
      window.htmx.process(f);
      f.requestSubmit();
    } else {
      f.submit();  // no htmx: fall back to a full page post
    }
  }

  function currentDate() {
    const el = document.querySelector("[data-day-iso]");
    return el ? el.dataset.dayIso : "";
  }

  // ---------------- Undo ----------------
  function undo() {
    const form = document.getElementById("undo-form");
    if (form) form.requestSubmit();
  }

  // ---------------- Submit confirm ----------------
  function openSubmitConfirm() {
    const dlg = document.getElementById("submit-confirm");
    if (dlg && !dlg.open) dlg.showModal();
  }

  // ---------------- Review mode ----------------
  // Walks the day's drafts in start-time order without leaving the keyboard.
  // The queue is captured once so blocks the user retimes mid-review don't get
  // revisited or skipped; ids that vanish (deleted, merged) are stepped over.
  function draftIds() {
    return Array.from(document.querySelectorAll('.block-card[data-draft="1"]'))
      .map(el => parseInt(el.dataset.blockId, 10))
      .filter(n => !isNaN(n));
  }

  function startReview() {
    const ids = draftIds();
    if (!ids.length) { showToast("No drafts to review"); return; }
    review = { ids: ids };
    openBlock(ids[0]);
  }

  function nextInReview(fromId) {
    if (!review) return null;
    const alive = draftIds();
    const i = review.ids.indexOf(fromId);
    if (i < 0) return null;
    for (let j = i + 1; j < review.ids.length; j++) {
      if (alive.indexOf(review.ids[j]) !== -1) return review.ids[j];
    }
    return null;
  }

  function updateReviewIndicator(dlg, id) {
    const el = dlg.querySelector(".review-pos");
    if (!el) return;
    if (!review || review.ids.indexOf(id) === -1) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = "Review " + (review.ids.indexOf(id) + 1) + " of " + review.ids.length;
  }

  function openBlock(id) {
    // Only one <dialog> can be modal at a time — close whatever is up (e.g. the
    // submit confirmation the user clicked "Fix" in).
    document.querySelectorAll("dialog[open]").forEach(d => d.close());
    const dlg = document.getElementById("edit-" + id);
    if (!dlg) return;
    selectedId = id;
    applySelection();
    dlg.showModal();
    updateReviewIndicator(dlg, id);

    // Land the cursor on whatever is actually missing: the ticket picker when
    // there's no ticket yet, otherwise the end of the description.
    const combo = dlg.querySelector(".ticket-combo");
    const trigger = combo && combo.querySelector(".ticket-combo-trigger");
    const ta = dlg.querySelector("textarea[name='description']");
    setTimeout(() => {
      if (combo && !combo.dataset.value && trigger) { trigger.focus(); return; }
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }, 30);
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
  // Re-paints the .selected ring from `selectedId` — called after every swap so
  // the ring doesn't vanish when the block list is replaced.
  function applySelection() {
    rows().forEach(r => {
      r.classList.toggle("selected", parseInt(r.dataset.blockId, 10) === selectedId);
    });
  }
  function stepSelection(dir) {
    const rs = rows();
    if (rs.length === 0) return;
    const curIdx = rs.findIndex(r => parseInt(r.dataset.blockId, 10) === selectedId);
    let nextIdx;
    if (curIdx === -1) nextIdx = dir > 0 ? 0 : rs.length - 1;
    else nextIdx = Math.max(0, Math.min(rs.length - 1, curIdx + dir));
    selectedId = parseInt(rs[nextIdx].dataset.blockId, 10);
    applySelection();
    rs[nextIdx].scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function editSelectedBlock() {
    const selected = document.querySelector(".block-row.selected") || draftableRows()[0];
    if (!selected) return;
    openBlock(parseInt(selected.dataset.blockId, 10));
  }

  // Click-to-select
  document.addEventListener("click", (e) => {
    const row = e.target.closest(".block-row");
    if (!row) return;
    // Ignore clicks on action buttons / delete form
    if (e.target.closest(".block-actions") || e.target.closest(".block-card-actions")) return;
    selectedId = parseInt(row.dataset.blockId, 10);
    applySelection();
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
  // Undoable toasts stay up for 8s — long enough to notice a mistaken delete and
  // take it back, which is why deletes no longer prompt for confirmation.
  function showToast(msg, undoable) {
    let wrap = document.querySelector(".toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div"); wrap.className = "toast-wrap";
      document.body.appendChild(wrap);
    }
    wrap.querySelectorAll(".toast").forEach(t => t.remove());

    const t = document.createElement("div");
    t.className = "toast";
    const label = document.createElement("span");
    label.textContent = msg;
    t.appendChild(label);

    if (undoable) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-undo";
      btn.innerHTML = 'Undo <span class="kbd">Ctrl Z</span>';
      btn.addEventListener("click", () => { t.remove(); undo(); });
      t.appendChild(btn);
    }

    wrap.appendChild(t);
    const ttl = undoable ? 8000 : 3000;
    setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, ttl);
  }

  // Server-driven toast: every mutation response carries a #toast-data payload
  // inside #day-live, so it arrives with the swap and is read exactly once.
  function consumeToast() {
    const el = document.getElementById("toast-data");
    if (!el) return;
    let data;
    try { data = JSON.parse(el.textContent || "{}"); } catch (e) { return; }
    el.remove();
    if (data.message) showToast(data.message, !!data.undoable);

    // Flash the row that was just saved, and bring a freshly created one into view.
    if (data.saved_id) {
      const card = document.getElementById("block-" + data.saved_id);
      if (card) {
        card.classList.add("just-saved");
        setTimeout(() => card.classList.remove("just-saved"), 1200);
      }
    }
    if (data.focus_id) {
      selectedId = data.focus_id;
      applySelection();
      const card = document.getElementById("block-" + data.focus_id);
      if (card) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
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

    // Ctrl/Cmd+Z: undo the last mutation. Skipped while typing so it stays the
    // browser's own text undo inside the description field.
    if (mod && e.key.toLowerCase() === "z" && !typing) {
      e.preventDefault();
      undo();
      return;
    }

    // Ctrl/Cmd+Enter: in the editor this is "Save & next"; elsewhere it opens the
    // submit confirmation.
    if (mod && e.key === "Enter") {
      e.preventDefault();
      if (openDialog) {
        const next = openDialog.querySelector(".btn-save-next");
        if (next) { next.click(); return; }
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
      case "r":
      case "R":         startReview(); return;
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
  function bulkRowChecks() { return Array.from(document.querySelectorAll(".bulk-row-check")); }
  function bulkCheckedIds() {
    return bulkRowChecks().filter(c => c.checked).map(c => c.value);
  }

  function updateBulkBar() {
    const bar = document.getElementById("bulk-bar");
    const nLabel = document.getElementById("bulk-bar-n");
    if (!bar || !nLabel) return;
    const checks = bulkRowChecks();
    const n = checks.filter(c => c.checked).length;
    nLabel.textContent = String(n);
    bar.hidden = n === 0;
    const selectAll = document.getElementById("bulk-select-all");
    if (selectAll) {
      selectAll.checked = n > 0 && n === checks.length;
      selectAll.indeterminate = n > 0 && n < checks.length;
    }
  }

  // The row checkboxes belong to #bulk-ticket-form, so the log action needs its
  // own copy of the selection.
  function submitBulkLog() {
    const ids = bulkCheckedIds();
    const form = document.getElementById("bulk-log-form");
    if (!form) return;
    if (!ids.length) { showToast("No blocks selected"); return; }
    form.querySelectorAll('input[name="block_ids"]').forEach(i => i.remove());
    ids.forEach(id => {
      const i = document.createElement("input");
      i.type = "hidden"; i.name = "block_ids"; i.value = id;
      form.appendChild(i);
    });
    form.requestSubmit();
  }

  function initBulkTicket() {
    const selectAll = document.getElementById("bulk-select-all");
    if (selectAll) {
      selectAll.addEventListener("change", () => {
        bulkRowChecks().forEach(c => { c.checked = selectAll.checked; });
        updateBulkBar();
      });
    }
    const clearBtn = document.getElementById("bulk-bar-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        bulkRowChecks().forEach(c => { c.checked = false; });
        updateBulkBar();
      });
    }
    updateBulkBar();
  }

  document.addEventListener("change", (e) => {
    if (e.target && e.target.classList && e.target.classList.contains("bulk-row-check")) updateBulkBar();
  });

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

    // Close any open combo when clicking outside. Bound once — the handler looks
    // combos up by selector, so it keeps working across swaps.
    if (!initTicketCombos.bound) {
      initTicketCombos.bound = true;
      document.addEventListener("click", (e) => {
        if (!e.target.closest(".ticket-combo")) closeAll(null);
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeAll(null);
      });
    }
  }

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
      // Belt and braces against a double-bind: two handlers would insert the
      // markdown twice per click.
      if (bar.dataset.tlBound) return;
      bar.dataset.tlBound = "1";
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

  // ---------------- v2 ribbon — zoom pills + drag-to-create ----------------
  function initRibbonV2() {
    const ribbon = document.getElementById("ribbon");
    const track = document.getElementById("ribbon-track");
    if (!ribbon || !track) return;
    // Belt and braces against a double-bind: two mousedown handlers on the same
    // handle would fire two drags, and so two retime POSTs.
    if (ribbon.dataset.tlBound) return;
    ribbon.dataset.tlBound = "1";

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

    // Wire zoom pills, then restore the zoom the user had picked — the ribbon is
    // re-rendered on every save and would otherwise snap back to 12h.
    document.querySelectorAll(".zoom-pill").forEach(btn => {
      btn.addEventListener("click", () => {
        ribbonZoom = btn.dataset.zoom;
        selectZoom(btn.dataset.zoom);
      });
    });

    function selectZoom(name) {
      let picked = null;
      document.querySelectorAll(".zoom-pill").forEach(b => {
        const on = b.dataset.zoom === name;
        b.classList.toggle("active", on);
        if (on) picked = b;
      });
      if (!picked) return;
      const s = parseInt(picked.dataset.startMin, 10);
      const e = parseInt(picked.dataset.endMin, 10);
      if (!isNaN(s) && !isNaN(e)) applyZoom(s, e);
    }

    if (ribbonZoom && ribbonZoom !== "day") selectZoom(ribbonZoom);

    const ghost = document.getElementById("ribbon-ghost");
    const form = document.getElementById("ribbon-drag-form");

    function trackXToMin(clientX) {
      const r = track.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      return windowStart + pct * windowSpan();
    }
    function snap5(m) { return Math.round(m / 5) * 5; }
    function minToPct(m) { return ((m - windowStart) / windowSpan()) * 100; }

    // Both drags below attach their move/up listeners on mousedown and drop them
    // on mouseup. initRibbonV2 re-runs after every swap, so listeners that lived
    // for the page's lifetime would pile up one copy per save.
    function onDrag(move, done) {
      function up(e) {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        document.removeEventListener("keydown", esc);
        done(e, false);
      }
      function esc(e) {
        if (e.key !== "Escape") return;
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        document.removeEventListener("keydown", esc);
        done(e, true);
      }
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      document.addEventListener("keydown", esc);
    }

    // ---- Edge drag: retime an existing draft by pulling its start or end ----
    // The bar follows the cursor locally; only the mouseup commits, so a stray
    // drag costs nothing and a committed one is a single undoable POST.
    ribbon.querySelectorAll(".draft-handle").forEach(handle => {
      handle.addEventListener("mousedown", (e) => {
        const bar = handle.closest(".draft-bar");
        if (!bar || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const origStart = hmToMin(bar.dataset.startHm);
        const origEnd = hmToMin(bar.dataset.endHm);
        if (isNaN(origStart) || isNaN(origEnd)) return;
        const which = handle.dataset.edge;
        let startMin = origStart, endMin = origEnd;
        ribbon.classList.add("is-dragging");

        function paint() {
          const range = clampPctRange(startMin, endMin);
          if (!range) return;
          bar.style.left = range.left + "%";
          bar.style.width = range.width + "%";
          bar.dataset.startHm = minToHm(startMin);
          bar.dataset.endHm = minToHm(endMin);
        }
        onDrag(
          (ev) => {
            const m = snap5(trackXToMin(ev.clientX));
            if (which === "start") {
              if (m < endMin - 5) { startMin = m; paint(); }
            } else if (m > startMin + 5) {
              endMin = m; paint();
            }
          },
          (ev, cancelled) => {
            ribbon.classList.remove("is-dragging");
            if (cancelled) { startMin = origStart; endMin = origEnd; paint(); return; }
            if (startMin === origStart && endMin === origEnd) return;
            livePost("/block/" + bar.dataset.blockId + "/retime", {
              ds: currentDate(),
              start: minToHm(startMin),
              end: minToHm(endMin),
            });
          }
        );
      });
    });

    // Double-click a bar to open its editor.
    ribbon.querySelectorAll(".draft-bar:not(.submitted)").forEach(bar => {
      bar.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        const id = parseInt(bar.dataset.blockId, 10);
        if (!isNaN(id)) openBlock(id);
      });
    });

    // ---- Drag-to-create: sweep empty track, release to draft a block ----
    track.addEventListener("mousedown", (e) => {
      // Don't start a drag on top of an existing segment/draft/marker.
      if (e.target !== track) return;
      if (e.button !== 0) return;
      e.preventDefault();
      const from = trackXToMin(e.clientX);
      let to = from;
      ribbon.classList.add("is-dragging");
      ghost.hidden = false;
      ghost.style.left = minToPct(from) + "%";
      ghost.style.width = "0%";

      onDrag(
        (ev) => {
          to = trackXToMin(ev.clientX);
          const a = Math.min(to, from), b = Math.max(to, from);
          ghost.style.left = minToPct(a) + "%";
          ghost.style.width = Math.max(0, minToPct(b) - minToPct(a)) + "%";
        },
        (ev, cancelled) => {
          ribbon.classList.remove("is-dragging");
          ghost.hidden = true;
          if (cancelled || !form) return;
          const a = snap5(Math.min(to, from)), b = snap5(Math.max(to, from));
          if (b - a < 10) return;  // ignore short drags
          form.querySelector('input[name="start"]').value = minToHm(a);
          form.querySelector('input[name="end"]').value = minToHm(b);
          form.requestSubmit();     // requestSubmit (not submit) so htmx intercepts
        }
      );
    });
  }

  // ---------------- v2 live clock (topbar) ----------------
  // The header isn't a live region, so this only needs setting up once.
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

  // ---------------- Per-render wiring ----------------
  // Everything that binds to elements inside a live region. Runs on load and
  // again after each htmx swap.
  function initDynamic() {
    initBulkTicket();
    initTicketsBrowser();
    initTicketCombos();
    initMarkdownToolbars();
    initRibbonV2();
    applySelection();

    // Leaving the editor by Esc or Cancel ends the review session; leaving it by
    // saving does not (the dialog is destroyed by the swap, so no close event).
    // Scoped to block editors — the submit and tickets dialogs share the class
    // and closing one of those shouldn't end a review.
    document.querySelectorAll(".edit-dialog[data-block-id]").forEach(dlg => {
      dlg.addEventListener("close", () => {
        if (advanceFrom === null) review = null;
      });
    });
  }

  // Delegated actions on elements that live inside swapped regions.
  document.addEventListener("click", (e) => {
    const saveNext = e.target.closest(".btn-save-next");
    if (saveNext) {
      // Record where to resume; the form submit continues normally and the
      // afterSettle handler opens the next draft.
      const dlg = saveNext.closest("dialog");
      const id = dlg ? parseInt(dlg.dataset.blockId, 10) : NaN;
      if (!isNaN(id)) {
        if (!review) review = { ids: draftIds() };
        advanceFrom = id;
      }
      return;
    }
    if (e.target.closest("#bulk-bar-log")) { submitBulkLog(); return; }
  });

  // ---------------- htmx lifecycle ----------------
  document.addEventListener("htmx:beforeRequest", () => {
    savedScrollY = window.scrollY;
  });

  function onSettled() {
    // Replacing #day-live can change the document height enough to shift the
    // viewport; put it back so a save really is invisible.
    if (savedScrollY !== null) {
      window.scrollTo(0, savedScrollY);
      savedScrollY = null;
    }
    initDynamic();
    consumeToast();

    if (advanceFrom !== null) {
      const from = advanceFrom;
      advanceFrom = null;
      const next = nextInReview(from);
      if (next !== null) {
        openBlock(next);
      } else if (review) {
        review = null;
        showToast("That was the last draft");
      }
    }
  }

  // htmx fires afterSettle once per swapped element, and one mutation swaps five
  // regions — so coalesce into a single run per frame. Without this, initDynamic
  // would bind the markdown toolbars and ribbon drag handlers five times over and
  // every click would fire that many actions.
  let settleQueued = false;
  document.addEventListener("htmx:afterSettle", () => {
    if (settleQueued) return;
    settleQueued = true;
    requestAnimationFrame(() => { settleQueued = false; onSettled(); });
  });

  initLiveClock();
  initDynamic();
  consumeToast();

  // Export a tiny API for inline onclick handlers
  window.TL = {
    toggleTheme,
    openCmdk,
    openSubmitConfirm,
    openBlock,
    startReview,
    undo,
    appendDesc,
  };
  window.appendDesc = appendDesc; // legacy inline reference
})();
