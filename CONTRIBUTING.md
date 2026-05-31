# Contributing to VibeBoard

Thank you for your interest in contributing to VibeBoard! This document provides guidelines and instructions for contributing.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/zanuartri/vibeboard.git`
3. Install dependencies: `npm install`
4. Start the dev server: `npm run dev`
5. Open http://localhost:7341

## Development Guidelines

### Code Style

- Use consistent indentation (2 spaces)
- No semicolons (except where required)
- Use modern JavaScript (ES6+)
- Keep functions small and focused
- Add comments for complex logic

### Architecture Principles

1. **No build step UI** — plain `public/index.html` + `styles.css` + ordered
   `public/js/*.js` classic scripts. No bundler, no transpile, no ES-module imports.
2. **SQLite storage** — All data goes through `mcp-server/db.js`
3. **Cross-platform** — Support Windows and macOS
4. **No auth** — This is a local tool, not a SaaS
5. **MCP stdio** — Use stdio transport, not HTTP MCP

### File Structure

```
vibeboard/
├── mcp-server/
│   ├── index.js        # Bootstrap (wires modules, listen, shutdown)
│   ├── config.js       # PORT / HOST / PUBLIC_DIR / VERSION
│   ├── events.js       # SSE registry + emitSSE
│   ├── auth.js         # Network-mode token middleware
│   ├── http-routes.js  # All REST + SSE endpoints
│   ├── mcp-tools.js    # All MCP tool definitions
│   ├── mcp-config.js   # Per-agent MCP config
│   ├── agent-routing.js# Spawn/stop routing + dependency checks
│   ├── agent.js        # Agent spawning, queue, lifecycle
│   ├── worktree.js     # Git worktree helpers
│   ├── models.js       # Model lists
│   ├── db.js           # Database layer
│   └── migrate.js      # Legacy migration
├── public/
│   ├── index.html      # UI markup
│   ├── styles.css      # UI styles
│   └── js/*.js         # UI logic (ordered classic scripts)
├── .claude/
│   └── mcp.json        # Claude Code config
└── README.md
```

## Making Changes

### Before You Start

1. Check existing issues to avoid duplicates
2. Create an issue to discuss major changes
3. Keep changes focused and atomic

### Testing

VibeBoard uses Node.js built-in test runner (`node:test`) to keep zero test dependencies.

**Test files location:** `test/*.test.js`

**Run tests:**
```bash
npm test
```

**Example test structure:**
```javascript
const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../mcp-server/db');

test('createCard returns a card with an ID', () => {
  const card = db.createCard(workspaceId, { title: 'Test card' });
  assert.ok(card.id);
  assert.strictEqual(card.title, 'Test card');
});
```

**Before submitting:**

1. Run `npm test` and ensure all tests pass
2. Test on your platform (Windows/macOS)
3. Test workspace creation and switching
4. Test card creation, moving, and deletion
5. Test MCP tools if you modified them
6. Verify the UI works without a build step

### Commit Messages

Use clear, descriptive commit messages:

```
Good:
- Add card notes display in modal
- Fix agent spawning on Windows
- Update README installation steps

Bad:
- fix bug
- update
- changes
```

## Pull Request Process

1. Update README.md if you add features
2. Update CLAUDE.md if you change MCP tools or architecture
3. Test thoroughly on your platform
4. Create a pull request with:
   - Clear title describing the change
   - Description of what changed and why
   - Screenshots for UI changes
   - Testing steps

## Areas for Contribution

### High Priority

- [ ] Improve error handling
- [ ] Add card filtering and search
- [ ] Support custom column workflows
- [ ] Add card due dates and priorities

### Medium Priority

- [ ] Export/import board data
- [ ] Keyboard shortcuts
- [ ] Dark mode improvements
- [ ] Card templates
- [ ] Bulk operations

### Low Priority

- [ ] Card attachments
- [ ] Time tracking
- [ ] Activity timeline
- [ ] Email notifications
- [ ] Markdown support in descriptions

## Questions?

- Open an issue for questions
- Check CLAUDE.md for architecture details
- Review existing code for patterns

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- Keep discussions on-topic

Thank you for contributing!
