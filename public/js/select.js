'use strict';

// ── vbSelect: themed custom dropdown ─────────────────────────────────────────
// A replacement for native <select> so the OPEN option list is themed too (the
// native popup is OS-rendered and can't be styled - that's the whole reason this
// exists). The popup is mounted on <body> with fixed positioning so it's never
// clipped by a scrolling sidebar, and flips above the trigger when there's no
// room below. Fully keyboard-operable (Arrow/Enter/Esc/Home/End/type-ahead).
//
//   const sel = vbSelect({ options, value, placeholder, onChange, ariaLabel });
//   container.appendChild(sel.el);
//   sel.setOptions([...]); sel.setValue(v); sel.getValue();
//
// options: [{ value, label, hint?, disabled? }]

let _vbSelectOpenInstance = null;

function vbSelect({ options = [], value = '', placeholder = 'Select…', onChange = null, ariaLabel = '' } = {}) {
  let opts = options.slice();
  let current = value;
  let pop = null;          // the body-mounted listbox while open
  let activeIdx = -1;      // highlighted option index while open
  let typeahead = '';
  let typeaheadTimer = null;

  const wrap = document.createElement('div');
  wrap.className = 'vb-select';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'vb-select-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  if (ariaLabel) trigger.setAttribute('aria-label', ariaLabel);

  const labelEl = document.createElement('span');
  labelEl.className = 'vb-select-label';
  const chevron = document.createElement('span');
  chevron.className = 'vb-select-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = "<svg width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='M3 4.5 6 7.5 9 4.5'/></svg>";
  trigger.appendChild(labelEl);
  trigger.appendChild(chevron);
  wrap.appendChild(trigger);

  function findOpt(v) { return opts.find(o => o.value === v) || null; }

  function renderLabel() {
    const o = findOpt(current);
    if (o) { labelEl.textContent = o.label; labelEl.classList.remove('placeholder'); }
    else { labelEl.textContent = placeholder; labelEl.classList.add('placeholder'); }
    trigger.disabled = opts.length === 0;
  }

  function positionPop() {
    if (!pop) return;
    const r = trigger.getBoundingClientRect();
    pop.style.minWidth = r.width + 'px';
    pop.style.left = r.left + 'px';
    // Measure then decide above/below.
    pop.style.top = '-9999px';
    pop.style.display = 'block';
    const ph = pop.offsetHeight;
    const below = window.innerHeight - r.bottom;
    if (below < ph + 8 && r.top > below) {
      pop.style.top = Math.max(8, r.top - ph - 4) + 'px';
    } else {
      pop.style.top = (r.bottom + 4) + 'px';
    }
  }

  function buildPop() {
    pop = document.createElement('div');
    pop.className = 'vb-select-pop';
    pop.setAttribute('role', 'listbox');
    opts.forEach((o, i) => {
      const item = document.createElement('div');
      item.className = 'vb-select-opt' + (o.value === current ? ' selected' : '') + (o.disabled ? ' disabled' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', o.value === current ? 'true' : 'false');
      item.dataset.idx = i;
      const lab = document.createElement('span');
      lab.className = 'vb-select-opt-label';
      lab.textContent = o.label;
      item.appendChild(lab);
      if (o.hint) {
        const h = document.createElement('span');
        h.className = 'vb-select-opt-hint';
        h.textContent = o.hint;
        item.appendChild(h);
      }
      if (o.value === current) {
        const chk = document.createElement('span');
        chk.className = 'vb-select-opt-check';
        chk.textContent = '✓';
        item.appendChild(chk);
      }
      if (!o.disabled) {
        item.addEventListener('mouseenter', () => setActive(i));
        item.addEventListener('mousedown', e => { e.preventDefault(); choose(i); });
      }
      pop.appendChild(item);
    });
    document.body.appendChild(pop);
  }

  function setActive(i) {
    if (!pop) return;
    activeIdx = i;
    [...pop.children].forEach((c, idx) => c.classList.toggle('active', idx === i));
    const el = pop.children[i];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    if (pop || trigger.disabled) return;
    if (_vbSelectOpenInstance) _vbSelectOpenInstance.close();
    _vbSelectOpenInstance = api;
    buildPop();
    positionPop();
    trigger.setAttribute('aria-expanded', 'true');
    wrap.classList.add('open');
    const sel = opts.findIndex(o => o.value === current && !o.disabled);
    setActive(sel >= 0 ? sel : opts.findIndex(o => !o.disabled));
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onListKey, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onOuterScroll, true);
  }

  function onOuterScroll(e) {
    if (pop && pop.contains(e.target)) return;
    close();
  }

  function close() {
    if (!pop) return;
    pop.remove(); pop = null; activeIdx = -1;
    trigger.setAttribute('aria-expanded', 'false');
    wrap.classList.remove('open');
    if (_vbSelectOpenInstance === api) _vbSelectOpenInstance = null;
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onListKey, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('scroll', onOuterScroll, true);
  }

  function choose(i) {
    const o = opts[i];
    if (!o || o.disabled) return;
    const changed = o.value !== current;
    current = o.value;
    renderLabel();
    close();
    trigger.focus();
    if (changed && onChange) onChange(current, o);
  }

  function onDocDown(e) {
    if (!wrap.contains(e.target) && pop && !pop.contains(e.target)) close();
  }

  function moveActive(delta) {
    if (!opts.length) return;
    let i = activeIdx;
    for (let n = 0; n < opts.length; n++) {
      i = (i + delta + opts.length) % opts.length;
      if (!opts[i].disabled) { setActive(i); return; }
    }
  }

  function onListKey(e) {
    if (!pop) return;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); moveActive(1); break;
      case 'ArrowUp':   e.preventDefault(); moveActive(-1); break;
      case 'Home':      e.preventDefault(); setActive(opts.findIndex(o => !o.disabled)); break;
      case 'End':       e.preventDefault(); for (let i = opts.length - 1; i >= 0; i--) if (!opts[i].disabled) { setActive(i); break; } break;
      case 'Enter':
      case ' ':         e.preventDefault(); if (activeIdx >= 0) choose(activeIdx); break;
      case 'Escape':    e.preventDefault(); e.stopPropagation(); close(); trigger.focus(); break;
      case 'Tab':       close(); break;
      default:
        if (e.key.length === 1) {
          typeahead += e.key.toLowerCase();
          clearTimeout(typeaheadTimer);
          typeaheadTimer = setTimeout(() => { typeahead = ''; }, 600);
          const hit = opts.findIndex(o => !o.disabled && o.label.toLowerCase().startsWith(typeahead));
          if (hit >= 0) setActive(hit);
        }
    }
  }

  trigger.addEventListener('click', () => { pop ? close() : open(); });
  trigger.addEventListener('keydown', e => {
    if (pop) return; // handled by onListKey
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  const api = {
    el: wrap,
    getValue: () => current,
    setValue(v) { current = v; renderLabel(); },
    setOptions(next, keep = true) {
      opts = next.slice();
      if (!keep || !findOpt(current)) current = findOpt(current) ? current : (value && findOpt(value) ? value : '');
      if (!findOpt(current)) current = '';
      renderLabel();
    },
    setPlaceholder(p) { placeholder = p; renderLabel(); },
    open, close,
    focus: () => trigger.focus(),
  };

  renderLabel();
  return api;
}
