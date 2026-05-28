const fs = require('fs');
const path = require('path');
const { createWorkspace, createCard, addAgentLog, getActiveWorkspaceId, setActiveWorkspaceId, db } = require('./db');

const LEGACY_FILE = path.resolve('./board.json');
const WS_DIR = path.resolve('./workspaces');

function migrateLegacyData() {
  let migrated = false;
  
  if (fs.existsSync(LEGACY_FILE)) {
    try {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
      const wsName = legacy.workspace?.name || '';
      const wsPath = legacy.workspace?.path || process.cwd();
      const wsDesc = legacy.workspace?.description || '';
      
      const ws = createWorkspace(wsName, wsPath, wsDesc);
      
      const columnMap = {};
      const columns = db.prepare('SELECT id, title FROM columns WHERE workspace_id = ?').all(ws.id);
      columns.forEach(col => { columnMap[col.title] = col.id; });
      
      if (legacy.columns) {
        legacy.columns.forEach((col, idx) => {
          const existingCol = columns.find(c => c.title === col.title);
          if (existingCol) {
            columnMap[col.title] = existingCol.id;
          } else {
            const newColId = 'col-' + require('crypto').randomUUID();
            db.prepare('INSERT INTO columns (id, workspace_id, title, color, position) VALUES (?, ?, ?, ?, ?)')
              .run(newColId, ws.id, col.title, col.color || '#6b6860', columns.length + idx);
            columnMap[col.title] = newColId;
          }
          
          if (col.cards) {
            col.cards.forEach(card => {
              createCard(ws.id, columnMap[col.title], card.title || card.text, {
                description: card.description,
                tags: card.tags,
                agent: card.agent,
              });
            });
          }
        });
      }
      
      if (legacy.agentLog) {
        legacy.agentLog.forEach(entry => {
          addAgentLog(ws.id, entry.agent || 'unknown', entry.action || 'event', entry.detail || '');
        });
      }
      
      setActiveWorkspaceId(ws.id);
      
      fs.renameSync(LEGACY_FILE, LEGACY_FILE + '.migrated');
      process.stderr.write(`Migrated legacy board.json to workspace ${ws.id}\n`);
      migrated = true;
    } catch (err) {
      process.stderr.write(`Failed to migrate legacy board.json: ${err.message}\n`);
    }
  }
  
  if (fs.existsSync(WS_DIR)) {
    const files = fs.readdirSync(WS_DIR).filter(f => f.endsWith('.json') && f !== '.active');
    
    files.forEach(file => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(WS_DIR, file), 'utf8'));
        
        const existing = db.prepare('SELECT id FROM workspaces WHERE id = ?').get(data.id);
        if (existing) return;
        
        const ws = createWorkspace(data.name || '', data.path || '', data.description || '');
        
        const columnMap = {};
        const columns = db.prepare('SELECT id, title FROM columns WHERE workspace_id = ?').all(ws.id);
        columns.forEach(col => { columnMap[col.title] = col.id; });
        
        if (data.columns) {
          data.columns.forEach((col, idx) => {
            const existingCol = columns.find(c => c.title === col.title);
            if (existingCol) {
              columnMap[col.title] = existingCol.id;
            } else {
              const newColId = 'col-' + require('crypto').randomUUID();
              db.prepare('INSERT INTO columns (id, workspace_id, title, color, position) VALUES (?, ?, ?, ?, ?)')
                .run(newColId, ws.id, col.title, col.color || '#6b6860', columns.length + idx);
              columnMap[col.title] = newColId;
            }
            
            if (col.cards) {
              col.cards.forEach(card => {
                createCard(ws.id, columnMap[col.title], card.title || card.text, {
                  description: card.description,
                  tags: card.tags,
                  agent: card.agent,
                });
              });
            }
          });
        }
        
        if (data.agentLog) {
          data.agentLog.forEach(entry => {
            addAgentLog(ws.id, entry.agent || 'unknown', entry.action || 'event', entry.detail || '');
          });
        }
        
        fs.renameSync(path.join(WS_DIR, file), path.join(WS_DIR, file + '.migrated'));
        process.stderr.write(`Migrated workspace ${file} to database\n`);
        migrated = true;
      } catch (err) {
        process.stderr.write(`Failed to migrate ${file}: ${err.message}\n`);
      }
    });
    
    if (fs.existsSync(path.join(WS_DIR, '.active'))) {
      try {
        const activeId = fs.readFileSync(path.join(WS_DIR, '.active'), 'utf8').trim();
        if (activeId && !getActiveWorkspaceId()) {
          const ws = db.prepare('SELECT id FROM workspaces LIMIT 1').get();
          if (ws) setActiveWorkspaceId(ws.id);
        }
      } catch (err) {}
    }
  }
  
  return migrated;
}

module.exports = { migrateLegacyData };
