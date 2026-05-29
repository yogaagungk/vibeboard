'use strict';

// ── Keyboard shortcuts ──────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName?.toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable;

  if (e.key === 'Escape') {
    if (document.getElementById('shortcuts-overlay').classList.contains('open')) {
      document.getElementById('shortcuts-overlay').classList.remove('open'); return;
    }
    if (document.querySelector('.modal-overlay.open')) {
      document.querySelector('.modal-overlay.open')?.classList.remove('open'); return;
    }
    if (document.getElementById('card-sidebar').classList.contains('open')) { closeCardModal(); return; }
    if (document.getElementById('log-sidebar').classList.contains('open')) {
      document.getElementById('log-sidebar').classList.remove('open'); return;
    }
    return;
  }
  if (typing) return;
  if (e.key === '?') {
    e.preventDefault();
    document.getElementById('shortcuts-overlay').classList.toggle('open');
  }
  if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    const firstCol = board.columns?.[0];
    if (firstCol) openNewCardModal(firstCol.id);
  }
  if (e.key === '/') {
    e.preventDefault();
    document.getElementById('board-search')?.focus();
  }
});
document.getElementById('shortcuts-overlay').addEventListener('click', e => {
  if (e.target.id === 'shortcuts-overlay') e.target.classList.remove('open');
});

// ── Export / Import ─────────────────────────────────────────────────────────
document.getElementById('ws-export-btn').addEventListener('click', async () => {
  if (!editingWsId) return;
  try {
    const resp = await fetch(`/api/workspaces/${editingWsId}/export`);
    if (!resp.ok) { showToast('Export failed'); return; }
    const data = await resp.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vibeboard-${(data.workspace?.name || 'board').replace(/\s+/g, '-')}-${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  } catch(err) { showToast('Export failed: ' + err.message); }
});

document.getElementById('ws-import-btn').addEventListener('click', () => {
  document.getElementById('ws-import-file').click();
});

document.getElementById('ws-import-file').addEventListener('change', async function() {
  const file = this.files?.[0]; if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const resp = await fetch('/api/workspaces/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const result = await resp.json();
    if (!resp.ok) { showToast('Import failed: ' + (result.error || 'unknown error')); return; }
    showToast(`Imported "${result.name || 'workspace'}" successfully`);
    closeWsModal();
    await loadWorkspaces();
  } catch(err) { showToast('Import failed: ' + err.message); }
  this.value = '';
});

// ── MCP Status & Setup ────────────────────────────────────────────────────
let mcpConfigured = true;
let mcpBannerDismissed = false;
let mcpStatusCache = null;

const AGENT_LABELS_MCP = { 'claude-code': 'Claude Code', 'opencode': 'OpenCode', 'codex': 'Codex CLI' };

async function checkMcpStatus() {
  try {
    const resp = await fetch('/api/mcp-status');
    if (!resp.ok) return;
    const data = await resp.json();
    mcpStatusCache = data;
    mcpConfigured = !data.anyUnconfigured;
    updateMcpBanner(data);
  } catch(_) {}
  // always resolves so callers can chain .then()
}

function updateMcpHint() {
  const hint = document.getElementById('card-modal-mcp-hint');
  if (!hint) return;
  const anyNeedsSetup = Object.values(mcpStatusCache?.agents || {}).some(a => a.installed && !a.configured);
  hint.style.display = anyNeedsSetup ? 'inline-flex' : 'none';
}

function updateMcpBanner(data) {
  const banner = document.getElementById('mcp-banner');
  const show = data.anyUnconfigured && !mcpBannerDismissed;
  banner.classList.toggle('visible', show);
  document.body.classList.toggle('mcp-banner-open', show);
  if (show) {
    const unconfigured = Object.entries(data.agents || {})
      .filter(([, a]) => a.installed && !a.configured)
      .map(([k]) => AGENT_LABELS_MCP[k] || k);
    document.getElementById('mcp-banner-text').innerHTML =
      `<strong>MCP not configured</strong> for ${unconfigured.join(', ')} — agents won't be able to interact with the board.`;
  }
}
document.getElementById('mcp-banner-dismiss').addEventListener('click', () => {
  mcpBannerDismissed = true;
  document.getElementById('mcp-banner').classList.remove('visible');
  document.body.classList.remove('mcp-banner-open');
});

async function openMcpModal() {
  document.getElementById('mcp-modal-overlay').classList.add('open');
  renderMcpAgentRows(null);
  document.getElementById('mcp-modal-install-all-btn').style.display = 'none';

  try {
    const resp = await fetch('/api/mcp-status');
    const data = await resp.json();
    mcpStatusCache = data;
    mcpConfigured = !data.anyUnconfigured;
    updateMcpBanner(data);
    renderMcpAgentRows(data.agents);
    const hasUnconfigured = Object.values(data.agents || {}).some(a => a.installed && !a.configured);
    document.getElementById('mcp-modal-install-all-btn').style.display = hasUnconfigured ? '' : 'none';
  } catch(_) {
    renderMcpAgentRows({});
  }
}

function renderMcpAgentRows(agents) {
  const container = document.getElementById('mcp-agent-rows');
  if (!agents) {
    container.innerHTML = '<div class="mcp-status-row" style="justify-content:center;font-size:12px;color:var(--text-muted)">Checking…</div>';
    return;
  }
  container.innerHTML = '';
  for (const key of ['claude-code', 'opencode', 'codex']) {
    const a = agents[key] || { installed: false, configured: false, configPath: '' };
    const row = document.createElement('div');
    row.className = 'mcp-agent-row';

    const dot = document.createElement('span');
    dot.className = 'mcp-status-dot ' + (a.installed ? (a.configured ? 'ok' : 'warn') : 'off');

    const info = document.createElement('div');
    info.className = 'mcp-agent-info';
    const name = document.createElement('div');
    name.className = 'mcp-agent-name';
    name.textContent = AGENT_LABELS_MCP[key];
    info.appendChild(name);
    if (a.installed && a.configPath) {
      const p = document.createElement('div');
      p.className = 'mcp-agent-path';
      p.textContent = a.configPath; p.title = a.configPath;
      info.appendChild(p);
    }

    const tag = document.createElement('span');
    tag.className = 'mcp-agent-tag ' + (a.installed ? (a.configured ? 'ok' : 'warn') : 'off');
    tag.textContent = !a.installed ? 'not installed' : a.configured ? 'configured' : 'not configured';

    row.appendChild(dot); row.appendChild(info); row.appendChild(tag);

    if (a.installed && !a.configured) {
      const btn = document.createElement('button');
      btn.className = 'mcp-agent-setup-btn';
      btn.textContent = 'Set up';
      btn.addEventListener('click', () => installMcpForAgent(key, btn));
      row.appendChild(btn);
    }
    container.appendChild(row);
  }
}

async function installMcpForAgent(agentKey, btn) {
  btn.disabled = true; btn.textContent = '…';
  try {
    const resp = await fetch('/api/mcp-setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: agentKey }),
    });
    const data = await resp.json();
    const result = data.results?.[agentKey];
    if (!result?.ok) throw new Error(result?.error || 'Failed');
    showToast(`${AGENT_LABELS_MCP[agentKey]} MCP configured`);
    await refreshMcpModal();
  } catch(err) {
    btn.disabled = false; btn.textContent = 'Set up';
    showToast('Setup failed: ' + err.message);
  }
}

