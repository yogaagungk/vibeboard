# Changelog

All notable changes to VibeBoard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.2] - 2026-06-01

### Added
- **Per-card review agent & model** — cards with "Requires review" toggled on can now specify a separate agent and model for the Review phase, independent of the In Progress agent. Pickers appear in both the new-card modal and the card sidebar when the toggle is on.
- **`review_issue` flag & badge** — when the review agent finds significant issues it calls `update_card({ review_issue: true })` and leaves a note. A red `! issue` badge appears on the card in the Review column. The flag is cleared automatically when the card leaves Review.
- **Smart `! merge` badge** — the badge now requires actual file changes (`has_branch_changes`); a branch with no committed file diff no longer triggers it. Stored on the card via `agentDone` so no async fetch is needed at render time.
- **Auto-spawn review agent** — when the In Progress agent calls `move_card("Review")` via MCP while still running, a pending respawn is correctly queued and the review agent starts automatically once the In Progress agent exits (previously silently dropped in MCP-subprocess mode).
- **Branch strategy** — `develop` is the active development branch; direct commits/pushes to `main` are prohibited. Documented in CLAUDE.md and AGENTS.md.
- **Codex model list updated** — hardcoded list updated to the current GPT-5.x lineup: `gpt-5.4` (default), `gpt-5.3-codex`, `gpt-5.5`, `gpt-5.2`, `gpt-5.4-mini`.

### Fixed
- **Review agent auto-spawn broken in MCP-subprocess mode** — `routeSpawnAgent` was calling `POST /run` which returns 409 when the In Progress agent is still active, preventing the pending-respawn queue from being set. New `POST /spawn-or-queue` endpoint bypasses the active-agent guard; `/run` remains unchanged for manual UI triggers.
- **Review agent/model not used via all spawn paths** — `spawnAgent` now resolves `review_agent`/`review_model` from the card internally, so the dequeue and pending-respawn paths also use the correct agent and model (previously only the direct spawn path did).
- **Review diff showed "No changes yet" with commits present** — `getDiff` was using `baseBranch...HEAD` (three-dot, merge-base diff) while `getCommits` used `baseBranch..HEAD` (two-dot). On repos where the base branch advanced after the worktree was created the diff was empty; both now use two-dot.
- **`! merge` badge and merge/PR buttons showed for empty branches** — `agentDone` now checks for actual file changes; if none, the worktree is removed and `branch`/`worktree_path` are cleared. Merge/PR buttons in the sidebar also gate on non-empty diff content, not just commit count.
- **`review_issue` and `has_branch_changes` never surfaced in UI** — both fields were written to DB but omitted from the `getBoard` SELECT and card mapping, making both badge features dead on arrival. Fixed.
- **Review-agent section stayed visible after main agent was cleared** — clearing the agent dropdown in the card sidebar now also hides the review-agent section.
- **SSE banner showed unknown character** — corrupted `0x16` byte in `#sse-banner-text::before` CSS content replaced with `\26A0\00a0` (⚠ + NBSP).
- **Add card button shown in non-editable columns** — removed from In Progress, Review, and Done columns; a same-height spacer preserves column layout.
- **Review phase prompt was contradictory** — old instruction said "fix issues then move_card back to In Progress" (self-contradictory). New: trivial issues → fix inline → `complete_card`; significant issues → `update_card({ review_issue: true })` + `add_card_note` → stop; review agent does not re-implement.
- **Review prompt had no context on what changed** — prompt now starts with `git diff base..HEAD` anchored to the worktree branch (worktree mode) or a stored base SHA captured at In Progress spawn time (non-worktree mode).

## [0.3.1] - 2026-06-01

### Added
- **Landing page revamp** — full redesign matching the ClickUp-inspired design system: sticky white nav with inline SVG logo, centered hero with interactive board mockup (flex columns, colored accents, running-agent pulse), agent pills strip (Claude Code / OpenCode / Codex / Command Code), left-aligned feature/steps/terminal sections, dark terminal block, white CTA section, flat footer link row.

### Fixed
- **Board mockup overflow** — mockup columns changed from fixed `200px` to `flex: 1` so all four columns fill the container without a horizontal scrollbar.

