const path = require('path');

// Shared server configuration. PUBLIC_DIR is resolved relative to this module
// (not cwd) so the UI is found no matter where the `vibeboard` bin is launched.
const PORT = (() => {
  const raw = process.env.PORT || 7341;
  const port = parseInt(raw, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    process.stderr.write(`Invalid PORT: ${raw} (must be 1-65535)\n`);
    process.exit(1);
  }
  return port;
})();
// Bind to loopback by default. The board has no auth and can spawn agents with
// skipped permissions, so exposing it on the network is opt-in via VB_HOST=0.0.0.0.
const HOST = process.env.VB_HOST || '127.0.0.1';
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
// Single source of truth for the running version: package.json. Bumping
// package.json (e.g. via `npm version`) automatically updates /health,
// /api/version, and the in-app version badge.
const { version: VERSION } = require('../package.json');

module.exports = { PORT, HOST, PUBLIC_DIR, VERSION };
