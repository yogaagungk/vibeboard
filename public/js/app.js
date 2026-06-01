'use strict';

// ── Global ESC ─────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('settings-overlay').classList.contains('open')) { document.getElementById('settings-overlay').classList.remove('open'); return; }
  if (document.getElementById('ws-modal-overlay').classList.contains('open')) { closeWsModal(); return; }
  if (document.getElementById('nc-modal-overlay').classList.contains('open')) { closeNewCardModal(); return; }
  closeCardModal();
  document.querySelectorAll('.card-inline-tag-dropdown').forEach(d => d.remove());
});

// ── Accessibility ────────────────────────────────────────────────────────────
// Reflect the .active state of toggle-style pickers to assistive tech.
function syncAriaPressed(root) {
  (root || document).querySelectorAll('.priority-btn, .tag-pick-btn, .theme-opt')
    .forEach(b => b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false'));
}
document.addEventListener('click', e => {
  // Close inline tag dropdowns when clicking outside them.
  if (!e.target.closest('.card-inline-tag-dropdown') && !e.target.closest('.card-add-tag-btn')) {
    document.querySelectorAll('.card-inline-tag-dropdown').forEach(d => d.remove());
  }
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
async function loadBoard() {
  const errorEl = document.getElementById('board-error-state');
  if (errorEl) errorEl.remove();

  const cached = loadCache();
  if (cached) {
    boardEl.style.display = '';
    renderBoard(cached);
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