### Changed
- Landing page tokens updated to match `styles.css` — `#7C3AED` accent, `#F4F5F8` bg, light/dark theme via `prefers-color-scheme`; all `font-weight: 300` removed, em dashes removed.

## [0.3.0] - 2026-06-01

### Added
- **ClickUp-inspired design system** — full UI overhaul replacing the previous Linear-inspired theme. White surfaces, vibrant column accent lines, colorful workspace icons (10-color curated palette via `wsColor()`), hash-based tag colors, and `#7C3AED` purple accent throughout.
- **Skeleton loading states** — shimmer placeholders for workspace list, header breadcrumb, board columns (4 skeleton columns with fake cards), and MCP modal agent rows. All skeletons respect light/dark theme via CSS custom properties.
- **Favicon & brand icon** — white background with colorful kanban bars (purple/orange/sky); sidebar collapsed icon matches.
- **Board-level progress summary in header** — sticky header shows `X / Y done (Z%)` with a progress bar; updates live. Click to scroll to Done column.
- **Keyboard shortcuts close button** — shortcuts overlay now has a proper modal-style header with title and × close button.

### Changed
- **Header** — clean white bar, workspace breadcrumb with colored icon, connection status pill, agent activity indicator.
- **Sidebar** — 240px wide, "WORKSPACES" section label, tighter item rows, active item with left accent bar, New Workspace button accent-tinted.
- **Columns** — colored top accent line (4px) is the sole column color indicator (dot removed); column title uppercase in accent color; count badge shows plain number without parentheses (e.g. `97` not `(97)`).
- **Cards** — add-card button always visible at column bottom (fixed `max-height` on `cards-list` instead of column); columns naturally compact when empty.
- **Modals & dialogs** — `border-radius: 10px`, deeper shadow `0 24px 64px`, uniform `16px 20px` padding. New Workspace modal wider (`520px`). `vbDialog` (confirm/prompt) restructured with `head / body / footer` layout. MCP modal, settings, card detail all consistent.
- **Card details sidebar** — title `16px/600`; tabs `13px/38px` with accent underline; body padding `16px 20px`; description `min-height 120px`; property rows tighter (`9px`); notes `13px` with white bg + subtle shadow.
- **Typography system** — removed all `font-weight: 300` (13 instances → 400); normalized uppercase label tracking to `0.5px`; removed negative letter-spacing from non-heading text; size floor raised to `10px` for text badges; card title `13px/500`; consistent `1.5` line-height for inputs, `1.6` for prose.
- **Filter buttons** — now show correct `▾` chevron (was broken by encoding bug); `0.3.0` also fixes `▶` play icon, `✓` checkmark, `⏳` hourglass, `⚠` warning — all converted to CSS unicode escapes for encoding safety.
- **COL_COLORS** — updated to more vibrant ClickUp-accurate palette (sky blue, amber, green, violet, red, cyan, pink, orange, teal).

### Fixed
- **Card sidebar stays open on workspace switch** — `workspace_switch` SSE handler now calls `closeCardModal()` before re-rendering, preventing stale card details from a different workspace.
- **CSS encoding corruption** — `▾ ▶ ✓ ⏳ ⚠` content values were double-encoded by PowerShell file operations; all converted to `\25be \25b6 \2713 \23f3 \26a0` escapes.
- **`var(--hover)` undefined** — 4 occurrences replaced with `var(--surface-2)`.
- **Column cards hidden** — `flex: 1 1 0` on `cards-list` collapsed to 0px with `max-height` container; fixed by applying `max-height` directly on `cards-list` so columns grow naturally and cards always render.
- **Duplicate CSS block** — ~420-line duplicate section removed from `styles.css`.
- **Em dashes in user-visible text** — replaced in SSE reconnect banner, workspace name placeholder, browser notification title, and error message string.

## [0.2.14] - 2026-05-31

### Added
- **Side-by-side diff view** — card diff modal now renders a split pane (old left, new right) with word-level highlighting; falls back to unified view on mobile (<768px)
- **Agent event chip colors in Activity Log** — `agent_started` (blue), `agent_completed` (green), `agent_failed` / `agent_spawn_failed` (red), `agent_warning` (orange); queued/dequeued remain neutral
- **`command-code` agent badge color** — teal `#0d9488`; documented in DESIGN.md §2 alongside other agent colors

