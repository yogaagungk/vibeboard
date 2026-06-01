'use strict';

// ── Global ESC ─────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('settings-overlay').classList.contains('open')) { document.getElementById('settings-overlay').classList.remove('open'); return; }
  if (document.getElementById('ws-modal-overlay').classList.contains('open')) { closeWsModal(); return; }
  if (document.getElementById('nc-modal-overlay').classList.contains('open')) { closeNewCardModal(); return; }
  closeCardModal();
});

// ── Accessibility ────────────────────────────────────────────────────────────
// Reflect the .active state of toggle-style pickers to assistive tech.
function syncAriaPressed(root) {
  (root || document).querySelectorAll('.priority-btn, .tag-pick-btn, .theme-opt')
    .forEach(b => b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false'));
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('.priority-btn, .tag-pick-btn, .theme-opt');
  if (b) queueMicrotask(() => syncAriaPressed(b.closest('.priority-picker, .modal-tag-picker, #card-modal-tag-picker, .theme-picker') || document));
}, true);

// Mark modal containers as dialogs and trap focus within the topmost open one.
function initModalA11y() {
  const dialogs = [
    ['ws-modal', 'Workspace settings'],
    ['settings-modal', 'Settings'],
    ['mcp-modal', 'MCP setup'],
    ['nc-modal', 'New card'],
    ['shortcuts-box', 'Keyboard shortcuts'],
  ];
  for (const [id, label] of dialogs) {
    const el = document.getElementById(id);
    if (el) { el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', label); }
  }
  const sidebar = document.getElementById('card-sidebar');
  if (sidebar) { sidebar.setAttribute('role', 'dialog'); sidebar.setAttribute('aria-label', 'Card details'); }

  const overlaySel = '.modal-overlay.open, #shortcuts-overlay.open';
  const returnFocus = new WeakMap();
  const focusables = c => [...c.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.offsetParent !== null);

  // Move focus into a modal when it opens; restore it when it closes.
  document.querySelectorAll('.modal-overlay, #shortcuts-overlay').forEach(overlay => {
    new MutationObserver(() => {
      const open = overlay.classList.contains('open');
      if (open && !overlay._a11yOpen) {
        overlay._a11yOpen = true;
        returnFocus.set(overlay, document.activeElement);
        const f = focusables(overlay);
        if (f.length) setTimeout(() => f[0].focus(), 30);
      } else if (!open && overlay._a11yOpen) {
        overlay._a11yOpen = false;
        const prev = returnFocus.get(overlay);
        if (prev && prev.focus) prev.focus();
      }
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const open = [...document.querySelectorAll(overlaySel)].pop();
    if (!open) return;
    const f = focusables(open);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

// ── Board loading ──────────────────────────────────────────────────────────
function renderBoardSkeleton() {
  boardEl.style.display = '';
  boardEl.innerHTML = '';
  const defs = [3, 2, 4, 1];
  defs.forEach(cardCount => {
    const col = document.createElement('div');
    col.className = 'column board-skel-col';

    const accentLine = document.createElement('div');
    accentLine.className = 'col-accent-line';
    col.appendChild(accentLine);

    const hdr = document.createElement('div');
    hdr.className = 'col-header';
    hdr.innerHTML = `<div class="skeleton" style="height:11px;width:48%;border-radius:3px"></div>
      <div class="skeleton" style="height:20px;width:28px;border-radius:10px;margin-left:auto"></div>`;
    col.appendChild(hdr);

    const list = document.createElement('div');
    list.className = 'cards-list';
    const lineWidths = [70, 90, 55, 80, 65];
    for (let i = 0; i < cardCount; i++) {
      const card = document.createElement('div');
      card.className = 'card board-skel-card';
      card.innerHTML = `
        <div class="skeleton" style="height:12px;width:${lineWidths[i % 5]}%;border-radius:3px"></div>
        <div class="skeleton" style="height:12px;width:${lineWidths[(i+2) % 5]}%;border-radius:3px;margin-top:6px"></div>
        <div style="display:flex;gap:5px;margin-top:10px">
          <div class="skeleton" style="height:18px;width:46px;border-radius:3px"></div>
          ${i % 2 === 0 ? `<div class="skeleton" style="height:18px;width:64px;border-radius:3px"></div>` : ''}
        </div>`;
      list.appendChild(card);
    }
    col.appendChild(list);

    const addArea = document.createElement('div');
    addArea.className = 'add-card-area';
    addArea.innerHTML = `<div class="skeleton" style="height:11px;width:60px;border-radius:3px;margin:6px 0 6px 10px"></div>`;
    col.appendChild(addArea);

    boardEl.appendChild(col);
  });
}

async function loadBoard() {
  const errorEl = document.getElementById('board-error-state');
  if (errorEl) errorEl.remove();

  const cached = loadCache();
  if (cached) {
    boardEl.style.display = '';
    renderBoard(cached);
  } else {
    renderBoardSkeleton();
  }

  try {
    const resp = await fetch('/board');
    if (resp.ok) {
      const fresh = await resp.json();
      if (fresh) { fresh.agentLog = fresh.agentLog||[]; saveCache(fresh); renderBoard(fresh); }
    } else {
      throw new Error('Server responded with ' + resp.status);
    }
  } catch(err) {
    if (!cached) {
      renderBoardError();
    } else {
      showToast('Failed to refresh board', 5000, 'error');
    }
  }
}

function renderBoardError() {
  boardEl.style.display = 'none';
  emptyState.classList.remove('visible');

  let errorEl = document.getElementById('board-error-state');
  if (!errorEl) {
    errorEl = document.createElement('div');
    errorEl.id = 'board-error-state';
    boardWrap.appendChild(errorEl);
  }

  errorEl.innerHTML = '';

  const icon = document.createElement('div');
  icon.className = 'error-icon';
  icon.textContent = '⚠';

  const title = document.createElement('div');
  title.className = 'error-title';
  title.textContent = 'Failed to load board';

  const sub = document.createElement('div');
  sub.className = 'error-sub';
  sub.textContent = 'The server could not be reached. Check your connection and try again.';

  const retryBtn = document.createElement('button');
  retryBtn.className = 'error-retry-btn';
  retryBtn.textContent = 'Retry';
  retryBtn.addEventListener('click', async () => {
    retryBtn.disabled = true;
    retryBtn.textContent = 'Loading…';
    await loadBoard();
  });

  errorEl.appendChild(icon);
  errorEl.appendChild(title);
  errorEl.appendChild(sub);
  errorEl.appendChild(retryBtn);
}

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  initModalA11y();
  syncAriaPressed();
  connectSSE();
  await loadWorkspaces();
  checkMcpStatus();

  if (workspaces.length === 0) {
    localStorage.removeItem('vb_board');
    setEmptyState(true);
    return;
  }

  await loadBoard();
  loadContextPanel(activeWsId);
  if (typeof initFilters === 'function') initFilters();
}

init();
