'use strict';

// ── Render board ───────────────────────────────────────────────────────────
function renderBoard(b) {
  board = b;
  if (Array.isArray(b.runningCards)) {
    runningCards.clear();
    b.runningCards.forEach(id => runningCards.add(id));
  }
  if (Array.isArray(b.queuedCards)) {
    queuedCards.clear();
    b.queuedCards.forEach(id => queuedCards.add(id));
  }
  boardEl.innerHTML = '';
  board.columns.forEach(col => boardEl.appendChild(buildColumn(col)));
  renderLog(board.agentLog || []);
  applySearch();
}

// ── Card search ─────────────────────────────────────────────────────────────
const searchInput = document.getElementById('board-search');
const searchClear = document.getElementById('board-search-clear');
const searchCount = document.getElementById('board-search-count');

function applySearch() {
  const q = searchInput.value.trim().toLowerCase();
  const cards = boardEl.querySelectorAll('.card');
  if (!q) {
    cards.forEach(c => c.style.display = '');
    searchClear.style.display = 'none';
    searchCount.style.display = 'none';
    return;
  }
  let total = 0, visible = 0;
  cards.forEach(c => {
    total++;
    const match = (c.dataset.searchTitle || '').includes(q);
    c.style.display = match ? '' : 'none';
    if (match) visible++;
  });
  // Use an explicit value: '' would fall back to the CSS rule (display:none).
  searchClear.style.display = 'inline-block';
  searchCount.style.display = 'inline-block';
  searchCount.textContent = `${visible} of ${total}`;
}

searchInput.addEventListener('input', applySearch);
searchClear.addEventListener('click', () => { searchInput.value = ''; applySearch(); searchInput.focus(); });

function buildColumn(col) {
  const colEl = document.createElement('div');
  colEl.className = 'column'; colEl.dataset.colId = col.id;

  const hdr = document.createElement('div'); hdr.className = 'col-header';
  const dot = document.createElement('span'); dot.className = 'col-color-dot'; dot.style.background = col.color || '#6b6860';

  const title = document.createElement('input');
  title.className = 'col-title'; title.type = 'text'; title.value = col.title; title.spellcheck = false;
  title.addEventListener('change', () => { col.title = title.value.trim() || 'Untitled'; title.value = col.title; postBoard(); });
  title.addEventListener('keydown', e => { if (e.key === 'Enter') title.blur(); });

  const count = document.createElement('span'); count.className = 'col-count';
  const limit = Number.isInteger(col.wip_limit) && col.wip_limit > 0 ? col.wip_limit : null;
  count.textContent = limit ? `${col.cards.length}/${limit}` : col.cards.length;
  if (limit && col.cards.length > limit) count.classList.add('over');
  count.title = 'Double-click to set a WIP limit';
  count.addEventListener('dblclick', async () => {
    const cur = limit ? String(limit) : '';
    const input = await vbPrompt(`Set a work-in-progress limit for "${col.title}". Leave blank to clear it.`, {
      title: 'WIP limit', value: cur, placeholder: 'e.g. 3', confirmText: 'Set limit',
    });
    if (input === null) return;
    const n = parseInt(input, 10);
    col.wip_limit = (Number.isInteger(n) && n > 0) ? n : null;
    renderBoard(board); postBoard();
  });

  hdr.appendChild(dot); hdr.appendChild(title); hdr.appendChild(count);
  colEl.appendChild(hdr);

  const cardsList = document.createElement('div');
  cardsList.className = 'cards-list'; cardsList.dataset.colId = col.id;
  col.cards.forEach(card => cardsList.appendChild(buildCard(card, col.id)));

  cardsList.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; cardsList.classList.add('drag-over'); });
  cardsList.addEventListener('dragleave', e => { if (!cardsList.contains(e.relatedTarget)) cardsList.classList.remove('drag-over'); });
  cardsList.addEventListener('drop', async e => {
    e.preventDefault(); cardsList.classList.remove('drag-over');
    if (!draggingCard) return;
    const tCol = board.columns.find(c => c.id === cardsList.dataset.colId);
    const sCol = board.columns.find(c => c.id === draggingFromCol);
    if (!tCol || !sCol) return;
    const idx = sCol.cards.findIndex(c => c.id === draggingCard);
    if (idx === -1) return;

    // Enforce WIP limit: block moving a card into a different column that is
    // already at capacity. Reordering within the same column is always allowed.
    const movingColumns = sCol.id !== tCol.id;
    const wip = Number.isInteger(tCol.wip_limit) && tCol.wip_limit > 0 ? tCol.wip_limit : null;
    if (movingColumns && wip && tCol.cards.length >= wip) {
      showToast(`"${tCol.title}" is at its WIP limit (${wip}) - move blocked`, 4000);
      draggingCard = null; draggingFromCol = null;
      return;
    }

    // Enforce dependencies: can't start a card (move to In Progress) while it has
    // unfinished blockers.
    if (movingColumns && tCol.title === 'In Progress') {
      const cardObj = sCol.cards[idx];
      const blockers = unfinishedBlockersUI(cardObj);
      if (blockers.length) {
        showToast(`"${cardObj.title}" is blocked by: ${blockers.map(c => c.title).join(', ')}`, 4500);
        draggingCard = null; draggingFromCol = null;
        return;
      }
    }

    const [card] = sCol.cards.splice(idx, 1);
    const over = e.target.closest('.card');
    if (over?.dataset.cardId) {
      const oi = tCol.cards.findIndex(c => c.id === over.dataset.cardId);
      if (oi !== -1) tCol.cards.splice(oi, 0, card); else tCol.cards.push(card);
    } else { tCol.cards.push(card); }
    draggingCard = null; draggingFromCol = null;

    const spawnsAgent = card.agent && sCol.id !== tCol.id && (tCol.title === 'In Progress' || tCol.title === 'Review');
    if (spawnsAgent) {
      const agentStatus = mcpStatusCache?.agents?.[card.agent];
      if (agentStatus?.installed && !agentStatus?.configured) {
        renderBoard(board); postBoard();
        openMcpModal();
        showToast('Agent queued - set up MCP first for full board interaction', 5000);
        return;
      }
    }
    renderBoard(board);
    await postBoard();
    if (spawnsAgent) {
      fetch(`/api/cards/${card.id}/run`, { method: 'POST' }).catch(() => {});
    }
  });

  colEl.appendChild(cardsList);
  colEl.appendChild(buildAddCardArea(col));
  return colEl;
}

