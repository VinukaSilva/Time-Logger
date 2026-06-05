# Time Logger

Automated daily time logging from your local machine activity (active window, idle, git commits, Claude Code sessions). Review your day in a web UI, edit blocks, then push worklogs to Jira and append them to a weekly Google Sheet.

**Windows-only for v1.** Mac and Linux support is planned.

## What it does

- **Collector tray** silently samples your active window, idle time, and git activity in the background.
- **Web UI** at `http://127.0.0.1:5000` lets you review the day as a timeline, edit time blocks, and submit them.
- **Auto-seed** turns detected activity into draft blocks with summaries built from commits + Claude Code sessions + window titles. Optional LLM polish rewrites them as MR-style notes.
- **One-click submit** pushes each block to Jira as a worklog (with full markdown formatting) and appends to a weekly Google Sheet.

## Requirements

- Windows 10/11
- Python 3.11+
- A Jira Cloud account with API token access
- (Optional) A Google account if you want the weekly Sheet integration
- (Optional) An LLM provider (Claude Code CLI, Gemini free-tier key, or Anthropic API key) for description polish

## Quick setup

```bat
git clone https://github.com/VinukaSilva/Time-Logger.git
cd Time-Logger
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python run_setup.py
```

The setup wizard walks you through everything interactively:

1. **Git identity** — auto-detected from your global `git config`, confirms which email(s) should be counted as "yours" when mining commit history.
2. **Tracked git repositories** — point the wizard at any parent folder and it discovers git repos under it (up to 3 levels deep). Pick which to track and give each one a label.
3. **Atlassian Jira** — base URL, email, and an API token from <https://id.atlassian.com/manage-profile/security/api-tokens>. The wizard validates the token by calling `/myself`.
4. **LLM description polish (optional)** — pick `claude_code` (uses your local `claude` CLI, no key), `anthropic` (paste a key from <https://console.anthropic.com>), `gemini` (paste a free-tier key from <https://aistudio.google.com/app/apikey>), or `off`.
5. **Google Sheets weekly log (optional)** — point at an OAuth client JSON if you want each submitted worklog appended to a weekly spreadsheet, or skip.

The wizard writes `config.yaml` + `.env` atomically. It's safe to re-run any time — each step proposes your current value as the default.

**Prefer to edit by hand?** Copy the templates instead:

```bat
copy config.example.yaml config.yaml
copy .env.example .env
```

Then open both files and fill in your values; comments in `config.example.yaml` document every field.

## Running

Two processes — the collector (background sampler) and the web UI (review screen):

```bat
python run_collector.py    :: tray icon — keeps running, samples activity
python run_web.py          :: web UI on http://127.0.0.1:5000
```

The collector should run continuously. Drop a shortcut to it in your Startup folder (`Win+R` → `shell:startup`) to auto-start at login.

The web UI is what you open whenever you want to review/submit your day.

## Daily flow

1. Tray collector runs in the background while you work.
2. End of day: open the web UI, hit **Auto-seed from work**.
3. The timeline ribbon shows what was detected; the block list shows draft worklog entries with auto-generated descriptions.
4. Edit any block: change ticket, tweak the markdown description (bullets, bold, code, etc.).
5. Click **Submit**. Each draft block becomes a Jira worklog + a row in the weekly Sheet.

## Configuration reference

The two config files:

- **`config.yaml`** — repos, Jira instance, LLM provider, collector tuning. See `config.example.yaml` for every field with comments.
- **`.env`** — secrets (Jira token, LLM API keys). Never commit this. See `.env.example` for the template.

Both files live in the project folder by default, alongside `db/`, `logs/`, and `secrets/`. If you'd rather store personal data outside the repo (e.g. so re-cloning doesn't move it), set `TIMELOGGER_HOME=<absolute path>` in your environment and the loader will look there instead. Both files and the relative paths in `config.yaml` resolve against that directory.

Key config sections:

| Section | What it controls |
|---|---|
| `repos` | Which git repos are tracked for commit activity |
| `projects` | Custom (non-repo) project rules for browser/email work |
| `collector.excluded_processes` | Apps to ignore (e.g. media players) |
| `llm.provider` | `claude_code` / `anthropic` / `gemini` / `off` — controls description polish |
| `git.author_emails` | Only count commits authored by these emails |
| `jira.extra_jql` | Pull additional tickets beyond "assigned to me" (e.g. management tasks) |
| `sheets.sheet_id` | Set by the setup wizard on first run |

## LLM description polish

`Auto-seed from work` can optionally rewrite each block's description using an LLM. Three providers are supported:

- **`claude_code`** (default if you have Claude Code installed): shells out to your local `claude` CLI. Uses your existing subscription, no API key. ~3–6s per block.
- **`anthropic`**: HTTPS to the Messages API. Needs `ANTHROPIC_API_KEY`. Fastest. Metered ~$0.005/block on Haiku 4.5.
- **`gemini`**: Google AI Studio free tier. Needs `GEMINI_API_KEY`. Rate-limited (15 RPM, ~20 RPD on new accounts).

The Jira worklog comment supports full markdown (bullets, bold, headings, code blocks, links, emojis) — what you type in the editor is what shows up in Jira.

## Troubleshooting

- **Tray icon not appearing**: make sure `run_collector.py` is actually running. Check `logs/collector.log`.
- **Jira 403 on submit**: API token may be expired. Regenerate at https://id.atlassian.com/manage-profile/security/api-tokens.
- **`bulk-bar` / dropdowns broken after pulling new changes**: hard-reload the browser (`Ctrl+Shift+R`) — static files are cached.
- **Tickets not showing**: tickets cache refreshes every 15 minutes automatically; force a refresh with the "Refresh tickets" button in the rail.
- **LLM polish "AI polish: NOT RUN"**: no segment had a tracked git repo. Add the repo to `config.yaml` or accept the structured fallback.

## License

MIT. See [LICENSE](LICENSE).

## Status

This is an early-stage project. Expect rough edges. Issues and PRs welcome.
