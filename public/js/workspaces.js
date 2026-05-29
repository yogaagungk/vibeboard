'use strict';

// ── Workspace list ─────────────────────────────────────────────────────────
async function loadWorkspaces() {
  try {
    const resp = await fetch('/workspaces');
    if (resp.ok) {
      workspaces = await resp.json();
      activeWsId = (workspaces.find(w => w.active) || workspaces[0])?.id || null;
      renderWorkspaceList();
      setEmptyState(workspaces.length === 0);
    }
  } catch(_){}
}

function renderWorkspaceList() {
  wsListEl.innerHTML = '';
  workspaces.forEach(ws => {
    const item = document.createElement('div');
    item.className = 'ws-item' + (ws.active ? ' active' : '');

    const dot = document.createElement('span');
    dot.className = 'ws-item-dot';

    const info = document.createElement('div');
    info.className = 'ws-item-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'ws-item-name';
    nameEl.textContent = ws.name || folderName(ws.path) || 'Untitled';

    info.appendChild(nameEl);

    if (ws.path) {
      const pathEl = document.createElement('div');
      pathEl.className = 'ws-item-path';
      pathEl.textContent = ws.path;
      pathEl.title = ws.path;
      info.appendChild(pathEl);
    }

    const editBtn = document.createElement('button');
    editBtn.className = 'ws-item-edit';
    editBtn.textContent = '···';
    editBtn.title = 'Edit workspace';
    editBtn.addEventListener('click', e => { e.stopPropagation(); openWsModal(ws.id); });

    item.appendChild(dot);
    item.appendChild(info);
    item.appendChild(editBtn);

    if (!ws.active) item.addEventListener('click', () => switchWorkspace(ws.id));
    wsListEl.appendChild(item);
  });
}

async function switchWorkspace(id) {
  try { await fetch(`/workspaces/${id}/switch`, { method: 'POST' }); } catch(_){}
}

// ── Create form ────────────────────────────────────────────────────────────
function openCreateForm() {
  wsCreateForm.style.display = 'flex';
  wsAddBtn.style.display = 'none';
  wsCreatePath.focus();
}

function closeCreateForm() {
  wsCreateForm.style.display = 'none';
  wsAddBtn.style.display = '';
  wsCreatePath.value = '';
  wsCreateName.value = '';
  wsCreatePath.classList.remove('error');
  wsCreateName.placeholder = 'Name (optional)';
  document.getElementById('ws-git-status').style.display = 'none';
}

wsAddBtn.addEventListener('click', openCreateForm);
wsCreateCancel.addEventListener('click', closeCreateForm);

wsCreateSubmit.addEventListener('click', async () => {
  const wsPath = wsCreatePath.value.trim();
  if (!wsPath) {
    wsCreatePath.classList.add('error');
    wsCreatePath.focus();
    return;
  }
  wsCreatePath.classList.remove('error');

  const name = wsCreateName.value.trim() || folderName(wsPath) || '';
  const use_worktree = document.getElementById('ws-create-use-worktree').checked ? 1 : 0;
  try {
    const resp = await fetch('/workspaces', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ name, path: wsPath, use_worktree }),
    });
    const ws = await resp.json();
    closeCreateForm();
    if (!activeWsId) await fetch(`/workspaces/${ws.id}/switch`, { method: 'POST' });
    await loadWorkspaces();
  } catch(_){}
});

wsCreatePath.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCreateForm();
  if (e.key === 'Enter') wsCreateName.focus();
});
wsCreateName.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCreateForm();
  if (e.key === 'Enter') wsCreateSubmit.click();
});

// ── Workspace detail modal ─────────────────────────────────────────────────
function openWsModal(wsId) {
  const ws = workspaces.find(w => w.id === wsId);
  if (!ws) return;
  editingWsId = wsId;

  document.getElementById('ws-modal-name').value = ws.name || folderName(ws.path) || '';
  document.getElementById('ws-modal-path').value = ws.path || '';
  document.getElementById('ws-modal-desc').value = ws.description || '';
  document.getElementById('ws-modal-use-worktree').checked = !!(ws.use_worktree || (wsId === activeWsId && board.use_worktree));

  const stats = document.getElementById('ws-modal-stats');
  stats.innerHTML = '';
  if (wsId === activeWsId && board.columns?.length) {
    board.columns.forEach(col => {
      const chip = document.createElement('div');
      chip.className = 'ws-stat-chip';
      chip.innerHTML = `<span class="ws-stat-dot" style="background:${col.color||'#6b6860'}"></span>${col.title}<span class="ws-stat-count">${col.cards.length}</span>`;
      stats.appendChild(chip);
    });
  } else {
    const hint = document.createElement('p');
    hint.style.cssText = 'font-size:12px;color:var(--text-muted);font-weight:300';
    hint.textContent = wsId === activeWsId ? 'No columns yet.' : 'Switch to this workspace to see stats.';
    stats.appendChild(hint);
  }

  document.getElementById('ws-modal-overlay').classList.add('open');
  document.getElementById('ws-modal-name').focus();
}

function closeWsModal() {
  document.getElementById('ws-modal-overlay').classList.remove('open');
  editingWsId = null;
}

document.getElementById('ws-modal-close').addEventListener('click', closeWsModal);
document.getElementById('ws-modal-overlay').addEventListener('click', e => { if (e.target.id === 'ws-modal-overlay') closeWsModal(); });

