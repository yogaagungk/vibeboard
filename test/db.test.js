'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Use a temp file so tests never touch the real DB
const TMP_DB = path.join(os.tmpdir(), `vb-test-${Date.now()}.db`);
process.env.VB_DB_PATH = TMP_DB;

// Per-test workspace dirs need to actually exist on disk because
// createWorkspace now validates the path. Create them on demand inside the
// OS temp dir.
const TMP_WS_ROOT = path.join(os.tmpdir(), `vb-test-ws-${Date.now()}`);
fs.mkdirSync(TMP_WS_ROOT, { recursive: true });
function tmpWs(name) {
  const dir = path.join(TMP_WS_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Require after setting the env var
const db = require('../mcp-server/db');

after(() => {
  try { fs.unlinkSync(TMP_DB); } catch (_) {}
  try { fs.rmSync(TMP_WS_ROOT, { recursive: true, force: true }); } catch (_) {}
});

// ── Workspaces ───────────────────────────────────────────────────────────────

test('createWorkspace creates workspace with default columns', () => {
  const ws = db.createWorkspace('Test WS', tmpWs('test'), 'desc', 0);
  assert.ok(ws.id.startsWith('ws-'));
  assert.equal(ws.name, 'Test WS');
  const board = db.getBoard(ws.id);
  assert.equal(board.columns.length, 4);
  assert.deepEqual(board.columns.map(c => c.title), ['Backlog', 'In Progress', 'Review', 'Done']);
});

test('listWorkspaces returns created workspace', () => {
  const ws = db.createWorkspace('Listed WS', tmpWs('listed'));
  const list = db.listWorkspaces();
  assert.ok(list.some(w => w.id === ws.id));
});

test('updateWorkspace updates name and description', () => {
  const ws = db.createWorkspace('Old Name', tmpWs('upd'));
  db.updateWorkspace(ws.id, { name: 'New Name', description: 'updated' });
  const updated = db.getWorkspace(ws.id);
  assert.equal(updated.name, 'New Name');
  assert.equal(updated.description, 'updated');
});

test('deleteWorkspace removes it', () => {
  const ws = db.createWorkspace('To Delete', tmpWs('del'));
  db.deleteWorkspace(ws.id);
  assert.equal(db.getWorkspace(ws.id), undefined);
});

// ── Cards ────────────────────────────────────────────────────────────────────

test('createCard adds card to column', () => {
  const ws = db.createWorkspace('Card WS', tmpWs('cards'));
  const board = db.getBoard(ws.id);
  const col = board.columns[0]; // Backlog
  const card = db.createCard(ws.id, col.id, 'My Task', { description: 'desc', tags: ['bug'], priority: 'high', due_date: '2026-12-01' });
  assert.ok(card.id.startsWith('card-'));
  assert.equal(card.title, 'My Task');
  assert.equal(card.priority, 'high');
  assert.equal(card.due_date, '2026-12-01');
  assert.deepEqual(card.tags, ['bug']);
});

test('getCard returns card with all fields', () => {
  const ws = db.createWorkspace('GetCard WS', tmpWs('gc'));
  const board = db.getBoard(ws.id);
  const col = board.columns[0];
  const created = db.createCard(ws.id, col.id, 'Get Me', { priority: 'low', due_date: '2026-06-01', custom_prompt: 'be terse' });
  const fetched = db.getCard(created.id);
  assert.equal(fetched.title, 'Get Me');
  assert.equal(fetched.priority, 'low');
  assert.equal(fetched.due_date, '2026-06-01');
  assert.equal(fetched.custom_prompt, 'be terse');
});

test('updateCard updates fields selectively', () => {
  const ws = db.createWorkspace('Update WS', tmpWs('updc'));
  const board = db.getBoard(ws.id);
  const col = board.columns[0];
  const card = db.createCard(ws.id, col.id, 'Original');
  db.updateCard(card.id, { title: 'Renamed', priority: 'medium', due_date: '2027-01-01' });
  const updated = db.getCard(card.id);
  assert.equal(updated.title, 'Renamed');
  assert.equal(updated.priority, 'medium');
  assert.equal(updated.due_date, '2027-01-01');
});

test('moveCard moves card to another column', () => {
  const ws = db.createWorkspace('Move WS', tmpWs('mv'));
  const board = db.getBoard(ws.id);
  const [backlog, inProgress] = board.columns;
  const card = db.createCard(ws.id, backlog.id, 'Moveable');
  db.moveCard(card.id, inProgress.id);
  const moved = db.getCard(card.id);
  assert.equal(moved.column_id, inProgress.id);
});

test('deleteCard removes card', () => {
  const ws = db.createWorkspace('Del Card WS', tmpWs('dc'));
  const board = db.getBoard(ws.id);
  const col = board.columns[0];
  const card = db.createCard(ws.id, col.id, 'Delete Me');
  db.deleteCard(card.id);
  assert.equal(db.getCard(card.id), null);
});

// ── Notes ────────────────────────────────────────────────────────────────────

test('addCardNote and getCardNotes work', () => {
  const ws = db.createWorkspace('Notes WS', tmpWs('notes'));
  const board = db.getBoard(ws.id);
  const col = board.columns[0];
  const card = db.createCard(ws.id, col.id, 'Noted Card');
  db.addCardNote(card.id, 'first note');
  db.addCardNote(card.id, 'second note');
  const notes = db.getCardNotes(card.id);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].content, 'first note');
  assert.equal(notes[1].content, 'second note');
});