function buildCard(card, colId) {
  const el = document.createElement('div');
  el.className = 'card' + (card.priority ? ' pri-' + card.priority : ''); el.draggable = true; el.dataset.cardId = card.id;
  el.dataset.searchTitle = (card.title || '').toLowerCase();
  // Keyboard-accessible: a real button role, focusable, openable with Enter/Space.
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `Open card: ${card.title || card.text || 'Untitled'}`);

  el.addEventListener('dragstart', e => { draggingCard = card.id; draggingFromCol = colId; e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  el.addEventListener('click', () => openCardModal(card.id, colId));
  el.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); openCardModal(card.id, colId); }
  });

  const text = document.createElement('div'); text.className = 'card-text'; text.textContent = card.title || card.text;

  // Footer is split into two tiers: a tags row (what kind of work) and a meta
  // row (status, agent, priority, dates) so a busy card stays scannable.
  const footer = document.createElement('div'); footer.className = 'card-footer';
  const tagsRow = document.createElement('div'); tagsRow.className = 'card-tags';
  const metaRow = document.createElement('div'); metaRow.className = 'card-meta';

  (card.tags || []).forEach(tag => {
    const pill = document.createElement('span'); pill.className = `tag tag-${tag}`; pill.textContent = tag; tagsRow.appendChild(pill);
  });

  if (card.priority) {
    const pb = document.createElement('span');
    pb.className = `priority-badge priority-${card.priority}`;
    pb.textContent = card.priority;
    metaRow.appendChild(pb);
  }
  if (card.due_date) {
    const db = document.createElement('span');
    db.className = 'due-date-badge' + (isOverdue(card.due_date) ? ' overdue' : '');
    db.textContent = '📅 ' + card.due_date;
    metaRow.appendChild(db);
  }
  if (card.agent) {
    const badge = document.createElement('span');
    badge.className = `card-agent-badge ${card.agent}`;
    badge.textContent = { 'claude-code': 'CC', 'opencode': 'OC', 'codex': 'CX' }[card.agent] || card.agent.slice(0,2).toUpperCase();
    badge.title = AGENT_LABELS[card.agent] || card.agent;
    metaRow.appendChild(badge);
  }
  if (card.branch) {
    const b = document.createElement('span');
    b.className = 'branch-badge card-branch-pill';
    b.textContent = card.branch.replace(/^vb\//, '');
    b.title = card.branch;
    metaRow.appendChild(b);
  }
  if (runningCards.has(card.id)) {
    const dot = document.createElement('span');
    dot.className = 'card-running-dot';
    dot.title = 'Agent running…';
    metaRow.appendChild(dot);
  } else if (queuedCards.has(card.id)) {
    const q = document.createElement('span');
    q.className = 'card-queued-pill';
    q.textContent = 'queued';
    q.title = 'Agent queued - waiting for a free slot';
    metaRow.appendChild(q);
  } else if (card.last_exit_code !== null && card.last_exit_code !== undefined) {
    const ok = card.last_exit_code === 0;
    const rs = document.createElement('span');
    rs.className = 'run-status-badge ' + (ok ? 'ok' : 'fail');
    const durStr = card.last_duration != null ? fmtDuration(card.last_duration) : '';
    rs.textContent = (ok ? '✓' : '✗') + (durStr ? ' ' + durStr : '');
    rs.title = `Last agent run ${ok ? 'succeeded' : 'failed (exit ' + card.last_exit_code + ')'}` + (durStr ? ` in ${durStr}` : '');
    metaRow.appendChild(rs);
  }

  if (card.last_cost != null || card.last_tokens != null) {
    const u = document.createElement('span');
    u.className = 'usage-badge';
    const parts = [];
    if (card.last_cost != null) parts.push('$' + Number(card.last_cost).toFixed(card.last_cost < 1 ? 3 : 2));
    if (card.last_tokens != null) parts.push(fmtTokens(card.last_tokens) + ' tok');
    u.textContent = parts.join(' · ');
    u.title = 'Reported by the last agent run';
    metaRow.appendChild(u);
  }

  const blockers = unfinishedBlockersUI(card);
  if (blockers.length) {
    const bl = document.createElement('span');
    bl.className = 'blocked-badge';
    bl.textContent = '🔒 blocked';
    bl.title = 'Blocked by: ' + blockers.map(c => c.title).join(', ');
    metaRow.appendChild(bl);
  }

  if (tagsRow.children.length) footer.appendChild(tagsRow);
  if (metaRow.children.length) footer.appendChild(metaRow);

  const delBtn = document.createElement('button'); delBtn.className = 'card-del-btn'; delBtn.textContent = '×';
  delBtn.setAttribute('aria-label', 'Delete card');
  delBtn.addEventListener('click', e => { e.stopPropagation(); deleteCard(card.id, colId); });

  el.appendChild(delBtn); el.appendChild(text);
  if (card.description) { const d = document.createElement('div'); d.className = 'card-desc-preview'; d.textContent = card.description; el.appendChild(d); }
  if (footer.children.length) el.appendChild(footer);
  return el;
}

