# VibeBoard — Agent Context

## What is this project

VibeBoard is a self-hostable open source kanban board built for developers who work with AI coding agents.

**Core concept**: When you move a card with an assigned agent to "In Progress", VibeBoard automatically spawns that agent (Claude Code, OpenCode, Codex, or Command Code) in your project directory. The agent can then use MCP tools to add progress notes, move cards, and mark tasks complete.

**Bidirectional MCP**: Both the human (via UI) and the agent (via MCP) can control the same board in real-time.

## Project structure

```
vibeboard/
├── mcp-server/
│   ├── index.js        ← Bootstrap: migrate, prune, wire modules, listen
│   ├── config.js       ← PORT / HOST / PUBLIC_DIR / VERSION
│   ├── events.js       ← SSE client registry + emitSSE (proxy in MCP-only mode)
│   ├── auth.js         ← Network-mode token middleware
│   ├── http-routes.js  ← registerRoutes(app): all REST + SSE endpoints
│   ├── mcp-tools.js    ← registerMcpTools(mcp): all MCP tool definitions
│   ├── mcp-config.js   ← Per-agent MCP config discovery / write
│   ├── agent-routing.js← routeSpawn/Stop + dependency (blocked_by) checks
│   ├── agent.js        ← Agent spawning, queue, lifecycle, usage parsing
│   ├── worktree.js     ← Git worktree create/merge/PR helpers
│   ├── models.js       ← Per-agent model lists
│   ├── db.js           ← SQLite database layer (cross-platform)
│   └── migrate.js      ← Legacy JSON to SQLite migration
├── public/
│   ├── index.html      ← Kanban UI markup (no inline JS/CSS)
│   ├── styles.css      ← UI styles
│   └── js/             ← UI logic as ordered classic scripts (no bundler)
│       ├── bootstrap.js, workspaces.js, board.js, realtime.js,
│       └── shortcuts-io.js, md-render.js, datepicker.js, card-sidebar.js,
│           dialogs.js, app.js
├── .claude/
│   └── mcp.json        ← MCP config for Claude Code
├── README.md           ← User documentation
├── CONTRIBUTING.md     ← Contributor guidelines
└── AGENTS.md           ← This file (agent context)
```

## How the system works

**Data storage**: SQLite database in OS user data directory
- Windows: `%APPDATA%\vibeboard\vibeboard.db`
- macOS: `~/Library/Application Support/vibeboard/vibeboard.db`

**UI assets**: `index.html` loads `styles.css` and the `js/*.js` files as ordered
classic `<script src>` tags (served by `express.static`). They share one global
scope and run in load order — no bundler, no build step, no ES-module imports.
Load order matters: `bootstrap.js` first (it patches `fetch` for the network
token), `app.js` last (it calls `init()`).

**Server architecture**: Single Node.js process (entry `mcp-server/index.js`) handles:
1. **MCP stdio transport** → Agents call tools (get_board, create_card, move_card, add_card_note, etc.)
2. **Express HTTP server** → Serves UI, REST endpoints
3. **SSE stream** → Real-time updates to UI when agents make changes
4. **Agent spawning** → When cards move to "In Progress", spawns assigned agent

**UI**: Single HTML file connects to:
- `GET /board` → Initial board state
- `POST /board` → Write board mutations from UI
- `GET /events` → SSE stream for live updates
- `GET /api/cards/:id/notes` → Fetch card notes/checkpoints
- `GET /api/folder-dialog` → Native folder picker (PowerShell on Windows, osascript on macOS)

## MCP tools available to agents

**Reading your task — start here:**
get_card           → full card details incl. untruncated description (params: cardId) ← use this first
get_card_notes     → progress notes for a card; output dumps excluded by default (params: cardId, includeOutput?)

**Board navigation — prefer these over get_board:**
get_column         → slim card list for a specific column (params: columnTitle, workspaceId?)
list_cards         → slim card list with filters (params: columnTitle?, tag?, agent?, workspaceId?, limit?, offset?)
search_cards       → slim card list by text/tag/column/agent (params: query?, tag?, columnTitle?, agent?, workspaceId?, limit?, offset?)
get_board          → board state; log excluded by default (params: workspaceId?, columnsOnly?, columnTitle?, compact?, includeLogs?)

**Board mutations:**
move_card          → move a card between columns (params: cardId, toColumnTitle)
complete_card      → move a card to Done (params: cardId)
add_card_note      → add a progress note/checkpoint (params: cardId, content)
create_card        → add a card (params: title, workspaceId?, columnTitle?, tags?, description?, agent?, model?, priority?, due_date?, blocked_by?)
update_card        → update card fields (params: cardId, title?, description?, tags?, agent?, model?, priority?, due_date?, blocked_by?, requires_review?, custom_prompt?, merged_at?)
delete_card        → remove a card (params: cardId)

**Workspaces:**
list_workspaces    → list all workspaces
create_workspace   → create a new workspace (params: name, path, description?)
switch_workspace   → switch to a different workspace (params: workspaceId)
set_workspace      → update workspace description (params: workspaceId, description) — name/path via UI only
delete_workspace   → delete a workspace (params: workspaceId, confirm: true)

**Agents & models:**
get_agent_status   → running/queued status + last note for a card (params: cardId)
cancel_agent       → cancel a queued or running agent (params: cardId)
list_models        → available models per agent type (params: agent?)
refresh_models     → refresh model cache from each agent CLI (no params)

