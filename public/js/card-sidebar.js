'use strict';

// ── Card Sidebar ──────────────────────────────────────────────────────────
const cardSidebar        = document.getElementById('card-sidebar');
const cardModalTitleEl   = document.getElementById('card-modal-title-input');
const cardModalColBadge  = document.getElementById('card-modal-col-badge');
const cardModalClose     = document.getElementById('card-modal-close');
const cardModalDesc      = document.getElementById('card-modal-desc');
const cardModalTagPicker = document.getElementById('card-modal-tag-picker');
const cardModalPromptTxt = document.getElementById('card-modal-prompt-text');
const cardModalCopyBtn   = document.getElementById('card-modal-copy-btn');

let modalCardId = null, modalColId = null, newCardColId = null;
let ncBlockedBy = []; // blocked_by being assembled in the New Card modal

async function loadCardNotes(cardId) {
  try {
    const resp = await fetch(`/api/cards/${cardId}/notes`);
    if (resp.ok) {
      const data = await resp.json();
      return data.notes || [];
    }
  } catch(_) {}
  return [];
}

function renderCardNotes(notes) {
  const notesList = document.getElementById('card-notes-list');
  const notesSection = document.getElementById('card-notes-section');
  const divider = document.getElementById('card-activity-divider');

  if (!notes || notes.length === 0) {
    notesSection.style.display = 'none';
    return;
  }

  notesSection.style.display = 'block';
  if (divider) divider.style.display = '';
  notesList.innerHTML = '';
  
  notes.forEach(note => {
    const noteEl = document.createElement('div');
    noteEl.className = 'card-note';
    
    const timeEl = document.createElement('div');
    timeEl.className = 'card-note-time';
    timeEl.textContent = fmtTime(note.createdAt);
    
    const contentEl = document.createElement('div');
    contentEl.className = 'card-note-content';
    // Strip BOM and non-printable control chars that may have leaked from old terminal output
    const clean = note.content
      .replace(/﻿/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
      .trim();
    contentEl.textContent = clean;
    
    noteEl.appendChild(timeEl);
    noteEl.appendChild(contentEl);
    notesList.appendChild(noteEl);
  });
}

function agentUnavailableReason(agent) {
  if (!agent) return null;
  if (!agentsAvailable[agent]) return 'not installed';
  const s = mcpStatusCache?.agents?.[agent];
  if (s?.installed && !s?.configured) return 'MCP not configured';
  return null;
}

function applyAgentBtns(activeAgent, onSelect) {
  const agentBtns = document.querySelectorAll('.agent-btn');
  agentBtns.forEach(btn => {
    const agent = btn.dataset.agent;
    const reason = agentUnavailableReason(agent);
    const unavailable = !!reason;
    btn.disabled = unavailable;
    btn.classList.toggle('unavailable', unavailable);
    btn.classList.toggle('active', !unavailable && agent === activeAgent);
    if (unavailable) {
      btn.dataset.reason = reason;
      btn.title = `${AGENT_LABELS[agent] || agent}: ${reason}`;
      btn.onclick = null;
    } else {
      delete btn.dataset.reason;
      btn.title = '';
      btn.onclick = () => {
        agentBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (onSelect) onSelect(btn);
      };
    }
  });
}

function openCardModal(cardId, colId) {
  logSidebar.classList.remove('open');
  const col = board.columns.find(c => c.id === colId);
  const card = col?.cards.find(c => c.id === cardId);
  if (!card) return;
  modalCardId = cardId; modalColId = colId;

  cardModalTitleEl.value = card.title || card.text || '';
  cardModalColBadge.textContent = col.title; cardModalColBadge.style.background = col.color || '#6b6860';
  const branchBadge = document.getElementById('card-modal-branch-badge');
  if (card.branch) { branchBadge.textContent = card.branch; branchBadge.style.display = ''; }
  else { branchBadge.style.display = 'none'; }
  cardModalDesc.value = card.description || '';

  cardModalTagPicker.innerHTML = '';
  TAGS.forEach(tag => {
    const btn = document.createElement('button');
    btn.className = `tag-pick-btn tag-${tag}`; btn.dataset.tag = tag; btn.textContent = tag; btn.type = 'button';
    const active = (card.tags||[]).includes(tag);
    if (active) { btn.classList.add('active'); btn.style.backgroundColor = `var(--tag-${tag})`; btn.style.color = 'white'; }
    else { btn.style.color = `var(--tag-${tag})`; btn.style.opacity = '0.45'; }
    btn.addEventListener('click', () => {
      const tags = card.tags||[];
      if (tags.includes(tag)) { card.tags = tags.filter(t=>t!==tag); btn.classList.remove('active'); btn.style.backgroundColor=''; btn.style.color=`var(--tag-${tag})`; btn.style.opacity='0.45'; }
      else { card.tags=[...tags,tag]; btn.classList.add('active'); btn.style.backgroundColor=`var(--tag-${tag})`; btn.style.color='white'; btn.style.opacity='1'; }
      saveModal(card);
    });
    cardModalTagPicker.appendChild(btn);
  });

  applyAgentBtns((card.agent||''), btn => {
    card.agent = btn.dataset.agent || undefined;
    updatePromptBox(card); saveModal(card);
    updateRunAgentBtn(card);
    document.getElementById('card-review-toggle-row').style.display = card.agent ? '' : 'none';
    document.getElementById('card-custom-prompt-section').style.display = card.agent ? '' : 'none';
    updateModelDropdown('card', card.agent || '', card.model);
  });

  updateModelDropdown('card', card.agent || '', card.model);

  const reviewToggleRow = document.getElementById('card-review-toggle-row');
  const reviewToggle = document.getElementById('card-needs-review-toggle');
  reviewToggleRow.style.display = card.agent ? '' : 'none';
  reviewToggle.checked = !!card.requires_review;
  reviewToggle.onchange = () => {
    card.requires_review = reviewToggle.checked;
    updatePromptBox(card);
    saveModal(card);
  };

  // Priority picker
  document.querySelectorAll('#card-priority-picker .priority-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.priority === (card.priority || ''));
    btn.onclick = () => {
      card.priority = btn.dataset.priority || null;
      document.querySelectorAll('#card-priority-picker .priority-btn').forEach(b => b.classList.toggle('active', b === btn));
      saveModal(card);
    };
  });

  // Due date
  const dueDateEl = document.getElementById('card-due-date');
  dueDateEl.value = card.due_date || '';
  dueDateEl.classList.toggle('overdue', isOverdue(card.due_date));
  dueDateEl.onchange = () => {
    card.due_date = dueDateEl.value || null;
    dueDateEl.classList.toggle('overdue', isOverdue(card.due_date));
    saveModal(card);
  };

  // Blocked-by dependency picker
  renderDepPicker(card);

  // Custom prompt textarea
  const customPromptSection = document.getElementById('card-custom-prompt-section');
  const customPromptEl = document.getElementById('card-custom-prompt');
  customPromptSection.style.display = card.agent ? '' : 'none';
  customPromptEl.value = card.custom_prompt || '';
  customPromptEl.onchange = () => {
    card.custom_prompt = customPromptEl.value;
    updatePromptBox(card);
    saveModal(card);
  };

  // Duplicate button
  const dupBtn = document.getElementById('card-duplicate-btn');
  dupBtn.style.display = '';
  dupBtn.onclick = async () => {
    dupBtn.disabled = true; dupBtn.textContent = '…';
    try {
      await fetch(`/api/cards/${cardId}/duplicate`, { method: 'POST' });
      showToast('Card duplicated', 3000, 'success');
    } catch(err) { showToast('Duplicate failed: ' + err.message, 3000, 'error'); }
    dupBtn.disabled = false; dupBtn.textContent = 'Duplicate';
  };

  document.getElementById('card-sidebar-footer').classList.add('visible');
  updatePromptBox(card);
  showChangesSection(card);
  updateRunAgentBtn(card);
  updateMoveButtons(card, col.title);

  const outputSection = document.getElementById('card-output-section');
  const outputPre = document.getElementById('card-output-content');
  const outputToggle = document.getElementById('card-output-toggle');
  outputSection.style.display = 'none';
  outputPre.textContent = '';
  outputToggle.style.display = 'none';
  outputToggle.textContent = 'Show full output';
  outputToggle.onclick = () => {
    const visible = outputSection.style.display === 'block';
    outputSection.style.display = visible ? 'none' : 'block';
    outputToggle.textContent = visible ? 'Show full output' : 'Hide full output';
    if (!visible && runningCards.has(cardId)) {
      fetch(`/api/cards/${cardId}/output`).then(r => r.json()).then(d => {
        if (d.output) { outputPre.textContent = d.output; outputPre.scrollTop = outputPre.scrollHeight; }
      }).catch(() => {});
    }
  };
  if (runningCards.has(cardId)) {
    outputToggle.style.display = 'inline-block';
    outputToggle.textContent = 'Show full output';
    fetch(`/api/cards/${cardId}/output`).then(r => r.json()).then(d => {
      if (d.output) { outputPre.textContent = d.output; }
    }).catch(() => {});
  }

  cardSidebar.classList.add('open');
  cardModalTitleEl.focus();
  syncAriaPressed(cardSidebar);

  loadCardNotes(cardId).then(notes => {
    renderCardNotes(notes);
    const hasActivity = notes.length > 0 || card.branch;
    document.getElementById('card-activity-divider').style.display = hasActivity ? '' : 'none';
  });
}

