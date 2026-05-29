'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

// auth.js reads HOST/PORT at load. With VB_HOST unset it's loopback mode, which
// is the configuration these CSRF tests target.
const { authMiddleware } = require('../mcp-server/auth');
const PORT = process.env.PORT || 7341;

// Drive authMiddleware with a fake req/res and report whether next() ran.
function run({ method = 'GET', origin, host = `localhost:${PORT}` } = {}) {
  const headers = {};
  if (origin !== undefined) headers.origin = origin;
  if (host !== undefined) headers.host = host;
  const req = {
    method, headers, query: {},
    socket: { remoteAddress: '127.0.0.1' },
    get(name) { return this.headers[name.toLowerCase()]; },
  };
  const res = { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  let nexted = false;
  authMiddleware(req, res, () => { nexted = true; });
  return { nexted, code: res.code };
}

test('GET passes regardless of Origin (safe method)', () => {
  assert.equal(run({ method: 'GET', origin: 'https://evil.com' }).nexted, true);
});

test('loopback POST with no Origin is allowed (curl / inter-process fetch)', () => {
  assert.equal(run({ method: 'POST' }).nexted, true);
});

test('same-origin loopback POST is allowed', () => {
  assert.equal(run({ method: 'POST', origin: `http://localhost:${PORT}` }).nexted, true);
  assert.equal(run({ method: 'POST', origin: `http://127.0.0.1:${PORT}`, host: `127.0.0.1:${PORT}` }).nexted, true);
});

test('cross-site POST (foreign Origin) is blocked with 403', () => {
  const r = run({ method: 'POST', origin: 'https://evil.com' });
  assert.equal(r.nexted, false);
  assert.equal(r.code, 403);
});

test('spoofed Host (DNS rebinding) POST is blocked with 403', () => {
  const r = run({ method: 'POST', host: 'evil.com', origin: 'http://evil.com' });
  assert.equal(r.nexted, false);
  assert.equal(r.code, 403);
});

test('DELETE from a foreign Origin is blocked', () => {
  assert.equal(run({ method: 'DELETE', origin: 'https://evil.com' }).code, 403);
});
