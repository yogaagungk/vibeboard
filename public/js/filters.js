'use strict';

const filterState = {
  tags: [],
  priorities: [],
  agents: [],
  dueDate: null
};

function initFilters() {
  loadFiltersFromURL();
  renderFilterBar();
  applyFilters();

  document.getElementById('filter-clear-all').addEventListener('click', clearAllFilters);
  initFilterButtons();
}

function initFilterButtons() {
  document.querySelectorAll('.filter-add-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const type = btn.dataset.filterType;
      const existing = document.querySelector('.filter-dropdown');
      if (existing && existing.dataset.forType === type) { existing.remove(); return; }
      openFilterDropdown(btn, type);
    });
  });
}

function openFilterDropdown(btn, type) {
  document.querySelectorAll('.filter-dropdown').forEach(d => d.remove());

  const options = getFilterOptions(type);
  if (!options.length) return;

  const dd = document.createElement('div');
  dd.className = 'filter-dropdown';
  dd.dataset.forType = type;

  options.forEach(({ label, value, active }) => {
    const item = document.createElement('button');
    item.className = 'filter-dropdown-item' + (active ? ' active' : '');
    item.textContent = label;
    item.addEventListener('click', e => {
      e.stopPropagation();
      if (active) {
        removeFilter(type === 'due' ? 'dueDate' : type, value);
      } else {
        addFilter(type === 'due' ? 'dueDate' : type, value);
      }
      dd.remove();
    });
    dd.appendChild(item);
  });

  const rect = btn.getBoundingClientRect();
  dd.style.top = (rect.bottom + 4) + 'px';
  dd.style.left = rect.left + 'px';
  document.body.appendChild(dd);

  setTimeout(() => {
    document.addEventListener('click', function closeDD() {
      dd.remove();
      document.removeEventListener('click', closeDD);
    }, { once: true });
  }, 0);
}

function getFilterOptions(type) {
  if (type === 'tag') {
    return TAGS.map(t => ({ label: t, value: t, active: filterState.tags.includes(t) }));
  }
  if (type === 'priority') {
    return [
      { label: 'High', value: 'high', active: filterState.priorities.includes('high') },
      { label: 'Medium', value: 'medium', active: filterState.priorities.includes('medium') },
      { label: 'Low', value: 'low', active: filterState.priorities.includes('low') },
    ];
  }
  if (type === 'agent') {
    return ['claude-code', 'opencode', 'codex', 'command-code'].map(k => ({
      label: AGENT_LABELS[k] || k,
      value: k,
      active: filterState.agents.includes(k),
    }));
  }
  if (type === 'due') {
    return [
      { label: 'Overdue', value: 'overdue', active: filterState.dueDate === 'overdue' },
      { label: 'Due today', value: 'today', active: filterState.dueDate === 'today' },
      { label: 'Due this week', value: 'week', active: filterState.dueDate === 'week' },
    ];
  }
  return [];
}

function loadFiltersFromURL() {
  const params = new URLSearchParams(window.location.search);
  const tags = params.get('tags');
  if (tags) filterState.tags = tags.split(',').filter(Boolean);
  const priorities = params.get('priorities');
  if (priorities) filterState.priorities = priorities.split(',').filter(Boolean);
  const agents = params.get('agents');
  if (agents) filterState.agents = agents.split(',').filter(Boolean);
  const dueDate = params.get('dueDate');
  if (dueDate) filterState.dueDate = dueDate;
}

function saveFiltersToURL() {
  const params = new URLSearchParams(window.location.search);
  if (filterState.tags.length) params.set('tags', filterState.tags.join(','));
  else params.delete('tags');
  if (filterState.priorities.length) params.set('priorities', filterState.priorities.join(','));
  else params.delete('priorities');
  if (filterState.agents.length) params.set('agents', filterState.agents.join(','));
  else params.delete('agents');
  if (filterState.dueDate) params.set('dueDate', filterState.dueDate);
  else params.delete('dueDate');
  const newURL = params.toString()
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname;
  window.history.replaceState({}, '', newURL);
}

function hasActiveFilters() {
  return filterState.tags.length > 0
    || filterState.priorities.length > 0
    || filterState.agents.length > 0
    || filterState.dueDate !== null;
}

function renderFilterBar() {
  const filterChips = document.getElementById('filter-chips');
  const clearAllBtn = document.getElementById('filter-clear-all');
  const sep = document.getElementById('filter-bar-sep');

  filterChips.innerHTML = '';

  const active = hasActiveFilters();
  if (sep) sep.style.display = active ? '' : 'none';
  clearAllBtn.style.display = active ? '' : 'none';

  filterState.tags.forEach(tag => filterChips.appendChild(createFilterChip('tag', tag, tag)));
  filterState.priorities.forEach(p => filterChips.appendChild(createFilterChip('priority', p, p)));
  filterState.agents.forEach(a => filterChips.appendChild(createFilterChip('agent', a, AGENT_LABELS[a] || a)));
  if (filterState.dueDate) {
    const label = { overdue: 'Overdue', today: 'Due today', week: 'Due this week' }[filterState.dueDate] || filterState.dueDate;
    filterChips.appendChild(createFilterChip('dueDate', filterState.dueDate, label));
  }

  // Highlight active filter buttons
  document.querySelectorAll('.filter-add-btn').forEach(btn => {
    const type = btn.dataset.filterType;
    const isActive = (type === 'tag' && filterState.tags.length > 0)
      || (type === 'priority' && filterState.priorities.length > 0)
      || (type === 'agent' && filterState.agents.length > 0)
      || (type === 'due' && filterState.dueDate !== null);
    btn.classList.toggle('active', isActive);
  });
}

