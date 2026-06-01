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
  
  if (filterState.tags.length) {
    params.set('tags', filterState.tags.join(','));
  } else {
    params.delete('tags');
  }
  
  if (filterState.priorities.length) {
    params.set('priorities', filterState.priorities.join(','));
  } else {
    params.delete('priorities');
  }
  
  if (filterState.agents.length) {
    params.set('agents', filterState.agents.join(','));
  } else {
    params.delete('agents');
  }
  
  if (filterState.dueDate) {
    params.set('dueDate', filterState.dueDate);
  } else {
    params.delete('dueDate');
  }
  
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
  const filterBar = document.getElementById('board-filter-bar');
  const filterChips = document.getElementById('filter-chips');
  const clearAllBtn = document.getElementById('filter-clear-all');
  
  if (!hasActiveFilters()) {
    filterBar.style.display = 'none';
    return;
  }
  
  filterBar.style.display = '';
  filterChips.innerHTML = '';
  
  filterState.tags.forEach(tag => {
    const chip = createFilterChip('tag', tag, tag);
    filterChips.appendChild(chip);
  });
  
  filterState.priorities.forEach(priority => {
    const chip = createFilterChip('priority', priority, priority);
    filterChips.appendChild(chip);
  });
  
  filterState.agents.forEach(agent => {
    const label = AGENT_LABELS[agent] || agent;
    const chip = createFilterChip('agent', agent, label);
    filterChips.appendChild(chip);
  });
  
  if (filterState.dueDate) {
    const label = filterState.dueDate === 'overdue' ? 'Overdue' : 
                  filterState.dueDate === 'today' ? 'Due today' :
                  filterState.dueDate === 'week' ? 'Due this week' : filterState.dueDate;
    const chip = createFilterChip('dueDate', filterState.dueDate, label);
    filterChips.appendChild(chip);
  }
  
  clearAllBtn.style.display = '';
}

function createFilterChip(type, value, displayLabel) {
  const chip = document.createElement('div');
  chip.className = 'filter-chip';
  
  if (type === 'tag') {
    chip.classList.add(`tag-${value}`);
  } else if (type === 'priority') {
    chip.classList.add(`priority-${value}`);
  }
  
  const typeLabel = document.createElement('span');
  typeLabel.className = 'filter-chip-label';
  typeLabel.textContent = type === 'tag' ? '' : 
                          type === 'priority' ? 'Priority:' :
                          type === 'agent' ? 'Agent:' :
                          type === 'dueDate' ? 'Due:' : '';
  
  const valueLabel = document.createElement('span');
  valueLabel.textContent = displayLabel;
  
  const removeBtn = document.createElement('span');
  removeBtn.className = 'filter-chip-remove';
  removeBtn.textContent = '×';
  
  if (typeLabel.textContent) chip.appendChild(typeLabel);
  chip.appendChild(valueLabel);
  chip.appendChild(removeBtn);
  
  chip.addEventListener('click', () => {
    removeFilter(type, value);
  });
  
  return chip;
}

function removeFilter(type, value) {
  if (type === 'tag') {
    filterState.tags = filterState.tags.filter(t => t !== value);
  } else if (type === 'priority') {
    filterState.priorities = filterState.priorities.filter(p => p !== value);
  } else if (type === 'agent') {
    filterState.agents = filterState.agents.filter(a => a !== value);
  } else if (type === 'dueDate') {
    filterState.dueDate = null;
  }
  
  saveFiltersToURL();
  renderFilterBar();
  applyFilters();
}

function clearAllFilters() {
  filterState.tags = [];
  filterState.priorities = [];
  filterState.agents = [];
  filterState.dueDate = null;
  
  saveFiltersToURL();
  renderFilterBar();
  applyFilters();
}

function addFilter(type, value) {
  if (type === 'tag' && !filterState.tags.includes(value)) {
    filterState.tags.push(value);
  } else if (type === 'priority' && !filterState.priorities.includes(value)) {
    filterState.priorities.push(value);
  } else if (type === 'agent' && !filterState.agents.includes(value)) {
    filterState.agents.push(value);
  } else if (type === 'dueDate') {
    filterState.dueDate = value;
  }
  
  saveFiltersToURL();
  renderFilterBar();
  applyFilters();
}

function applyFilters() {
  if (!hasActiveFilters()) {
    boardEl.querySelectorAll('.card').forEach(c => {
      if (!c.style.display || c.style.display === 'none') {
        const searchActive = searchInput.value.trim().length > 0;
        if (!searchActive) c.style.display = '';
      }
    });
    updateFilterCount();
    return;
  }
  
  const cards = boardEl.querySelectorAll('.card');
  let total = 0, visible = 0;
  
  cards.forEach(c => {
    total++;
    const cardId = c.dataset.cardId;
    const cardEntry = findCardEntry(cardId);
    if (!cardEntry) return;
    
    const card = cardEntry.card;
    let match = true;
    
    if (filterState.tags.length > 0) {
      const cardTags = card.tags || [];
      const hasTag = filterState.tags.some(t => cardTags.includes(t));
      if (!hasTag) match = false;
    }
    
    if (match && filterState.priorities.length > 0) {
      const cardPriority = card.priority || '';
      if (!filterState.priorities.includes(cardPriority)) match = false;
    }
    
    if (match && filterState.agents.length > 0) {
      const cardAgent = card.agent || '';
      if (!filterState.agents.includes(cardAgent)) match = false;
    }
    
    if (match && filterState.dueDate) {
      if (filterState.dueDate === 'overdue') {
        if (!card.due_date || !isOverdue(card.due_date)) match = false;
      } else if (filterState.dueDate === 'today') {
        if (!card.due_date || !isDueToday(card.due_date)) match = false;
      } else if (filterState.dueDate === 'week') {
        if (!card.due_date || !isDueThisWeek(card.due_date)) match = false;
      }
    }
    
    const searchActive = searchInput.value.trim().length > 0;
    if (searchActive) {
      const searchMatch = (c.dataset.searchTitle || '').includes(searchInput.value.trim().toLowerCase());
      match = match && searchMatch;
    }
    
    c.style.display = match ? '' : 'none';
    if (match) visible++;
  });
  
  updateFilterCount();
}

function updateFilterCount() {
  const searchActive = searchInput.value.trim().length > 0;
  const filterActive = hasActiveFilters();
  
  if (!searchActive && !filterActive) {
    searchCount.style.display = 'none';
    return;
  }
  
  const cards = boardEl.querySelectorAll('.card');
  let total = 0, visible = 0;
  cards.forEach(c => {
    total++;
    if (c.style.display !== 'none') visible++;
  });
  
  searchCount.style.display = 'inline-block';
  searchCount.textContent = `${visible} of ${total}`;
}

function isDueToday(dueDate) {
  const today = new Date().toISOString().split('T')[0];
  return dueDate === today;
}

function isDueThisWeek(dueDate) {
  const today = new Date();
  const due = new Date(dueDate + 'T00:00:00');
  const diffTime = due - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= 7;
}

window.addFilter = addFilter;
window.initFilters = initFilters;
window.applyFilters = applyFilters;
