const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

function getUserDataDir() {
  const platform = process.platform;
  let base;
  
  if (platform === 'win32') {
    base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  } else if (platform === 'darwin') {
    base = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  }
  
  return path.join(base, 'vibeboard');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const DATA_DIR = getUserDataDir();
ensureDir(DATA_DIR);

const DB_PATH = path.join(DATA_DIR, 'vibeboard.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema migrations
db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS columns (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    color TEXT NOT NULL,
    position INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    column_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    tags TEXT,
    agent TEXT,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS card_notes (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS agent_log (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    agent TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_columns_workspace ON columns(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column_id);
  CREATE INDEX IF NOT EXISTS idx_cards_workspace ON cards(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_card_notes_card ON card_notes(card_id);
  CREATE INDEX IF NOT EXISTS idx_agent_log_workspace ON agent_log(workspace_id);
`);

// Column migrations for existing databases
(function migrate() {
  const cardCols = db.pragma('table_info(cards)').map(r => r.name);
  if (!cardCols.includes('branch'))       db.exec('ALTER TABLE cards ADD COLUMN branch TEXT');
  if (!cardCols.includes('worktree_path')) db.exec('ALTER TABLE cards ADD COLUMN worktree_path TEXT');
})();

function getActiveWorkspaceId() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('active_workspace_id');
  return row ? row.value : null;
}

function setActiveWorkspaceId(id) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('active_workspace_id', id);
}

function listWorkspaces() {
  return db.prepare('SELECT id, name, path, description FROM workspaces ORDER BY created_at DESC').all();
}

function getWorkspace(id) {
  return db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
}

function createWorkspace(name, wsPath, description = '') {
  const id = 'ws-' + crypto.randomUUID();
  const now = new Date().toISOString();
  
  db.prepare(`
    INSERT INTO workspaces (id, name, path, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, wsPath, description, now, now);
  
  const defaultColumns = [
    { id: 'col-' + crypto.randomUUID(), title: 'Backlog', color: '#6b6860', position: 0 },
    { id: 'col-' + crypto.randomUUID(), title: 'In Progress', color: '#2563eb', position: 1 },
    { id: 'col-' + crypto.randomUUID(), title: 'Review', color: '#d97706', position: 2 },
    { id: 'col-' + crypto.randomUUID(), title: 'Done', color: '#16a34a', position: 3 },
  ];
  
  const insertCol = db.prepare('INSERT INTO columns (id, workspace_id, title, color, position) VALUES (?, ?, ?, ?, ?)');
  for (const col of defaultColumns) {
    insertCol.run(col.id, id, col.title, col.color, col.position);
  }
  
  return { id, name, path: wsPath, description };
}

function updateWorkspace(id, updates) {
  const fields = [];
  const values = [];
  
  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.path !== undefined) { fields.push('path = ?'); values.push(updates.path); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  
  if (fields.length === 0) return;
  
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  
  db.prepare(`UPDATE workspaces SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

function deleteWorkspace(id) {
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
}

function getBoard(workspaceId) {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  
  const columns = db.prepare(`
    SELECT id, title, color, position FROM columns 
    WHERE workspace_id = ? 
    ORDER BY position
  `).all(workspaceId);
  
  const cards = db.prepare(`
    SELECT id, column_id, title, description, tags, agent, branch, worktree_path, position, created_at
    FROM cards
    WHERE workspace_id = ?
    ORDER BY position
  `).all(workspaceId);
  
  const agentLog = db.prepare(`
    SELECT id, timestamp, agent, action, detail 
    FROM agent_log 
    WHERE workspace_id = ? 
    ORDER BY timestamp DESC
  `).all(workspaceId);
  
  const columnsWithCards = columns.map(col => ({
    ...col,
    cards: cards
      .filter(c => c.column_id === col.id)
      .map(c => ({
        ...c,
        tags: c.tags ? JSON.parse(c.tags) : [],
        createdAt: c.created_at,
        worktreePath: c.worktree_path,
      }))
  }));
  
  return {
    id: workspace.id,
    name: workspace.name,
    path: workspace.path,
    description: workspace.description,
    columns: columnsWithCards,
    agentLog,
  };
}

function createCard(workspaceId, columnId, title, options = {}) {
  const id = 'card-' + crypto.randomUUID();
  const now = new Date().toISOString();
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 as pos FROM cards WHERE column_id = ?').get(columnId).pos;
  
  db.prepare(`
    INSERT INTO cards (id, column_id, workspace_id, title, description, tags, agent, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, columnId, workspaceId, title,
    options.description || null,
    options.tags ? JSON.stringify(options.tags) : null,
    options.agent || null,
    position, now, now
  );
  
  return { id, title, tags: options.tags || [], createdAt: now, ...options };
}

function updateCard(cardId, updates) {
  const fields = [];
  const values = [];
  
  if (updates.title !== undefined)       { fields.push('title = ?');        values.push(updates.title); }
  if (updates.description !== undefined) { fields.push('description = ?');   values.push(updates.description || null); }
  if (updates.tags !== undefined)        { fields.push('tags = ?');          values.push(JSON.stringify(updates.tags)); }
  if (updates.agent !== undefined)       { fields.push('agent = ?');         values.push(updates.agent || null); }
  if (updates.branch !== undefined)      { fields.push('branch = ?');        values.push(updates.branch || null); }
  if (updates.worktreePath !== undefined){ fields.push('worktree_path = ?'); values.push(updates.worktreePath || null); }
  
  if (fields.length === 0) return;
  
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(cardId);
  
  db.prepare(`UPDATE cards SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

function moveCard(cardId, toColumnId) {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  if (!card) return null;
  
  const fromColumnId = card.column_id;
  
  db.prepare('UPDATE cards SET position = position - 1 WHERE column_id = ? AND position > ?').run(fromColumnId, card.position);
  
  const newPosition = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 as pos FROM cards WHERE column_id = ?').get(toColumnId).pos;
  
  db.prepare('UPDATE cards SET column_id = ?, position = ?, updated_at = ? WHERE id = ?')
    .run(toColumnId, newPosition, new Date().toISOString(), cardId);
  
  return { cardId, fromColumnId, toColumnId };
}

function deleteCard(cardId) {
  const card = db.prepare('SELECT column_id, position FROM cards WHERE id = ?').get(cardId);
  if (!card) return false;
  
  db.prepare('DELETE FROM cards WHERE id = ?').run(cardId);
  db.prepare('UPDATE cards SET position = position - 1 WHERE column_id = ? AND position > ?').run(card.column_id, card.position);
  
  return true;
}

function addCardNote(cardId, content) {
  const id = 'note-' + crypto.randomUUID();
  const now = new Date().toISOString();
  
  db.prepare('INSERT INTO card_notes (id, card_id, content, created_at) VALUES (?, ?, ?, ?)')
    .run(id, cardId, content, now);
  
  return { id, cardId, content, createdAt: now };
}

function getCardNotes(cardId) {
  return db.prepare('SELECT id, content, created_at as createdAt FROM card_notes WHERE card_id = ? ORDER BY created_at')
    .all(cardId);
}

function addAgentLog(workspaceId, agent, action, detail) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  
  db.prepare('INSERT INTO agent_log (id, workspace_id, timestamp, agent, action, detail) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, workspaceId, now, agent, action, detail);
  
  return { id, timestamp: now, agent, action, detail };
}

function addColumn(workspaceId, title, color = '#6b6860') {
  const id = 'col-' + crypto.randomUUID();
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 as pos FROM columns WHERE workspace_id = ?').get(workspaceId).pos;
  
  db.prepare('INSERT INTO columns (id, workspace_id, title, color, position) VALUES (?, ?, ?, ?, ?)')
    .run(id, workspaceId, title, color, position);
  
  return { id, title, color, cards: [] };
}

function syncBoard(workspaceId, columns) {
  const existingCols  = db.prepare('SELECT id FROM columns WHERE workspace_id = ?').all(workspaceId).map(r => r.id);
  const existingCards = db.prepare('SELECT id FROM cards   WHERE workspace_id = ?').all(workspaceId).map(r => r.id);

  const incomingColIds  = columns.map(c => c.id);
  const incomingCardIds = columns.flatMap(c => (c.cards || []).map(card => card.id));

  const sync = db.transaction(() => {
    // Remove deleted columns (cascades to cards)
    for (const id of existingCols) {
      if (!incomingColIds.includes(id))
        db.prepare('DELETE FROM columns WHERE id = ?').run(id);
    }

    // Upsert columns + cards
    for (let ci = 0; ci < columns.length; ci++) {
      const col = columns[ci];
      if (existingCols.includes(col.id)) {
        db.prepare('UPDATE columns SET title = ?, color = ?, position = ? WHERE id = ?')
          .run(col.title, col.color || '#6b6860', ci, col.id);
      } else {
        db.prepare('INSERT INTO columns (id, workspace_id, title, color, position) VALUES (?, ?, ?, ?, ?)')
          .run(col.id, workspaceId, col.title, col.color || '#6b6860', ci);
      }

      for (let ki = 0; ki < (col.cards || []).length; ki++) {
        const card = col.cards[ki];
        const now  = new Date().toISOString();
        const tags = JSON.stringify(card.tags || []);
        if (existingCards.includes(card.id)) {
          db.prepare('UPDATE cards SET column_id=?, title=?, description=?, tags=?, agent=?, position=?, updated_at=? WHERE id=?')
            .run(col.id, card.title, card.description || null, tags, card.agent || null, ki, now, card.id);
        } else {
          db.prepare('INSERT INTO cards (id, column_id, workspace_id, title, description, tags, agent, position, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
            .run(card.id, col.id, workspaceId, card.title, card.description || null, tags, card.agent || null, ki, now, now);
        }
      }
    }

    // Remove deleted cards
    for (const id of existingCards) {
      if (!incomingCardIds.includes(id))
        db.prepare('DELETE FROM cards WHERE id = ?').run(id);
    }
  });

  sync();
}

function getCard(cardId) {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  if (!card) return null;
  
  return {
    ...card,
    tags: card.tags ? JSON.parse(card.tags) : [],
    createdAt: card.created_at,
  };
}

function getColumn(columnId) {
  return db.prepare('SELECT * FROM columns WHERE id = ?').get(columnId);
}

module.exports = {
  db,
  DATA_DIR,
  getUserDataDir,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  getBoard,
  createCard,
  updateCard,
  moveCard,
  deleteCard,
  addCardNote,
  getCardNotes,
  addAgentLog,
  addColumn,
  syncBoard,
  getCard,
  getColumn,
};