function openNewCardModal(colId) {
  logSidebar.classList.remove('open');
  cardSidebar.classList.remove('open');
  newCardColId = colId;

  const col = board.columns.find(c => c.id === colId);
  const badge = document.getElementById('nc-col-badge');
  badge.textContent = col.title; badge.style.background = col.color || '#6b6860';

  document.getElementById('nc-title-input').value = '';
  document.getElementById('nc-desc').value = '';

  const picker = document.getElementById('nc-tag-picker');
  picker.innerHTML = '';
  TAGS.forEach(tag => {
    const btn = document.createElement('button');
    btn.className = `tag-pick-btn tag-${tag}`; btn.dataset.tag = tag; btn.textContent = tag; btn.type = 'button';
    btn.style.color = `var(--tag-${tag})`; btn.style.opacity = '0.45';
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      if (btn.classList.contains('active')) { btn.style.backgroundColor = `var(--tag-${tag})`; btn.style.color = 'white'; btn.style.opacity = '1'; }
      else { btn.style.backgroundColor = ''; btn.style.color = `var(--tag-${tag})`; btn.style.opacity = '0.45'; }
    });
    picker.appendChild(btn);
  });

  const agentOpts = document.getElementById('nc-agent-opts');
  agentOpts.querySelectorAll('.agent-btn').forEach(btn => {
    const agent = btn.dataset.ncAgent;
    const reason = agentUnavailableReason(agent);
    btn.disabled = !!reason;
    btn.classList.toggle('unavailable', !!reason);
    btn.classList.toggle('active', agent === '');
    btn.title = reason ? `${AGENT_LABELS[agent] || agent}: ${reason}` : '';
    btn.onclick = !reason ? () => {
      agentOpts.querySelectorAll('.agent-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('nc-agent-warning').style.display = agent ? '' : 'none';
      updateModelDropdown('nc', agent);
    } : null;
  });

  updateModelDropdown('nc', '');

  // Reset priority picker to None
  document.querySelectorAll('#nc-priority-picker .priority-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.ncPriority === '');
    btn.onclick = () => {
      document.querySelectorAll('#nc-priority-picker .priority-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
  });

  document.getElementById('nc-due-date').value = '';
  document.getElementById('nc-needs-review').checked = false;
  document.getElementById('nc-agent-warning').style.display = 'none';

  // Blocked-by picker (buffered in ncBlockedBy until the card is created)
  ncBlockedBy = [];
  renderBlockedByControl(
    document.getElementById('nc-dep-list'),
    () => ncBlockedBy,
    ids => { ncBlockedBy = ids; },
    null,
  );

  document.getElementById('nc-modal-overlay').classList.add('open');
  document.getElementById('nc-title-input').focus();
  syncAriaPressed(document.getElementById('nc-modal-overlay'));
}

function getModalTags() {
  return Array.from(cardModalTagPicker.querySelectorAll('.tag-pick-btn.active')).map(b => b.dataset.tag);
}

function getModalAgent() {
  const active = document.querySelector('.agent-btn.active');
  return active?.dataset?.agent || undefined;
}


// Reusable "blocked by" control: a dropdown to add a blocker + removable chips
// for the current selections. getBlocked()/setBlocked() own persistence so the
// same control works for an existing card (saves immediately) and the New Card
// modal (buffers into ncBlockedBy until create). excludeId hides the card itself.
function renderBlockedByControl(containerEl, getBlocked, setBlocked, excludeId) {
  if (!containerEl) return;
  containerEl.innerHTML = '';

  const candidates = [];
  for (const col of (board?.columns || [])) {
    for (const c of col.cards) {
      if (c.id !== excludeId) candidates.push({ card: c, column: col });
    }
  }

  const chips = document.createElement('div');
  chips.className = 'dep-chips';

  const ctrl = vbSelect({
    options: [], value: '', placeholder: '+ Add a blocker…', ariaLabel: 'Add a blocker',
    onChange: id => {
      if (!id) return;
      const cur = getBlocked();
      if (!cur.includes(id)) setBlocked([...cur, id]);
      ctrl.setValue('');
      repaint();
    },
  });

  function repaint() {
    const blocked = getBlocked();
    const available = candidates.filter(({ card }) => !blocked.includes(card.id));
    ctrl.setOptions(available.map(({ card, column }) => ({
      value: card.id,
      label: card.title,
      hint: column.title === 'Done' ? '✓ Done' : column.title,
    })));
    ctrl.setValue('');
    ctrl.setPlaceholder(!candidates.length ? 'No other cards available'
      : (!available.length ? 'All cards selected' : '+ Add a blocker…'));

    chips.innerHTML = '';
    blocked.forEach(id => {
      const entry = findCardEntry(id);
      const done = entry && entry.column.title === 'Done';
      const chip = document.createElement('span');
      chip.className = 'dep-chip' + (done ? ' done' : '');
      const label = document.createElement('span');
      label.className = 'dep-chip-label';
      label.textContent = entry ? entry.card.title : '(deleted card)';
      chip.title = done ? 'Satisfied — already in Done' : (entry ? entry.column.title : 'No longer on the board');
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'dep-chip-x'; x.textContent = '×';
      x.setAttribute('aria-label', 'Remove blocker');
      x.addEventListener('click', () => { setBlocked(getBlocked().filter(b => b !== id)); repaint(); });
      chip.appendChild(label); chip.appendChild(x);
      chips.appendChild(chip);
    });
  }

  containerEl.appendChild(ctrl.el);
  containerEl.appendChild(chips);
  repaint();
}

function renderDepPicker(card) {
  renderBlockedByControl(
    document.getElementById('card-dep-list'),
    () => card.blocked_by || [],
    ids => { card.blocked_by = ids; saveModal(card); },
    card.id,
  );
}

function updateRunAgentBtn(card) {
  const btn = document.getElementById('card-run-agent-btn');
  const section = document.getElementById('card-agent-run-section');
  const lastRunEl = document.getElementById('card-agent-last-run');
  if (!card || !card.agent) {
    if (section) section.style.display = 'none';
    return;
  }
  if (section) section.style.display = '';
  const running = runningCards.has(card.id);
  if (btn) { btn.disabled = running; btn.textContent = running ? 'Running…' : 'Run agent'; }
  const stopBtn = document.getElementById('card-stop-agent-btn');
  if (stopBtn) { stopBtn.style.display = running ? '' : 'none'; stopBtn.disabled = false; stopBtn.textContent = 'Stop agent'; }
  if (lastRunEl) {
    if (card.agent_ran_at) {
      const bits = ['Last run: ' + timeAgo(card.agent_ran_at)];
      if (card.last_exit_code !== null && card.last_exit_code !== undefined) {
        bits.push(card.last_exit_code === 0 ? '✓ ok' : `✗ exit ${card.last_exit_code}`);
      }
      if (card.last_duration != null) bits.push(fmtDuration(card.last_duration));
      const usage = [];
      if (card.last_cost != null) usage.push('$' + Number(card.last_cost).toFixed(card.last_cost < 1 ? 3 : 2));
      if (card.last_tokens != null) usage.push(fmtTokens(card.last_tokens) + ' tok');
      if (usage.length) bits.push(usage.join(' · '));
      lastRunEl.textContent = bits.join('  ·  ');
    } else {
      lastRunEl.textContent = '';
    }
  }
}

function updateMoveButtons(card, currentColTitle) {
  const moveSection = document.getElementById('card-move-actions');
  const moveButtons = document.getElementById('card-move-buttons');

  if (!card) { moveSection.style.display = 'none'; return; }

  const targets = board.columns.filter(c => c.title !== currentColTitle);
  if (targets.length === 0) { moveSection.style.display = 'none'; return; }

  moveSection.style.display = 'block';
  moveButtons.innerHTML = '';

  const blockers = unfinishedBlockersUI(card);

  targets.forEach(targetCol => {
    const btn = document.createElement('button');
    btn.className = 'card-move-btn';
    btn.textContent = `→ ${targetCol.title}`;
    // Block starting a card (move to In Progress) while it has unfinished blockers.
    if (targetCol.title === 'In Progress' && blockers.length) {
      btn.disabled = true;
      btn.style.opacity = '0.4';
      btn.style.cursor = 'not-allowed';
      btn.title = 'Blocked by: ' + blockers.map(c => c.title).join(', ');
      moveButtons.appendChild(btn);
      return;
    }
    btn.onclick = async () => {
      const tc = board.columns.find(c => c.id === targetCol.id);
      if (!tc) return;
      const sourceCol = board.columns.find(c => c.id === modalColId);
      if (!sourceCol) return;
      const cardIdx = sourceCol.cards.findIndex(c => c.id === card.id);
      if (cardIdx === -1) return;
      const [movedCard] = sourceCol.cards.splice(cardIdx, 1);
      tc.cards.push(movedCard);
      renderBoard(board);
      closeCardModal();
      await postBoard();
      const spawnsAgent = card.agent && (targetCol.title === 'In Progress' || targetCol.title === 'Review');
      if (spawnsAgent) {
        showToast(`⚡ Starting ${AGENT_LABELS[card.agent] || card.agent} on "${card.title || card.text}"`, 4000);
        try { await fetch(`/api/cards/${card.id}/run`, { method: 'POST' }); }
        catch (err) { showToast('Failed to start agent: ' + err.message, 3000, 'error'); }
      } else {
        showToast(`Moved to ${targetCol.title}`);
      }
    };
    moveButtons.appendChild(btn);
  });
}

function updatePromptBox(card) {
  const promptSection = document.getElementById('card-prompt-section');
  const promptText = document.getElementById('card-modal-prompt-text');
  if (!card.agent) {
    promptSection.style.display = 'none';
  } else {
    const col = board.columns.find(c => c.id === modalColId);
    const desc = card.description ? `\nDescription: ${card.description}` : '';
    const tags = (card.tags||[]).length ? `\nTags: ${card.tags.join(', ')}` : '';
    
    let columnContext = '';
    const colTitle = col?.title || '';
    const needsReview = !!card.requires_review;
    if (colTitle === 'In Progress') {
      const nextStep = needsReview
        ? '- When implementation is complete and all changes are committed, call move_card to move to Review'
        : '- This card does NOT require review — when done, commit all changes, then call complete_card to move directly to Done (skip Review)';
      columnContext = `\nYou are in the IN PROGRESS phase. Your job is to:
- Call get_board first to see the full board state
- Plan and implement the feature/fix
- Write code and make changes in the project directory
- Commit ALL changes with git before moving columns: run \`git add -A && git commit -m "...\"\`
- Use add_card_note to log progress, decisions, and blockers
${nextStep}

IMPORTANT: Do NOT call move_card or complete_card until you have committed your changes with git commit.`;
    } else if (colTitle === 'Review') {
      columnContext = `\nYou are in the REVIEW phase. Your job is to:
- Call get_board first to see the full board state
- Review all code changes made in In Progress
- Run tests and verify functionality works as expected
- Check for bugs, edge cases, or issues
- Add notes about what you found using add_card_note
- If issues found: commit any fixes, then call move_card to move back to In Progress
- If everything looks good: ensure all changes are committed, then call complete_card to mark as Done

IMPORTANT: Always commit any fixes before moving columns.`;
    } else if (colTitle === 'Done') {
      columnContext = `\nThis card is DONE. The work is complete.
- All changes should already be committed
- The user will manually merge or create a PR
- You may add a final summary note with add_card_note if helpful`;
    } else {
      columnContext = `\nCurrent column: ${colTitle}`;
    }

    promptText.value = `You have a task on VibeBoard.

Card: "${card.title||card.text}"${desc}${tags}${columnContext}
Card ID: ${card.id}
Workspace ID: ${activeWsId||''}

Column workflow:
- Backlog → not started
- In Progress → actively implementing (must commit before moving)
- Review → testing and verification (must commit fixes before moving)
- Done → complete, ready for manual merge/PR

Git rule: ALWAYS run \`git add -A && git commit\` before calling move_card or complete_card.
This ensures your work is never lost when the card changes state.${card.custom_prompt ? '\n\nAdditional instructions from the user:\n' + card.custom_prompt : ''}`;
    promptSection.style.display = 'block';
  }
}

function showChangesSection(card) {
  const section  = document.getElementById('card-changes-section');
  const actions  = document.getElementById('card-merge-actions');
  const badge    = document.getElementById('card-branch-badge');
  const meta     = document.getElementById('card-changes-meta');
  const diffView = document.getElementById('card-diff-view');
  const toggleBtn = document.getElementById('card-diff-toggle');

  if (!card.branch) {
    section.style.display = 'none';
    return;
  }

  document.getElementById('card-activity-divider').style.display = '';
  section.style.display = 'block';
  const inDone = board.columns.find(c => c.id === modalColId)?.title === 'Done';
  actions.style.display = inDone ? 'flex' : 'none';
  const mergeBtn = document.getElementById('card-merge-btn');
  const prBtn    = document.getElementById('card-pr-btn');
  mergeBtn.disabled = true; mergeBtn.title = 'No commits on this branch yet';
  prBtn.disabled    = true; prBtn.title    = 'No commits on this branch yet';
  badge.textContent = card.branch;
  meta.textContent = '';
  diffView.style.display = 'none';
  diffView.innerHTML = '';
  toggleBtn.textContent = 'Show diff';
  toggleBtn._diffData = null;

  fetch(`/api/cards/${card.id}/diff`)
    .then(r => r.json())
    .then(data => {
      const count = data.commits ? data.commits.split('\n').filter(Boolean).length : 0;
      meta.textContent = count ? `${count} commit${count > 1 ? 's' : ''}` : 'no commits yet';
      toggleBtn._diffData = data;
      const hasCommits = count > 0;
      const mb = document.getElementById('card-merge-btn');
      const pb = document.getElementById('card-pr-btn');
      mb.disabled = !hasCommits; mb.title = hasCommits ? '' : 'No commits on this branch yet';
      pb.disabled = !hasCommits; pb.title = hasCommits ? '' : 'No commits on this branch yet';
    })
    .catch(() => { meta.textContent = ''; });
}

function saveModal(card) {
  card.title = cardModalTitleEl.value.trim() || card.title;
  renderBoard(board); postBoard();
}

cardModalTitleEl.addEventListener('input', () => {
  const col = board.columns.find(c=>c.id===modalColId);
  const card = col?.cards.find(c=>c.id===modalCardId);
  if (card) { card.title = cardModalTitleEl.value; updatePromptBox(card); }
});
cardModalTitleEl.addEventListener('change', () => saveModal(board.columns.find(c=>c.id===modalColId)?.cards.find(c=>c.id===modalCardId)));
cardModalDesc.addEventListener('input', () => {
  const col = board.columns.find(c=>c.id===modalColId);
  const card = col?.cards.find(c=>c.id===modalCardId);
  if (card) { card.description = cardModalDesc.value; updatePromptBox(card); }
});
cardModalDesc.addEventListener('change', () => saveModal(board.columns.find(c=>c.id===modalColId)?.cards.find(c=>c.id===modalCardId)));

cardModalClose.addEventListener('click', closeCardModal);

// Resize handle for card sidebar
const resizeHandle = document.getElementById('card-sidebar-resize-handle');
let isResizing = false;
let startX = 0;
let startWidth = 0;

const CARD_SIDEBAR_MIN_WIDTH = 400;
const CARD_SIDEBAR_MAX_WIDTH = 800;
const CARD_SIDEBAR_DEFAULT_WIDTH = 480;

// Load saved width from localStorage
const savedWidth = localStorage.getItem('vb_card_sidebar_width');
if (savedWidth) {
  const width = parseInt(savedWidth, 10);
  if (width >= CARD_SIDEBAR_MIN_WIDTH && width <= CARD_SIDEBAR_MAX_WIDTH) {
    cardSidebar.style.width = width + 'px';
  }
}

resizeHandle.addEventListener('mousedown', (e) => {
  isResizing = true;
  startX = e.clientX;
  startWidth = cardSidebar.offsetWidth;
  document.body.style.cursor = 'ew-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const deltaX = startX - e.clientX;
  const newWidth = Math.max(CARD_SIDEBAR_MIN_WIDTH, Math.min(CARD_SIDEBAR_MAX_WIDTH, startWidth + deltaX));
  cardSidebar.style.width = newWidth + 'px';
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem('vb_card_sidebar_width', cardSidebar.offsetWidth);
  }
});

