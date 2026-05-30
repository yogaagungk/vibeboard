'use strict';

// ── SSE ────────────────────────────────────────────────────────────────────
function connectSSE() {
  if (es) { es.close(); es = null; }
  es = new EventSource(vbUrl('/events'));
  es.onopen = () => {
    connDot.className = 'connected'; connDot.title = 'SSE connected';
    sseReconnectAttempts = 0;
    const banner = document.getElementById('sse-banner');
    if (banner) banner.classList.remove('visible');
  };
  es.onmessage = e => {
    let msg; try { msg = JSON.parse(e.data); } catch(_) { return; }
    const { type, data } = msg;

    if (type === 'board_update') {
      if (data._tabId === TAB_ID) return;
      const affected = findAffectedCards(board, data);
      board = data; board.agentLog = board.agentLog || [];
      saveCache(board); renderBoard(board);
      affected.forEach(id => flashCard(id));
      // Refresh branch badge + notes if the updated card's sidebar is open, so
      // agent checkpoints (add_card_note → board_update) appear live without
      // needing to close and reopen the card.
      if (modalCardId) {
        const col = board.columns.find(c => c.cards?.some(c2 => c2.id === modalCardId));
        const card = col?.cards.find(c => c.id === modalCardId);
        if (card && col) {
          if (col.id !== modalColId) {
            modalColId = col.id;
            const badge = document.getElementById('card-modal-col-badge');
            if (badge) { badge.textContent = col.title; badge.style.background = col.color || '#6b6860'; }
          }
          const bb = document.getElementById('card-modal-branch-badge');
          if (card.branch) { bb.textContent = card.branch; bb.style.display = ''; }
          else { bb.style.display = 'none'; }
          updateRunAgentBtn(card);
        }
        loadCardNotes(modalCardId).then(renderCardNotes);
      }
    }
    if (type === 'trigger') showTriggerToast(data);
    if (type === 'agent_queued') {
      queuedCards.add(data.cardId);
      const entry = findCardEntry(data.cardId);
      if (entry) { showToast(`⏳ Queued: "${entry.card.title}" (waiting for a free agent slot)`, 4000); }
      renderBoard(board);
    }
    if (type === 'agent_dequeued') {
      queuedCards.delete(data.cardId);
      renderBoard(board);
      if (modalCardId === data.cardId) {
        const col = board.columns.find(c => c.cards?.some(c2 => c2.id === data.cardId));
        const card = col?.cards.find(c => c.id === data.cardId);
        if (card) updateRunAgentBtn(card);
      }
    }
    if (type === 'agent_started') {
      runningCards.add(data.cardId);
      queuedCards.delete(data.cardId);
      const el = document.querySelector(`[data-card-id="${data.cardId}"]`);
      if (el) {
        let meta = el.querySelector('.card-meta');
        if (!meta) {
          let footer = el.querySelector('.card-footer');
          if (!footer) { footer = document.createElement('div'); footer.className = 'card-footer'; el.appendChild(footer); }
          meta = document.createElement('div'); meta.className = 'card-meta'; footer.appendChild(meta);
        }
        if (!meta.querySelector('.card-running-dot')) { const dot = document.createElement('span'); dot.className = 'card-running-dot'; dot.title = 'Agent running…'; meta.appendChild(dot); }
      }
      if (modalCardId === data.cardId) {
        const col = board.columns.find(c => c.cards?.some(card => card.id === data.cardId));
        const card = col?.cards.find(c => c.id === data.cardId);
        if (card) updateRunAgentBtn(card);
      }
    }
    if (type === 'agent_completed' || type === 'agent_error') {
      runningCards.delete(data.cardId);
      queuedCards.delete(data.cardId);
      // Reflect the run outcome on the local card immediately (badge), without
      // waiting for a full board reload.
      const entry = findCardEntry(data.cardId);
      if (entry && type === 'agent_completed') {
        entry.card.last_exit_code = data.code;
        if (data.duration != null) entry.card.last_duration = data.duration;
        if (data.cost != null) entry.card.last_cost = data.cost;
        if (data.tokens != null) entry.card.last_tokens = data.tokens;
        renderBoard(board);
      }
      const el = document.querySelector(`[data-card-id="${data.cardId}"]`);
      if (el) el.querySelectorAll('.card-running-dot').forEach(d => d.remove());
      if (modalCardId === data.cardId) {
        const toggle = document.getElementById('card-output-toggle');
        if (toggle) toggle.style.display = 'inline-block';
        const col = board.columns.find(c => c.cards?.some(card => card.id === data.cardId));
        const card = col?.cards.find(c => c.id === data.cardId);
        if (card) updateRunAgentBtn(card);
        loadCardNotes(data.cardId).then(renderCardNotes);
      }
    }
    if (type === 'agent_output') {
      if (modalCardId === data.cardId) {
        const pre = document.getElementById('card-output-content');
        if (pre) {
          pre.textContent += data.lines.join('\n') + '\n';
          pre.scrollTop = pre.scrollHeight;
        }
      }
    }
    if (type === 'agent_log') {
      prependLogEntry(data);
      board.agentLog = board.agentLog || []; board.agentLog.unshift(data);
      if (board.agentLog.length > 500) board.agentLog.length = 500;
    }
    if (type === 'mcp_configured') {
      checkMcpStatus().then(() => refreshAgentBtnsInModal());
      refreshModels();
    }
    if (type === 'models_updated') {
      availableModels = data;
      showToast('Models updated');
    }
    if (type === 'workspace_switch') {
      const { board: nb, workspaceId } = data;
      activeWsId = workspaceId;
      workspaces = workspaces.map(w => ({ ...w, active: w.id === workspaceId }));
      renderWorkspaceList(); setEmptyState(false);
      nb.agentLog = nb.agentLog || []; saveCache(nb); renderBoard(nb);
      mcpBannerDismissed = false;
      checkMcpStatus();
    }
    if (type === 'workspace_list') {
      workspaces = data;
      activeWsId = (workspaces.find(w => w.active) || workspaces[0])?.id || null;
      renderWorkspaceList(); setEmptyState(workspaces.length === 0);
    }
  };
  es.onerror = () => {
    connDot.className = ''; connDot.title = 'SSE disconnected';
    sseReconnectAttempts++;
    es.close(); es = null;
    if (sseReconnectAttempts >= MAX_SSE_RECONNECT) {
      const banner = document.getElementById('sse-banner');
      if (banner) banner.classList.add('visible');
    }
    setTimeout(async () => {
      connectSSE();
      // Re-sync board state - may have changed while disconnected
      try {
        const resp = await fetch('/board');
        if (resp.ok) {
          const fresh = await resp.json();
          if (fresh) { fresh.agentLog = fresh.agentLog || []; saveCache(fresh); renderBoard(fresh); applySearch(); }
        }
      } catch(_) {}
    }, 3000);
  };
}

function findAffectedCards(old, nw) {
  const m = {}; (old.columns||[]).forEach(c => c.cards.forEach(card => m[card.id] = c.id));
  const out = [];
  (nw.columns||[]).forEach(c => c.cards.forEach(card => { if (!(card.id in m) || m[card.id] !== c.id) out.push(card.id); }));
  return out;
}
function flashCard(id) {
  const el = document.querySelector(`[data-card-id="${id}"]`); if (!el) return;
  el.classList.remove('agent-flash'); void el.offsetWidth; el.classList.add('agent-flash');
  setTimeout(() => el.classList.remove('agent-flash'), 1600);
}

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(msg, dur = 3000, type = '') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div'); t.className = 'toast' + (type ? ' ' + type : ''); t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, dur);
}
function showTriggerToast(data) {
  const lbl = data.agent ? ` (${AGENT_LABELS[data.agent] || data.agent})` : '';
  showToast(`Agent triggered${lbl}: ${data.card?.title || data.card?.text || ''}`, 4000);
}

// ── Due date helpers ────────────────────────────────────────────────────────
function isOverdue(dateStr) {
  if (!dateStr) return false;
  return dateStr < new Date().toISOString().slice(0, 10);
}
