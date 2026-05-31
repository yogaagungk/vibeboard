const { HOST, PORT } = require('./config');

// Network-mode auth. When the board is bound to a non-loopback address it has no
// auth and can spawn agents with skipped permissions, so gate it with a shared
// token. Requests that originate from the host machine (loopback) are always
// allowed — this keeps the local UX and all inter-process calls (agent-done,
// sse-emit, spawn proxy, which all hit http://localhost) working without a token.
// Only remote clients must present the token via `X-VB-Token` or `?token=`.
const NETWORK_MODE = HOST !== '127.0.0.1' && HOST !== 'localhost';
let AUTH_TOKEN = process.env.VB_TOKEN || null;
if (NETWORK_MODE && !AUTH_TOKEN) {
  AUTH_TOKEN = require('crypto').randomBytes(18).toString('hex');
}

function getAuthToken() { return AUTH_TOKEN; }

function rotateToken() {
  if (!NETWORK_MODE) return null;
  AUTH_TOKEN = require('crypto').randomBytes(18).toString('hex');
  return AUTH_TOKEN;
}

function isLoopbackReq(req) {
  const ip = req.socket?.remoteAddress || req.ip || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// State-changing methods are the CSRF-relevant ones; GET/HEAD must never mutate.
function isMutating(method) {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

// Hostnames a loopback browser session is expected to use.
const LOOPBACK_HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`];

function originHost(req) {
  const origin = req.get('origin');
  if (!origin) return null;            // non-browser client (curl, inter-process fetch)
  try { return new URL(origin).host; } catch (_) { return false; } // malformed → reject
}

// CSRF / drive-by protection. A malicious page in the user's browser can send a
// no-preflight POST to http://localhost:7341 and trigger agents; the browser
// always attaches an Origin on such cross-origin requests, so we validate it.
// In loopback mode we also pin the Host header to localhost, which additionally
// defeats DNS-rebinding (where a spoofed Host would otherwise match the Origin).
// Returns an error string if the request should be blocked, else null.
function csrfBlockReason(req) {
  if (!isMutating(req.method)) return null;

  if (!NETWORK_MODE) {
    const host = req.get('host');
    if (host && !LOOPBACK_HOSTS.includes(host)) {
      // Custom hostnames mapped to loopback are intentionally rejected here;
      // use 127.0.0.1/localhost, or run with VB_HOST for network access.
      return 'unexpected Host header (possible DNS rebinding)';
    }
    const oHost = originHost(req);
    if (oHost === false || (oHost && !LOOPBACK_HOSTS.includes(oHost))) {
      return 'cross-origin request blocked';
    }
    return null;
  }

  // Network mode: the token is the primary gate, but still reject an Origin that
  // doesn't match the host the client connected to.
  const oHost = originHost(req);
  if (oHost === false || (oHost && oHost !== req.get('host'))) {
    return 'cross-origin request blocked';
  }
  return null;
}

function authMiddleware(req, res, next) {
  const blocked = csrfBlockReason(req);
  if (blocked) return res.status(403).json({ error: `Forbidden: ${blocked}` });

  if (!NETWORK_MODE) return next();
  if (isLoopbackReq(req)) return next();
  const token = req.get('x-vb-token') || req.query.token;
  if (AUTH_TOKEN && token === AUTH_TOKEN) return next();
  res.status(401).json({ error: 'Unauthorized: missing or invalid token. Append ?token=… to the URL.' });
}

module.exports = { NETWORK_MODE, getAuthToken, rotateToken, isLoopbackReq, authMiddleware };