function refreshAgentBtnsInModal() {
  if (!cardSidebar.classList.contains('open')) return;
  const currentAgent = getModalAgent();
  if (modalCardId) {
    const col = board.columns.find(c => c.id === modalColId);
    const card = col?.cards.find(c => c.id === modalCardId);
    applyAgentBtns(currentAgent, btn => {
      if (card) { card.agent = btn.dataset.agent || undefined; updatePromptBox(card); saveModal(card); }
    });
  } else {
    applyAgentBtns(currentAgent, null);
  }
  updateMcpHint();
}

async function refreshMcpModal() {
  try {
    const resp = await fetch('/api/mcp-status');
    const data = await resp.json();
    mcpStatusCache = data;
    mcpConfigured = !data.anyUnconfigured;
    updateMcpBanner(data);
    renderMcpAgentRows(data.agents);
    const hasUnconfigured = Object.values(data.agents || {}).some(a => a.installed && !a.configured);
    document.getElementById('mcp-modal-install-all-btn').style.display = hasUnconfigured ? '' : 'none';
    if (!hasUnconfigured) showToast('All agents configured');
    refreshAgentBtnsInModal();
  } catch(_) {}
}

document.getElementById('mcp-modal-install-all-btn').addEventListener('click', async function() {
  this.disabled = true; this.textContent = 'Setting up…';
  try {
    await fetch('/api/mcp-setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'all' }),
    });
    await refreshMcpModal();
  } catch(err) { showToast('Setup failed: ' + err.message); }
  this.disabled = false; this.textContent = 'Set up all';
});

function closeMcpModal() {
  document.getElementById('mcp-modal-overlay').classList.remove('open');
}
document.getElementById('mcp-modal-close').addEventListener('click', closeMcpModal);
document.getElementById('mcp-modal-cancel').addEventListener('click', closeMcpModal);
document.getElementById('mcp-modal-overlay').addEventListener('click', e => { if (e.target.id === 'mcp-modal-overlay') closeMcpModal(); });
