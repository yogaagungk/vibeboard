'use strict';

// ── vbDatePicker: minimalist calendar picker ──────────────────────────────────
// Wraps a native <input type="date"> element: hides it, renders a styled trigger
// button + floating calendar popup, and patches el.value via Object.defineProperty
// so all existing reads/writes/onchange handlers continue to work unchanged.
//
//   const dp = vbDatePicker(document.getElementById('my-date-input'));
//
// The hidden input still receives change events when the user picks a date.

function vbDatePicker(el) {
  if (!el) return null;

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DOW = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  let _value = el.value || '';
  let viewYear, viewMonth;
  let pop = null;

  function parseValue(v) {
    if (!v || typeof v !== 'string') return null;
    const parts = v.split('-').map(Number);
    if (parts.length !== 3 || parts.some(n => isNaN(n) || n <= 0)) return null;
    return { y: parts[0], m: parts[1], d: parts[2] };
  }

  function todayParts() {
    const t = new Date();
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function toDateStr(y, m, d) { return `${y}-${pad2(m)}-${pad2(d)}`; }

  function initView() {
    const p = parseValue(_value);
    const t = todayParts();
    viewYear  = p ? p.y : t.y;
    viewMonth = p ? p.m : t.m;
  }

  // ── DOM scaffold ─────────────────────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.className = 'vb-datepicker';
  el.parentNode.insertBefore(wrap, el);
  wrap.appendChild(el);
  el.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'vb-datepicker-trigger';
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  wrap.appendChild(trigger);

  // ── Patch el.value ────────────────────────────────────────────────────────────
  Object.defineProperty(el, 'value', {
    get: () => _value,
    set: v  => { _value = typeof v === 'string' ? v : ''; renderTrigger(); },
    configurable: true,
    enumerable: true,
  });

  // ── Trigger render ───────────────────────────────────────────────────────────
  const CAL_SVG = `<svg class="vb-dp-cal-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="12" rx="2"/><path d="M2 7h12M5 1v4M11 1v4"/></svg>`;

  function renderTrigger() {
    const p = parseValue(_value);
    const overdue = _value && typeof isOverdue === 'function' && isOverdue(_value);
    trigger.classList.toggle('overdue', !!overdue);
    if (p) {
      trigger.innerHTML = `${CAL_SVG}<span>${p.d} ${MONTHS[p.m - 1].slice(0, 3)} ${p.y}</span>`;
      trigger.classList.remove('vb-dp-placeholder');
    } else {
      trigger.innerHTML = `${CAL_SVG}<span>Pick a date</span>`;
      trigger.classList.add('vb-dp-placeholder');
    }
  }

  // ── Calendar popup ───────────────────────────────────────────────────────────
  function buildCalendar() {
    const t = todayParts();
    const sel = parseValue(_value);
    const firstDow     = new Date(viewYear, viewMonth - 1, 1).getDay();
    const daysInMonth  = new Date(viewYear, viewMonth, 0).getDate();
    const prevMonDays  = new Date(viewYear, viewMonth - 1, 0).getDate();
    const totalCells   = Math.ceil((firstDow + daysInMonth) / 7) * 7;

    // Header: ‹ Month Year ›
    const header = document.createElement('div');
    header.className = 'vb-dp-header';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'vb-dp-nav';
    prevBtn.setAttribute('aria-label', 'Previous month');
    prevBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 2 4 6l4 4"/></svg>`;

    const monthLabel = document.createElement('span');
    monthLabel.className = 'vb-dp-month-year';
    monthLabel.textContent = `${MONTHS[viewMonth - 1]} ${viewYear}`;

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'vb-dp-nav';
    nextBtn.setAttribute('aria-label', 'Next month');
    nextBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 2 8 6 4 10"/></svg>`;

    prevBtn.addEventListener('mousedown', e => { e.preventDefault(); navigate(-1); });
    nextBtn.addEventListener('mousedown', e => { e.preventDefault(); navigate(1); });
    header.append(prevBtn, monthLabel, nextBtn);

    // DOW header row
    const dowRow = document.createElement('div');
    dowRow.className = 'vb-dp-dow-row';
    DOW.forEach(d => {
      const s = document.createElement('span');
      s.className = 'vb-dp-dow';
      s.textContent = d;
      dowRow.appendChild(s);
    });

    // Day grid
    const grid = document.createElement('div');
    grid.className = 'vb-dp-grid';

    for (let i = 0; i < totalCells; i++) {
      let y, m, d;
      if (i < firstDow) {
        d = prevMonDays - firstDow + i + 1;
        m = viewMonth === 1 ? 12 : viewMonth - 1;
        y = viewMonth === 1 ? viewYear - 1 : viewYear;
      } else if (i >= firstDow + daysInMonth) {
        d = i - firstDow - daysInMonth + 1;
        m = viewMonth === 12 ? 1 : viewMonth + 1;
        y = viewMonth === 12 ? viewYear + 1 : viewYear;
      } else {
        d = i - firstDow + 1;
        m = viewMonth;
        y = viewYear;
      }

      const dateStr = toDateStr(y, m, d);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vb-dp-day';
      btn.textContent = d;
      btn.dataset.date = dateStr;

      const isOther    = m !== viewMonth;
      const isSelected = sel && sel.y === y && sel.m === m && sel.d === d;
      const isToday    = t.y === y && t.m === m && t.d === d;

      if (isOther)    btn.classList.add('other-month');
      if (isSelected) btn.classList.add('selected');
      if (isToday && !isSelected) btn.classList.add('today');

      btn.addEventListener('mousedown', e => { e.preventDefault(); selectDate(dateStr); });
      grid.appendChild(btn);
    }

    // Footer: Clear  Today
    const footer = document.createElement('div');
    footer.className = 'vb-dp-footer';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'vb-dp-foot-btn';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('mousedown', e => { e.preventDefault(); selectDate(''); });

    const todayBtn = document.createElement('button');
    todayBtn.type = 'button';
    todayBtn.className = 'vb-dp-foot-btn vb-dp-today-btn';
    todayBtn.textContent = 'Today';
    todayBtn.addEventListener('mousedown', e => {
      e.preventDefault();
      const to = todayParts();
      selectDate(toDateStr(to.y, to.m, to.d));
    });

    footer.append(clearBtn, todayBtn);
    pop.innerHTML = '';
    pop.append(header, dowRow, grid, footer);
  }

  function navigate(delta) {
    viewMonth += delta;
    if (viewMonth > 12) { viewMonth = 1; viewYear++; }
    else if (viewMonth < 1) { viewMonth = 12; viewYear--; }
    buildCalendar();
    positionPop();
  }

  function selectDate(dateStr) {
    _value = dateStr;
    renderTrigger();
    close();
    trigger.focus();
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function positionPop() {
    if (!pop) return;
    const r  = trigger.getBoundingClientRect();
    const pw = pop.offsetWidth  || 248;
    const ph = pop.offsetHeight || 284;
    let left = r.left;
    let top  = r.bottom + 6;
    if (left + pw > window.innerWidth  - 8) left = Math.max(8, r.right - pw);
    if (top  + ph > window.innerHeight - 8) top  = Math.max(8, r.top - ph - 6);
    pop.style.left = left + 'px';
    pop.style.top  = top  + 'px';
  }

  // ── Open / close ─────────────────────────────────────────────────────────────
  function open() {
    if (pop) return;
    initView();
    pop = document.createElement('div');
    pop.className = 'vb-datepicker-pop';
    pop.style.visibility = 'hidden';
    buildCalendar();
    document.body.appendChild(pop);
    positionPop();
    pop.style.visibility = '';
    wrap.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown',   onKey,     true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
  }

  function close() {
    if (!pop) return;
    pop.remove(); pop = null;
    wrap.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown',   onKey,     true);
    window.removeEventListener('resize', close);
    window.removeEventListener('scroll', onScroll, true);
  }

  function onDocDown(e) {
    if (!wrap.contains(e.target) && pop && !pop.contains(e.target)) close();
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); trigger.focus(); }
  }

  function onTriggerKeyDown(e) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!pop) {
        e.preventDefault();
        selectDate('');
      }
    }
  }

  function onScroll(e) {
    if (pop && pop.contains(e.target)) return;
    close();
  }

  trigger.addEventListener('click', () => { pop ? close() : open(); });
  trigger.addEventListener('keydown', onTriggerKeyDown);

  renderTrigger();
  return { el: wrap, getValue: () => _value, setValue: v => { _value = v || ''; renderTrigger(); }, open, close };
}

// ── Initialize static date inputs ─────────────────────────────────────────────
window._ncDatePicker   = vbDatePicker(document.getElementById('nc-due-date'));
window._cardDatePicker = vbDatePicker(document.getElementById('card-due-date'));
