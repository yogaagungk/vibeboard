const { exec } = require('child_process');
const express = require('express');
const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const db = require('./db');
const { migrateLegacyData } = require('./migrate');
const { spawnAgent, stopAgent, isAgentRunning } = require('./agent');

const PUBLIC_DIR = path.resolve('./public');

migrateLegacyData();

const sseClients = new Set();

function emitSSE(type, data) {
  const payload = 'data: ' + JSON.stringify({ type, data }) + '\n\n';
  for (const res of sseClients) res.write(payload);
}

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', version: '0.1.0' }));

app.get('/workspaces', (_req, res) => {
  const active = db.getActiveWorkspaceId();
  const list = db.listWorkspaces().map(w => ({ ...w, active: w.id === active }));
  res.json(list);
});

app.post('/workspaces', (req, res) => {
  const { name = '', path: wsPath = '', description = '' } = req.body;
  const ws = db.createWorkspace(name, wsPath, description);
  if (!db.getActiveWorkspaceId()) {
    db.setActiveWorkspaceId(ws.id);
    emitSSE('workspace_switch', { board: db.getBoard(ws.id), workspaceId: ws.id });
  }
  const active = db.getActiveWorkspaceId();
  emitSSE('workspace_list', db.listWorkspaces().map(w => ({ ...w, active: w.id === active })));
  res.json(ws);
});

app.post('/workspaces/:id/switch', (req, res) => {
  const { id } = req.params;
  const ws = db.getWorkspace(id);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  db.setActiveWorkspaceId(id);
  const board = db.getBoard(id);
  emitSSE('workspace_switch', { board, workspaceId: id });
  res.json({ ok: true, workspaceId: id });
});

