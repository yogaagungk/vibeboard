# Changelog

All notable changes to this project will be documented in this file.

## [0.2.7] - 2026-05-30

### Added
- **Discard changes button** — Done cards with an unmerged branch now show a "Discard changes" danger button alongside the merge button; confirming deletes the worktree, removes the local branch, and clears the branch reference on the card.
- **Expand diff dialog** — a ⛶ expand button on the diff view opens the full diff in a wide (80 vw, max 900 px) centered dialog with monospace font and horizontal scroll for long lines.
- **Theme icons in settings modal** — System / Light / Dark theme buttons now include inline SVG icons (monitor / sun / moon) for faster scanning.

### Changed
- **Details tab redesigned** — flat layout replaces the bordered "DETAILS" box; all fields (Tags, Priority, Due Date, Blocked by) are now inline label + control rows with thin dividers, matching a clean sidebar aesthetic.
- **Agent tab redesigned** — same flat label treatment: Agent selector, Model picker, Running+Stop buttons (now side by side), and Additional Instructions all converted to compact inline rows. Agent Prompt is collapsed by default with a Show/Hide toggle.
- **New card modal redesigned** — Tags, Priority, Due Date, Blocked by, and Agent fields updated to match the flat inline label style introduced in the Details and Agent tab redesigns.
- **Settings button flattened** — sidebar bottom Settings button no longer has a border/box; renders as a flat hover row consistent with workspace list items above it.
- **Notes & Checkpoints collapsed by default** — each note shows timestamp + first-line preview; click to expand. Most recent note starts expanded. Reduces visual clutter when agents write many checkpoints.
- **Agent prompt collapsed by default** — the prompt textarea in the Agent tab is hidden by default; a Show/Hide toggle reveals it when needed.

### Fixed
- **ANSI escape codes stripped from full output** — terminal color/formatting sequences (e.g. `\x1b[0m`, `\x1b[90m`) are now sanitized before display; previously rendered as garbage characters.
- **Card sidebar refreshes when column changes via SSE** — the merge button and move actions now update in place when an agent moves the open card to Done; previously required closing and reopening the sidebar.

## [0.2.6] - 2026-05-30

### Added
- **SVG favicon** — kanban columns icon displayed in browser tab; scales perfectly at any size.
- **"need merge" badge on Done cards** — cards in the Done column with an unmerged branch show a red "need merge" pill (mirrors the green "merged" badge) so unmerged work is visible at a glance.
- **`search_cards` MCP tool** — agents can now query cards server-side by title/description, tag, column, or agent without fetching the full board; also exposes `GET /api/cards/search`.
- **`delete_workspace` MCP tool** — agents can delete workspaces programmatically (requires `confirm: true`; blocked if only one workspace remains).
- **Cascade delete for workspaces** — deleting a workspace now atomically removes all its cards, notes, and agent log entries in a single SQLite transaction; no more orphaned rows.
- **Cyclic dependency detection** — adding a `blocked_by` relation that would create a cycle (A → B → A) is now rejected in the UI, REST API, and MCP with a clear error message.

### Changed
- **Card description textarea taller** — min-height increased from 90 px to 200 px in the Details sidebar tab, making better use of the available space.

### Fixed
- **Board load failure shows error state** — if `GET /board` fails on startup, the UI now shows a "Failed to load board" message with a Retry button instead of a blank screen. SSE disconnects show a non-intrusive reconnecting banner.
- **WIP limits enforced server-side** — `POST /board` and the `move_card` MCP tool now reject moves that exceed a column's WIP limit; previously only the client enforced this.
- **Plain card deletion now requires confirmation** — the × delete button on cards without a branch now shows a `vbConfirm` dialog; previously they were deleted immediately with no warning.
- **+Add card button clipped by taskbar** — added bottom padding to columns so the button remains fully visible above the OS taskbar in Chrome.

## [0.2.5] - 2026-05-29

### Added
- **Card sidebar redesigned** — 3-tab layout (Details / Agent / Activity) replaces the single long scrolling panel; each concern gets focused space with a persistent tab selection stored in `localStorage`.
- **Description preview toggle** — new setting (off by default) to show/hide the 2-line description on kanban card tiles; toggling applies instantly without reload.
- **Delete confirmation for unmerged cards** — deleting a card with an active branch and uncommitted work shows a warning dialog with the branch name and worktree path; confirming cascades cleanup: removes local worktree and local branch.
- **`workspaceId` param on MCP tools** — `get_board`, `get_column`, and `create_card` now accept an optional `workspaceId` to target a specific workspace without switching the active one.

### Changed
- **MERGED badge moved above the title** — joins priority and agent badges in the `.card-top` row for faster scanning.

### Fixed
- **Add card button clipped at viewport bottom** — column `max-height` increased from `-40px` to `-80px` headroom so the sticky footer is never hidden behind OS chrome or taskbar.
- **Empty column drop zone** — `min-height: 0` on `.cards-list` was collapsing empty columns; restored to `40px`, plus a `data-empty` attribute expands them to `80px` for easier drag-and-drop.
- **Stop agent button hover** — now shows a light red background tint; was `background: transparent`.

