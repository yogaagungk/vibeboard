# Changelog

All notable changes to this project will be documented in this file.

## [0.2.1] - 2026-05-29

### Security
- Workspace path validation: `create_workspace` and `set_workspace` reject
  obvious foot-guns (filesystem root, the home directory itself, system dirs
  like `/etc`, `C:\Windows`, `/System`) and non-existent paths. Cross-platform
  via `os.homedir()` + per-OS denylist; case-insensitive on Windows/macOS.
- Spawn-dir verification: right before `spawn()`, the agent's working
  directory is re-checked. Symlinks are refused; worktree paths must resolve
  inside the workspace root. Catches deleted workspaces, symlink swaps, and
  worktrees that escaped their root.
- Prompt-injection hardening: card title, description, tags, priority,
  due date, branch, and custom prompt are sanitized (ANSI escapes, ASCII
  control chars, zero-width and bidi-override characters stripped) and
  wrapped in a clearly delimited `<card-data>` block. The system context
  tells the agent to treat everything inside as untrusted task data, never
  as instructions. Literal `</card-data>` strings inside user content are
  HTML-encoded so they cannot close the wrapper.

### Changed
- MCP-created cards now default to `requires_review = false`, matching the
  new-card UI dialog. Pass `requires_review: true` explicitly to opt in.

## [0.2.0] - 2026-05-29

### Security
- CSRF protection on board mutations (cross-site Origin / spoofed Host requests
  return 403). Network mode also adds a kill-switch endpoint to stop running
  agents.

### Added
- Linear-inspired design system: lavender-blue accent, four-step surface
  ladder, hairline borders, negative-tracked display type. Documented in
  `DESIGN.md`.
- Radius scale tokens (`--radius-xs/sm/md/lg/xl/pill`), `--surface-4`,
  `--text-strong`, and `--accent-focus` for tighter alignment with Linear.
- In-app version badge that polls the npm registry and lights up when an
  upgrade is available.
- Collapsible left rail; refreshed dropdowns, card sidebar, agent log.
- Single source of truth for the running version: `mcp-server/config.js` now
  reads `version` from `package.json`, so future bumps only happen in one place.

### Fixed
- Themed dropdowns (`vbSelect`) no longer close when the user scrolls inside
  the popup, so long agent / model lists are usable in the new-card dialog and
  card sidebar.
- Stripped stray glyphs and em dashes from the UI copy and README; brand mark
  in the app header is plain text.

## [0.1.0] - 2026-05-29

### Security
- Server now binds to `127.0.0.1` by default; network exposure is opt-in via
  `VB_HOST=0.0.0.0` and is gated by a shared token (`VB_TOKEN`), with a warning.
  Closes unauthenticated LAN RCE.
- Validate the `model` parameter and run `git`/`gh` via argument arrays (no shell)
  to close command-injection vectors via model values, card titles, and branches.

### Fixed
- Agent spawn/stop is routed to the HTTP-server process, so agents triggered via
  MCP (in the separate MCP-only process) now save their output note and clear
  their timeout instead of leaking.
- `requires_review` now defaults consistently (ON) however a card is created.
- `move_card` spawns the assigned agent on moves to In Progress **and** Review,
  matching the UI.
- Orphaned git worktrees are cleaned up on card/workspace delete.
- Search "Clear" button and result count now appear while filtering.
- Card notes/checkpoints refresh live while an agent is running.

### Added
- Per-column WIP limits — double-click a column count to set one (enforced in UI + `move_card`).
- Card dependencies (`blocked_by`) — dropdown picker; blocks moving to In Progress until blockers reach Done.
- Concurrency cap with an automatic agent queue (`VB_MAX_AGENTS`).
- Run visibility: per-card exit status, duration, and best-effort cost/token usage.
- Per-card model selection; Codex CLI selectable; refreshed Claude model list.
- Stop agent button in the card sidebar (`POST /api/cards/:id/stop`).
- Kanban board with Backlog, In Progress, Review, and Done columns
- AI agent integration: auto-spawn Claude Code, OpenCode, or Codex when cards move to In Progress
- Per-card agent assignment and "Needs review" toggle
- Git worktree isolation per card (optional, per workspace)
- Real-time SSE updates across all browser tabs
- SQLite storage in OS user data directory (Windows / macOS)
- Multiple workspace support with per-workspace project directory
- MCP server with bidirectional board control for agents
- Agent progress notes and activity log
- Diff viewer and Merge / Create PR actions for worktree branches
- Native folder picker (PowerShell on Windows, osascript on macOS)
- MCP auto-configuration for Claude Code, OpenCode, and Codex CLI
- Dark mode support (follows system preference)
- Card search/filter
- Agent output saved as card note on completion
- Agent timeout (default 30 min, configurable via `AGENT_TIMEOUT_MS`)
- Agent log capped at 500 rows per workspace
- Startup cleanup of orphaned git worktrees
- SSE reconnect auto-refresh

### Notes
- Requires Node.js 18+
- Windows and macOS supported
- No build step — plain HTML/CSS/JS UI served as static files
