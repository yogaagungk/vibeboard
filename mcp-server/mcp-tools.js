const { z } = require('zod');
const db = require('./db');
const { emitSSE } = require('./events');
const { routeSpawnAgent, routeStopAgent, unfinishedBlockers } = require('./agent-routing');
const models = require('./models');

// Register all MCP tools on the given McpServer. Every tool returns a JSON text
// payload and never throws — errors are serialized so the agent can react.
module.exports = function registerMcpTools(mcp) {
  mcp.tool('get_board', 'Get the full board state of the active workspace', { workspaceId: z.string().optional(), columnsOnly: z.boolean().optional(), excludeLogs: z.boolean().optional(), columnTitle: z.string().optional() }, async ({ workspaceId, columnsOnly, excludeLogs, columnTitle }) => {
    try {
      const activeId = workspaceId || db.getActiveWorkspaceId();
      if (!activeId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'No active workspace' }) }] };
      const board = db.getBoard(activeId);
      if (columnTitle) {
        const col = board.columns.find(c => c.title === columnTitle);
        if (!col) return { content: [{ type: 'text', text: JSON.stringify({ error: `Column not found: ${columnTitle}` }) }] };
        return { content: [{ type: 'text', text: JSON.stringify({ id: board.id, name: board.name, path: board.path, description: board.description, use_worktree: board.use_worktree, columns: [col], agentLog: excludeLogs ? [] : board.agentLog }) }] };
      }
      if (columnsOnly) {
        return { content: [{ type: 'text', text: JSON.stringify({ id: board.id, name: board.name, path: board.path, description: board.description, use_worktree: board.use_worktree, columns: board.columns.map(c => ({ id: c.id, title: c.title, color: c.color, position: c.position, wip_limit: c.wip_limit })), agentLog: excludeLogs ? [] : board.agentLog }) }] };
      }
      if (excludeLogs) {
        return { content: [{ type: 'text', text: JSON.stringify({ ...board, agentLog: [] }) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(board) }] };
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

  mcp.tool('set_workspace', 'Update the description of a workspace. Requires workspaceId to prevent accidentally modifying the wrong workspace. Cannot change name or path — use the UI for that.',
    { workspaceId: z.string(), description: z.string() },
    async ({ workspaceId, description }) => {
      try {
        const ws = db.getWorkspace(workspaceId);
        if (!ws) return { content: [{ type: 'text', text: JSON.stringify({ error: `Workspace not found: ${workspaceId}` }) }] };
        db.updateWorkspace(workspaceId, { description });
        const active = db.getActiveWorkspaceId();
        emitSSE('workspace_list', db.listWorkspaces().map(w => ({ ...w, active: w.id === active })));
        const updated = db.getWorkspace(workspaceId);
        return { content: [{ type: 'text', text: JSON.stringify({ id: updated.id, name: updated.name, path: updated.path, description: updated.description }) }] };
      } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
    }
  );

  mcp.tool('delete_workspace', 'Delete a workspace and all its cards, notes, and agent log entries',
    { workspaceId: z.string(), confirm: z.boolean() },
    async ({ workspaceId, confirm }) => {
      try {
        if (confirm !== true) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Must set confirm=true to delete a workspace' }) }] };

        const ws = db.getWorkspace(workspaceId);
        if (!ws) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Workspace not found' }) }] };

        const list = db.listWorkspaces();
        if (list.length <= 1) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Cannot delete the only workspace' }) }] };

        if (!db.deleteWorkspace(workspaceId)) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Delete failed' }) }] };

        if (db.getActiveWorkspaceId() === workspaceId) {
          const next = list.find(w => w.id !== workspaceId);
          if (next) db.setActiveWorkspaceId(next.id);
        }

        const active = db.getActiveWorkspaceId();
        emitSSE('workspace_deleted', { workspaceId });
        emitSSE('workspace_list', db.listWorkspaces().map(w => ({ ...w, active: w.id === active })));
        if (active) emitSSE('workspace_switch', { board: db.getBoard(active), workspaceId: active });

        return { content: [{ type: 'text', text: JSON.stringify({ deleted: true, workspaceId }) }] };
      } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
    }
  );

  mcp.tool('list_templates', 'List card templates for a workspace',
    { workspaceId: z.string().optional() },
    async ({ workspaceId }) => {
      try {
        const id = workspaceId || db.getActiveWorkspaceId();
        if (!id) return { content: [{ type: 'text', text: JSON.stringify({ error: 'No active workspace' }) }] };
        return { content: [{ type: 'text', text: JSON.stringify(db.listTemplates(id)) }] };
      } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
    }
  );

  mcp.tool('create_template', 'Create a card template for repeatable tasks',
    { name: z.string(), workspaceId: z.string().optional(), title_pattern: z.string().optional(), tags: z.array(z.string()).optional(), agent: z.string().optional(), model: z.string().optional(), priority: z.enum(['high', 'medium', 'low']).optional(), custom_prompt: z.string().optional() },
    async ({ name, workspaceId, title_pattern, tags, agent, model, priority, custom_prompt }) => {
      try {
        const id = workspaceId || db.getActiveWorkspaceId();
        if (!id) return { content: [{ type: 'text', text: JSON.stringify({ error: 'No active workspace' }) }] };
        const tpl = db.createTemplate(id, name, { title_pattern, tags, agent, model, priority, custom_prompt });
        emitSSE('templates_updated', { workspaceId: id, templates: db.listTemplates(id) });
        return { content: [{ type: 'text', text: JSON.stringify(tpl) }] };
      } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
    }
  );

  mcp.tool('get_column', 'Get all cards in a specific column', { columnTitle: z.string(), workspaceId: z.string().optional() }, async ({ columnTitle, workspaceId }) => {
    try {
      const activeId = workspaceId || db.getActiveWorkspaceId();
      if (!activeId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'No active workspace' }) }] };
      const board = db.getBoard(activeId);
      const column = board.columns.find(c => c.title === columnTitle);
      if (!column) return { content: [{ type: 'text', text: JSON.stringify({ error: `Column not found: ${columnTitle}` }) }] };
      return { content: [{ type: 'text', text: JSON.stringify({ column, cards: column.cards }) }] };
    } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
  });

  mcp.tool('create_card', 'Create a new card in a column (default: Backlog). blocked_by takes card IDs that must reach Done before this card can move to In Progress.',
    { title: z.string(), workspaceId: z.string().optional(), columnTitle: z.string().optional(), tags: z.array(z.string()).optional(), description: z.string().optional(), agent: z.enum(['claude-code', 'opencode', 'codex', 'command-code']).optional(), model: z.string().optional(), priority: z.enum(['high', 'medium', 'low']).optional(), due_date: z.string().optional(), blocked_by: z.array(z.string()).optional(), review_agent: z.enum(['claude-code', 'opencode', 'codex', 'command-code']).optional(), review_model: z.string().optional() },
    async ({ title, workspaceId, columnTitle = 'Backlog', tags = [], description, agent, model, priority, due_date, blocked_by, review_agent, review_model }) => {
      try {
        const activeId = workspaceId || db.getActiveWorkspaceId();
        if (!activeId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'No active workspace' }) }] };
        const board = db.getBoard(activeId);
        const column = board.columns.find(c => c.title === columnTitle);
        if (!column) return { content: [{ type: 'text', text: JSON.stringify({ error: `Column not found: ${columnTitle}` }) }] };
        
        if (blocked_by && blocked_by.length > 0) {
          const allCards = board.columns.flatMap(c => c.cards);
          const unknownIds = blocked_by.filter(id => !allCards.some(c => c.id === id));
          if (unknownIds.length > 0) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown card IDs in blocked_by: ${unknownIds.join(', ')}` }) }] };
          }
        }
        
        const card = db.createCard(activeId, column.id, title, { description, tags, agent, model, priority, due_date, blocked_by, review_agent, review_model });
        db.addAgentLog(activeId, agent || 'system', 'create_card', `Created '${title}' in ${columnTitle}`, card.id);
        emitSSE('board_update', db.getBoard(activeId));
        return { content: [{ type: 'text', text: JSON.stringify(card) }] };
      } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
    }
  );

  mcp.tool('update_card', "Update a card's title, description, tags, assigned agent, model, priority, due_date, requires_review, custom_prompt, blocked_by, review_agent, review_model, review_issue, or merged_at",
    { cardId: z.string(), title: z.string().optional(), description: z.string().optional(), tags: z.array(z.string()).optional(), agent: z.enum(['claude-code', 'opencode', 'codex', 'command-code', '']).optional(), model: z.string().optional(), priority: z.enum(['high', 'medium', 'low', '']).optional(), due_date: z.string().optional(), blocked_by: z.array(z.string()).optional(), requires_review: z.boolean().optional(), custom_prompt: z.string().optional(), review_agent: z.enum(['claude-code', 'opencode', 'codex', 'command-code', '']).optional(), review_model: z.string().optional(), review_issue: z.boolean().optional(), merged_at: z.string().datetime().nullable().optional() },
    async ({ cardId, title, description, tags, agent, model, priority, due_date, blocked_by, requires_review, custom_prompt, review_agent, review_model, review_issue, merged_at }) => {
      try {
        const card = db.getCard(cardId);
        if (!card) return { content: [{ type: 'text', text: JSON.stringify({ error: `Card not found: ${cardId}` }) }] };
        
        if (blocked_by !== undefined && blocked_by.length > 0) {
          const board = db.getBoard(card.workspace_id);
          const allCards = board.columns.flatMap(c => c.cards);
          const unknownIds = blocked_by.filter(id => !allCards.some(c => c.id === id));
          if (unknownIds.length > 0) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown card IDs in blocked_by: ${unknownIds.join(', ')}` }) }] };
          }
        }
        
        const updates = { title, description, tags, agent: agent || undefined, model: model !== undefined ? model : undefined, priority: priority || undefined, due_date: due_date !== undefined ? due_date : undefined, blocked_by: blocked_by !== undefined ? blocked_by : undefined, requires_review: requires_review !== undefined ? requires_review : undefined, custom_prompt: custom_prompt !== undefined ? custom_prompt : undefined, review_agent: review_agent || undefined, review_model: review_model !== undefined ? review_model : undefined, review_issue: review_issue !== undefined ? review_issue : undefined };
        if (merged_at !== undefined) {
          updates.merged_at = merged_at;
          if (merged_at !== null) {
            updates.branch = null;
            updates.worktreePath = null;
          }
        }
        if (agent !== undefined && agent !== card.agent) {
          if (agent === '') {
            db.addAgentLog(card.workspace_id, 'system', 'update_card', `Agent unassigned (was: ${card.agent || 'none'}) on '${card.title}'`, cardId);
          } else {
            db.addAgentLog(card.workspace_id, agent || 'system', 'update_card', `Agent assigned: ${agent} (was: ${card.agent || 'none'}) on '${card.title}'`, cardId);
          }
        }
        db.updateCard(cardId, updates);
        if (agent === undefined || agent === card.agent) {
          db.addAgentLog(card.workspace_id, card.agent || 'system', 'update_card', `Updated '${card.title}'`, cardId);
        }
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

        if (card.column_id !== toColumn.id && Number.isInteger(toColumn.wip_limit) && toColumn.wip_limit > 0 && toColumn.cards.length >= toColumn.wip_limit) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: `Column '${toColumnTitle}' is at its WIP limit (${toColumn.cards.length}/${toColumn.wip_limit})` }) }] };
        }

        if (card.column_id !== toColumn.id && toColumnTitle === 'In Progress') {
          const blockers = unfinishedBlockers(card, board);
          if (blockers.length) {
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Card is blocked by unfinished card(s): ${blockers.join(', ')}` }) }] };
          }
        }

        const fromColumn = db.getColumn(card.column_id);
        db.moveCard(cardId, toColumn.id);
        db.addAgentLog(card.workspace_id, card.agent || 'system', 'move_card', `Moved '${card.title}' → ${toColumnTitle}`, cardId);
        emitSSE('board_update', db.getBoard(card.workspace_id));

        if (card.column_id !== toColumn.id && (toColumnTitle === 'In Progress' || toColumnTitle === 'Review') && card.agent) {
          emitSSE('trigger', { card, toColumn: toColumnTitle, agent: card.agent });
          try {
            routeSpawnAgent(cardId, toColumnTitle);
          } catch (spawnErr) {
            db.addCardNote(cardId, `⚠️ Agent spawn failed: ${spawnErr.message}`);
            emitSSE('agent_spawn_failed', { cardId, error: spawnErr.message });
            emitSSE('board_update', db.getBoard(card.workspace_id));
          }
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
      db.addAgentLog(card.workspace_id, card.agent || 'system', 'complete_card', `Completed '${card.title}'`, cardId);
      emitSSE('board_update', db.getBoard(card.workspace_id));
      emitSSE('trigger', { card, toColumn: 'Done' });

      return { content: [{ type: 'text', text: JSON.stringify({ card, fromColumn: fromColumn.title }) }] };
    } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
  });

  mcp.tool('delete_card', 'Delete a card from the board', { cardId: z.string() }, async ({ cardId }) => {
    try {
      const card = db.getCard(cardId);
      if (!card) return { content: [{ type: 'text', text: JSON.stringify({ error: `Card not found: ${cardId}` }) }] };

      routeStopAgent(cardId);

      db.deleteCard(cardId);
      db.addAgentLog(card.workspace_id, 'system', 'delete_card', `Deleted '${card.title}'`, cardId);
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
        db.addAgentLog(card.workspace_id, card.agent || 'system', 'add_note', `Added note to '${card.title}'`, cardId);
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

  mcp.tool('search_cards', 'Search cards by text, tag, column, agent, or status without loading the full board', {
    query: z.string().optional(),
    tag: z.string().optional(),
    columnTitle: z.string().optional(),
    agent: z.string().optional(),
    workspaceId: z.string().optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
  }, async ({ query, tag, columnTitle, agent, workspaceId, limit = 50, offset = 0 }) => {
    try {
      const activeId = workspaceId || db.getActiveWorkspaceId();
      if (!activeId) return { content: [{ type: 'text', text: JSON.stringify({ count: 0, total: 0, cards: [], limit, offset }) }] };
      const result = db.searchCards(activeId, { query, tag, column: columnTitle, agent, limit, offset });
      return { content: [{ type: 'text', text: JSON.stringify({ count: result.cards.length, total: result.total, cards: result.cards, limit, offset }) }] };
    } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
  });

  mcp.tool('list_models', 'List available models for each agent type, optionally filtered by agent',
    { agent: z.enum(['claude-code', 'opencode', 'codex', 'command-code']).optional() },
    async ({ agent }) => {
      try {
        const all = models.getAvailableModels();
        if (agent) {
          if (!all[agent]) return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown agent: ${agent}` }) }] };
          return { content: [{ type: 'text', text: JSON.stringify({ [agent]: all[agent] }) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(all) }] };
      } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
    }
  );

  mcp.tool('refresh_models', 'Refresh the model cache for all agent types', {},
    async () => {
      try {
        const all = models.refreshAvailableModels();
        const counts = {};
        for (const agent of Object.keys(all)) {
          counts[agent] = all[agent].length;
        }
        return { content: [{ type: 'text', text: JSON.stringify(counts) }] };
      } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
    }
  );

  mcp.tool('list_cards', 'List cards with optional filters (more efficient than get_board for finding card IDs)',
    { columnTitle: z.string().optional(), tag: z.string().optional(), agent: z.enum(['claude-code', 'opencode', 'codex', 'command-code']).optional(), workspaceId: z.string().optional(), limit: z.number().int().positive().optional(), offset: z.number().int().nonnegative().optional() },
    async ({ columnTitle, tag, agent, workspaceId, limit = 50, offset = 0 }) => {
      try {
        const activeId = workspaceId || db.getActiveWorkspaceId();
        if (!activeId) return { content: [{ type: 'text', text: JSON.stringify({ count: 0, total: 0, cards: [], limit, offset }) }] };
        const result = db.listCards(activeId, { column: columnTitle, tag, agent, limit, offset });
        return { content: [{ type: 'text', text: JSON.stringify({ count: result.cards.length, total: result.total, cards: result.cards, limit, offset }) }] };
      } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
    }
  );

  mcp.tool('get_agent_status', 'Get the current agent status for a card (running, queued, last note, exit code)',
    { cardId: z.string() },
    async ({ cardId }) => {
      try {
        const card = db.getCard(cardId);
        if (!card) return { content: [{ type: 'text', text: JSON.stringify({ error: `Card not found: ${cardId}` }) }] };
        const status = db.getAgentStatus(cardId);
        return { content: [{ type: 'text', text: JSON.stringify(status) }] };
      } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
    }
  );

  mcp.tool('cancel_agent', 'Cancel a queued or running agent for a card',
    { cardId: z.string() },
    async ({ cardId }) => {
      try {
        const card = db.getCard(cardId);
        if (!card) return { content: [{ type: 'text', text: JSON.stringify({ error: `Card not found: ${cardId}` }) }] };
        
        const stopped = routeStopAgent(cardId);
        if (stopped) {
          db.addCardNote(cardId, 'Agent cancelled by user.');
          emitSSE('board_update', db.getBoard(card.workspace_id));
          return { content: [{ type: 'text', text: JSON.stringify({ cancelled: true, cardId }) }] };
        } else {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'No agent running or queued for this card' }) }] };
        }
      } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
    }
  );
};