### Fixed
- **Diff modal — unified scroll** — split diff now has a single vertical scrollbar (right pane) synced to left via JS; horizontal scrollbars are one per pane (not per file), bidirectionally synced; mouse wheel over left pane forwards to right pane
- **Diff modal — row background width** — colored row backgrounds (red/green) now extend the full horizontal scroll width instead of stopping at content edge
- **Diff modal — sticky scrollbar** — scrollbars remain visible at the dialog edge while scrolling instead of floating mid-content
- **Diff modal — per-file collapse** — each file can be collapsed/expanded independently; arrow indicator updates correctly
- **Diff modal — horizontal scroll** — long lines no longer truncate; each pane scrolls independently with sync
- **Diff modal — line truncation** — lines no longer wrap or clip; collapse arrow size increased for easier clicking
- **Settings button dark mode** — was showing browser-default white background; added `background: transparent`
- **Settings button icon** — replaced sun/asterisk SVG with a proper gear/cog icon
- **Activity Log naming** — header button and HTML comment were "Agent Log"; standardised to "Activity Log" everywhere
- **MCP modal DESIGN.md violations** — `font-family: monospace` → `'JetBrains Mono', monospace` on path elements; `border-radius: 7px` literals → `var(--radius-md)` on modal rows and log entries
- **Command Code `--max-turns`** — raised from default 10 to 60; 10 turns was too few for a full task cycle (read → edit → commit → complete)
- **Command Code taste** — agent prompt now explicitly tells command-code not to run taste commands or create `taste.md`

### Changed
- **Agent prompts shortened** — UI copy-paste helper and auto-spawn prompt trimmed to remove redundant instructions

## [0.2.13] - 2026-05-31

### Added
- **Command Code agent** — new agent type (`command-code` binary); assigned cards spawn Command Code with `--yolo --skip-onboarding` via stdin pipe to `-p` mode
- **Command Code MCP auto-setup** — `POST /api/mcp-setup` configures `~/.commandcode/mcp.json` via `command-code mcp add --transport stdio --scope user`
- **Command Code model listing** — `refresh_models` and the UI model selector fetch available models from `command-code --list-models`
- **REST endpoints for Command Code board updates** — `POST /api/cards/:id/note`, `/api/cards/:id/move`, and `/api/cards/:id/complete` let Command Code update the board via HTTP (`shell_command`) since MCP is not loaded in `-p` mode

### Fixed
- **Command Code on Windows** — prompt piped via stdin (`type … | command-code -p`) instead of as a `-p` CLI argument, avoiding cmd.exe argument-splitting on double-quote characters
- **Command Code board updates** — agent prompt now includes REST API instructions with concrete endpoint URLs instead of MCP tool references (MCP is not initialised in `-p` mode)

### Changed
- **Favicon** — card color updated from green (`#4ade80`) to accent blue (`#5e6ad2`)
- **Agent prompts shortened** — auto-spawn prompt and UI copy-paste helper trimmed to remove redundant instructions while keeping all key information

## [0.2.12] - 2026-05-31

### Added
- **Priority-aware agent queue** — queued agents now run in `high → medium → low → unset` order
  with FIFO as a tiebreaker within the same priority level, instead of strict arrival order.
- **`cancel_agent` MCP tool** — cancel a queued or running agent for a card; also adds a UI ×
  button on the kanban card while it is queued.
- **Stale-while-revalidate model cache** — model lists are returned immediately from disk cache on
  startup; CLI refresh runs in the background and the cache is persisted to
  `DATA_DIR/models-cache.json` so it survives restarts.
- **CI pipeline** — GitHub Actions workflow runs on Node 18, 20, and 22 with a smoke test (starts
  the server, verifies `/board` returns 200). Actions bumped to v5 for Node.js 24 compatibility.
- **Test framework documented** — `CONTRIBUTING.md` now shows how to write tests using Node.js
  built-in `node:test` with a concrete example.
- **Database transaction safety** — all schema migration `ALTER TABLE` calls wrapped in a single
  transaction; `moveCard` and `deleteCard` wrapped so partial failures can't corrupt positions.
- **Database indexes** — `CREATE INDEX` on `cards.created_at` and `cards.updated_at` for faster
  sort/filter queries on large boards.
