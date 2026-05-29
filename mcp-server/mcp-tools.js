const { z } = require('zod');
const db = require('./db');
const { emitSSE } = require('./events');
const { routeSpawnAgent, routeStopAgent, unfinishedBlockers } = require('./agent-routing');

// Register all MCP tools on the given McpServer. Every tool returns a JSON text
// payload and never throws — errors are serialized so the agent can react.
module.exports = function registerMcpTools(mcp) {
  mcp.tool('get_board', 'Get the full board state of the active workspace', {}, async () => {
    try {
      const activeId = db.getActiveWorkspaceId();
      if (!activeId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'No active workspace' }) }] };
      return { content: [{ type: 'text', text: JSON.stringify(db.getBoard(activeId)) }] };
    } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
  });

  mcp.tool('list_workspaces', 'List all workspaces and which one is active', {}, async () => {
    try {
      const active = db.getActiveWorkspaceId();
      return { content: [{ type: 'text', text: JSON.stringify(db.listWorkspaces().map(w => ({ ...w, active: w.id === active }))) }] };
    } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
  });

  mcp.tool('create_workspace', 'Create a new workspace',
    { name: z.string(), path: z.string(), description: z.string().optional() },
    async ({ name, path: wsPath, description }) => {
      try {
        const ws = db.createWorkspace(name, wsPath, description || '');
        if (!db.getActiveWorkspaceId()) {
          db.setActiveWorkspaceId(ws.id);
          emitSSE('workspace_switch', { board: db.getBoard(ws.id), workspaceId: ws.id });
        }
        const active = db.getActiveWorkspaceId();
        emitSSE('workspace_list', db.listWorkspaces().map(w => ({ ...w, active: w.id === active })));
        return { content: [{ type: 'text', text: JSON.stringify(ws) }] };
      } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
    }
  );

  mcp.tool('switch_workspace', 'Switch the active workspace', { workspaceId: z.string() }, async ({ workspaceId }) => {
    try {
      const ws = db.getWorkspace(workspaceId);
      if (!ws) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Workspace not found' }) }] };
      db.setActiveWorkspaceId(workspaceId);
      const board = db.getBoard(workspaceId);
      emitSSE('workspace_switch', { board, workspaceId });
      return { content: [{ type: 'text', text: JSON.stringify(board) }] };
    } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
  });

  mcp.tool('set_workspace', 'Update name, path, or description of the active workspace',
    { name: z.string().optional(), path: z.string().optional(), description: z.string().optional() },
    async ({ name, path: wsPath, description }) => {
      try {
        const activeId = db.getActiveWorkspaceId();
        if (!activeId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'No active workspace' }) }] };
        db.updateWorkspace(activeId, { name, path: wsPath, description });
        emitSSE('board_update', db.getBoard(activeId));
        const active = db.getActiveWorkspaceId();
        emitSSE('workspace_list', db.listWorkspaces().map(w => ({ ...w, active: w.id === active })));
        const ws = db.getWorkspace(activeId);
        return { content: [{ type: 'text', text: JSON.stringify({ id: ws.id, name: ws.name, path: ws.path, description: ws.description }) }] };
      } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
    }
  );

  mcp.tool('get_column', 'Get all cards in a specific column', { columnTitle: z.string() }, async ({ columnTitle }) => {
    try {
      const activeId = db.getActiveWorkspaceId();
      if (!activeId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'No active workspace' }) }] };
      const board = db.getBoard(activeId);
      const column = board.columns.find(c => c.title === columnTitle);
      if (!column) return { content: [{ type: 'text', text: JSON.stringify({ error: `Column not found: ${columnTitle}` }) }] };
      return { content: [{ type: 'text', text: JSON.stringify({ column, cards: column.cards }) }] };
    } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
  });

  mcp.tool('create_card', 'Create a new card in a column (default: Backlog). blocked_by takes card IDs that must reach Done before this card can move to In Progress.',
    { title: z.string(), columnTitle: z.string().optional(), tags: z.array(z.string()).optional(), description: z.string().optional(), agent: z.enum(['claude-code', 'opencode', 'codex']).optional(), model: z.string().optional(), priority: z.enum(['high', 'medium', 'low']).optional(), due_date: z.string().optional(), blocked_by: z.array(z.string()).optional() },
    async ({ title, columnTitle = 'Backlog', tags = [], description, agent, model, priority, due_date, blocked_by }) => {
      try {
        const activeId = db.getActiveWorkspaceId();
        if (!activeId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'No active workspace' }) }] };
        const board = db.getBoard(activeId);
        const column = board.columns.find(c => c.title === columnTitle);
        if (!column) return { content: [{ type: 'text', text: JSON.stringify({ error: `Column not found: ${columnTitle}` }) }] };
        const card = db.createCard(activeId, column.id, title, { description, tags, agent, model, priority, due_date, blocked_by });
        db.addAgentLog(activeId, agent || 'system', 'create_card', `Created '${title}' in ${columnTitle}`);
        emitSSE('board_update', db.getBoard(activeId));
        return { content: [{ type: 'text', text: JSON.stringify(card) }] };
      } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
    }
  );

  mcp.tool('update_card', "Update a card's title, description, tags, assigned agent, model, priority, or blocked_by dependencies",
    { cardId: z.string(), title: z.string().optional(), description: z.string().optional(), tags: z.array(z.string()).optional(), agent: z.enum(['claude-code', 'opencode', 'codex', '']).optional(), model: z.string().optional(), priority: z.enum(['high', 'medium', 'low', '']).optional(), due_date: z.string().optional(), blocked_by: z.array(z.string()).optional() },
    async ({ cardId, title, description, tags, agent, model, priority, due_date, blocked_by }) => {
      try {
        const card = db.getCard(cardId);
        if (!card) return { content: [{ type: 'text', text: JSON.stringify({ error: `Card not found: ${cardId}` }) }] };
        db.updateCard(cardId, { title, description, tags, agent: agent || undefined, model: model !== undefined ? model : undefined, priority: priority || undefined, due_date: due_date !== undefined ? due_date : undefined, blocked_by: blocked_by !== undefined ? blocked_by : undefined });
        db.addAgentLog(card.workspace_id, agent || 'system', 'update_card', `Updated '${card.title}'`);
        emitSSE('board_update', db.getBoard(card.workspace_id));
        return { content: [{ type: 'text', text: JSON.stringify(db.getCard(cardId)) }] };
      } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
    }
  );

  mcp.tool('move_card', 'Move a card to a different column',
    { cardId: z.string(), toColumnTitle: z.string() },
    async ({ cardId, toColumnTitle }) => {
      try {
        const card = db.getCard(cardId);
        if (!card) return { content: [{ type: 'text', text: JSON.stringify({ error: `Card not found: ${cardId}` }) }] };

        const board = db.getBoard(card.workspace_id);
        if (!board) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Card workspace not found' }) }] };

        const toColumn = board.columns.find(c => c.title === toColumnTitle);
        if (!toColumn) return { content: [{ type: 'text', text: JSON.stringify({ error: `Column not found: ${toColumnTitle}` }) }] };

        // Enforce WIP limit: refuse to move a card into a different column already
        // at capacity (reordering / staying in place is always allowed).
        if (card.column_id !== toColumn.id && Number.isInteger(toColumn.wip_limit) && toColumn.wip_limit > 0 && toColumn.cards.length >= toColumn.wip_limit) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: `Column '${toColumnTitle}' is at its WIP limit (${toColumn.cards.length}/${toColumn.wip_limit})` }) }] };
        }

        // Enforce dependencies: a card can't start (move to In Progress) until all
        // of its blockers have reached Done.
        if (card.column_id !== toColumn.id && toColumnTitle === 'In Progress') {
          const blockers = unfinishedBlockers(card, board);
          if (blockers.length) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Card is blocked by unfinished card(s): ${blockers.join(', ')}` }) }] };
          }
        }

        const fromColumn = db.getColumn(card.column_id);
        db.moveCard(cardId, toColumn.id);
        db.addAgentLog(card.workspace_id, card.agent || 'system', 'move_card', `Moved '${card.title}' → ${toColumnTitle}`);
        emitSSE('board_update', db.getBoard(card.workspace_id));

        if ((toColumnTitle === 'In Progress' || toColumnTitle === 'Review') && card.agent) {
          emitSSE('trigger', { card, toColumn: toColumnTitle, agent: card.agent });
          routeSpawnAgent(cardId);
        }

        return { content: [{ type: 'text', text: JSON.stringify({ card, fromColumn: fromColumn.title, toColumn: toColumnTitle }) }] };
      } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
    }
  );

  mcp.tool('complete_card', 'Mark a card as done (moves to Done column)', { cardId: z.string() }, async ({ cardId }) => {
    try {
      const card = db.getCard(cardId);
      if (!card) return { content: [{ type: 'text', text: JSON.stringify({ error: `Card not found: ${cardId}` }) }] };

      const board = db.getBoard(card.workspace_id);
      if (!board) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Card workspace not found' }) }] };

      const doneColumn = board.columns.find(c => c.title === 'Done');
      if (!doneColumn) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Done column not found' }) }] };

      const fromColumn = db.getColumn(card.column_id);
      db.moveCard(cardId, doneColumn.id);
      db.addAgentLog(card.workspace_id, card.agent || 'system', 'complete_card', `Completed '${card.title}'`);
      emitSSE('board_update', db.getBoard(card.workspace_id));
      emitSSE('trigger', { card, toColumn: 'Done' });

      routeStopAgent(cardId);

      return { content: [{ type: 'text', text: JSON.stringify({ card, fromColumn: fromColumn.title }) }] };
    } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
  });

  mcp.tool('delete_card', 'Delete a card from the board', { cardId: z.string() }, async ({ cardId }) => {
    try {
      const card = db.getCard(cardId);
      if (!card) return { content: [{ type: 'text', text: JSON.stringify({ error: `Card not found: ${cardId}` }) }] };

      routeStopAgent(cardId);

      db.deleteCard(cardId);
      db.addAgentLog(card.workspace_id, 'system', 'delete_card', `Deleted '${card.title}'`);
      emitSSE('board_update', db.getBoard(card.workspace_id));

      return { content: [{ type: 'text', text: JSON.stringify({ deleted: true, card }) }] };
    } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
  });

  mcp.tool('add_card_note', 'Add a note or checkpoint to a card',
    { cardId: z.string(), content: z.string() },
    async ({ cardId, content }) => {
      try {
        const card = db.getCard(cardId);
        if (!card) return { content: [{ type: 'text', text: JSON.stringify({ error: `Card not found: ${cardId}` }) }] };

        const note = db.addCardNote(cardId, content);
        db.addAgentLog(card.workspace_id, card.agent || 'system', 'add_note', `Added note to '${card.title}'`);
        emitSSE('board_update', db.getBoard(card.workspace_id));

        return { content: [{ type: 'text', text: JSON.stringify(note) }] };
      } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
    }
  );

  mcp.tool('get_card_notes', 'Get all notes for a card', { cardId: z.string() }, async ({ cardId }) => {
    try {
      const card = db.getCard(cardId);
      if (!card) return { content: [{ type: 'text', text: JSON.stringify({ error: `Card not found: ${cardId}` }) }] };
      const notes = db.getCardNotes(cardId);
      return { content: [{ type: 'text', text: JSON.stringify({ cardId, notes }) }] };
    } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
  });
};
