'use strict';

// ── Network-mode token ───────────────────────────────────────────────────────
// When the server runs on a non-loopback host it requires a shared token. The
// operator opens the board via http://host:7341/?token=… ; we capture it once and
// attach it to every same-origin fetch + the SSE stream. In normal local use the
// URL has no token, so this is a no-op and fetch is left untouched.
const VB_TOKEN = new URLSearchParams(location.search).get('token') || '';
if (VB_TOKEN) {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    init = { ...(init || {}) };
    init.headers = { ...(init.headers || {}), 'X-VB-Token': VB_TOKEN };
    return _fetch(input, init);
  };
}
function vbUrl(pathAndQuery) {
  if (!VB_TOKEN) return pathAndQuery;
  return pathAndQuery + (pathAndQuery.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(VB_TOKEN);
}

// ── Theme ──────────────────────────────────────────────────────────────────
const THEME_KEY = 'vb_theme';
const THEME_CYCLE = ['light', 'dark'];
const THEME_ICONS = { system: '☀', light: '☀', dark: '☾' };
const THEME_LABELS = { system: 'Light', light: 'Light', dark: 'Dark' };
function applyTheme(t) {
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  document.querySelectorAll('.theme-opt').forEach(b => b.classList.toggle('active', b.dataset.t === t));
  localStorage.setItem(THEME_KEY, t);
  const btn = document.getElementById('theme-btn');
  if (btn) { btn.textContent = THEME_ICONS[t] || '⊙'; btn.title = `Theme: ${THEME_LABELS[t] || t} (click to cycle)`; }
}
applyTheme(localStorage.getItem(THEME_KEY) || 'system');

// ── Card description toggle ────────────────────────────────────────────────
function getShowDescriptions() {
  return localStorage.getItem('vb_show_descriptions') === 'true';
}
function setShowDescriptions(val) {
  localStorage.setItem('vb_show_descriptions', val ? 'true' : 'false');
}
document.body.classList.toggle('vb-show-descriptions', getShowDescriptions());

// ── State ──────────────────────────────────────────────────────────────────
const TAB_ID = crypto.randomUUID();
let board = { columns: [], agentLog: [] };
let workspaces = [];
let activeWsId = null;
let editingWsId = null;
let draggingCard = null;
let draggingFromCol = null;
let es = null;
let sseReconnectAttempts = 0;
const MAX_SSE_RECONNECT = 3;

const TAGS = ['feature','bug','design','infra','docs','api'];
const COL_COLORS = ['#6b6860','#2563eb','#d97706','#16a34a','#7c3aed','#dc2626','#0891b2','#db2777'];
const AGENT_LABELS = { 'claude-code': 'Claude Code', 'opencode': 'OpenCode', 'codex': 'Codex CLI', 'command-code': 'Command Code', '': 'None' };

let agentsAvailable = { 'claude-code': true, 'opencode': true, 'codex': true, 'command-code': true };
fetch('/api/agents/available').then(r => r.json()).then(data => { agentsAvailable = data; }).catch(() => {});

let availableModels = { 'claude-code': [], 'opencode': [], 'codex': [], 'command-code': [] };
fetch('/api/models').then(r => r.json()).then(data => { availableModels = data; }).catch(() => {});

const runningCards = new Set();
const queuedCards = new Set();

// ── Dependency helpers ───────────────────────────────────────────────────────
function findCardEntry(id) {
  for (const col of (board?.columns || [])) {
    const c = col.cards.find(x => x.id === id);
    if (c) return { card: c, column: col };
  }
  return null;
}
// Blocker cards that haven't reached Done yet (a deleted blocker counts as cleared).
function unfinishedBlockersUI(card) {
  if (!Array.isArray(card.blocked_by) || !card.blocked_by.length) return [];
  return card.blocked_by
    .map(id => findCardEntry(id))
    .filter(e => e && e.column.title !== 'Done')
    .map(e => e.card);
}

// ── Cycle detection helpers ──────────────────────────────────────────────────
// Detects if setting cardId's blocked_by to newBlockedBy would create a cycle.
// Returns the cycle path as an array of card IDs, or null if no cycle.
function detectCycleUI(cardId, newBlockedBy) {
  newBlockedBy = (newBlockedBy || []).filter(id => id !== cardId);
  if (!newBlockedBy.length) return null;
  if (!board || !board.columns) return null;

  const graph = {};
  for (const col of board.columns) {
    for (const card of col.cards) {
      graph[card.id] = (card.blocked_by || []).filter(id => id !== card.id);
    }
  }
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

// Translates a cycle path array of card IDs to display-friendly titles.
function cyclePathTitles(cyclePath) {
  const cardMap = {};
  for (const col of (board?.columns || [])) {
    for (const card of col.cards) {
      cardMap[card.id] = card.title;
    }
  }
  return cyclePath.map(id => cardMap[id] || id.slice(0, 8));
}

// Finds all card IDs that are part of a circular dependency in the current board.
function findCycleCardIds() {
  const ids = new Set();
  if (!board || !board.columns) return ids;

  const graph = {};
  for (const col of board.columns) {
    for (const card of col.cards) {
      graph[card.id] = (card.blocked_by || []).filter(id => id !== card.id);
    }
  }

  for (const col of board.columns) {
    for (const card of col.cards) {
      if (ids.has(card.id)) continue;
      const visited = new Set();
      const path = [];

      function dfs(id) {
        const idx = path.indexOf(id);
        if (idx !== -1) {
          for (let i = idx; i < path.length; i++) ids.add(path[i]);
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
  }

  return ids;
}

// ── DOM ────────────────────────────────────────────────────────────────────
const boardEl        = document.getElementById('board');
const boardWrap      = document.getElementById('board-wrap');
const emptyState     = document.getElementById('empty-state');
const connDot        = document.getElementById('conn-dot');
const logSidebar     = document.getElementById('log-sidebar');
const logEntries     = document.getElementById('log-entries');
const logToggleBtn   = document.getElementById('log-toggle-btn');
const wsNewBtn    = document.getElementById('ws-new-btn');
const wsNewPath   = document.getElementById('ws-new-path');
const wsNewName   = document.getElementById('ws-new-name');
const wsListEl    = document.getElementById('ws-list');

// New header elements
const headerWorkspace     = document.getElementById('header-workspace');
const headerWorkspaceIcon = document.getElementById('header-workspace-icon');
const headerWorkspaceName = document.getElementById('header-workspace-name');
const headerConnection    = document.getElementById('header-connection');
const headerAgents        = document.getElementById('header-agents');
const headerAgentsIcon    = document.getElementById('header-agents-icon');
const headerAgentsCount   = document.getElementById('header-agents-count');

// ── Utilities ──────────────────────────────────────────────────────────────
function uid() { return crypto.randomUUID(); }
function stableHash(o) { return JSON.stringify(o); }
function fmtTime(iso) { return new Date(iso).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}); }
function folderName(p) { return p.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean).pop() || ''; }

function timeAgo(isoString) {
  if (!isoString) return '';
  const seconds = Math.floor((new Date() - new Date(isoString)) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function fmtDuration(seconds) {
  if (seconds == null) return '';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtTokens(n) {
  if (n == null) return '';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'k';
  return (n / 1_000_000).toFixed(1) + 'M';
}

function updateHeaderAgents(count) {
  if (!headerAgents) return;
  
  if (count > 0) {
    headerAgentsCount.textContent = count;
    headerAgents.querySelector('.header-agents-label').textContent = count === 1 ? 'agent' : 'agents';
    headerAgentsIcon.classList.remove('idle');
    headerAgents.hidden = false;
    headerAgents.title = `${count} active agent${count === 1 ? '' : 's'}`;
  } else {
    headerAgents.hidden = true;
  }
}

function isAbsolutePath(p) {
  if (!p) return false;
  if (p.startsWith('/')) return true;
  if (/^[a-zA-Z]:[/\\]/.test(p)) return true;
  return false;
}

// vbSelect controllers for the model dropdowns, keyed by prefix ('nc' | 'card').
const modelSelects = {};

function updateModelDropdown(prefix, agent, selectedModel) {
  const modelRow = document.getElementById(`${prefix}-model-row`);
  const mount = document.getElementById(`${prefix}-model-mount`);

  if (!agent || !availableModels[agent] || availableModels[agent].length === 0) {
    if (modelRow) modelRow.style.display = 'none';
    return;
  }
  if (!modelRow || !mount) return;

  modelRow.style.display = '';
  const options = [{ value: '', label: 'Default' }].concat(
    availableModels[agent].map(m => ({ value: m.id, label: m.name, hint: m.description || '' }))
  );

  let ctrl = modelSelects[prefix];
  if (!ctrl) {
    ctrl = vbSelect({
      options, value: selectedModel || '', placeholder: 'Default', ariaLabel: 'Model',
      onChange: v => {
        // Only the card detail sidebar persists immediately; the new-card modal
        // reads the value at submit time.
        const card = board.columns.flatMap(c => c.cards).find(c => c.id === modalCardId);
        if (card) { card.model = v || undefined; saveModal(card); }
      },
    });
    mount.appendChild(ctrl.el);
    modelSelects[prefix] = ctrl;
  } else {
    ctrl.setOptions(options);
    ctrl.setValue(selectedModel || '');
  }
}

async function refreshModels() {
  try {
    const resp = await fetch('/api/models/refresh', { method: 'POST' });
    const data = await resp.json();
    availableModels = data;
    showToast('Models refreshed');
  } catch (err) {
    showToast('Failed to refresh models: ' + err.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const ncRefresh = document.getElementById('nc-model-refresh');
  const cardRefresh = document.getElementById('card-model-refresh');
  if (ncRefresh) ncRefresh.addEventListener('click', refreshModels);
  if (cardRefresh) cardRefresh.addEventListener('click', refreshModels);
});

// ── Persistence ────────────────────────────────────────────────────────────
function saveCache(b) { try { localStorage.setItem('vb_board', JSON.stringify(b)); } catch(_){} }
function loadCache() { try { const r=localStorage.getItem('vb_board'); if(r) return JSON.parse(r); } catch(_){} return null; }

// ── POST board ─────────────────────────────────────────────────────────────
async function postBoard() {
  const payload = { ...JSON.parse(JSON.stringify(board)), _tabId: TAB_ID };
  try { await fetch('/board', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }); } catch(_){}
  saveCache(board);
}

// ── Empty state ────────────────────────────────────────────────────────────
function setEmptyState(empty) {
  emptyState.classList.toggle('visible', empty);
  boardEl.style.display = empty ? 'none' : '';
}

document.getElementById('empty-create-btn').addEventListener('click', () => {
  openCreateForm();
});

// ── Browse folder ──────────────────────────────────────────────────────────
async function browseFolder(inputEl, btnEl) {
  btnEl.disabled = true;
  const orig = btnEl.textContent;
  btnEl.textContent = '…';
  try {
    const resp = await fetch('/api/folder-dialog');
    if (resp.ok) {
      const { path } = await resp.json();
      if (path) {
        inputEl.value = path;
        inputEl.dispatchEvent(new Event('input'));
      }
    }
  } catch(_) { showToast('Folder dialog unavailable - type the path manually'); }
  finally { btnEl.disabled = false; btnEl.textContent = orig; }
}

document.getElementById('ws-new-browse').addEventListener('click', () => browseFolder(wsNewPath, document.getElementById('ws-new-browse')));
document.getElementById('ws-modal-browse').addEventListener('click', () =>
  browseFolder(document.getElementById('ws-modal-path'), document.getElementById('ws-modal-browse'))
);

// Auto-fill name from path and check git status when path changes (new workspace modal)
let _gitCheckTimer = null;
wsNewPath.addEventListener('input', () => {
  if (!wsNewName.value.trim()) {
    const suggested = folderName(wsNewPath.value);
    wsNewName.placeholder = suggested ? `Name (${suggested})` : 'Optional — inferred from folder name';
  }
  clearTimeout(_gitCheckTimer);
  const p = wsNewPath.value.trim();
  const gitRow = document.getElementById('ws-new-git-status');
  if (!p) { gitRow.style.display = 'none'; return; }
  _gitCheckTimer = setTimeout(() => checkPathGitStatus(p), 600);
});

async function checkPathGitStatus(wsPath) {
  const gitRow = document.getElementById('ws-new-git-status');
  gitRow.style.display = 'flex';
  gitRow.innerHTML = '<span style="color:var(--text-muted)">Checking git…</span>';
  try {
    const data = await fetch(`/api/git-status?path=${encodeURIComponent(wsPath)}`).then(r => r.json());
    if (data.isGit) {
      gitRow.innerHTML = `<span style="color:#16a34a">✓ Git repo</span><span style="color:var(--text-muted);font-family:monospace">${data.branch ? `  ${data.branch}` : ''}</span>`;
    } else {
      gitRow.innerHTML = `<span style="color:var(--text-muted)">Not a git repo</span><button id="ws-git-init-btn" style="margin-left:auto;font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer">Init git</button>`;
      document.getElementById('ws-git-init-btn').addEventListener('click', async function() {
        this.disabled = true; this.textContent = 'Initializing…';
        try {
          const r = await fetch('/api/git-init', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ path: wsPath }),
          }).then(r => r.json());
          if (r.ok) {
            gitRow.innerHTML = `<span style="color:#16a34a">✓ Git initialized</span><span style="color:var(--text-muted);font-family:monospace">  ${r.branch || 'main'}</span>`;
          } else {
            throw new Error(r.error);
          }
        } catch(err) {
          gitRow.innerHTML = `<span style="color:var(--danger)">Init failed: ${err.message}</span>`;
        }
      });
    }
  } catch(_) {
    gitRow.style.display = 'none';
  }
}
