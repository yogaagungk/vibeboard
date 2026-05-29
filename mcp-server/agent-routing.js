const db = require('./db');
const { PORT } = require('./config');
const { emitSSE, isHttpRunning } = require('./events');
const { spawnAgent, stopAgent, isAgentRunning, isAgentActive } = require('./agent');

// Agent processes are tracked in-memory by the process that spawns them. The
// HTTP server and the MCP stdio server can be two separate processes, so agent
// spawn/stop is always routed to the HTTP-server process — otherwise the child's
// completion callback (which POSTs to the HTTP server) would land in a process
// whose activeAgents map never had the card, leaking timeouts and dropping the
// session-output note.
function routeSpawnAgent(cardId) {
  if (isHttpRunning()) {
    const card = db.getCard(cardId);
    if (card?.agent) {
      spawnAgent(cardId, card.workspace_id, card.agent, emitSSE);
    }
  } else {
    fetch(`http://localhost:${PORT}/api/cards/${cardId}/run`, { method: 'POST' }).catch(() => {});
  }
}

function routeStopAgent(cardId) {
  if (isHttpRunning()) {
    if (isAgentActive(cardId)) stopAgent(cardId);
  } else {
    fetch(`http://localhost:${PORT}/api/cards/${cardId}/stop`, { method: 'POST' }).catch(() => {});
  }
}

// Titles of a card's blocker dependencies that have NOT yet reached Done. A
// blocker whose card was deleted (no longer on the board) is treated as cleared.
function unfinishedBlockers(card, board) {
  if (!Array.isArray(card.blocked_by) || !card.blocked_by.length) return [];
  const colById = {};
  const cardById = {};
  for (const col of board.columns) {
    for (const c of col.cards) { colById[c.id] = col.title; cardById[c.id] = c; }
  }
  return card.blocked_by
    .filter(id => colById[id] && colById[id] !== 'Done')
    .map(id => cardById[id]?.title || id);
}

module.exports = { routeSpawnAgent, routeStopAgent, unfinishedBlockers };