app.patch('/workspaces/:id', (req, res) => {
  const { id } = req.params;
  const ws = db.getWorkspace(id);
  if (!ws) return res.status(404).json({ error: 'Not found' });
  try {
    db.updateWorkspace(id, req.body);
    const active = db.getActiveWorkspaceId();
    emitSSE('workspace_list', db.listWorkspaces().map(w => ({ ...w, active: w.id === active })));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/workspaces/:id', (req, res) => {
  const { id } = req.params;
  const list = db.listWorkspaces();
  if (list.length <= 1) return res.status(400).json({ error: 'Cannot delete the last workspace' });
  try { db.deleteWorkspace(id); } catch { return res.status(404).json({ error: 'Not found' }); }
  
  if (db.getActiveWorkspaceId() === id) {
    const next = list.find(w => w.id !== id);
    if (next) db.setActiveWorkspaceId(next.id);
  }
  
  const active = db.getActiveWorkspaceId();
  const newList = db.listWorkspaces().map(w => ({ ...w, active: w.id === active }));
  emitSSE('workspace_switch', { board: db.getBoard(active), workspaceId: active });
  emitSSE('workspace_list', newList);
  res.json({ ok: true });
});

app.get('/api/folder-dialog', (_req, res) => {
  let cmd;
  if (process.platform === 'win32') {
    cmd = [
      'powershell', '-NoProfile', '-STA', '-Command',
      'Add-Type -AssemblyName System.Windows.Forms;' +
      '$owner = New-Object System.Windows.Forms.Form;' +
      '$owner.TopMost = $true; $owner.Opacity = 0; $owner.Show();' +
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog;' +
      '$d.Description = "Select project folder";' +
      '$d.ShowNewFolderButton = $true;' +
      '$r = $d.ShowDialog($owner); $owner.Close();' +
      'if ($r -eq [System.Windows.Forms.DialogResult]::OK) { $d.SelectedPath }',
    ];
  } else if (process.platform === 'darwin') {
    cmd = `osascript -e 'POSIX path of (choose folder with prompt "Select project folder:")'`;
  } else {
    cmd = `zenity --file-selection --directory --title="Select project folder" 2>/dev/null || kdialog --getexistingdirectory "$HOME" --title "Select project folder" 2>/dev/null`;
  }

  const run = Array.isArray(cmd)
    ? (cb) => exec(cmd.join(' '), { timeout: 60000 }, cb)
    : (cb) => exec(cmd, { timeout: 60000 }, cb);

  run((err, stdout, stderr) => {
    if (err) process.stderr.write('folder-dialog error: ' + (stderr || err.message) + '\n');
    const p = (stdout || '').trim().replace(/[/\\]+$/, '');
    res.json(p ? { path: p } : { path: null, cancelled: true });
  });
});

app.get('/api/info', (_req, res) => {
  res.json({
    dataDir: db.DATA_DIR,
    platform: process.platform,
    version: '0.1.0',
    storage: 'sqlite',
  });
});

app.get('/board', (_req, res) => {
  const activeId = db.getActiveWorkspaceId();
  if (!activeId) return res.json(null);
  const board = db.getBoard(activeId);
  res.json(board);
});

app.post('/board', (req, res) => {
  const activeId = db.getActiveWorkspaceId();
  if (!activeId) return res.status(400).json({ error: 'No active workspace' });
  
  const body = req.body;
  if (body.name !== undefined || body.path !== undefined || body.description !== undefined) {
    db.updateWorkspace(activeId, { name: body.name, path: body.path, description: body.description });
  }
  
  emitSSE('board_update', db.getBoard(activeId));
  res.json({ ok: true });
});

app.get('/api/cards/:cardId/notes', (req, res) => {
  const { cardId } = req.params;
  try {
    const notes = db.getCardNotes(cardId);
    res.json({ cardId, notes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.add(res);
  const hb = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
});

app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

const mcp = new McpServer({ name: 'vibeboard', version: '0.1.0' });

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

mcp.tool('create_card', 'Create a new card in a column (default: Backlog)',
  { title: z.string(), columnTitle: z.string().optional(), tags: z.array(z.string()).optional(), description: z.string().optional(), agent: z.enum(['claude-code', 'opencode']).optional() },
  async ({ title, columnTitle = 'Backlog', tags = [], description, agent }) => {
    try {
      const activeId = db.getActiveWorkspaceId();
      if (!activeId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'No active workspace' }) }] };
      const board = db.getBoard(activeId);
      const column = board.columns.find(c => c.title === columnTitle);
      if (!column) return { content: [{ type: 'text', text: JSON.stringify({ error: `Column not found: ${columnTitle}` }) }] };
      const card = db.createCard(activeId, column.id, title, { description, tags, agent });
      db.addAgentLog(activeId, agent || 'system', 'create_card', `Created '${title}' in ${columnTitle}`);
      emitSSE('board_update', db.getBoard(activeId));
      return { content: [{ type: 'text', text: JSON.stringify(card) }] };
    } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
  }
);

mcp.tool('update_card', "Update a card's title, description, tags, or assigned agent",
  { cardId: z.string(), title: z.string().optional(), description: z.string().optional(), tags: z.array(z.string()).optional(), agent: z.enum(['claude-code', 'opencode', '']).optional() },
  async ({ cardId, title, description, tags, agent }) => {
    try {
      const card = db.getCard(cardId);
      if (!card) return { content: [{ type: 'text', text: JSON.stringify({ error: `Card not found: ${cardId}` }) }] };
      db.updateCard(cardId, { title, description, tags, agent: agent || undefined });
      const activeId = db.getActiveWorkspaceId();
      if (activeId) {
        db.addAgentLog(activeId, agent || 'system', 'update_card', `Updated '${card.title}'`);
        emitSSE('board_update', db.getBoard(activeId));
      }
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
      
      const activeId = db.getActiveWorkspaceId();
      if (!activeId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'No active workspace' }) }] };
      
      const board = db.getBoard(activeId);
      const toColumn = board.columns.find(c => c.title === toColumnTitle);
      if (!toColumn) return { content: [{ type: 'text', text: JSON.stringify({ error: `Column not found: ${toColumnTitle}` }) }] };
      
      const fromColumn = db.getColumn(card.column_id);
      db.moveCard(cardId, toColumn.id);
      db.addAgentLog(activeId, card.agent || 'system', 'move_card', `Moved '${card.title}' → ${toColumnTitle}`);
      emitSSE('board_update', db.getBoard(activeId));
      
      if (toColumnTitle === 'In Progress' && card.agent && !isAgentRunning(cardId)) {
        emitSSE('trigger', { card, toColumn: toColumnTitle, agent: card.agent });
        spawnAgent(cardId, activeId, card.agent, emitSSE);
      }
      
      return { content: [{ type: 'text', text: JSON.stringify({ card, fromColumn: fromColumn.title, toColumn: toColumnTitle }) }] };
    } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
  }
);

