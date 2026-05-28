# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-05-28

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
- Agent output saved as card note on completion
- Agent timeout (default 30 min, configurable via `AGENT_TIMEOUT_MS`)
- Agent log capped at 500 rows per workspace
- Startup cleanup of orphaned git worktrees
- SSE reconnect auto-refresh

### Notes
- Requires Node.js 18+
- Windows and macOS supported
- No build step required — single-file vanilla JS UI