### Docs
- `README.md`, `AGENTS.md`, and `CLAUDE.md` synced: `add_column` removed, `workspaceId?` and `merged_at?` params documented.

## [0.2.4] - 2026-05-29

### Added
- **`merged_at` in `update_card` MCP tool** — agents that merge their own branch can set `merged_at` directly; the board pill and sidebar label update immediately via SSE.
- **`requires_review` badge on kanban card** — cards with human review required show an orange "👁 Review" pill on the tile.

### Fixed
- **Card reverts to Backlog after drag** — `POST /board` was hitting express's default 100kb body limit; raised to 10mb (`express.json({ limit: '10mb' })`).
- **MCP subprocess starts its own dead HTTP server** — subprocess now checks `port.lock` via a health check before binding; if the HTTP server is already running it enters proxy mode instead.
- **`complete_card` blocking `agentDone`** — removed `routeStopAgent` call from `complete_card`; agent now exits naturally so exit stats, card notes, and `agent_completed` SSE all fire correctly.
- **Run agent enabled on Done card after agent completes** — `modalColId` now updates in real-time when a card moves columns while the sidebar is open.
- **Add card button** — moved back outside the scroll container as a sticky column footer; `min-height: 0` flex fix applied to `.cards-list`.
- **Priority + agent badges** — moved above the card title into a `.card-top` row for faster scanning.

## [0.2.3] - 2026-05-29

### Added
- **Viewport virtualization for large columns** — columns with 100+ cards mount only visible cards in the DOM; drag-and-drop and search still work across the full list.
- **`merged_at` field exposed** — DB column added; board and sidebar reflect merge status; Merge button stamps the timestamp.

### Fixed
- **`move_card` re-triggered agent spawn on same-column move** — added `card.column_id !== toColumn.id` guard matching the existing WIP and blocker checks.
- **MCP SSE not delivered on custom PORT** — MCP subprocess reads `port.lock` written by the HTTP server at startup; no hardcoding needed.
- **Stop agent button stuck in "Stopping…"** — success path now calls `updateRunAgentBtn`; `agent_dequeued` SSE handler also updates the sidebar.
- **Merge button stuck in "Merging…" on other cards** — button state reset before `closeCardModal()` in the success path.
- **Run agent button enabled in wrong columns** — switched from Done-only blocklist to an explicit `['In Progress', 'Review']` allowlist.
- **Newest card on top** — cards render in reverse position order (newest first) in every column.
- **Agent log live updates appended to bottom** — fixed `push` → `unshift` so newest entry always appears at the top.
- **"Update available" label always shown** — CSS `display: inline-flex` was overriding the `hidden` attribute; fixed with `.version-update-label[hidden] { display: none }`.

## [0.2.2] - 2026-05-29

### Added
- **list_models / refresh_models MCP tools** - agents can now discover valid
  model IDs without guessing. `list_models({ agent? })` returns the per-agent
  model list; `refresh_models()` nudges the cache and returns counts.
- **Persistent `merged_at` flag on cards** - pressing Merge now stamps a
  timestamp on the card instead of clearing the branch name. Cards show a
  green "merged" pill on the board; the sidebar hides Merge/PR/Diff buttons
  and shows "Merged YYYY-MM-DD" instead.
- **expose `requires_review` and `custom_prompt` in `update_card`** MCP tool
  - boolean and string fields the data layer already supported but the MCP
  schema omitted.
- **Neutral tag fallback** - `.tag` now has a `--surface-2` background and
  `--text-strong` text, so custom tags (`mcp`, `agent-experience`, etc.)
  render legibly instead of invisible white-on-white.
- **Textual "Update available" label** in the header next to the version
  badge, in orange (`--tag-docs`), with `aria-live="polite"`. Only shown
  when an upgrade is detected.

### Fixed
- **Card footer clipped** - removed `overflow: hidden` from `.card` so the
  tags/priority/agent badges row is never cut off.
- **Invisible column scrollbar** - scrollbar width bumped from 4px to 8px
  across all scroll regions (cards-list, sidebar, log, workspace list), with
  a hover-darken effect on the thumb. Scrollbar now grabbable on Windows.
- **Auto-spawn on Review** - when an active agent calls `move_card` to
  Review, VibeBoard queues a follow-up spawn that fires after the current
  agent exits, so Review phase runs without manual re-trigger.
- **Agent writes leaking outside worktree** - `buildPrompt` now includes the
  worktree path (not the workspace root) in the "Work in:" line, and the
  prompt explicitly tells the agent to work inside the worktree directory.
  On agent exit, a sanity check compares `git status` between the worktree
  and main; leaks are logged as `agent_warning` with a card note.
- **Run agent button disabled for Done cards** - greyed with explanatory
  tooltip; click handler early-returns with a toast.

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