function closeCardModal() {
  document.getElementById('card-prompt-section').style.display = 'none';
  document.getElementById('card-agent-run-section').style.display = 'none';
  document.getElementById('card-review-toggle-row').style.display = 'none';
  document.getElementById('card-custom-prompt-section').style.display = 'none';
  document.getElementById('card-duplicate-btn').style.display = 'none';
  document.getElementById('card-move-actions').style.display = 'none';
  document.getElementById('card-modal-branch-badge').style.display = 'none';
  document.getElementById('card-merge-actions').style.display = 'none';
  document.getElementById('card-changes-section').style.display = 'none';
  document.getElementById('card-activity-divider').style.display = 'none';
  document.getElementById('card-notes-section').style.display = 'none';
  const outToggle = document.getElementById('card-output-toggle');
  if (outToggle) { outToggle.style.display = 'none'; outToggle.textContent = 'Show full output'; }
  document.getElementById('card-output-section').style.display = 'none';
  document.getElementById('card-output-content').textContent = '';
  document.getElementById('card-sidebar-footer').classList.remove('visible');
  newCardColId = null;
  cardSidebar.classList.remove('open');
  modalCardId = null;
  modalColId = null;
}

cardModalCopyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(cardModalPromptTxt.value).then(() => {
    cardModalCopyBtn.textContent = 'Copied!'; cardModalCopyBtn.classList.add('copied');
    setTimeout(() => { cardModalCopyBtn.textContent = 'Copy'; cardModalCopyBtn.classList.remove('copied'); }, 2000);
  });
});

