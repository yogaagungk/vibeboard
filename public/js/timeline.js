'use strict';

let timelineView = 'month';
let timelineScrollPos = 0;

function renderTimeline(b) {
  const timelineEl = document.getElementById('timeline');
  if (!timelineEl) return;

  board = b;
  timelineEl.innerHTML = '';

  const allCards = [];
  b.columns.forEach(col => {
    col.cards.forEach(card => {
      allCards.push({ ...card, columnId: col.id, columnTitle: col.title });
    });
  });

  const scheduled = allCards.filter(c => c.due_date);
  const unscheduled = allCards.filter(c => !c.due_date);

  const container = document.createElement('div');
  container.className = 'timeline-container';

  const toolbar = document.createElement('div');
  toolbar.className = 'timeline-toolbar';

  const viewPicker = document.createElement('div');
  viewPicker.className = 'timeline-view-picker';
  ['week', 'month', 'quarter'].forEach(v => {
    const btn = document.createElement('button');
    btn.className = 'timeline-view-btn' + (v === timelineView ? ' active' : '');
    btn.textContent = v.charAt(0).toUpperCase() + v.slice(1);
    btn.addEventListener('click', () => {
      timelineView = v;
      renderTimeline(board);
    });
    viewPicker.appendChild(btn);
  });

  const todayBtn = document.createElement('button');
  todayBtn.className = 'timeline-today-btn';
  todayBtn.textContent = 'Today';
  todayBtn.addEventListener('click', () => {
    const todayEl = timelineEl.querySelector('.timeline-day.today');
    if (todayEl) todayEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  });

  toolbar.appendChild(viewPicker);
  toolbar.appendChild(todayBtn);
  container.appendChild(toolbar);

  const ganttWrap = document.createElement('div');
  ganttWrap.className = 'timeline-gantt-wrap';

  const gantt = buildGanttChart(scheduled);
  ganttWrap.appendChild(gantt);

  container.appendChild(ganttWrap);

  if (unscheduled.length) {
    const unscheduledSection = document.createElement('div');
    unscheduledSection.className = 'timeline-unscheduled';

    const header = document.createElement('div');
    header.className = 'timeline-unscheduled-header';
    header.textContent = `Unscheduled (${unscheduled.length})`;
    unscheduledSection.appendChild(header);

    const list = document.createElement('div');
    list.className = 'timeline-unscheduled-list';
    unscheduled.forEach(card => {
      list.appendChild(buildTimelineCard(card));
    });
    unscheduledSection.appendChild(list);

    container.appendChild(unscheduledSection);
  }

  timelineEl.appendChild(container);

  if (timelineScrollPos > 0) {
    ganttWrap.scrollLeft = timelineScrollPos;
  }
}

