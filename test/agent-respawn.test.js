'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

// Use a throw-away DB and a restrictive concurrency cap (1) so we can exercise
// the queue path without spawning 4+ agents.
const TMP_DB = path.join(os.tmpdir(), `vb-agent-respawn-${Date.now()}.db`);
process.env.VB_DB_PATH = TMP_DB;
process.env.VB_MAX_AGENTS = '1';

const TMP_WS_ROOT = path.join(os.tmpdir(), `vb-agent-respawn-ws-${Date.now()}`);
fs.mkdirSync(TMP_WS_ROOT, { recursive: true });

// ── Mock child_process.spawn ──────────────────────────────────────────────────
// Must be installed before agent.js is loaded so the top-level `const { spawn }`
// captures the mock instead of the real one.

let currentFakeChild = null;

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.pipe = () => {};
  child.stderr.pipe = () => {};
  child.pid = 54321;
  child.kill = () => {};
  currentFakeChild = child;
  return child;
}

const cp = require('child_process');
const originalSpawn = cp.spawn;
cp.spawn = () => makeFakeChild();

// Mock fetch so the agent-done HTTP POST inside launchAgent drives the lifecycle
// synchronously instead of hitting a non-existent server.
const originalFetch = global.fetch;
let agentDoneHook = null;
global.fetch = (url, opts = {}) => {
  if (typeof url === 'string' && url.includes('/api/agent-done/') && opts.body) {
    const cardId = url.split('/').pop();
    const { code } = JSON.parse(opts.body);
    if (agentDoneHook) agentDoneHook(cardId, code);
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }
  return originalFetch ? originalFetch(url, opts) : Promise.reject(new Error('no fetch'));
};

// ── Modules ────────────────────────────────────────────────────────────────────

const db = require('../mcp-server/db');
const agent = require('../mcp-server/agent');

// ── Test emitSSE: captures events in an array instead of broadcasting ──────────

const capturedSSE = [];
function testEmitSSE(type, data) {
  capturedSSE.push({ type, data: JSON.parse(JSON.stringify(data)) });
}
function resetSSE() { capturedSSE.length = 0; }
function sseOfType(type) { return capturedSSE.filter(e => e.type === type); }

// ── Helpers ────────────────────────────────────────────────────────────────────

