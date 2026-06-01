'use strict';

let swimlaneView = false;
let swimlaneGroupBy = 'tag';

function getSwimlaneGroupBy() {
  try {
    return localStorage.getItem('vb_swimlane_group_by') || 'tag';
  } catch (_) {
    return 'tag';
  }
}

function setSwimlaneGroupBy(value) {
  swimlaneGroupBy = value;
  try {
    localStorage.setItem('vb_swimlane_group_by', value);
  } catch (_) {}
}

function getSwimlaneView() {
  try {
    return localStorage.getItem('vb_swimlane_view') === '1';
  } catch (_) {
    return false;
  }
}

function setSwimlaneView(enabled) {
  swimlaneView = enabled;
  try {
    localStorage.setItem('vb_swimlane_view', enabled ? '1' : '0');
  } catch (_) {}
}

function getGroupValues(groupBy) {
  if (groupBy === 'tag') {
    return TAGS;
  } else if (groupBy === 'priority') {
    return ['high', 'medium', 'low', ''];
  } else if (groupBy === 'agent') {
    return ['claude-code', 'opencode', 'codex', 'command-code', ''];
  }
  return [];
}

function getGroupLabel(groupBy, value) {
  if (groupBy === 'tag') {
    return value;
  } else if (groupBy === 'priority') {
    return value || 'none';
  } else if (groupBy === 'agent') {
    return value ? (AGENT_LABELS[value] || value) : 'none';
  }
  return value || 'none';
}

function getCardGroupValue(card, groupBy) {
  if (groupBy === 'tag') {
    return card.tags || [];
  } else if (groupBy === 'priority') {
    return card.priority || '';
  } else if (groupBy === 'agent') {
    return card.agent || '';
  }
  return '';
}

function renderSwimlaneBoard(b) {
  cycleCardIds = findCycleCardIds();
  board = b;
  if (Array.isArray(b.runningCards)) {
    runningCards.clear();
    b.runningCards.forEach(id => runningCards.add(id));
  }
  if (Array.isArray(b.queuedCards)) {
    queuedCards.clear();
    b.queuedCards.forEach(id => queuedCards.add(id));
  }

  boardEl.innerHTML = '';
  boardEl.classList.add('swimlane-mode');

  const groupValues = getGroupValues(swimlaneGroupBy);
  
  groupValues.forEach(groupValue => {
    const lane = buildSwimlane(groupValue, b.columns);
    boardEl.appendChild(lane);
  });

  document.body.classList.toggle('vb-show-descriptions', getShowDescriptions());
  renderLog(board.agentLog || []);
}

