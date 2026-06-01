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
    if (!resp.ok) { showToast('Export failed', 3000, 'error'); return; }
    const data = await resp.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vibeboard-${(data.workspace?.name || 'board').replace(/\s+/g, '-')}-${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  } catch(err) { showToast('Export failed: ' + err.message, 3000, 'error'); }
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
    if (!resp.ok) { showToast('Import failed: ' + (result.error || 'unknown error'), 3000, 'error'); return; }
    showToast(`Imported "${result.name || 'workspace'}" successfully`, 3000, 'success');
    closeWsModal();
    await loadWorkspaces();
  } catch(err) { showToast('Import failed: ' + err.message, 3000, 'error'); }
  this.value = '';
});

// ── MCP Status & Setup ────────────────────────────────────────────────────
let mcpConfigured = true;
let mcpBannerDismissed = false;
let mcpStatusCache = null;

const AGENT_LABELS_MCP = { 'claude-code': 'Claude Code', 'opencode': 'OpenCode', 'codex': 'Codex CLI', 'command-code': 'Command Code' };

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
      `<strong>MCP not configured</strong> for ${unconfigured.join(', ')} - agents won't be able to interact with the board.`;
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
    container.innerHTML = ['','','',''].map(() => `
      <div class="mcp-agent-row mcp-agent-row-skel">
        <div class="skeleton" style="width:8px;height:8px;border-radius:50%;flex-shrink:0"></div>
        <div class="mcp-agent-info" style="display:flex;flex-direction:column;gap:5px">
          <div class="skeleton" style="height:12px;width:65%;border-radius:3px"></div>
          <div class="skeleton" style="height:9px;width:45%;border-radius:2px"></div>
        </div>
        <div class="skeleton" style="height:24px;width:58px;border-radius:4px;flex-shrink:0"></div>
      </div>`).join('');
    return;
  }
  container.innerHTML = '';
  for (const key of ['claude-code', 'opencode', 'codex', 'command-code']) {
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
    showToast(`${AGENT_LABELS_MCP[agentKey]} MCP configured`, 3000, 'success');
    await refreshMcpModal();
  } catch(err) {
    btn.disabled = false; btn.textContent = 'Set up';
    showToast('Setup failed: ' + err.message, 3000, 'error');
  }
}

function refreshAgentBtnsInModal() {
  if (!cardSidebar.classList.contains('open')) return;
  const currentAgent = getModalAgent();
  const cardMount = document.getElementById('card-agent-mount');
  if (cardMount?._agentSelect) {
    cardMount._agentSelect.setOptions(buildAgentOptions());
    cardMount._agentSelect.setValue(currentAgent);
  }
  const ncMount = document.getElementById('nc-agent-mount');
  if (ncMount?._agentSelect) {
    ncMount._agentSelect.setOptions(buildAgentOptions());
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
