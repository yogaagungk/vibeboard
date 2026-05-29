'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

// agent.js transitively requires db.js — point it at a throwaway DB so requiring
// the module never touches the real one.
const TMP_DB = path.join(os.tmpdir(), `vb-agent-test-${Date.now()}.db`);
process.env.VB_DB_PATH = TMP_DB;

const { buildShellCmd, isSafeModel } = require('../mcp-server/agent');

test.after?.(() => { try { fs.unlinkSync(TMP_DB); } catch (_) {} });

// ── isSafeModel ───────────────────────────────────────────────────────────────

test('isSafeModel accepts well-formed model ids', () => {
  assert.equal(isSafeModel('claude-opus-4-8'), true);
  assert.equal(isSafeModel('anthropic/claude-sonnet-4-6'), true);
  assert.equal(isSafeModel('gpt-5-codex'), true);
  assert.equal(isSafeModel('opencode/grok-code-fast-1'), true);
});

test('isSafeModel rejects shell metacharacters and bad types', () => {
  assert.equal(isSafeModel('model; rm -rf /'), false);
  assert.equal(isSafeModel('model$(whoami)'), false);
  assert.equal(isSafeModel('model && echo pwned'), false);
  assert.equal(isSafeModel('model`id`'), false);
  assert.equal(isSafeModel(''), false);
  assert.equal(isSafeModel(undefined), false);
  assert.equal(isSafeModel(null), false);
  assert.equal(isSafeModel(42), false);
});

// ── buildShellCmd ─────────────────────────────────────────────────────────────

test('buildShellCmd references the prompt file for each known agent', () => {
  const pf = '/tmp/prompt.txt';
  for (const agent of ['claude-code', 'opencode', 'codex']) {
    const cmd = buildShellCmd(agent, pf);
    assert.ok(cmd.includes(pf), `${agent} command should reference the prompt file`);
  }
});

test('buildShellCmd adds --model flag only for safe models', () => {
  const pf = '/tmp/prompt.txt';
  assert.ok(buildShellCmd('claude-code', pf, 'claude-opus-4-8').includes('--model claude-opus-4-8'));
  assert.ok(buildShellCmd('opencode', pf, 'anthropic/claude-sonnet-4-6').includes('--model anthropic/claude-sonnet-4-6'));
  assert.ok(buildShellCmd('codex', pf, 'gpt-5-codex').includes('--model gpt-5-codex'));
});

test('buildShellCmd drops unsafe model values (no injection)', () => {
  const pf = '/tmp/prompt.txt';
  const cmd = buildShellCmd('claude-code', pf, 'evil; rm -rf /');
  assert.ok(!cmd.includes('rm -rf'), 'unsafe model must not be interpolated into the command');
  assert.ok(!cmd.includes('--model'), 'unsafe model must not produce a --model flag');
});

test('buildShellCmd omits --model when no model given', () => {
  const cmd = buildShellCmd('claude-code', '/tmp/prompt.txt');
  assert.ok(!cmd.includes('--model'));
  assert.ok(cmd.includes('--dangerously-skip-permissions'));
});