// ── Agent log ─────────────────────────────────────────────────────────────────

test('addAgentLog inserts and caps at 500', () => {
  const ws = db.createWorkspace('Log WS', tmpWs('log'));
  // Insert 510 log entries
  for (let i = 0; i < 510; i++) {
    db.addAgentLog(ws.id, 'claude-code', 'test_action', `entry ${i}`);
  }
  const board = db.getBoard(ws.id);
  assert.ok(board.agentLog.length <= 500, `Expected ≤500 log entries, got ${board.agentLog.length}`);
});

// ── Export / Import ───────────────────────────────────────────────────────────

test('exportWorkspace returns correct structure', () => {
  const ws = db.createWorkspace('Export WS', tmpWs('exp'));
  const board = db.getBoard(ws.id);
  const col = board.columns[0];
  db.createCard(ws.id, col.id, 'Exported Card', { priority: 'high', tags: ['feature'] });
  const data = db.exportWorkspace(ws.id);
  assert.equal(data.version, 1);
  assert.equal(data.workspace.name, 'Export WS');
  assert.equal(data.columns.length, 4);
  const backlog = data.columns.find(c => c.title === 'Backlog');
  assert.equal(backlog.cards.length, 1);
  assert.equal(backlog.cards[0].title, 'Exported Card');
  assert.equal(backlog.cards[0].priority, 'high');
});

test('importWorkspace creates workspace with cards', () => {
  const exportData = {
    version: 1,
    workspace: { name: 'Imported WS', path: tmpWs('imp'), description: 'test' },
    columns: [
      { title: 'Backlog',     color: '#888', position: 0, cards: [{ title: 'Card A', tags: ['bug'], priority: 'low', notes: [{ content: 'a note', created_at: new Date().toISOString() }] }] },
      { title: 'In Progress', color: '#00f', position: 1, cards: [] },
      { title: 'Review',      color: '#f90', position: 2, cards: [] },
      { title: 'Done',        color: '#0a0', position: 3, cards: [] },
    ],
  };
  const ws = db.importWorkspace(exportData);
  assert.ok(ws.id);
  const board = db.getBoard(ws.id);
  const backlog = board.columns.find(c => c.title === 'Backlog');
  assert.equal(backlog.cards.length, 1);
  assert.equal(backlog.cards[0].title, 'Card A');
  assert.equal(backlog.cards[0].priority, 'low');
  const notes = db.getCardNotes(backlog.cards[0].id);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].content, 'a note');
});

// ── WIP limits ────────────────────────────────────────────────────────────────

test('syncBoard persists column wip_limit and getBoard returns it', () => {
  const ws = db.createWorkspace('WIP WS', tmpWs('wip'));
  const board = db.getBoard(ws.id);
  board.columns[1].wip_limit = 3; // In Progress
  db.syncBoard(ws.id, board.columns);
  const fresh = db.getBoard(ws.id);
  assert.equal(fresh.columns[1].wip_limit, 3);
  assert.equal(fresh.columns[0].wip_limit, null);
});

test('exportWorkspace/importWorkspace preserve wip_limit', () => {
  const ws = db.createWorkspace('WIP Export', tmpWs('wipexp'));
  const board = db.getBoard(ws.id);
  board.columns[2].wip_limit = 5; // Review
  db.syncBoard(ws.id, board.columns);
  const data = db.exportWorkspace(ws.id);
  const imported = db.importWorkspace(data);
  const ib = db.getBoard(imported.id);
  const review = ib.columns.find(c => c.title === 'Review');
  assert.equal(review.wip_limit, 5);
});

