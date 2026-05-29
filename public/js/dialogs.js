'use strict';

// ── Styled dialogs ───────────────────────────────────────────────────────────
// Promise-based, self-contained replacements for window.confirm / window.prompt
// so we never fall back to the browser's native (and off-theme) dialogs. Each
// dialog builds its own overlay, focuses sensibly, traps Tab, and supports
// Esc (cancel) / Enter (confirm). It manages its own focus so it doesn't depend
// on the modal-a11y observer wired up in app.js for the static modals.
//
//   vbConfirm(message, opts?) → Promise<boolean>
//   vbPrompt(message, opts?)  → Promise<string|null>   (null = cancelled)

function vbDialog({
  title = '',
  message = '',
  messageHtml = '',
  input = false,
  value = '',
  placeholder = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
} = {}) {
  return new Promise(resolve => {
    const prevFocus = document.activeElement;

    const overlay = document.createElement('div');
    overlay.className = 'vb-dialog-overlay';

    const box = document.createElement('div');
    box.className = 'vb-dialog';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    if (title) {
      const h = document.createElement('div');
      h.className = 'vb-dialog-title';
      h.textContent = title;
      box.setAttribute('aria-label', title);
      box.appendChild(h);
    }
    if (message || messageHtml) {
      const m = document.createElement('div');
      m.className = 'vb-dialog-message';
      if (messageHtml) {
        m.innerHTML = messageHtml;
      } else {
        m.textContent = message;
      }
      box.appendChild(m);
    }

    let field = null;
    if (input) {
      field = document.createElement('input');
      field.type = 'text';
      field.className = 'vb-dialog-input';
      field.value = value;
      field.placeholder = placeholder;
      field.spellcheck = false;
      field.autocomplete = 'off';
      box.appendChild(field);
    }

    const footer = document.createElement('div');
    footer.className = 'vb-dialog-footer';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-ghost';
    cancelBtn.textContent = cancelText;
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = danger ? 'btn-danger vb-dialog-confirm-danger' : 'btn-save';
    confirmBtn.textContent = confirmText;
    footer.appendChild(cancelBtn);
    footer.appendChild(confirmBtn);
    box.appendChild(footer);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    // Trigger the open transition on the next frame.
    requestAnimationFrame(() => overlay.classList.add('open'));

    let done = false;
    function close(result) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 150);
      if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (_) {} }
      resolve(result);
    }

    const onConfirm = () => close(input ? field.value : true);
    const onCancel = () => close(input ? null : false);

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) onCancel(); });

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
      if (e.key === 'Enter') {
        // Enter confirms from the input or either button; let Shift+Enter pass.
        if (!e.shiftKey) { e.preventDefault(); onConfirm(); }
        return;
      }
      if (e.key === 'Tab') {
        const focusables = [...box.querySelectorAll('button, input')].filter(el => !el.disabled);
        if (!focusables.length) return;
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);

    setTimeout(() => { (field || confirmBtn).focus(); if (field) field.select(); }, 40);
  });
}

function vbConfirm(message, opts = {}) {
  return vbDialog({ message, messageHtml: opts.messageHtml || '', input: false, confirmText: 'Confirm', ...opts });
}

function vbPrompt(message, opts = {}) {
  return vbDialog({ message, input: true, confirmText: 'Save', ...opts });
}