// ── Diff toggle ────────────────────────────────────────────────────────────
document.getElementById('card-diff-toggle').addEventListener('click', async function() {
  const diffView = document.getElementById('card-diff-view');
  if (diffView.style.display !== 'none') {
    diffView.style.display = 'none'; this.textContent = 'Show diff'; return;
  }
  if (!this._diffData) {
    this.textContent = 'Loading…';
    try {
      this._diffData = await fetch(`/api/cards/${modalCardId}/diff`).then(r => r.json());
    } catch(_) { this.textContent = 'Show diff'; return; }
  }
  const data = this._diffData;
  diffView.innerHTML = '';
  if (!data.diff) {
    const empty = document.createElement('div'); empty.className = 'diff-empty';
    empty.textContent = 'No changes yet.'; diffView.appendChild(empty);
  } else {
    const wrap = document.createElement('div'); wrap.className = 'diff-view';
    data.diff.split('\n').forEach(line => {
      const el = document.createElement('span'); el.className = 'diff-line';
      if (line.startsWith('+') && !line.startsWith('+++'))      el.classList.add('add');
      else if (line.startsWith('-') && !line.startsWith('---')) el.classList.add('del');
      else if (line.startsWith('@@'))                           el.classList.add('hunk');
      else if (/^(diff |index |--- |\+\+\+ )/.test(line))      el.classList.add('meta');
      el.textContent = line || ' ';
      wrap.appendChild(el);
    });
    diffView.appendChild(wrap);
  }
  diffView.style.display = 'block'; this.textContent = 'Hide diff';
});

