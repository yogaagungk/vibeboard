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
app.use(express.json({ limit: '10mb' }));
registerRoutes(app);

const mcp = new McpServer({ name: 'vibeboard', version: VERSION });
registerMcpTools(mcp);

async function startServer() {
  // If another server is already running (port.lock exists and responds), skip
  // binding entirely. The MCP subprocess runs in proxy-only mode — emitSSE will
  // forward events via HTTP to the running server's /api/sse-emit endpoint.
  try {
    const lockPort = parseInt(fs.readFileSync(path.join(db.DATA_DIR, 'port.lock'), 'utf8'), 10);
    if (isNaN(lockPort) || lockPort < 1 || lockPort > 65535) {
      fs.unlinkSync(path.join(db.DATA_DIR, 'port.lock'));
    } else {
      const res = await fetch(`http://localhost:${lockPort}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) {
        process.stderr.write(`HTTP server detected on port ${lockPort} — running in MCP-only mode\n`);
        return;
      }
    }
  } catch (_) {}

  // No running server found — start our own.
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

  // Expose server for shutdown handler
  return server;
}

let httpServer = null;

function shutdown() {
  killAllAgents(); // don't leave spawned agents running after the server exits
  if (isHttpRunning() && httpServer) {
    try { fs.unlinkSync(path.join(db.DATA_DIR, 'port.lock')); } catch (_) {}
    for (const res of sseClients) { try { res.end(); } catch(_) {} }
    sseClients.clear();
    httpServer.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Kick off server startup (async). We don't await it — MCP stdio listener starts
// immediately regardless of whether we bind HTTP or run MCP-only.
startServer().then(srv => { if (srv) httpServer = srv; }).catch(() => {});

const transport = new StdioServerTransport();
mcp.connect(transport)
  .then(() => process.stderr.write('MCP server connected via stdio\n'))
  .catch(err => process.stderr.write('MCP connect error: ' + err.message + '\n'));
