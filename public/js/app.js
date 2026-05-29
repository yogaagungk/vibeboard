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
  (root || document).querySelectorAll('.agent-btn, .priority-btn, .tag-pick-btn, .theme-opt')
    .forEach(b => b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false'));
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('.agent-btn, .priority-btn, .tag-pick-btn, .theme-opt');
  if (b) queueMicrotask(() => syncAriaPressed(b.closest('.agent-options, .priority-picker, .modal-tag-picker, #card-modal-tag-picker, .theme-picker') || document));
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

  const cached = loadCache();
  if (cached) renderBoard(cached);

  try {
    const resp = await fetch('/board');
    if (resp.ok) {
      const fresh = await resp.json();
      if (fresh) { fresh.agentLog = fresh.agentLog||[]; saveCache(fresh); renderBoard(fresh); }
    }
  } catch(_) { if (!cached) renderBoard({ columns:[], agentLog:[] }); }
}

init();
