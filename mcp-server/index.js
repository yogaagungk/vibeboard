#!/usr/bin/env node
const express = require('express');
const fs = require('fs');
const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const db = require('./db');
const { migrateLegacyData } = require('./migrate');
const { PORT, HOST, VERSION } = require('./config');
const { sseClients, setHttpRunning, isHttpRunning } = require('./events');
const { getAuthToken } = require('./auth');
const { killAllAgents } = require('./agent');
const registerRoutes = require('./http-routes');
const registerMcpTools = require('./mcp-tools');

migrateLegacyData();

// On startup, prune stale git worktree references for all workspaces that use worktrees.
// This repairs git's internal tracking when .vb-worktrees/ entries were deleted externally
// or when the server crashed while an agent had a worktree open. Run async so a slow disk
// or many workspaces don't block server boot.
(function pruneOrphanedWorktrees() {
  const { exec } = require('child_process');
  for (const ws of db.listWorkspaces()) {
    if (!ws.use_worktree || !ws.path) continue;
    exec('git worktree prune', { cwd: ws.path }, () => {});
  }
})();

const app = express();
app.use(express.json());
registerRoutes(app);

const mcp = new McpServer({ name: 'vibeboard', version: VERSION });
registerMcpTools(mcp);

const server = app.listen(PORT, HOST, () => {
  setHttpRunning(true);
  try {
    fs.writeFileSync(path.join(db.DATA_DIR, 'port.lock'), String(PORT));
  } catch (_) {}
  process.stderr.write(`HTTP server listening on http://localhost:${PORT}\n`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    const { networkInterfaces } = require('os');
    let localIP = HOST;
    try {
      const nets = networkInterfaces();
      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          if (net.family === 'IPv4' && !net.internal) { localIP = net.address; break; }
        }
      }
    } catch (_) {}
    process.stderr.write(`Network access ENABLED: http://${localIP}:${PORT}/?token=${getAuthToken()}\n`);
    process.stderr.write(`Remote clients must use the token above (or set VB_TOKEN). Local (loopback) access needs no token.\n`);
    process.stderr.write(`WARNING: anyone with the token can move cards and run agents in your project dirs.\n`);
  }
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    process.stderr.write(`Port ${PORT} in use — running in MCP-only mode, proxying SSE to main server\n`);
    // Don't exit — MCP stdio still works, emitSSE will proxy to the running server
  } else {
    process.stderr.write('Server error: ' + err.message + '\n');
    process.exit(1);
  }
});

function shutdown() {
  killAllAgents(); // don't leave spawned agents running after the server exits
  if (isHttpRunning()) {
    try { fs.unlinkSync(path.join(db.DATA_DIR, 'port.lock')); } catch (_) {}
    for (const res of sseClients) { try { res.end(); } catch(_) {} }
    sseClients.clear();
    server.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const transport = new StdioServerTransport();
mcp.connect(transport)
  .then(() => process.stderr.write('MCP server connected via stdio\n'))
  .catch(err => process.stderr.write('MCP connect error: ' + err.message + '\n'));