- **`blocked_by` cycle detection at DB layer** — `createCard` now runs the same cycle check that
  `updateCard` already had, so the invariant is enforced regardless of call site.
- **XSS fix in dialogs** — `messageHtml` is now sanitized through a strict allowlist
  (`b, i, em, strong, code, br`) before being set via `innerHTML`.
- **Tag search uses `json_each()`** — `search_cards` and `list_cards` now match tags with exact
  SQLite `json_each()` queries instead of `LIKE "%tag%"` which matched substrings.
- **Cross-workspace column validation** — `moveCard` now verifies the destination column belongs
  to the same workspace as the card.
- **`blocked_by` ID validation in MCP** — `create_card` and `update_card` reject unknown card IDs
  in `blocked_by` with a clear error listing the unknown IDs.
- **Model regex hardened** — `isSafeModel` now also rejects models containing `..` or consecutive
  slashes, closing a potential path traversal vector.
- **PORT validation on startup** — `config.js` validates PORT is in 1–65535 range and exits with
  a clear message instead of a cryptic bind error.
- **`port.lock` bounds check** — corrupted `port.lock` files are detected and deleted on startup
  instead of silently using an invalid port.
- **Absolute path enforcement** — workspace path inputs in the UI now reject relative paths with
  an inline error on both the workspace creation form and workspace settings.
- **Token rotation** — `POST /admin/rotate-token` (network mode only, protected by current token)
  regenerates the auth token at runtime. `VB_TOKEN` env var sets a fixed token.
- **`syncBoard` concurrency mutex** — concurrent `POST /board` calls are serialised with a promise
  queue so two browser tabs can't clobber each other's changes.
- **Agent respawn queue** — `pendingRespawn` is now a per-card array queue; rapid successive moves
  while an agent is running no longer silently drop earlier respawn targets.

### Fixed
- **`opencode run` on Windows** — command now pipes prompt via stdin (`type … | opencode run`)
  instead of PowerShell `(Get-Content -Raw)`, which was splitting multi-line prompts on newlines
  and causing `--flag-style` text in card descriptions to be parsed as CLI options.
- **`claude-code` real-time output** — spawns now pass `--output-format stream-json` so output is
  flushed event-by-event rather than all at once at the end; a `parseClaudeStreamJson` transform
  extracts readable text from JSON events (assistant messages, tool names, session cost).
- **Output section persists across card switch/reload** — frontend always fetches
  `/api/cards/:id/output` on card open and auto-expands the section when content is present,
  instead of relying on in-memory `runningCards` state that resets on reload.
- **`cancel_agent` correctly returns success for queued cards** — `stopAgent` now tracks whether
  it dequeued a card separately from whether it killed a running process, so the MCP tool and UI
  both receive the correct result.
- **SSE `board_update` guard** — tab-sync ping payloads that carry only `_tabId` (no `columns`)
  no longer throw a `TypeError` in the `board_update` handler.
- **Search empty state** — columns with no visible cards after a search now show a "No results"
  placeholder instead of appearing blank.

### Changed
- **`claude-code` effort** — spawns now pass `--effort medium` to reduce token consumption without
  sacrificing task quality.
- **Queue position note** — queued agent note now shows "Position in queue: N" (removed the
  redundant "of N" which always equalled N).

[Unreleased]: https://github.com/zanuartri/vibeboard/compare/v0.2.14...HEAD
[0.2.14]: https://github.com/zanuartri/vibeboard/compare/v0.2.13...v0.2.14
[0.2.13]: https://github.com/zanuartri/vibeboard/compare/v0.2.12...v0.2.13
[0.2.12]: https://github.com/zanuartri/vibeboard/compare/v0.2.11...v0.2.12

## [0.2.11] - 2026-05-31

### Added
- **`list_cards` MCP tool** — lightweight card listing with `columnTitle`, `tag`, `agent`,
  `limit`, and `offset` filters; much more efficient than `get_board` when you only need card IDs
  or a filtered subset.
- **`get_agent_status` MCP tool** — returns `{ running, queued, lastNote, lastExitCode }` for a
  card so agents can check peer activity without fetching the full board.
- **`get_board` filter params** — `columnsOnly` (strips card data), `excludeLogs` (omits agent
  log), and `columnTitle` (returns a single column) reduce payload size for agents that don't need
  the full state.