**Templates:**
list_templates     → list card templates for a workspace (params: workspaceId?)
create_template    → create a reusable card template (params: name, workspaceId?, title_pattern?, tags?, agent?, model?, priority?, custom_prompt?)

## Agent spawning system

When a card is moved TO "In Progress" (via move_card or the UI):
- If the card has an assigned agent (claude-code, opencode, codex, or command-code)
- A 1.5 s debounce fires — moving the card back within that window cancels the spawn
- VibeBoard spawns that agent as a child process in the workspace directory
- The agent receives a prompt containing: workspace description, full card data (description capped at 2 000 chars), phase instructions, any prior session notes (last 5 short notes from previous runs), and board API guidance
- SSE emits event type "agent_started" with the card context
- UI shows a toast: "⚡ Agent triggered: [card title]"
- Agent can call add_card_note to log progress
- When agent exits, notes are saved and SSE emits "agent_completed"

**Agent-specific details**:
- **Claude Code**: Binary `claude`, prompt via stdin
- **OpenCode**: Binary `opencode`, prompt via stdin
- **Codex**: Binary `codex`, prompt via stdin
- **Command Code**: Binary `command-code`, prompt via stdin to `-p` mode, uses `--yolo --skip-onboarding` flags; board updates via REST API (MCP not loaded in `-p` mode)

Constraints enforced on the move into "In Progress":
- **WIP limit** — a column with a `wip_limit` rejects moves once full (UI + move_card).
- **Dependencies** — a card with unfinished `blocked_by` cards (blockers not yet in
  Done) cannot move to In Progress (UI buttons/drag disabled; move_card errors).
- **Concurrency cap** — at most `VB_MAX_AGENTS` (default 3) agents run at once;
  excess spawn requests are queued (SSE "agent_queued") and started automatically
  as slots free up ("agent_dequeued").

On exit, the card records `last_exit_code`, `last_duration`, and best-effort
`last_cost`/`last_tokens` (scraped from session output), surfaced as a badge on the
card. These are agent-written and are never overwritten by a UI board sync.

## Workspace system

Each workspace is an independent kanban board linked to a project directory.
Users can create multiple workspaces and switch between them.
The active workspace is stored in the database settings table.

## Agent log

Every tool call that mutates the board appends to the agent_log table:
{ id, workspace_id, timestamp, agent, action, detail }

The UI shows this as a live collapsible sidebar.

## How to run

npm install
npm start
# open http://localhost:7341

## How to connect agents to the MCP server

Use the in-app **MCP Setup** dialog to auto-configure Claude Code, OpenCode, or
Codex, or wire them up manually:
- **Claude Code**: `claude mcp add -s user vibeboard -- node <path>/mcp-server/index.js`
  (the repo's `.claude/mcp.json` is also auto-detected)
- **Codex**: add a `vibeboard` entry under `mcpServers` in `~/.codex/config.json`
  (`command: node`, `args: [<path>/mcp-server/index.js]`)

## How to connect OpenCode

Add to your OpenCode config:
{
  "mcp": {
    "vibeboard": {
      "type": "local",
      "command": ["node", "./mcp-server/index.js"]
    }
  }
}

## Branch strategy

- **`develop`** is the active development branch. All work happens here or in feature branches cut from it.
- **`main`** is protected. Never commit directly to `main`. Never push directly to `main`.
- Merge path: `feature/* → develop` (PR) → `main` (PR, release only).
- When working on a task, commit to `develop` (or a feature branch). Submit changes via PR — do not push to `main` under any circumstances.

## Key rules for agents working in this repo

1. SQLite database is the source of truth — always call get_board first before mutating
2. Use move_card to signal task status, not just create_card
3. Use add_card_note to log progress and checkpoints as you work
4. Log to stderr only — stdout is reserved for MCP stdio protocol
5. UI = plain HTML + CSS + ordered classic scripts. No bundler, no build step,
   no ES-module imports. New UI logic goes in an existing `public/js/*.js` file
   (or a new one added to the ordered `<script src>` list, respecting load order).
6. Server and UI stay separate: never inline JS/CSS back into index.html, and
   never add a build/transpile step to either side.
7. If you need to run the server to verify your changes, use a different port:
   `PORT=7342 npm start`. The default port 7341 is already in use by the live
   instance managing your session — binding to it will cause a conflict.
8. Always work on `develop` or a feature branch. Never commit or push directly to `main`.

## Tech decisions (do not change without discussion)

- **SQLite database** — stored in OS user data directory (Windows: `%APPDATA%`, macOS: `~/Library/Application Support`)
- **No bundler / no build step** — UI ships as static `index.html` + `styles.css`
  + ordered `public/js/*.js` classic scripts served by `express.static`; the
  server is plain CommonJS modules. Nothing is transpiled or bundled.
- **No auth** — this is a local tool, not a SaaS
- **stdio transport** — not HTTP MCP, because it works without a running server
- **Node.js only** — no Bun, no Deno, keeps the runtime consistent across contributors
- **Vanilla JS** — no React/Vue/Svelte, keep the UI simple and dependency-free

## Open Source & NPM

This project is:
- Open source (MIT license)
- Published to npm as `@zanuartri/vibeboard` (CLI command: `vibeboard`)
- Accepting contributions (see CONTRIBUTING.md)
- Self-hostable with no cloud dependencies

When contributing, ensure:
- Windows and macOS compatibility
- No breaking changes to MCP tool signatures
- Backward compatibility with existing workspaces
- Clear documentation for new features

