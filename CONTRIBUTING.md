# Contributing to VibeBoard

Thank you for your interest in contributing to VibeBoard! This document provides guidelines and instructions for contributing.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/yourusername/vibeboard.git`
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

1. **Single-file UI** — `public/index.html` must remain a single file with no build step
2. **SQLite storage** — All data goes through `mcp-server/db.js`
3. **Cross-platform** — Support Windows and macOS
4. **No auth** — This is a local tool, not a SaaS
5. **MCP stdio** — Use stdio transport, not HTTP MCP

### File Structure

```
vibeboard/
├── mcp-server/
│   ├── index.js      # Main server (HTTP + MCP + SSE)
│   ├── db.js         # Database layer
│   ├── agent.js      # Agent spawning
│   └── migrate.js    # Legacy migration
├── public/
│   └── index.html    # Single-file UI
├── .claude/
│   └── mcp.json      # Claude Code config
└── README.md
```

## Making Changes

### Before You Start

1. Check existing issues to avoid duplicates
2. Create an issue to discuss major changes
3. Keep changes focused and atomic

### Testing

Before submitting:

1. Test on your platform (Windows/macOS)
2. Test workspace creation and switching
3. Test card creation, moving, and deletion
4. Test MCP tools if you modified them
5. Verify the UI works without a build step

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

- [ ] Add tests (unit and integration)
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

Thank you for contributing! 🎉