- **`search_cards` pagination** — `limit` (default 50) and `offset` params added; response now
  includes `total` count alongside the page.
- **`move_card` spawn failure visible** — if agent spawn throws after a card is moved, VibeBoard
  adds a card note `⚠️ Agent spawn failed: …` and emits `agent_spawn_failed` SSE instead of
  leaving the card silently stuck.
- **`update_card` logs agent changes** — assigning or clearing a card's agent now writes an
  explicit agent log entry (`Agent assigned: opencode (was: none)`).

### Fixed
- **Agent completion never lost** — the internal HTTP notify that marks a card done after an agent
  exits now retries up to 3 times (500 ms / 1 s / 1.5 s backoff) instead of silently swallowing
  errors; a failed notify is logged to stderr so it's always visible.
- **Timer leak on long-running servers** — `clearTimeout` is now called immediately in the agent's
  `close` and `error` handlers before the async notify fetch, preventing timeout handles from
  accumulating when the fetch is slow or retrying.
- **`activeAgents` map leak on spawn error** — if `updateCard` or another step throws after the
  agent child was already set in the map, the catch block now fully tears down the entry (clears
  interval/timeout, kills child, removes PID file) so nothing leaks.
- **PID file registry for cross-process cleanup** — each spawned agent writes an
  `agent-pid-<cardId>` file to the data directory; `killAllAgents` on SIGTERM now also kills any
  PIDs registered by MCP subprocess instances that aren't in the current process's `activeAgents`
  map, so no orphaned agents survive a server shutdown.
- **Duplicate dead declarations removed** — `agent.js` had two redundant function declarations
  (`isAgentRunning`, `isAgentActive`) introduced at the top of the file that shadowed the correct
  implementations lower down; removed.

### Changed
- **WIP limit badge shows edit affordance** — the card-count badge on column headers now shows a
  `✎` pencil icon on hover, making the double-click-to-edit interaction discoverable.
- **Search debounced** — board search input now waits 150 ms after the last keystroke before
  filtering, preventing layout thrashing on large boards.
- **Note preview tooltips** — truncated agent checkpoint previews in the activity feed now have a
  `title` attribute with the full text, accessible on hover and to screen readers.
- **Column title accessibility** — the inline-edit input for renaming a column now has
  `aria-label="Column title"`.
- **Datepicker keyboard clear** — pressing `Delete` or `Backspace` while the datepicker trigger
  has focus clears the date without opening the calendar popup.

## [0.2.10] - 2026-05-30

