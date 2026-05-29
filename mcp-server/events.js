const fs = require('fs');
const path = require('path');
const { PORT } = require('./config');
const { DATA_DIR } = require('./db');

// SSE fan-out to connected UI clients. The HTTP server and the MCP stdio server
// can be separate processes (when an agent connects it launches its own
// `node index.js`, which finds the port in use and runs MCP-only). Only the
// HTTP-server process holds live SSE clients, so emitSSE broadcasts locally when
// it owns the HTTP server and otherwise proxies to the running one.
const sseClients = new Set();
let httpRunning = false;

function setHttpRunning(v) { httpRunning = v; }
function isHttpRunning() { return httpRunning; }

function broadcast(type, data) {
  const payload = 'data: ' + JSON.stringify({ type, data }) + '\n\n';
  for (const res of sseClients) res.write(payload);
}

function getHttpPort() {
  try {
    const port = parseInt(fs.readFileSync(path.join(DATA_DIR, 'port.lock'), 'utf8'), 10);
    if (port > 0) return port;
  } catch (_) {}
  return PORT;
}

function emitSSE(type, data) {
  if (httpRunning) {
    broadcast(type, data);
  } else {
    // MCP-only mode: proxy to the running HTTP server
    fetch(`http://localhost:${getHttpPort()}/api/sse-emit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data }),
    }).catch(() => {});
  }
}

module.exports = { sseClients, emitSSE, broadcast, setHttpRunning, isHttpRunning };