function buildAddCardArea(col) {
  const area = document.createElement('div'); area.className = 'add-card-area';
  const trigger = document.createElement('button'); trigger.className = 'add-card-trigger'; trigger.textContent = '+ Add card';
  trigger.addEventListener('click', () => openNewCardModal(col.id));
  area.appendChild(trigger);
  return area;
}

// ── Board mutations ────────────────────────────────────────────────────────
function deleteCard(cardId, colId) {
  const col = board.columns.find(c => c.id === colId); if (!col) return;
  col.cards = col.cards.filter(c => c.id !== cardId);
  renderBoard(board); postBoard();
}

// ── Agent Log ──────────────────────────────────────────────────────────────
function renderLog(entries) {
  if (!entries?.length) { logEntries.innerHTML = '<p class="log-empty">No activity yet.</p>'; return; }
  logEntries.innerHTML = '';
  [...entries].reverse().forEach(e => logEntries.appendChild(buildLogEntry(e)));
}
function buildLogEntry(entry) {
  const el = document.createElement('div'); el.className = 'log-entry';
  const action = entry.action || 'event';
  el.dataset.action = action.toLowerCase();

  const top = document.createElement('div'); top.className = 'log-entry-top';
  const chip = document.createElement('span'); chip.className = 'log-entry-action'; chip.textContent = action.replace(/_/g, ' ');
  top.appendChild(chip);
  if (entry.agent) {
    const ag = document.createElement('span'); ag.className = 'log-entry-agent';
    ag.textContent = AGENT_LABELS[entry.agent] || entry.agent;
    top.appendChild(ag);
  }
  const time = document.createElement('span'); time.className = 'log-entry-time'; time.textContent = fmtTime(entry.timestamp || new Date().toISOString());
  top.appendChild(time);

  const detail = document.createElement('div'); detail.className = 'log-entry-detail'; detail.textContent = entry.detail || '';
  el.appendChild(top); el.appendChild(detail);
  return el;
}
function prependLogEntry(entry) {
  logEntries.querySelectorAll('.log-empty').forEach(e => e.remove());
  logEntries.insertBefore(buildLogEntry(entry), logEntries.firstChild);
}

