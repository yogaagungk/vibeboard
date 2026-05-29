'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `vb-mcp-test-${Date.now()}.db`);
process.env.VB_DB_PATH = TMP_DB;

const TMP_WS_ROOT = path.join(os.tmpdir(), `vb-mcp-test-ws-${Date.now()}`);
fs.mkdirSync(TMP_WS_ROOT, { recursive: true });
function tmpWs(name) {
  const dir = path.join(TMP_WS_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const db = require('../mcp-server/db');

after(() => {
  try { fs.unlinkSync(TMP_DB); } catch (_) {}
  try { fs.rmSync(TMP_WS_ROOT, { recursive: true, force: true }); } catch (_) {}
});

test('updateCard via update_card handler path — requires_review false on true-default card', () => {
  const ws = db.createWorkspace('Review Test', tmpWs('review'));
  const board = db.getBoard(ws.id);
  const col = board.columns[0];
  const card = db.createCard(ws.id, col.id, 'Needs Review', { requires_review: true });
  assert.equal(card.requires_review, true);

  db.updateCard(card.id, { requires_review: false });
  const updated = db.getCard(card.id);
  assert.equal(updated.requires_review, false);
});

test('updateCard via update_card handler path — requires_review true works', () => {
  const ws = db.createWorkspace('Review Test 2', tmpWs('review2'));
  const board = db.getBoard(ws.id);
  const col = board.columns[0];
  const card = db.createCard(ws.id, col.id, 'No Review', { requires_review: false });
  assert.equal(card.requires_review, false);

  db.updateCard(card.id, { requires_review: true });
  const updated = db.getCard(card.id);
  assert.equal(updated.requires_review, true);
});

test('updateCard via update_card handler path — custom_prompt is updatable', () => {
  const ws = db.createWorkspace('Prompt Test', tmpWs('prompt'));
  const board = db.getBoard(ws.id);
  const col = board.columns[0];
  const card = db.createCard(ws.id, col.id, 'Prompted');
  assert.equal(card.custom_prompt, '');

  db.updateCard(card.id, { custom_prompt: 'Be concise and use emojis' });
  const updated = db.getCard(card.id);
  assert.equal(updated.custom_prompt, 'Be concise and use emojis');
});

test('updateCard via update_card handler path — custom_prompt can be cleared', () => {
  const ws = db.createWorkspace('Prompt Clear', tmpWs('prompt-clr'));
  const board = db.getBoard(ws.id);
  const col = board.columns[0];
  const card = db.createCard(ws.id, col.id, 'Prompt Clear', { custom_prompt: 'old prompt' });
  assert.equal(card.custom_prompt, 'old prompt');

  db.updateCard(card.id, { custom_prompt: '' });
  const updated = db.getCard(card.id);
  assert.equal(updated.custom_prompt, '');
});

test('updateCard via update_card handler path — merged_at sets timestamp and clears branch/worktree', () => {
  const ws = db.createWorkspace('Merge TS', tmpWs('merge-ts'));
  const board = db.getBoard(ws.id);
  const col = board.columns[0];
  const card = db.createCard(ws.id, col.id, 'TS Merge');
  assert.equal(card.merged_at, null);

  db.updateCard(card.id, { branch: 'feature/foo', worktreePath: '/tmp/wt' });
  let updated = db.getCard(card.id);
  assert.equal(updated.branch, 'feature/foo');
  assert.equal(updated.worktree_path, '/tmp/wt');

  db.updateCard(card.id, { merged_at: '2026-01-01T00:00:00.000Z', branch: null, worktreePath: null });
  updated = db.getCard(card.id);
  assert.equal(updated.merged_at, '2026-01-01T00:00:00.000Z');
  assert.equal(updated.branch, null);
  assert.equal(updated.worktree_path, null);
});

test('updateCard via update_card handler path — merged_at clears to null', () => {
  const ws = db.createWorkspace('Merge Null', tmpWs('merge-null'));
  const board = db.getBoard(ws.id);
  const col = board.columns[0];
  const card = db.createCard(ws.id, col.id, 'Null Merge', { merged_at: '2026-01-01T00:00:00.000Z' });
  assert.equal(card.merged_at, '2026-01-01T00:00:00.000Z');

  db.updateCard(card.id, { merged_at: null });
  const updated = db.getCard(card.id);
  assert.equal(updated.merged_at, null);
});

test('updateCard via update_card handler path — merged_at rejects invalid datetime', () => {
  const { z } = require('zod');
  const schema = z.string().datetime().nullable().optional();
  assert.equal(schema.safeParse('not-a-date').success, false);
  assert.equal(schema.safeParse('2026-01-01').success, false);
  assert.equal(schema.safeParse('2026-01-01T00:00:00.000Z').success, true);
  assert.equal(schema.safeParse(null).success, true);
  assert.equal(schema.safeParse(undefined).success, true);
});