document.getElementById('ws-modal-save').addEventListener('click', async () => {
  if (!editingWsId) return;
  const name = document.getElementById('ws-modal-name').value.trim();
  const wsPath = document.getElementById('ws-modal-path').value.trim();
  const description = document.getElementById('ws-modal-desc').value.trim();
  const useWorktree = document.getElementById('ws-modal-use-worktree').checked;

  try {
    if (editingWsId === activeWsId) {
      board.name = name; board.path = wsPath; board.description = description; board.use_worktree = useWorktree ? 1 : 0;
      await postBoard();
    } else {
      await fetch(`/workspaces/${editingWsId}`, {
        method: 'PATCH', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ name, path: wsPath, description, use_worktree: useWorktree ? 1 : 0 }),
      });
    }
    const ws = workspaces.find(w => w.id === editingWsId);
    if (ws) { ws.name = name; ws.path = wsPath; ws.description = description; ws.use_worktree = useWorktree ? 1 : 0; }
    renderWorkspaceList();
  } catch(_){}
  closeWsModal();
});

document.getElementById('ws-modal-delete').addEventListener('click', async () => {
  if (!editingWsId) return;
  const ws = workspaces.find(w => w.id === editingWsId);
  const ok = await vbConfirm(`Delete workspace "${ws?.name || 'Untitled'}"? Its board and cards will be removed. This cannot be undone.`, {
    title: 'Delete workspace', confirmText: 'Delete', danger: true,
  });
  if (!ok) return;
  const id = editingWsId;
  closeWsModal();
  try {
    const resp = await fetch(`/workspaces/${id}`, { method: 'DELETE' });
    if (!resp.ok) showToast('Delete failed', 3000, 'error');
  } catch(_){}
});

// ── Settings modal ─────────────────────────────────────────────────────────
const settingsOverlay = document.getElementById('settings-overlay');

document.getElementById('settings-btn').addEventListener('click', async () => {
  settingsOverlay.classList.add('open');
  // Load data path
  try {
    const resp = await fetch('/api/info');
    if (resp.ok) {
      const info = await resp.json();
      document.getElementById('settings-data-path').textContent = info.dataDir;
    }
  } catch(_) {}
});

document.getElementById('settings-close').addEventListener('click', () => settingsOverlay.classList.remove('open'));
settingsOverlay.addEventListener('click', e => { if (e.target === settingsOverlay) settingsOverlay.classList.remove('open'); });

document.querySelectorAll('.theme-opt').forEach(btn => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.t));
});

document.getElementById('theme-btn').addEventListener('click', () => {
  const cur = localStorage.getItem(THEME_KEY) || 'system';
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(cur) + 1) % THEME_CYCLE.length];
  applyTheme(next);
});

// ── Card description toggle ────────────────────────────────────────────────
const descToggle = document.getElementById('setting-show-descriptions');
if (descToggle) {
  descToggle.checked = getShowDescriptions();
  descToggle.addEventListener('change', () => {
    setShowDescriptions(descToggle.checked);
    document.body.classList.toggle('vb-show-descriptions', descToggle.checked);
  });
}

document.getElementById('settings-copy-path').addEventListener('click', function() {
  const p = document.getElementById('settings-data-path').textContent;
  navigator.clipboard.writeText(p).then(() => {
    this.textContent = 'Copied!'; this.classList.add('copied');
    setTimeout(() => { this.textContent = 'Copy'; this.classList.remove('copied'); }, 2000);
  });
});

// ── New Card Modal ────────────────────────────────────────────────────────
function closeNewCardModal() {
  document.getElementById('nc-modal-overlay').classList.remove('open');
  newCardColId = null;
}

function submitNewCard() {
  const title = document.getElementById('nc-title-input').value.trim();
  if (!title) { showToast('Card title is required'); return; }
  const col = board.columns.find(c => c.id === newCardColId);
  if (!col) return;
  const tags = Array.from(document.querySelectorAll('#nc-tag-picker .tag-pick-btn.active')).map(b => b.dataset.tag);
  const activeAgentBtn = document.querySelector('#nc-agent-opts .agent-btn.active');
  const agent = activeAgentBtn?.dataset.ncAgent || undefined;
  const model = modelSelects['nc']?.getValue() || undefined;
  const description = document.getElementById('nc-desc').value.trim() || undefined;
  const requires_review = document.getElementById('nc-needs-review').checked;
  const activePriorityBtn = document.querySelector('#nc-priority-picker .priority-btn.active');
  const priority = activePriorityBtn?.dataset.ncPriority || undefined;
  const due_date = document.getElementById('nc-due-date').value || null;
  col.cards.push({
    id: uid(), title, tags, requires_review, priority: priority || null, due_date,
    ...(description && { description }),
    ...(agent && { agent }),
    ...(model && { model }),
    ...(ncBlockedBy.length && { blocked_by: [...ncBlockedBy] })
  });
  closeNewCardModal();
  renderBoard(board); postBoard();
}

document.getElementById('nc-close').addEventListener('click', closeNewCardModal);
document.getElementById('nc-cancel').addEventListener('click', closeNewCardModal);
document.getElementById('nc-create').addEventListener('click', submitNewCard);
document.getElementById('nc-modal-overlay').addEventListener('click', e => { if (e.target.id === 'nc-modal-overlay') closeNewCardModal(); });
document.getElementById('nc-title-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('nc-desc').focus();
  if (e.key === 'Escape') closeNewCardModal();
});
