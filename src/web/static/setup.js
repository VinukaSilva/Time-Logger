// Time Logger — setup-page client glue
// Handles: AJAX repo discovery, AJAX Jira test, dynamic LLM/Sheets field visibility.

(function () {
  "use strict";

  // ---------------- LLM provider conditional fields ----------------
  const providerSel = document.getElementById("llm_provider");
  const anthropicField = document.querySelector(".llm-anthropic");
  const geminiField = document.querySelector(".llm-gemini");

  function syncLlmFields() {
    if (!providerSel) return;
    const v = providerSel.value;
    if (anthropicField) anthropicField.hidden = (v !== "anthropic");
    if (geminiField) geminiField.hidden = (v !== "gemini");
  }
  if (providerSel) {
    providerSel.addEventListener("change", syncLlmFields);
    syncLlmFields();
  }

  // ---------------- Sheets conditional field ----------------
  const sheetsCheckbox = document.getElementById("sheets_enabled");
  const sheetsField = document.querySelector(".sheets-conditional");

  function syncSheetsField() {
    if (sheetsField) sheetsField.hidden = !sheetsCheckbox.checked;
  }
  if (sheetsCheckbox) {
    sheetsCheckbox.addEventListener("change", syncSheetsField);
    syncSheetsField();
  }

  // ---------------- Repo discovery (AJAX) ----------------
  const probeInput = document.getElementById("probe-parent");
  const probeBtn = document.getElementById("probe-btn");
  const probeStatus = document.getElementById("probe-status");
  const repoList = document.getElementById("repo-list");

  function escHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }

  function addRepoRow({ path, label, checked = true }) {
    const row = document.createElement("div");
    row.className = "repo-row";
    row.innerHTML =
      '<label style="display:flex;align-items:center;justify-content:center"><input type="checkbox" class="repo-check" ' + (checked ? "checked" : "") + '></label>' +
      '<span class="repo-path" title="' + escHtml(path) + '">' + escHtml(path) + '</span>' +
      '<input type="text" class="repo-label-input" value="' + escHtml(label) + '" placeholder="Label">';
    // Hidden inputs that will be picked up by the form submit.
    const hiddenPath = document.createElement("input");
    hiddenPath.type = "hidden";
    hiddenPath.name = "repo_paths";
    hiddenPath.value = path;
    const hiddenLabel = document.createElement("input");
    hiddenLabel.type = "hidden";
    hiddenLabel.name = "repo_labels";
    hiddenLabel.value = label;
    row.appendChild(hiddenPath);
    row.appendChild(hiddenLabel);

    // Keep hidden inputs in sync with checkbox + label
    const check = row.querySelector(".repo-check");
    const labelInput = row.querySelector(".repo-label-input");
    function sync() {
      // If unchecked, blank out the path so the server skips it.
      hiddenPath.value = check.checked ? path : "";
      hiddenLabel.value = labelInput.value;
    }
    check.addEventListener("change", sync);
    labelInput.addEventListener("input", sync);

    repoList.appendChild(row);
  }

  async function probeRepos() {
    const parent = (probeInput.value || "").trim();
    if (!parent) {
      probeStatus.textContent = "Enter a path first.";
      return;
    }
    probeStatus.textContent = "Scanning…";
    try {
      const r = await fetch("/setup/probe-repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        probeStatus.innerHTML = '<span class="test-fail">' + escHtml(data.error || ("HTTP " + r.status)) + '</span>';
        return;
      }
      if (!data.repos || data.repos.length === 0) {
        probeStatus.innerHTML = '<span class="test-fail">No git repos found under that path.</span>';
        return;
      }
      // Avoid duplicating repos that are already in the list.
      const existing = new Set(Array.from(repoList.querySelectorAll(".repo-path")).map(e => e.title));
      let added = 0;
      data.repos.forEach(r => {
        if (existing.has(r.path)) return;
        addRepoRow(r);
        added++;
      });
      probeStatus.innerHTML = '<span class="test-ok">Found ' + data.repos.length + ' repo(s); added ' + added + '.</span>';
      probeInput.value = "";
    } catch (e) {
      probeStatus.innerHTML = '<span class="test-fail">' + escHtml(String(e)) + '</span>';
    }
  }
  if (probeBtn) probeBtn.addEventListener("click", probeRepos);
  if (probeInput) probeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); probeRepos(); }
  });

  // ---------------- Jira test (AJAX) ----------------
  const testBtn = document.getElementById("test-jira-btn");
  const testStatus = document.getElementById("test-jira-status");

  async function testJira() {
    const base = document.querySelector('[name="jira_base_url"]').value.trim();
    const email = document.querySelector('[name="jira_email"]').value.trim();
    const token = document.querySelector('[name="jira_token"]').value.trim();
    if (!base || !email || !token) {
      testStatus.innerHTML = '<span class="test-fail">Fill in base URL, email, and token first.</span>';
      return;
    }
    testStatus.textContent = "Testing…";
    try {
      const r = await fetch("/setup/test-jira", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: base, email, token }),
      });
      const data = await r.json();
      if (data.ok) {
        testStatus.innerHTML = '<span class="test-ok">✓ Connected as ' + escHtml(data.display_name) + ' (' + escHtml(data.email) + ')</span>';
      } else if (data.status) {
        testStatus.innerHTML = '<span class="test-fail">Jira returned ' + data.status + ': ' + escHtml((data.detail || "").substring(0, 120)) + '</span>';
      } else {
        testStatus.innerHTML = '<span class="test-fail">' + escHtml(data.detail || "Unknown error") + '</span>';
      }
    } catch (e) {
      testStatus.innerHTML = '<span class="test-fail">' + escHtml(String(e)) + '</span>';
    }
  }
  if (testBtn) testBtn.addEventListener("click", testJira);
})();