logToggleBtn.addEventListener('click', () => {
  const logOpen = logSidebar.classList.contains('open');
  if (logOpen) {
    logSidebar.classList.remove('open');
  } else {
    cardSidebar.classList.remove('open');
    logSidebar.classList.add('open');
  }
});

document.getElementById('log-sidebar-close').addEventListener('click', () => {
  logSidebar.classList.remove('open');
});

document.getElementById('log-clear-btn').addEventListener('click', async () => {
  const ok = await vbConfirm('Clear all activity log entries? This cannot be undone.', {
    title: 'Clear activity log', confirmText: 'Clear', danger: true,
  });
  if (!ok) return;
  try {
    await fetch('/api/agent-log', { method: 'DELETE' });
    logEntries.innerHTML = '<p class="log-empty">No activity yet.</p>';
  } catch(err) { showToast('Failed to clear log: ' + err.message); }
});

document.getElementById('mcp-btn').addEventListener('click', () => {
  openMcpModal();
});

document.getElementById('mobile-menu-btn').addEventListener('click', () => {
  document.getElementById('workspace-sidebar').classList.toggle('mobile-open');
});

// ── Collapsible workspace rail (desktop) ─────────────────────────────────────
const SIDEBAR_COLLAPSE_KEY = 'vb_sidebar_collapsed';
function applySidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  const btn = document.getElementById('sidebar-toggle-btn');
  if (btn) {
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    btn.title = collapsed ? 'Show sidebar' : 'Collapse sidebar';
  }
}
document.getElementById('sidebar-toggle-btn').addEventListener('click', () => {
  const next = !document.body.classList.contains('sidebar-collapsed');
  applySidebarCollapsed(next);
  try { localStorage.setItem(SIDEBAR_COLLAPSE_KEY, next ? '1' : '0'); } catch (_) {}
});
// Apply persisted state immediately (scripts run before first paint → no flash).
applySidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1');

// ── Version badge + update check ─────────────────────────────────────────────
async function checkVersion() {
  const badge = document.getElementById('version-badge');
  if (!badge) return;
  try {
    const r = await fetch('/api/version');
    if (!r.ok) return;
    const v = await r.json();
    badge.textContent = 'v' + v.current;
    badge.title = `VibeBoard v${v.current}`;
    if (v.updateAvailable && v.latest) {
      badge.classList.add('update');
      badge.title = `Update available: v${v.current} → v${v.latest} - click to copy the upgrade command`;
      const cmd = `npm install -g ${v.package}@latest`;
      badge.onclick = () => {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(cmd).then(
            () => showToast(`Copied · ${cmd}`, 5000, 'success'),
            () => showToast(`Upgrade with: ${cmd}`, 7000)
          );
        } else { showToast(`Upgrade with: ${cmd}`, 7000); }
      };
    }
  } catch (_) {}
}
checkVersion();
