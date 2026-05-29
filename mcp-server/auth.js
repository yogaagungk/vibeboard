const { HOST } = require('./config');

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

function isLoopbackReq(req) {
  const ip = req.socket?.remoteAddress || req.ip || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function authMiddleware(req, res, next) {
  if (!NETWORK_MODE) return next();
  if (isLoopbackReq(req)) return next();
  const token = req.get('x-vb-token') || req.query.token;
  if (AUTH_TOKEN && token === AUTH_TOKEN) return next();
  res.status(401).json({ error: 'Unauthorized: missing or invalid token. Append ?token=… to the URL.' });
}

module.exports = { NETWORK_MODE, getAuthToken, isLoopbackReq, authMiddleware };