// ── Run agent ──────────────────────────────────────────────────────────────
document.getElementById('card-run-agent-btn').addEventListener('click', async function() {
  if (!modalCardId) return;
  this.disabled = true; this.textContent = 'Starting…';
  const toggle = document.getElementById('card-output-toggle');
  const outputPre = document.getElementById('card-output-content');
  outputPre.textContent = '';
  try {
    const resp = await fetch(`/api/cards/${modalCardId}/run`, { method: 'POST' });
    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      try { const d = await resp.json(); msg = d.error || msg; } catch(_) { msg = await resp.text().catch(() => msg); }
      throw new Error(msg);
    }
    await resp.json();
    this.textContent = 'Running…';
    if (toggle) {
      toggle.style.display = 'inline-block';
      toggle.textContent = 'Show full output';
    }
  } catch(err) {
    this.disabled = false; this.textContent = 'Run agent';
    showToast('Failed to run agent: ' + err.message, 3000, 'error');
  }
});

document.getElementById('card-stop-agent-btn').addEventListener('click', async function() {
  if (!modalCardId) return;
  this.disabled = true; this.textContent = 'Stopping…';
  try {
    const resp = await fetch(`/api/cards/${modalCardId}/stop`, { method: 'POST' });
    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      try { const d = await resp.json(); msg = d.error || msg; } catch(_) {}
      throw new Error(msg);
    }
  } catch(err) {
    this.disabled = false; this.textContent = 'Stop agent';
    showToast('Failed to stop agent: ' + err.message, 3000, 'error');
  }
});

// ── Merge ──────────────────────────────────────────────────────────────────
document.getElementById('card-merge-btn').addEventListener('click', async function() {
  if (!modalCardId) return;
  this.disabled = true; this.textContent = 'Merging…';
  try {
    const resp = await fetch(`/api/cards/${modalCardId}/merge`, { method: 'POST' });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Merge failed');
    showToast('Merged successfully', 3000, 'success');
    closeCardModal();
  } catch(err) {
    showToast('Merge failed: ' + err.message, 3000, 'error');
    this.disabled = false; this.textContent = 'Merge';
  }
});

// ── Create PR ──────────────────────────────────────────────────────────────
document.getElementById('card-pr-btn').addEventListener('click', async function() {
  if (!modalCardId) return;
  this.disabled = true; this.textContent = 'Creating…';
  try {
    const resp = await fetch(`/api/cards/${modalCardId}/pr`, { method: 'POST' });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'PR creation failed');
    showToast('PR created: ' + data.url, 3000, 'success');
    if (data.url?.startsWith('http')) window.open(data.url, '_blank');
  } catch(err) {
    showToast('PR failed: ' + err.message, 3000, 'error');
  }
  this.disabled = false; this.textContent = 'Create PR';
});