### Added
- **Agent context file viewer** — new "Context" button in the board toolbar opens a modal listing
  all AI context files found in the workspace (`CLAUDE.md`, `AGENTS.md`, `OPENCODE.md`,
  `CODEX.md`, `DESIGN.md`, `.claude/CLAUDE.md`) with tab navigation between files. Contributed by
  [@yogaagungk](https://github.com/yogaagungk).
- **Context tab in card sidebar** — shows the context file relevant to the card's assigned agent
  (`CLAUDE.md` for claude-code, `AGENTS.md` for others) so you can review what the agent will
  read before it spawns.
- **Markdown renderer** (`md-render.js`) — lightweight vanilla renderer supporting headings,
  bold/italic, inline code, fenced code blocks, tables, ordered/unordered lists, blockquotes, and
  YAML front matter as a collapsible "Design tokens" block. Inline hex color codes (`#RRGGBB` /
  `#RGB`) render with a small color swatch chip.

### Changed
- **Date picker replaced with custom calendar picker** — native `<input type="date">` replaced
  with a minimalist floating calendar popup matching the Linear-inspired design system; supports
  both light and dark themes; shows overdue state in red; Clear and Today shortcuts in the footer.

### Fixed
- **Card sidebar crash on missing divider** — `closeCardModal` and the notes loader both now
  null-guard the removed `card-activity-divider` element that was causing "Cannot read properties
  of null" on close.

## [0.2.9] - 2026-05-30

### Changed
- **New card modal redesigned** — tags moved above description textarea; Priority and Due Date now
  share a single row; Schedule section renamed to Details; Agent section renamed to Assignment;
  removed redundant section labels; tighter 8px spacing between fields.
- **Card details sidebar redesigned** — Details tab matches new card modal layout (tags above
  textarea, Priority/Due in one row); Agent tab renamed to Assignment with Needs review toggle
  moved inside the section; Activity tab wraps Move to buttons in a sidebar-group for consistency.
- **Priority dropdown width increased in card details** — Priority field now uses `flex: 1.5` for
  better proportion with Due date field (card details only, new card modal unchanged).
- **Additional instructions label** — "Instructions" field in Agent tab renamed to "Additional
  instructions" for clarity.

### Fixed
- **Blocked by dropdown width overflow** — long card titles with badges now properly constrain to
  `max-width: 380px` with ellipsis truncation; dropdown uses `width: max-content` to prevent
  expanding beyond trigger width.
- **Date picker styling** — height increased from 28px to 34px and padding/border updated to match
  priority dropdown styling.
- **Activity tab divider removed** — eliminated redundant `<hr>` between Move to and Changes
  sections; Move to now uses sidebar-group wrapper for consistent styling.
- **Expand diff button hidden when merged** — diff expand button now properly hides alongside the
  "Show diff" toggle when a card is merged.

## [0.2.8] - 2026-05-30

### Changed
- **Agent selector converted to dropdown** — both the card sidebar and new card modal now use a
  compact dropdown instead of wrapping button groups; eliminates "Claude Code" / "Codex CLI" text
  wrapping.
- **Priority converted to dropdown in new card modal** — replaces the 4-button group with a
  compact `vbSelect` dropdown, shares one row with Due Date.
- **All notes collapsed by default** — every note in Notes & Checkpoints starts collapsed; removed
  the "latest note starts expanded" exception. Click any note to expand it.
- **Agent prompt redesigned** — taller textarea (`min-height: 160px`, `max-height: 280px`),
  read-only styling to distinguish from editable fields, Show/Hide toggle moved below the header
  row.

### Fixed
- **Blocked by dropdown filters Done cards** — cards already in Done no longer appear as blocker
  options since they're already satisfied; shows "No available blockers" when nothing is
  selectable.
- **Blocked by dropdown shows column badge** — each item now shows the card's current column name
  on the right for quick context.
- **Blocked by dropdown z-index** — dropdown popover in the new card modal now renders above the
  modal overlay (`position: fixed; z-index: 1100`).
- **Expand diff button uses proper SVG icon** — replaces the inconsistent `⛶` unicode character
  with a clean inline SVG expand icon; adds `title="Expand diff"` tooltip.

## [0.2.7] - 2026-05-30

### Added
- **Discard changes button** — Done cards with an unmerged branch now show a "Discard changes"
  danger button alongside the merge button; confirming deletes the worktree, removes the local
  branch, and clears the branch reference on the card.
- **Expand diff dialog** — a ⛶ expand button on the diff view opens the full diff in a wide
  (80 vw, max 900 px) centered dialog with monospace font and horizontal scroll for long lines.
- **Theme icons in settings modal** — System / Light / Dark theme buttons now include inline SVG
  icons (monitor / sun / moon) for faster scanning.

### Changed
- **Details tab redesigned** — flat layout replaces the bordered "DETAILS" box; all fields (Tags,
  Priority, Due Date, Blocked by) are now inline label + control rows with thin dividers.
- **Agent tab redesigned** — same flat label treatment: Agent selector, Model picker,
  Running+Stop buttons (now side by side), and Additional Instructions all converted to compact
  inline rows. Agent Prompt is collapsed by default with a Show/Hide toggle.
- **New card modal redesigned** — Tags, Priority, Due Date, Blocked by, and Agent fields updated
  to match the flat inline label style.
- **Notes & Checkpoints collapsed by default** — each note shows timestamp + first-line preview;
  click to expand. Most recent note starts expanded.

### Fixed
- **ANSI escape codes stripped from full output** — terminal color/formatting sequences are now
  sanitized before display; previously rendered as garbage characters.
- **Card sidebar refreshes when column changes via SSE** — the merge button and move actions now
  update in place when an agent moves the open card to Done.

## [0.2.6] - 2026-05-30

### Added
- **SVG favicon** — kanban columns icon displayed in browser tab.
- **"need merge" badge on Done cards** — cards in Done with an unmerged branch show a red "need
  merge" pill.
- **`search_cards` MCP tool** — agents can query cards server-side by title/description, tag,
  column, or agent without fetching the full board.
- **`delete_workspace` MCP tool** — agents can delete workspaces programmatically (requires
  `confirm: true`; blocked if only one workspace remains).
- **Cascade delete for workspaces** — deleting a workspace now atomically removes all its cards,
  notes, and agent log entries in a single SQLite transaction.
- **Cyclic dependency detection** — adding a `blocked_by` relation that would create a cycle is
  now rejected in the UI, REST API, and MCP with a clear error message.

### Changed
- **Card description textarea taller** — min-height increased from 90 px to 200 px.

### Fixed
- **Board load failure shows error state** — if `GET /board` fails on startup, the UI now shows a
  "Failed to load board" message with a Retry button. SSE disconnects show a reconnecting banner.
- **WIP limits enforced server-side** — `POST /board` and the `move_card` MCP tool now reject
  moves that exceed a column's WIP limit.
- **Plain card deletion now requires confirmation** — the × delete button on cards without a
  branch now shows a `vbConfirm` dialog.
- **+Add card button clipped by taskbar** — added bottom padding to columns.

## [0.2.5] - 2026-05-29

### Added
- **Card sidebar redesigned** — 3-tab layout (Details / Agent / Activity) replaces the single long
  scrolling panel; each concern gets focused space with a persistent tab selection stored in
  `localStorage`.
- **Description preview toggle** — new setting (off by default) to show/hide the 2-line
  description on kanban card tiles.
- **Delete confirmation for unmerged cards** — deleting a card with an active branch shows a
  warning dialog; confirming cascades cleanup: removes local worktree and local branch.
- **`workspaceId` param on MCP tools** — `get_board`, `get_column`, and `create_card` now accept
  an optional `workspaceId` to target a specific workspace without switching the active one.

### Changed
- **MERGED badge moved above the title** — joins priority and agent badges in the `.card-top` row.

### Fixed
- **Add card button clipped at viewport bottom** — column `max-height` headroom increased.
- **Empty column drop zone** — `min-height: 0` on `.cards-list` was collapsing empty columns;
  restored to `40px` plus `data-empty` attribute expands them to `80px`.
- **Stop agent button hover** — now shows a light red background tint.

## [0.2.4] - 2026-05-29

### Added
- **`merged_at` in `update_card` MCP tool** — agents that merge their own branch can set
  `merged_at` directly; the board pill and sidebar label update immediately via SSE.
- **`requires_review` badge on kanban card** — cards with human review required show an orange
  "👁 Review" pill on the tile.

### Fixed
- **Card reverts to Backlog after drag** — `POST /board` was hitting express's default 100kb body
  limit; raised to 10mb.
- **MCP subprocess starts its own dead HTTP server** — subprocess now checks `port.lock` via a
  health check before binding; if the HTTP server is already running it enters proxy mode.
- **`complete_card` blocking `agentDone`** — removed `routeStopAgent` call from `complete_card`;
  agent now exits naturally so exit stats, card notes, and `agent_completed` SSE all fire.
- **Run agent enabled on Done card after agent completes** — `modalColId` now updates in real-time
  when a card moves columns while the sidebar is open.

## [0.2.3] - 2026-05-29

### Added
- **Viewport virtualization for large columns** — columns with 100+ cards mount only visible cards
  in the DOM; drag-and-drop and search still work across the full list.
- **`merged_at` field exposed** — DB column added; board and sidebar reflect merge status.

### Fixed
- **`move_card` re-triggered agent spawn on same-column move** — added `card.column_id !==
  toColumn.id` guard.
- **MCP SSE not delivered on custom PORT** — MCP subprocess reads `port.lock` written by the HTTP
  server at startup.
- **Stop agent button stuck in "Stopping…"** — success path now calls `updateRunAgentBtn`.
- **Merge button stuck in "Merging…" on other cards** — button state reset before
  `closeCardModal()`.
- **Run agent button enabled in wrong columns** — switched from Done-only blocklist to an explicit
  `['In Progress', 'Review']` allowlist.
- **Newest card on top** — cards render in reverse position order (newest first).
- **Agent log live updates** — fixed `push` → `unshift` so newest entry always appears at top.

## [0.2.2] - 2026-05-29

### Added
- **`list_models` / `refresh_models` MCP tools** — agents can now discover valid model IDs;
  `list_models({ agent? })` returns the per-agent model list; `refresh_models()` nudges the cache.
- **Persistent `merged_at` flag on cards** — pressing Merge stamps a timestamp; cards show a green
  "merged" pill; sidebar hides Merge/PR/Diff buttons and shows "Merged YYYY-MM-DD" instead.
- **`requires_review` and `custom_prompt` in `update_card`** — MCP tool now exposes these fields.
- **Neutral tag fallback** — `.tag` now has a `--surface-2` background so custom tags render
  legibly.
- **Textual "Update available" label** in the header, in orange, with `aria-live="polite"`.

### Fixed
- **Card footer clipped** — removed `overflow: hidden` from `.card`.
- **Invisible column scrollbar** — scrollbar width bumped from 4px to 8px with hover-darken.
- **Auto-spawn on Review** — when an active agent calls `move_card` to Review, VibeBoard queues a
  follow-up spawn that fires after the current agent exits.
- **Agent writes leaking outside worktree** — `buildPrompt` now includes the worktree path; prompt
  explicitly tells the agent to work inside the worktree directory.
- **Run agent button disabled for Done cards** — greyed with explanatory tooltip.

## [0.2.1] - 2026-05-29

### Security
- **Workspace path validation** — `create_workspace` and `set_workspace` reject filesystem root,
  home directory, and system dirs (`/etc`, `C:\Windows`, `/System`); cross-platform via
  `os.homedir()` + per-OS denylist.
- **Spawn-dir verification** — right before `spawn()`, the agent's working directory is
  re-checked; symlinks are refused; worktree paths must resolve inside the workspace root.
- **Prompt-injection hardening** — card title, description, tags, and custom prompt are sanitized
  (ANSI escapes, ASCII control chars, zero-width and bidi-override characters stripped) and wrapped
  in a `<card-data>` block treated as untrusted task data.

### Changed
- MCP-created cards now default to `requires_review = false`.

## [0.2.0] - 2026-05-29

### Security
- CSRF protection on board mutations (cross-site Origin / spoofed Host requests return 403).
- Network mode adds a kill-switch endpoint to stop running agents.

### Added
- Linear-inspired design system: lavender-blue accent, four-step surface ladder, hairline borders.
- Radius scale tokens, `--surface-4`, `--text-strong`, `--accent-focus`.
- In-app version badge that polls the npm registry and lights up when an upgrade is available.
- Collapsible left rail; refreshed dropdowns, card sidebar, agent log.
- Single source of truth for version: `mcp-server/config.js` reads `version` from `package.json`.

### Fixed
- Themed dropdowns (`vbSelect`) no longer close when scrolling inside the popup.

## [0.1.0] - 2026-05-29

### Added
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
- Per-column WIP limits with double-click to set
- Card dependencies (`blocked_by`) with cycle detection
- Concurrency cap with automatic agent queue (`VB_MAX_AGENTS`)
- Agent output saved as card note on completion
- Agent timeout (default 30 min, configurable via `AGENT_TIMEOUT_MS`)
- Per-card model selection
- Stop agent button in the card sidebar
- Run visibility: exit code, duration, and best-effort cost/token usage per run

[Unreleased]: https://github.com/zanuartri/vibeboard/compare/v0.2.12...HEAD
[0.2.12]: https://github.com/zanuartri/vibeboard/compare/v0.2.11...v0.2.12
[0.2.11]: https://github.com/zanuartri/vibeboard/compare/v0.2.10...v0.2.11
[0.2.10]: https://github.com/zanuartri/vibeboard/compare/v0.2.9...v0.2.10
[0.2.9]: https://github.com/zanuartri/vibeboard/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/zanuartri/vibeboard/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/zanuartri/vibeboard/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/zanuartri/vibeboard/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/zanuartri/vibeboard/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/zanuartri/vibeboard/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/zanuartri/vibeboard/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/zanuartri/vibeboard/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/zanuartri/vibeboard/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/zanuartri/vibeboard/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/zanuartri/vibeboard/releases/tag/v0.1.0