// ── Dependencies + run status ───────────────────────────────────────────────────

test('createCard persists blocked_by and getBoard/getCard return it as an array', () => {
  const ws = db.createWorkspace('Dep WS', tmpWs('dep'));
  const board = db.getBoard(ws.id);
  const col = board.columns[0];
  const blocker = db.createCard(ws.id, col.id, 'Blocker');
  const dependent = db.createCard(ws.id, col.id, 'Dependent', { blocked_by: [blocker.id] });
  const fetched = db.getCard(dependent.id);
  assert.deepEqual(fetched.blocked_by, [blocker.id]);
  const fresh = db.getBoard(ws.id);
  const card = fresh.columns[0].cards.find(c => c.id === dependent.id);
  assert.deepEqual(card.blocked_by, [blocker.id]);
});

test('updateCard records run status fields and they survive a UI sync', () => {
  const ws = db.createWorkspace('Run WS', tmpWs('run'));
  const board = db.getBoard(ws.id);
  const col = board.columns[0];
  const card = db.createCard(ws.id, col.id, 'Ran');
  db.updateCard(card.id, { last_exit_code: 0, last_duration: 42, last_cost: 0.0123, last_tokens: 4500 });
  let fetched = db.getCard(card.id);
  assert.equal(fetched.last_exit_code, 0);
  assert.equal(fetched.last_duration, 42);
  assert.equal(fetched.last_cost, 0.0123);
  assert.equal(fetched.last_tokens, 4500);

  // A full-board sync from the UI must not clobber agent-written run status.
  const b2 = db.getBoard(ws.id);
  db.syncBoard(ws.id, b2.columns);
  fetched = db.getCard(card.id);
  assert.equal(fetched.last_exit_code, 0);
  assert.equal(fetched.last_tokens, 4500);
});

test('syncBoard persists blocked_by edited from the UI', () => {
  const ws = db.createWorkspace('Dep Sync WS', tmpWs('depsync'));
  const board = db.getBoard(ws.id);
  const col = board.columns[0];
  const a = db.createCard(ws.id, col.id, 'A');
  const b = db.createCard(ws.id, col.id, 'B');
  const fresh = db.getBoard(ws.id);
  const cardB = fresh.columns[0].cards.find(c => c.id === b.id);
  cardB.blocked_by = [a.id];
  db.syncBoard(ws.id, fresh.columns);
  assert.deepEqual(db.getCard(b.id).blocked_by, [a.id]);
});

// ── Active workspace ──────────────────────────────────────────────────────────

// ── Merged at ──────────────────────────────────────────────────────────────────

test('merged_at persists through getCard and getBoard and export/import', () => {
  const ws = db.createWorkspace('Merged WS', tmpWs('merged'));
  const board = db.getBoard(ws.id);
  const col = board.columns[0];
  const card = db.createCard(ws.id, col.id, 'Will be merged');
  const ts = new Date().toISOString();
  db.updateCard(card.id, { merged_at: ts });

  const fetched = db.getCard(card.id);
  assert.equal(fetched.merged_at, ts);

  const fresh = db.getBoard(ws.id);
  const bc = fresh.columns[0].cards.find(c => c.id === card.id);
  assert.equal(bc.merged_at, ts);

  // export/import round-trips merged_at
  const data = db.exportWorkspace(ws.id);
  const imported = db.importWorkspace(data);
  const ib = db.getBoard(imported.id);
  const ic = ib.columns[0].cards.find(c => c.title === 'Will be merged');
  assert.equal(ic.merged_at, ts);
});

test('createCard with merged_at sets the field', () => {
  const ws = db.createWorkspace('Create Merged WS', tmpWs('cmerged'));
  const board = db.getBoard(ws.id);
  const col = board.columns[0];
  const ts = new Date().toISOString();
  const card = db.createCard(ws.id, col.id, 'Pre-merged', { merged_at: ts });
  assert.equal(card.merged_at, ts);
  const fetched = db.getCard(card.id);
  assert.equal(fetched.merged_at, ts);
});

test('setActiveWorkspaceId and getActiveWorkspaceId work', () => {
  const ws = db.createWorkspace('Active WS', tmpWs('active'));
  db.setActiveWorkspaceId(ws.id);
  assert.equal(db.getActiveWorkspaceId(), ws.id);
});