mcp.tool('complete_card', 'Mark a card as done (moves to Done column)', { cardId: z.string() }, async ({ cardId }) => {
  try {
    const card = db.getCard(cardId);
    if (!card) return { content: [{ type: 'text', text: JSON.stringify({ error: `Card not found: ${cardId}` }) }] };
    
    const activeId = db.getActiveWorkspaceId();
    if (!activeId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'No active workspace' }) }] };
    
    const board = db.getBoard(activeId);
    const doneColumn = board.columns.find(c => c.title === 'Done');
    if (!doneColumn) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Done column not found' }) }] };
    
    const fromColumn = db.getColumn(card.column_id);
    db.moveCard(cardId, doneColumn.id);
    db.addAgentLog(activeId, card.agent || 'system', 'complete_card', `Completed '${card.title}'`);
    emitSSE('board_update', db.getBoard(activeId));
    emitSSE('trigger', { card, toColumn: 'Done' });
    
    if (isAgentRunning(cardId)) {
      stopAgent(cardId);
    }
    
    return { content: [{ type: 'text', text: JSON.stringify({ card, fromColumn: fromColumn.title }) }] };
  } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
});

mcp.tool('delete_card', 'Delete a card from the board', { cardId: z.string() }, async ({ cardId }) => {
  try {
    const card = db.getCard(cardId);
    if (!card) return { content: [{ type: 'text', text: JSON.stringify({ error: `Card not found: ${cardId}` }) }] };
    
    const activeId = db.getActiveWorkspaceId();
    db.deleteCard(cardId);
    
    if (activeId) {
      db.addAgentLog(activeId, 'system', 'delete_card', `Deleted '${card.title}'`);
      emitSSE('board_update', db.getBoard(activeId));
    }
    
    if (isAgentRunning(cardId)) {
      stopAgent(cardId);
    }
    
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
      
      const activeId = db.getActiveWorkspaceId();
      if (activeId) {
        db.addAgentLog(activeId, card.agent || 'system', 'add_note', `Added note to '${card.title}'`);
        emitSSE('board_update', db.getBoard(activeId));
      }
      
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

mcp.tool('add_column', 'Add a new column to the board',
  { title: z.string(), color: z.string().optional() },
  async ({ title, color = '#6b6860' }) => {
    try {
      const activeId = db.getActiveWorkspaceId();
      if (!activeId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'No active workspace' }) }] };
      const board = db.getBoard(activeId);
      if (board.columns.find(c => c.title === title)) return { content: [{ type: 'text', text: JSON.stringify({ error: `Column already exists: ${title}` }) }] };
      const column = db.addColumn(activeId, title, color);
      emitSSE('board_update', db.getBoard(activeId));
      return { content: [{ type: 'text', text: JSON.stringify(column) }] };
    } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
  }
);

const PORT = process.env.PORT || 7341;
const server = app.listen(PORT, () => process.stderr.write(`HTTP server listening on http://localhost:${PORT}\n`));

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    process.stderr.write(`Port ${PORT} already in use — kill the existing process then retry.\n`);
  } else {
    process.stderr.write('Server error: ' + err.message + '\n');
  }
  process.exit(1);
});

function shutdown() {
  for (const res of sseClients) { try { res.end(); } catch(_) {} }
  sseClients.clear();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const transport = new StdioServerTransport();
mcp.connect(transport)
  .then(() => process.stderr.write('MCP server connected via stdio\n'))
  .catch(err => process.stderr.write('MCP connect error: ' + err.message + '\n'));