function buildSwimlane(groupValue, columns) {
  const lane = document.createElement('div');
  lane.className = 'swimlane';
  lane.dataset.groupValue = groupValue;

  const header = document.createElement('div');
  header.className = 'swimlane-header';
  
  const title = document.createElement('div');
  title.className = 'swimlane-title';
  title.textContent = getGroupLabel(swimlaneGroupBy, groupValue);
  
  if (swimlaneGroupBy === 'tag' && groupValue) {
    title.classList.add('tag-' + groupValue);
  } else if (swimlaneGroupBy === 'priority' && groupValue) {
    title.classList.add('priority-' + groupValue);
  } else if (swimlaneGroupBy === 'agent' && groupValue) {
    title.classList.add('agent-' + groupValue);
  }
  
  header.appendChild(title);
  lane.appendChild(header);

  const columnsRow = document.createElement('div');
  columnsRow.className = 'swimlane-columns';

  columns.forEach(col => {
    const colEl = document.createElement('div');
    colEl.className = 'swimlane-column';
    colEl.dataset.colId = col.id;
    colEl.dataset.groupValue = groupValue;

    const colHeader = document.createElement('div');
    colHeader.className = 'swimlane-col-header';
    colHeader.textContent = col.title;
    colEl.appendChild(colHeader);

    const cardsList = document.createElement('div');
    cardsList.className = 'swimlane-cards-list';
    cardsList.dataset.colId = col.id;
    cardsList.dataset.groupValue = groupValue;

    const filteredCards = col.cards.filter(card => {
      const cardValue = getCardGroupValue(card, swimlaneGroupBy);
      if (swimlaneGroupBy === 'tag') {
        return Array.isArray(cardValue) && cardValue.includes(groupValue);
      } else {
        return cardValue === groupValue;
      }
    });

    const reversedCards = [...filteredCards].reverse();
    reversedCards.forEach(card => {
      cardsList.appendChild(buildCard(card, col.id));
    });

    cardsList.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      cardsList.classList.add('drag-over');
    });

    cardsList.addEventListener('dragleave', e => {
      if (!cardsList.contains(e.relatedTarget)) {
        cardsList.classList.remove('drag-over');
      }
    });

    cardsList.addEventListener('drop', async e => {
      e.preventDefault();
      cardsList.classList.remove('drag-over');
      if (!draggingCard) return;

      const tCol = board.columns.find(c => c.id === cardsList.dataset.colId);
      const sCol = board.columns.find(c => c.id === draggingFromCol);
      if (!tCol || !sCol) return;

      const idx = sCol.cards.findIndex(c => c.id === draggingCard);
      if (idx === -1) return;

      const movingColumns = sCol.id !== tCol.id;
      const wip = Number.isInteger(tCol.wip_limit) && tCol.wip_limit > 0 ? tCol.wip_limit : null;
      if (movingColumns && wip && tCol.cards.length >= wip) {
        showToast(`"${tCol.title}" is at its WIP limit (${wip}) - move blocked`, 4000);
        draggingCard = null;
        draggingFromCol = null;
        return;
      }

      if (movingColumns && tCol.title === 'In Progress') {
        const cardObj = sCol.cards[idx];
        const blockers = unfinishedBlockersUI(cardObj);
        if (blockers.length) {
          showToast(`"${cardObj.title}" is blocked by: ${blockers.map(c => c.title).join(', ')}`, 4500);
          draggingCard = null;
          draggingFromCol = null;
          return;
        }
      }

      const [card] = sCol.cards.splice(idx, 1);
      const over = e.target.closest('.card');
      if (over?.dataset.cardId) {
        const oi = tCol.cards.findIndex(c => c.id === over.dataset.cardId);
        if (oi !== -1) tCol.cards.splice(oi + 1, 0, card);
        else tCol.cards.push(card);
      } else {
        tCol.cards.push(card);
      }
      draggingCard = null;
      draggingFromCol = null;

      const spawnsAgent = card.agent && sCol.id !== tCol.id && (tCol.title === 'In Progress' || tCol.title === 'Review');
      if (spawnsAgent) {
        const agentStatus = mcpStatusCache?.agents?.[card.agent];
        if (agentStatus?.installed && !agentStatus?.configured) {
          renderSwimlaneBoard(board);
          postBoard();
          openMcpModal();
          showToast('Agent queued - set up MCP first for full board interaction', 5000);
          return;
        }
      }

      renderSwimlaneBoard(board);
      await postBoard();
      if (spawnsAgent) {
        fetch(`/api/cards/${card.id}/run`, { method: 'POST' }).catch(() => {});
      }
    });

    colEl.appendChild(cardsList);
    columnsRow.appendChild(colEl);
  });

  lane.appendChild(columnsRow);
  return lane;
}

function toggleSwimlaneView() {
  const enabled = !swimlaneView;
  setSwimlaneView(enabled);
  
  const btn = document.getElementById('swimlane-toggle-btn');
  if (btn) {
    btn.classList.toggle('active', enabled);
    btn.title = enabled ? 'Switch to standard view' : 'Switch to swimlane view';
  }

  const groupSelector = document.getElementById('swimlane-group-selector');
  if (groupSelector) {
    groupSelector.style.display = enabled ? '' : 'none';
  }

  if (enabled) {
    renderSwimlaneBoard(board);
  } else {
    boardEl.classList.remove('swimlane-mode');
    renderBoard(board);
  }
}

function changeSwimlaneGroupBy(newGroupBy) {
  setSwimlaneGroupBy(newGroupBy);
  
  const buttons = document.querySelectorAll('.swimlane-group-btn');
  buttons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.groupBy === newGroupBy);
  });

  if (swimlaneView) {
    renderSwimlaneBoard(board);
  }
}

swimlaneView = getSwimlaneView();
swimlaneGroupBy = getSwimlaneGroupBy();

function initSwimlaneControls() {
  const toggleBtn = document.getElementById('swimlane-toggle-btn');
  const groupSelector = document.getElementById('swimlane-group-selector');
  
  if (!toggleBtn) return;

  toggleBtn.classList.toggle('active', swimlaneView);
  toggleBtn.title = swimlaneView ? 'Switch to standard view' : 'Switch to swimlane view';
  
  if (groupSelector) {
    groupSelector.style.display = swimlaneView ? '' : 'none';
    
    const buttons = groupSelector.querySelectorAll('.swimlane-group-btn');
    buttons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.groupBy === swimlaneGroupBy);
      btn.addEventListener('click', () => {
        changeSwimlaneGroupBy(btn.dataset.groupBy);
      });
    });
  }

  toggleBtn.addEventListener('click', toggleSwimlaneView);

  if (swimlaneView && board) {
    renderSwimlaneBoard(board);
  }
}