function buildGanttChart(cards) {
  const gantt = document.createElement('div');
  gantt.className = 'timeline-gantt';

  if (!cards.length) {
    const empty = document.createElement('div');
    empty.className = 'timeline-empty';
    empty.textContent = 'No cards with due dates';
    gantt.appendChild(empty);
    return gantt;
  }

  const dates = cards.map(c => new Date(c.due_date));
  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(Math.min(minDate.getTime(), today.getTime()));
  const end = new Date(Math.max(maxDate.getTime(), today.getTime()));

  start.setDate(start.getDate() - 7);
  end.setDate(end.getDate() + 14);

  const dayCount = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

  const header = document.createElement('div');
  header.className = 'timeline-header';

  const grid = document.createElement('div');
  grid.className = 'timeline-grid';

  const rows = document.createElement('div');
  rows.className = 'timeline-rows';

  for (let i = 0; i < dayCount; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);

    const dayCol = document.createElement('div');
    dayCol.className = 'timeline-day';
    if (d.toDateString() === today.toDateString()) dayCol.classList.add('today');
    if (d.getDay() === 0 || d.getDay() === 6) dayCol.classList.add('weekend');

    const dayLabel = document.createElement('div');
    dayLabel.className = 'timeline-day-label';
    dayLabel.textContent = d.getDate();
    if (d.getDate() === 1 || i === 0) {
      const monthLabel = document.createElement('div');
      monthLabel.className = 'timeline-month-label';
      monthLabel.textContent = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      dayLabel.appendChild(monthLabel);
    }
    dayCol.appendChild(dayLabel);

    header.appendChild(dayCol);

    const gridCol = document.createElement('div');
    gridCol.className = 'timeline-grid-col';
    if (d.toDateString() === today.toDateString()) gridCol.classList.add('today');
    if (d.getDay() === 0 || d.getDay() === 6) gridCol.classList.add('weekend');
    grid.appendChild(gridCol);
  }

  cards.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

  cards.forEach(card => {
    const dueDate = new Date(card.due_date);
    dueDate.setHours(0, 0, 0, 0);
    const dayIndex = Math.floor((dueDate - start) / (1000 * 60 * 60 * 24));

    const row = document.createElement('div');
    row.className = 'timeline-row';

    const cardEl = document.createElement('div');
    cardEl.className = 'timeline-card' + (card.priority ? ' pri-' + card.priority : '');
    cardEl.style.gridColumn = `${dayIndex + 1} / span 1`;
    cardEl.dataset.cardId = card.id;

    const cardInner = document.createElement('div');
    cardInner.className = 'timeline-card-inner';

    const title = document.createElement('div');
    title.className = 'timeline-card-title';
    title.textContent = card.title || 'Untitled';

    const meta = document.createElement('div');
    meta.className = 'timeline-card-meta';

    if (card.columnTitle) {
      const col = document.createElement('span');
      col.className = 'timeline-card-column';
      col.textContent = card.columnTitle;
      meta.appendChild(col);
    }

    if (card.agent) {
      const agent = document.createElement('span');
      agent.className = `timeline-card-agent ${card.agent}`;
      agent.textContent = { 'claude-code': 'CC', 'opencode': 'OC', 'codex': 'CX', 'command-code': 'CMD' }[card.agent] || card.agent.slice(0,2).toUpperCase();
      meta.appendChild(agent);
    }

    if (card.tags && card.tags.length) {
      card.tags.forEach(tag => {
        const t = document.createElement('span');
        t.className = `timeline-card-tag tag-${tag}`;
        t.textContent = tag;
        meta.appendChild(t);
      });
    }

    cardInner.appendChild(title);
    if (meta.children.length) cardInner.appendChild(meta);
    cardEl.appendChild(cardInner);

    cardEl.addEventListener('click', () => openCardModal(card.id, card.columnId));

    row.appendChild(cardEl);
    rows.appendChild(row);
  });

  gantt.appendChild(header);
  gantt.appendChild(grid);
  gantt.appendChild(rows);

  const ganttWrap = gantt.closest('.timeline-gantt-wrap');
  if (ganttWrap) {
    ganttWrap.addEventListener('scroll', () => {
      timelineScrollPos = ganttWrap.scrollLeft;
    });
  }

  return gantt;
}

function buildTimelineCard(card) {
  const el = document.createElement('div');
  el.className = 'timeline-unscheduled-card' + (card.priority ? ' pri-' + card.priority : '');
  el.dataset.cardId = card.id;

  const title = document.createElement('div');
  title.className = 'timeline-unscheduled-card-title';
  title.textContent = card.title || 'Untitled';

  const meta = document.createElement('div');
  meta.className = 'timeline-unscheduled-card-meta';

  if (card.columnTitle) {
    const col = document.createElement('span');
    col.className = 'timeline-card-column';
    col.textContent = card.columnTitle;
    meta.appendChild(col);
  }

  if (card.agent) {
    const agent = document.createElement('span');
    agent.className = `card-agent-badge ${card.agent}`;
    agent.textContent = { 'claude-code': 'CC', 'opencode': 'OC', 'codex': 'CX', 'command-code': 'CMD' }[card.agent] || card.agent.slice(0,2).toUpperCase();
    meta.appendChild(agent);
  }

  if (card.tags && card.tags.length) {
    card.tags.forEach(tag => {
      const t = document.createElement('span');
      t.className = `tag tag-${tag}`;
      t.textContent = tag;
      meta.appendChild(t);
    });
  }

  el.appendChild(title);
  if (meta.children.length) el.appendChild(meta);

  el.addEventListener('click', () => openCardModal(card.id, card.columnId));

  return el;
}
