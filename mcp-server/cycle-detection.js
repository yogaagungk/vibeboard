function buildGraph(cards) {
  const graph = {};
  for (const card of cards) {
    graph[card.id] = (card.blocked_by || []).filter(id => id !== card.id);
  }
  return graph;
}

function wouldCreateCycle(cardId, newBlockedBy, cards) {
  newBlockedBy = (newBlockedBy || []).filter(id => id !== cardId);
  if (!newBlockedBy.length) return null;

  const graph = buildGraph(cards);
  graph[cardId] = newBlockedBy;

  function dfs(currentId, visited, path) {
    if (currentId === cardId) return [...path, currentId];
    if (visited.has(currentId)) return null;
    visited.add(currentId);
    for (const blocker of (graph[currentId] || [])) {
      const result = dfs(blocker, visited, [...path, currentId]);
      if (result) return result;
    }
    return null;
  }

  for (const blocker of newBlockedBy) {
    const cyclePath = dfs(blocker, new Set(), []);
    if (cyclePath) {
      return [cardId, ...cyclePath];
    }
  }
  return null;
}

function findCycleIds(cards) {
  const graph = buildGraph(cards);
  const inCycle = new Set();

  for (const card of cards) {
    if (inCycle.has(card.id)) continue;

    const visited = new Set();
    const path = [];

    function dfs(id) {
      const idx = path.indexOf(id);
      if (idx !== -1) {
        for (let i = idx; i < path.length; i++) inCycle.add(path[i]);
        return true;
      }
      if (visited.has(id)) return false;
      visited.add(id);
      path.push(id);
      for (const blocker of (graph[id] || [])) {
        if (dfs(blocker)) { path.pop(); return true; }
      }
      path.pop();
      return false;
    }

    dfs(card.id);
  }

  return [...inCycle];
}

module.exports = { wouldCreateCycle, findCycleIds, buildGraph };