function tmpWs(name) {
  const dir = path.join(TMP_WS_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function setupCard(columnTitle, agentType) {
  const ws = db.createWorkspace('Respawn WS', tmpWs('respawn-' + Date.now()), '', 0);
  const board = db.getBoard(ws.id);
  const col = board.columns.find(c => c.title === columnTitle);
  const card = db.createCard(ws.id, col.id, 'Respawn Test', { agent: agentType || 'opencode' });
  return { ws, board, col, card };
}

// ── Setup / Cleanup ───────────────────────────────────────────────────────────

beforeEach(() => {
  agent.killAllAgents();
  agentDoneHook = null;
});

after(() => {
  agent.killAllAgents();
  cp.spawn = originalSpawn;
  global.fetch = originalFetch;
  try { fs.unlinkSync(TMP_DB); } catch (_) {}
  try { fs.rmSync(TMP_WS_ROOT, { recursive: true, force: true }); } catch (_) {}
});

// ── Tests ──────────────────────────────────────────────────────────────────────

test('respawn fires after exit when agent moved itself to Review', () => {
  resetSSE();
  const { ws, card } = setupCard('In Progress');
  const reviewCol = db.getBoard(ws.id).columns.find(c => c.title === 'Review');

  // 1) start the agent
  agent.spawnAgent(card.id, ws.id, 'opencode', testEmitSSE);
  assert.equal(agent.isAgentRunning(card.id), true, 'agent should be running');
  const started1 = sseOfType('agent_started');
  assert.equal(started1.length, 1, 'should have one agent_started event');

  // 2) simulate the agent moving itself to Review while still running
  db.moveCard(card.id, reviewCol.id);
  agent.spawnAgent(card.id, ws.id, 'opencode', testEmitSSE);
  const pendingEvents = sseOfType('agent_pending_respawn');
  assert.equal(pendingEvents.length, 1, 'should emit agent_pending_respawn');
  assert.equal(pendingEvents[0].data.cardId, card.id);
  assert.equal(agent.isPendingRespawn(card.id), true, 'card should be pending respawn');

  // 3) the running agent exits
  const hook = (cid, code) => {
    agentDoneHook = null;
    agent.agentDone(cid, code, testEmitSSE);
  };
  agentDoneHook = hook;
  currentFakeChild.emit('close', 0);

  // After agentDone the pending respawn should fire a second spawn
  const startedAll = sseOfType('agent_started');
  assert.equal(startedAll.length, 2, 'should have two agent_started events (initial + respawn)');
  assert.equal(agent.isPendingRespawn(card.id), false, 'pending respawn should be cleared');
  assert.equal(agent.isAgentRunning(card.id), true, 'agent should be running for review phase');
});

test('no respawn when agent moved itself to Done', () => {
  resetSSE();
  const { ws, card } = setupCard('In Progress');
  const doneCol = db.getBoard(ws.id).columns.find(c => c.title === 'Done');

  // 1) start the agent
  agent.spawnAgent(card.id, ws.id, 'opencode', testEmitSSE);
  assert.equal(agent.isAgentRunning(card.id), true);

  // 2) move to Done while agent still running
  db.moveCard(card.id, doneCol.id);
  agent.spawnAgent(card.id, ws.id, 'opencode', testEmitSSE);

  // Done is NOT a spawnable column -> no pending respawn
  const pendingEvents = sseOfType('agent_pending_respawn');
  assert.equal(pendingEvents.length, 0, 'should NOT emit agent_pending_respawn for Done');
  assert.equal(agent.isPendingRespawn(card.id), false, 'card should NOT be pending respawn');
});

test('respawn-with-no-free-slot is queued then dequeued', () => {
  resetSSE();
  const { ws: wsA, card: cardA } = setupCard('In Progress');
  const { ws: wsB, card: cardB } = setupCard('In Progress');
  const reviewCol = db.getBoard(wsA.id).columns.find(c => c.title === 'Review');

  // VB_MAX_AGENTS=1 -> only one slot

  // 1) start card A
  agent.spawnAgent(cardA.id, wsA.id, 'opencode', testEmitSSE);
  assert.equal(agent.isAgentRunning(cardA.id), true);

  // 2) card A moves to Review while running -> pending respawn
  db.moveCard(cardA.id, reviewCol.id);
  agent.spawnAgent(cardA.id, wsA.id, 'opencode', testEmitSSE);
  assert.equal(agent.isPendingRespawn(cardA.id), true);

  // 3) also queue card B while A is running
  agent.spawnAgent(cardB.id, wsB.id, 'opencode', testEmitSSE);
  assert.equal(agent.isAgentRunning(cardA.id), true, 'A still running');
  assert.equal(agent.isAgentRunning(cardB.id), false, 'B should be queued, not running');
  assert.equal(agent.isAgentActive(cardB.id), true, 'B should be active (queued)');

  // 4) card A exits -> agentDone: dequeueNext starts B (fills the slot),
  //    then pending respawn for A finds no free slot -> A gets queued
  const hook = (cid, code) => {
    agentDoneHook = null;
    agent.agentDone(cid, code, testEmitSSE);
  };
  agentDoneHook = hook;
  currentFakeChild.emit('close', 0);

  // B should now be running (dequeued into the single slot)
  assert.equal(agent.isAgentRunning(cardB.id), true, 'B should be running after dequeue');
  // A's respawn should be queued (no free slot)
  assert.equal(agent.isPendingRespawn(cardA.id), false, 'A no longer in pendingRespawn map');
  assert.equal(agent.isAgentRunning(cardA.id), false, 'A should not be running (cap reached)');

  // So far we should have: A initial, B started = 2 agent_started events
  const startedSoFar = sseOfType('agent_started');
  assert.equal(startedSoFar.length, 2, 'A initial + B started = 2');

  // 5) B exits -> dequeueNext starts A
  const hookB = (cid, code) => {
    agentDoneHook = null;
    agent.agentDone(cid, code, testEmitSSE);
  };
  agentDoneHook = hookB;
  currentFakeChild.emit('close', 0);

  // A should now be running (dequeued after B exited)
  assert.equal(agent.isAgentRunning(cardA.id), true, 'A should be running after B exits');
  const startedFinal = sseOfType('agent_started');
  assert.equal(startedFinal.length, 3, 'A initial + B + A respawn = 3');
});