function createFilterChip(type, value, displayLabel) {
  const chip = document.createElement('div');
  chip.className = 'filter-chip';
  if (type === 'tag') chip.classList.add(`tag-${value}`);
  else if (type === 'priority') chip.classList.add(`priority-${value}`);

  const typeLabel = document.createElement('span');
  typeLabel.className = 'filter-chip-label';
  typeLabel.textContent = { priority: 'Priority:', agent: 'Agent:', dueDate: 'Due:' }[type] || '';

  const valueLabel = document.createElement('span');
  valueLabel.textContent = displayLabel;

  const removeBtn = document.createElement('span');
  removeBtn.className = 'filter-chip-remove';
  removeBtn.textContent = '×';

  if (typeLabel.textContent) chip.appendChild(typeLabel);
  chip.appendChild(valueLabel);
  chip.appendChild(removeBtn);
  chip.addEventListener('click', () => removeFilter(type, value));
  return chip;
}

function removeFilter(type, value) {
  if (type === 'tag') filterState.tags = filterState.tags.filter(t => t !== value);
  else if (type === 'priority') filterState.priorities = filterState.priorities.filter(p => p !== value);
  else if (type === 'agent') filterState.agents = filterState.agents.filter(a => a !== value);
  else if (type === 'dueDate') filterState.dueDate = null;
  saveFiltersToURL(); renderFilterBar(); applyFilters();
}

function clearAllFilters() {
  filterState.tags = []; filterState.priorities = []; filterState.agents = []; filterState.dueDate = null;
  saveFiltersToURL(); renderFilterBar(); applyFilters();
}

function addFilter(type, value) {
  if (type === 'tag' && !filterState.tags.includes(value)) filterState.tags.push(value);
  else if (type === 'priority' && !filterState.priorities.includes(value)) filterState.priorities.push(value);
  else if (type === 'agent' && !filterState.agents.includes(value)) filterState.agents.push(value);
  else if (type === 'dueDate') filterState.dueDate = value;
  saveFiltersToURL(); renderFilterBar(); applyFilters();
}

function applyFilters() {
  const searchActive = searchInput.value.trim().length > 0;
  const filtersActive = hasActiveFilters();

  if (!filtersActive && !searchActive) {
    boardEl.querySelectorAll('.card').forEach(c => { c.style.display = ''; });
    updateFilterCount();
    return;
  }

  const q = searchInput.value.trim().toLowerCase();
  boardEl.querySelectorAll('.card').forEach(c => {
    let match = true;

    if (filtersActive) {
      const cardEntry = findCardEntry(c.dataset.cardId);
      if (!cardEntry) { c.style.display = 'none'; return; }
      const card = cardEntry.card;

      if (filterState.tags.length > 0) {
        if (!filterState.tags.some(t => (card.tags || []).includes(t))) match = false;
      }
      if (match && filterState.priorities.length > 0) {
        if (!filterState.priorities.includes(card.priority || '')) match = false;
      }
      if (match && filterState.agents.length > 0) {
        if (!filterState.agents.includes(card.agent || '')) match = false;
      }
      if (match && filterState.dueDate) {
        if (filterState.dueDate === 'overdue' && (!card.due_date || !isOverdue(card.due_date))) match = false;
        else if (filterState.dueDate === 'today' && (!card.due_date || !isDueToday(card.due_date))) match = false;
        else if (filterState.dueDate === 'week' && (!card.due_date || !isDueThisWeek(card.due_date))) match = false;
      }
    }

    if (match && searchActive) match = (c.dataset.searchTitle || '').includes(q);
    c.style.display = match ? '' : 'none';
  });

  updateFilterCount();
}

function updateFilterCount() {
  const searchActive = searchInput.value.trim().length > 0;
  const filterActive = hasActiveFilters();
  if (!searchActive && !filterActive) { searchCount.style.display = 'none'; return; }
  const cards = boardEl.querySelectorAll('.card');
  let total = 0, visible = 0;
  cards.forEach(c => { total++; if (c.style.display !== 'none') visible++; });
  searchCount.style.display = 'inline-block';
  searchCount.textContent = `${visible} of ${total}`;
}

function isDueToday(dueDate) {
  return dueDate === new Date().toISOString().split('T')[0];
}

function isDueThisWeek(dueDate) {
  const today = new Date();
  const due = new Date(dueDate + 'T00:00:00');
  const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= 7;
}

window.addFilter = addFilter;
window.initFilters = initFilters;
window.applyFilters = applyFilters;
