const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const express = require('express');
const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const db = require('./db');
const { migrateLegacyData } = require('./migrate');
const { spawnAgent, agentDone, stopAgent, isAgentRunning, getRunningCardIds, getOutputFile } = require('./agent');
const wt = require('./worktree');

const PUBLIC_DIR = path.resolve('./public');
const PORT = process.env.PORT || 7341;

migrateLegacyData();

// On startup, prune stale git worktree references for all workspaces that use worktrees.
// This repairs git's internal tracking when .vb-worktrees/ entries were deleted externally
// or when the server crashed while an agent had a worktree open.
(function pruneOrphanedWorktrees() {
  const { execSync } = require('child_process');
  for (const ws of db.listWorkspaces()) {
    if (!ws.use_worktree || !ws.path) continue;
    try {
      execSync('git worktree prune', { cwd: ws.path, stdio: 'ignore' });
    } catch (_) {}
  }
})();

const sseClients = new Set();
let httpServerRunning = false;

function emitSSE(type, data) {
  if (httpServerRunning) {
    const payload = 'data: ' + JSON.stringify({ type, data }) + '\n\n';
    for (const res of sseClients) res.write(payload);
  } else {
    // MCP-only mode: proxy to the running HTTP server
    fetch(`http://localhost:${PORT}/api/sse-emit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data }),
    }).catch(() => {});
  }
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
  const { name = '', path: wsPath = '', description = '', use_worktree = 0 } = req.body;
  const ws = db.createWorkspace(name, wsPath, description, use_worktree);
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
  try { db.deleteWorkspace(id); } catch { return res.status(404).json({ error: 'Not found' }); }
  
  if (db.getActiveWorkspaceId() === id) {
    const next = list.find(w => w.id !== id);
    if (next) {
      db.setActiveWorkspaceId(next.id);
    } else {
      db.db.prepare('DELETE FROM settings WHERE key = ?').run('active_workspace_id');
    }
  }
  
  const active = db.getActiveWorkspaceId();
  const newList = db.listWorkspaces().map(w => ({ ...w, active: w.id === active }));
  emitSSE('workspace_switch', { board: active ? db.getBoard(active) : null, workspaceId: active });
  emitSSE('workspace_list', newList);
  res.json({ ok: true });
});

app.get('/api/git-status', (req, res) => {
  const { path: wsPath } = req.query;
  if (!wsPath) return res.status(400).json({ error: 'path required' });
  const { execSync } = require('child_process');
  try {
    execSync('git rev-parse --git-dir', { cwd: wsPath, stdio: 'ignore' });
    let branch = '';
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: wsPath, stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
    } catch(_) {}
    res.json({ isGit: true, branch });
  } catch(_) {
    res.json({ isGit: false, branch: null });
  }
});

app.post('/api/git-init', (req, res) => {
  const { path: wsPath } = req.body || {};
  if (!wsPath) return res.status(400).json({ error: 'path required' });
  const { execSync } = require('child_process');
  try {
    execSync('git init', { cwd: wsPath, stdio: 'ignore' });
    let branch = 'main';
    try {
      branch = execSync('git symbolic-ref --short HEAD', {
        cwd: wsPath, stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim() || 'main';
    } catch(_) {}
    res.json({ ok: true, branch });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/folder-dialog', (_req, res) => {
  if (process.platform === 'darwin') {
    const child = spawn('osascript', ['-e', 'POSIX path of (choose folder with prompt "Select project folder:")'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => out += d);
    child.on('close', () => {
      const p = out.trim().replace(/[/\\]+$/, '');
      res.json(p ? { path: p } : { path: null, cancelled: true });
    });
  } else {
    const tmpdir = process.env.TEMP || 'C:\\Windows\\Temp';
    const psPath = path.join(tmpdir, `folder-dialog-${Date.now()}.ps1`);
    const psScript = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$f = New-Object System.Windows.Forms.Form',
      '$f.StartPosition = "CenterScreen"',
      '$f.WindowState = "Minimized"',
      '$f.ShowInTaskbar = $false',
      '$f.TopMost = $true',
      '$f.Show()',
      '$f.TopMost = $false',
      '$d = New-Object System.Windows.Forms.OpenFileDialog',
      '$d.ValidateNames = $false',
      '$d.CheckFileExists = $false',
      '$d.CheckPathExists = $true',
      "$d.FileName = 'Folder Selection'",
      "$d.Filter = 'Folders|*.none'",
      "$d.Title = 'Select project folder'",
      "if ($d.ShowDialog($f) -eq 'OK') {",
      '  Split-Path $d.FileName',
      '}',
      '$f.Close()',
    ].join('\n');
    fs.writeFileSync(psPath, psScript, 'utf8');
    const child = spawn('powershell', [
      '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', psPath
    ], { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('close', () => {
      try { fs.unlinkSync(psPath); } catch(_) {}
      if (err) process.stderr.write('folder-dialog: ' + err + '\n');
      const p = out.trim().replace(/[/\\]+$/, '');
      res.json(p ? { path: p } : { path: null, cancelled: true });
    });
  }
});

app.post('/api/agent-done/:cardId', (req, res) => {
  const { cardId } = req.params;
  const code = parseInt(req.body?.code ?? 0, 10);
  agentDone(cardId, code, emitSSE);
  res.json({ ok: true });
});

app.post('/api/cards/:cardId/run', (req, res) => {
  const { cardId } = req.params;
  const card = db.getCard(cardId);
  if (!card) return res.status(404).json({ error: 'Card not found' });
  if (!card.agent) return res.status(400).json({ error: 'Card has no assigned agent' });
  if (isAgentRunning(cardId)) return res.status(409).json({ error: 'Agent already running' });
  spawnAgent(cardId, card.workspace_id, card.agent, emitSSE);
  res.json({ ok: true });
});

app.get('/api/agents/available', (_req, res) => {
  res.json({
    'claude-code': isAgentInstalled('claude'),
    'opencode':    isAgentInstalled('opencode'),
    'codex':       isAgentInstalled('codex'),
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
  board.runningCards = getRunningCardIds();
  res.json(board);
});

app.get('/api/cards/:cardId/output', (req, res) => {
  const { cardId } = req.params;
  const outputFile = getOutputFile(cardId);
  try {
    const raw = fs.readFileSync(outputFile, 'utf8');
    res.json({ cardId, output: raw });
  } catch (_) {
    res.json({ cardId, output: '' });
  }
});

app.post('/board', (req, res) => {
  const activeId = db.getActiveWorkspaceId();
  if (!activeId) return res.status(400).json({ error: 'No active workspace' });

  const body = req.body;
  if (body.name !== undefined || body.path !== undefined || body.description !== undefined || body.use_worktree !== undefined) {
    db.updateWorkspace(activeId, { name: body.name, path: body.path, description: body.description, use_worktree: body.use_worktree });
  }
  if (Array.isArray(body.columns)) {
    db.syncBoard(activeId, body.columns);
  }

  const fresh = db.getBoard(activeId);
  emitSSE('board_update', { ...fresh, _tabId: body._tabId });
  res.json({ ok: true });
});

// ── MCP helpers ──────────────────────────────────────────────────────────────
function getAgentMcpConfigs() {
  const home = os.homedir();
  const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const serverPath = path.join(__dirname, 'index.js');

  return {
    'claude-code': {
      label: 'Claude Code',
      cmd: 'claude',
      configPath: path.join(home, '.claude.json'),
      read: cfg => !!(cfg.mcpServers?.vibeboard),
      write: (_cfg, configPath) => {
        // Use the CLI so Claude Code manages its own registry correctly
        const { execSync } = require('child_process');
        execSync(`claude mcp add -s user vibeboard -- node "${serverPath}"`, {
          stdio: 'pipe', timeout: 10000,
        });
        // Return null to signal the caller to skip the JSON write
        return null;
      },
    },
    'opencode': {
      label: 'OpenCode',
      cmd: 'opencode',
      // OpenCode uses XDG-style ~/.config/opencode/opencode.json on all platforms
      configPath: path.join(xdgConfig, 'opencode', 'opencode.json'),
      read: cfg => !!(cfg.mcp?.vibeboard),
      write: cfg => ({
        ...cfg,
        mcp: {
          ...(cfg.mcp || {}),
          vibeboard: { type: 'local', command: ['node', serverPath] },
        },
      }),
    },
    'codex': {
      label: 'Codex CLI',
      cmd: 'codex',
      configPath: path.join(home, '.codex', 'config.json'),
      read: cfg => !!(cfg.mcpServers?.vibeboard || cfg.mcp?.vibeboard),
      write: cfg => ({
        ...cfg,
        mcpServers: { ...(cfg.mcpServers || {}), vibeboard: { command: 'node', args: [serverPath] } },
      }),
    },
  };
}

function isAgentInstalled(cmd) {
  const { execSync } = require('child_process');
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch (_) { return false; }
}

function readAgentMcpStatus(key, info) {
  const installed = isAgentInstalled(info.cmd);
  if (!installed) return { installed: false, configured: false, configPath: info.configPath };
  try {
    const cfg = JSON.parse(fs.readFileSync(info.configPath, 'utf8'));
    return { installed: true, configured: info.read(cfg), configPath: info.configPath };
  } catch (_) {
    return { installed: true, configured: false, configPath: info.configPath };
  }
}

app.get('/api/mcp-status', (_req, res) => {
  const configs = getAgentMcpConfigs();
  const agents = {};
  for (const [key, info] of Object.entries(configs)) {
    agents[key] = readAgentMcpStatus(key, info);
  }
  const anyUnconfigured = Object.values(agents).some(a => a.installed && !a.configured);
  res.json({ agents, anyUnconfigured });
});

app.post('/api/mcp-setup', (req, res) => {
  const { agent } = req.body || {};
  const configs = getAgentMcpConfigs();
  const targets = agent && agent !== 'all' ? [agent] : Object.keys(configs);
  const results = {};

  for (const key of targets) {
    const info = configs[key];
    if (!info) { results[key] = { ok: false, error: 'Unknown agent' }; continue; }
    if (!isAgentInstalled(info.cmd)) { results[key] = { ok: false, error: 'Not installed' }; continue; }
    try {
      fs.mkdirSync(path.dirname(info.configPath), { recursive: true });
      let existing = {};
      try { existing = JSON.parse(fs.readFileSync(info.configPath, 'utf8')); } catch (_) {}
      const updated = info.write(existing, info.configPath);
      // null means the write function handled it directly (e.g. via CLI)
      if (updated !== null) {
        fs.writeFileSync(info.configPath, JSON.stringify(updated, null, 2), 'utf8');
      }
      results[key] = { ok: true, configPath: info.configPath };
    } catch (err) {
      results[key] = { ok: false, error: err.message };
    }
  }

  emitSSE('mcp_configured', { results });
  res.json({ ok: true, results });
});

app.get('/api/cards/:cardId/diff', (req, res) => {
  const card = db.getCard(req.params.cardId);
  if (!card?.worktree_path) return res.json({ diff: '', commits: '' });
  const wsId = db.getActiveWorkspaceId();
  const workspace = db.getWorkspace(wsId);
  if (!workspace) return res.json({ diff: '', commits: '' });
  const base = wt.getBaseBranch(workspace.path);
  res.json({
    diff:    wt.getDiff(card.worktree_path, base),
    commits: wt.getCommits(card.worktree_path, base),
    branch:  card.branch,
    base,
  });
});

app.post('/api/cards/:cardId/merge', (req, res) => {
  const card = db.getCard(req.params.cardId);
  if (!card?.branch) return res.status(400).json({ error: 'Card has no branch' });
  const wsId = db.getActiveWorkspaceId();
  const workspace = db.getWorkspace(wsId);
  if (!workspace) return res.status(400).json({ error: 'No active workspace' });
  try {
    wt.mergeBranch(workspace.path, card.branch, card.worktree_path);
    db.updateCard(card.id, { branch: null, worktreePath: null });
    const fresh = db.getBoard(wsId);
    emitSSE('board_update', fresh);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cards/:cardId/pr', (req, res) => {
  const card = db.getCard(req.params.cardId);
  if (!card?.worktree_path) return res.status(400).json({ error: 'Card has no worktree' });
  try {
    const url = wt.pushAndCreatePR(card.worktree_path, card.title);
    res.json({ ok: true, url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workspaces/:id/export', (req, res) => {
  const data = db.exportWorkspace(req.params.id);
  if (!data) return res.status(404).json({ error: 'Workspace not found' });
  res.setHeader('Content-Disposition', `attachment; filename="vibeboard-export-${Date.now()}.json"`);
  res.json(data);
});

app.post('/api/workspaces/import', (req, res) => {
  try {
    const ws = db.importWorkspace(req.body);
    if (!db.getActiveWorkspaceId()) {
      db.setActiveWorkspaceId(ws.id);
      emitSSE('workspace_switch', { board: db.getBoard(ws.id), workspaceId: ws.id });
    }
    const active = db.getActiveWorkspaceId();
    emitSSE('workspace_list', db.listWorkspaces().map(w => ({ ...w, active: w.id === active })));
    res.json(ws);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/agent-log', (_req, res) => {
  const activeId = db.getActiveWorkspaceId();
  if (!activeId) return res.status(400).json({ error: 'No active workspace' });
  db.db.prepare('DELETE FROM agent_log WHERE workspace_id = ?').run(activeId);
  emitSSE('board_update', db.getBoard(activeId));
  res.json({ ok: true });
});

app.post('/api/cards/:cardId/duplicate', (req, res) => {
  const card = db.getCard(req.params.cardId);
  if (!card) return res.status(404).json({ error: 'Card not found' });
  const copy = db.createCard(card.workspace_id, card.column_id, card.title + ' (copy)', {
    description: card.description,
    tags: card.tags,
    agent: card.agent,
    requires_review: card.requires_review,
    priority: card.priority,
    custom_prompt: card.custom_prompt,
    due_date: card.due_date,
  });
  db.addAgentLog(card.workspace_id, 'system', 'duplicate_card', `Duplicated '${card.title}'`);
  emitSSE('board_update', db.getBoard(card.workspace_id));
  res.json(copy);
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

app.post('/api/sse-emit', (req, res) => {
  const { type, data } = req.body || {};
  if (type) {
    const payload = 'data: ' + JSON.stringify({ type, data }) + '\n\n';
    for (const client of sseClients) client.write(payload);
  }
  res.json({ ok: true });
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
  { title: z.string(), columnTitle: z.string().optional(), tags: z.array(z.string()).optional(), description: z.string().optional(), agent: z.enum(['claude-code', 'opencode']).optional(), priority: z.enum(['high', 'medium', 'low']).optional(), due_date: z.string().optional() },
  async ({ title, columnTitle = 'Backlog', tags = [], description, agent, priority, due_date }) => {
    try {
      const activeId = db.getActiveWorkspaceId();
      if (!activeId) return { content: [{ type: 'text', text: JSON.stringify({ error: 'No active workspace' }) }] };
      const board = db.getBoard(activeId);
      const column = board.columns.find(c => c.title === columnTitle);
      if (!column) return { content: [{ type: 'text', text: JSON.stringify({ error: `Column not found: ${columnTitle}` }) }] };
      const card = db.createCard(activeId, column.id, title, { description, tags, agent, priority, due_date });
      db.addAgentLog(activeId, agent || 'system', 'create_card', `Created '${title}' in ${columnTitle}`);
      emitSSE('board_update', db.getBoard(activeId));
      return { content: [{ type: 'text', text: JSON.stringify(card) }] };
    } catch (err) { return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }] }; }
  }
);

mcp.tool('update_card', "Update a card's title, description, tags, assigned agent, or priority",
  { cardId: z.string(), title: z.string().optional(), description: z.string().optional(), tags: z.array(z.string()).optional(), agent: z.enum(['claude-code', 'opencode', '']).optional(), priority: z.enum(['high', 'medium', 'low', '']).optional(), due_date: z.string().optional() },
  async ({ cardId, title, description, tags, agent, priority, due_date }) => {
    try {
      const card = db.getCard(cardId);
      if (!card) return { content: [{ type: 'text', text: JSON.stringify({ error: `Card not found: ${cardId}` }) }] };
      db.updateCard(cardId, { title, description, tags, agent: agent || undefined, priority: priority || undefined, due_date: due_date !== undefined ? due_date : undefined });
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
      
      const fromColumn = db.getColumn(card.column_id);
      db.moveCard(cardId, toColumn.id);
      db.addAgentLog(card.workspace_id, card.agent || 'system', 'move_card', `Moved '${card.title}' → ${toColumnTitle}`);
      emitSSE('board_update', db.getBoard(card.workspace_id));
      
      if (toColumnTitle === 'In Progress' && card.agent && !isAgentRunning(cardId)) {
        emitSSE('trigger', { card, toColumn: toColumnTitle, agent: card.agent });
        spawnAgent(cardId, card.workspace_id, card.agent, emitSSE);
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
    
    db.deleteCard(cardId);
    db.addAgentLog(card.workspace_id, 'system', 'delete_card', `Deleted '${card.title}'`);
    emitSSE('board_update', db.getBoard(card.workspace_id));
    
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

const server = app.listen(PORT, '0.0.0.0', () => {
  httpServerRunning = true;
  const { networkInterfaces } = require('os');
  let localIP = 'localhost';
  try {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          localIP = net.address;
          break;
        }
      }
    }
  } catch (_) {}
  process.stderr.write(`HTTP server listening on http://localhost:${PORT}\n`);
  process.stderr.write(`Network access: http://${localIP}:${PORT}\n`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    process.stderr.write(`Port ${PORT} in use — running in MCP-only mode, proxying SSE to main server\n`);
    // Don't exit — MCP stdio still works, emitSSE will proxy to the running server
  } else {
    process.stderr.write('Server error: ' + err.message + '\n');
    process.exit(1);
  }
});

function shutdown() {
  if (httpServerRunning) {
    for (const res of sseClients) { try { res.end(); } catch(_) {} }
    sseClients.clear();
    server.close(() => process.exit(0));
  } else {
    process.exit(0);
  }
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const transport = new StdioServerTransport();
mcp.connect(transport)
  .then(() => process.stderr.write('MCP server connected via stdio\n'))
  .catch(err => process.stderr.write('MCP connect error: ' + err.message + '\n'));
