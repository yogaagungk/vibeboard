# VibeBoard

A self-hostable kanban board with bidirectional MCP (Model Context Protocol) integration for AI coding agents.

## Features

- 🎯 **Kanban Board** — Organize tasks with drag-and-drop columns
- 🤖 **AI Agent Integration** — Automatically spawn Claude Code or OpenCode when cards move to "In Progress"
- 📝 **Agent Checkpoints** — Agents can add notes and progress updates via MCP tools
- 🔄 **Real-time Sync** — SSE-based live updates across UI and agents
- 💾 **SQLite Storage** — Local database in your user data directory
- 🌐 **Self-hosted** — No cloud, no account required
- 🔧 **Multiple Workspaces** — Each workspace links to a project directory

## Installation

```bash
npm install -g vibeboard
```

Or run locally:

```bash
git clone https://github.com/zanuartri/vibeboard.git
cd vibeboard
npm install
npm start
```

Open http://localhost:7341 in your browser.

## Usage

### Creating a Workspace

1. Click "New workspace" in the sidebar
2. Browse to select your project directory
3. Give it a name (optional)
4. Start adding cards to your board

### Assigning AI Agents

1. Click on a card to open details
2. Select an agent (Claude Code or OpenCode)
3. Move the card to "In Progress"
4. The agent will automatically spawn and start working

### MCP Integration

VibeBoard runs an MCP server that agents can connect to. When you move a card with an assigned agent to "In Progress", VibeBoard spawns that agent in the workspace directory with a prompt containing the card details.

The agent can then use MCP tools to:
- Read the board state
- Add progress notes
- Move cards between columns
- Mark tasks complete

## MCP Tools

Available tools for AI agents:

- `get_board` — Read full board state
- `get_column` — Get cards in a specific column
- `list_workspaces` — List all workspaces
- `create_workspace` — Create a new workspace
- `switch_workspace` — Switch active workspace
- `set_workspace` — Update workspace metadata
- `create_card` — Add a new card
- `update_card` — Update card fields
- `move_card` — Move card between columns
- `complete_card` — Mark card as done
- `delete_card` — Remove a card
- `add_card_note` — Add progress note/checkpoint
- `get_card_notes` — Get all notes for a card
- `add_column` — Add a new column

## Configuration

### Claude Code

Add to `.claude/mcp.json`:

```json
{
  "mcpServers": {
    "vibeboard": {
      "command": "node",
      "args": ["./mcp-server/index.js"]
    }
  }
}
```

### OpenCode

Add to your OpenCode config:

```json
{
  "mcp": {
    "vibeboard": {
      "type": "local",
      "command": ["node", "./mcp-server/index.js"]
    }
  }
}
```

## Environment Variables

Create a `.env` file (optional):

```
PORT=7341
VB_HOST=127.0.0.1
VB_TOKEN=
VB_MAX_AGENTS=3
AGENT_TIMEOUT_MS=1800000
```

- `PORT` — HTTP/UI port (default `7341`).
- `VB_HOST` — interface to bind to. Defaults to `127.0.0.1` (loopback only).
- `VB_TOKEN` — shared access token required for **remote** clients when `VB_HOST`
  is non-loopback. If left blank in network mode, a random token is generated and
  printed at startup. Requests from the host machine (loopback) never need a token.
- `VB_MAX_AGENTS` — max agents running at once (default `3`). Moves that would
  spawn another agent beyond this cap are queued and start automatically as
  running agents finish.
- `AGENT_TIMEOUT_MS` — per-agent run timeout (default `1800000`, i.e. 30 min).

> ⚠️ **Network exposure is opt-in.** When `VB_HOST` is non-loopback, VibeBoard
> requires a token for any request coming from another machine — open the board
> via `http://<host>:7341/?token=<token>` (shown at startup or set via `VB_TOKEN`).
> Loopback access on the host stays token-free. Anyone who has the token can move
> cards and trigger agents with skipped permissions in your project directories,
> so only expose it on a trusted network.

## WIP Limits

Double-click a column's card count in its header to set a work-in-progress
limit (blank to clear). The count turns red when the column is over its limit.
Limits are advisory — drops are still allowed, with a warning toast.

## Data Storage

VibeBoard stores data in SQLite at:

- **Windows**: `%APPDATA%\vibeboard\vibeboard.db`
- **macOS**: `~/Library/Application Support/vibeboard/vibeboard.db`

## Development

```bash
npm run dev  # Start with auto-reload
```

## Architecture

- **mcp-server/index.js** — MCP server + HTTP server + SSE
- **mcp-server/db.js** — SQLite database layer
- **mcp-server/agent.js** — Agent spawning and lifecycle
- **mcp-server/migrate.js** — Legacy JSON to SQLite migration
- **public/index.html** — Single-file UI (vanilla JS, no build step)

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT

## Support

- Report issues: https://github.com/zanuartri/vibeboard/issues
- Documentation: See CLAUDE.md for agent context
