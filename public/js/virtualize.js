'use strict';

const VIRTUALIZE_THRESHOLD = 100;
const VIEWPORT_BUFFER = 300;
const ESTIMATED_CARD_HEIGHT = 120;
const MIN_RENDER_COUNT = 20;

const virtualizedColumns = new Map();
let dragInProgress = false;

function virtualizeColumn(colEl, cards) {
  const colId = colEl.dataset.colId;
  const cardsList = colEl.querySelector('.cards-list');
  if (!cardsList) return;

  const oldState = virtualizedColumns.get(colId);
  if (oldState) {
    destroyVirtualization(colId);
  }

  if (cards.length < VIRTUALIZE_THRESHOLD) {
    cards.forEach(card => cardsList.appendChild(buildCard(card, colId)));
    return;
  }

  const state = {
    colId,
    cardsList,
    cards,
    visibleRange: { start: 0, end: 0 },
    cardHeights: new Array(cards.length).fill(ESTIMATED_CARD_HEIGHT),
    spacerTop: null,
    spacerBottom: null,
    renderedCards: new Map(),
    scrollListener: null,
    searchActive: false,
  };
  virtualizedColumns.set(colId, state);

  state.spacerTop = document.createElement('div');
  state.spacerTop.className = 'virtual-spacer-top';
  state.spacerTop.style.height = '0px';
  cardsList.insertBefore(state.spacerTop, cardsList.firstChild);

  state.spacerBottom = document.createElement('div');
  state.spacerBottom.className = 'virtual-spacer-bottom';
  state.spacerBottom.style.height = '0px';
  cardsList.appendChild(state.spacerBottom);

  state.scrollListener = () => updateVisibleRange(state);
  cardsList.addEventListener('scroll', state.scrollListener, { passive: true });

  if (dragInProgress) {
    const frag = document.createDocumentFragment();
    cards.forEach(card => frag.appendChild(buildCard(card, colId)));
    cardsList.insertBefore(frag, state.spacerBottom);
    state.visibleRange = { start: 0, end: cards.length };
    cards.forEach(card => {
      const el = cardsList.querySelector(`[data-card-id="${card.id}"]`);
      if (el) state.renderedCards.set(card.id, el);
    });
  } else {
    updateVisibleRange(state);
  }
}

function updateVisibleRange(state) {
  if (dragInProgress || state.searchActive) return;

  const { cardsList, cards, cardHeights } = state;
  const scrollTop = cardsList.scrollTop;
  const viewportHeight = cardsList.clientHeight;

  const viewTop = Math.max(0, scrollTop - VIEWPORT_BUFFER);
  const viewBottom = scrollTop + viewportHeight + VIEWPORT_BUFFER;

  let start = cards.length;
  let acc = 0;
  for (let i = 0; i < cards.length; i++) {
    const h = cardHeights[i] || ESTIMATED_CARD_HEIGHT;
    acc += h;
    if (acc > viewTop) {
      start = i;
      break;
    }
  }
  if (start === cards.length) start = Math.max(0, cards.length - 1);

  let end = 0;
  acc = 0;
  for (let i = 0; i < cards.length; i++) {
    const h = cardHeights[i] || ESTIMATED_CARD_HEIGHT;
    if (acc > viewBottom) break;
    end = i;
    acc += h;
  }
  end = Math.min(end + 1, cards.length);

  const count = end - start;
  if (count < MIN_RENDER_COUNT && cards.length > MIN_RENDER_COUNT) {
    const deficit = MIN_RENDER_COUNT - count;
    const addBefore = Math.min(deficit, start);
    start -= addBefore;
    end = Math.min(cards.length, end + Math.min(deficit - addBefore, cards.length - end));
  }

  start = Math.max(0, start);
  end = Math.min(cards.length, end);

  if (start === state.visibleRange.start && end === state.visibleRange.end) return;

  state.visibleRange = { start, end };
  renderVisibleCards(state);
}

function renderVisibleCards(state) {
  const { cardsList, cards, visibleRange, spacerTop, spacerBottom, renderedCards, colId, cardHeights } = state;
  const { start, end } = visibleRange;

  // Remove all card elements currently between the spacers
  let child = spacerTop.nextSibling;
  while (child && child !== spacerBottom) {
    const next = child.nextSibling;
    child.remove();
    child = next;
  }

  // Build the correct set of cards in order
  const fragment = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    const card = cards[i];
    var existingEl = renderedCards.get(card.id);
    if (existingEl && !existingEl.isConnected) existingEl = null;
    fragment.appendChild(existingEl || buildCard(card, colId));
  }

  cardsList.insertBefore(fragment, spacerBottom);

  // Measure actual heights
  const newRendered = new Map();
  for (let i = start; i < end; i++) {
    const card = cards[i];
    const el = fragment.children[i - start];
    newRendered.set(card.id, el);
    if (el && el.isConnected) {
      const h = el.offsetHeight;
      if (h > 0) cardHeights[i] = h;
    }
  }

  // Compute spacer heights from accumulated actual heights
  let topHeight = 0;
  for (let i = 0; i < start; i++) {
    topHeight += cardHeights[i];
  }
  let bottomHeight = 0;
  for (let i = end; i < cards.length; i++) {
    bottomHeight += cardHeights[i];
  }

  spacerTop.style.height = topHeight + 'px';
  spacerBottom.style.height = bottomHeight + 'px';

  state.renderedCards = newRendered;
}

function destroyVirtualization(colId) {
  const state = virtualizedColumns.get(colId);
  if (!state) return;

  if (state.scrollListener) {
    try { state.cardsList.removeEventListener('scroll', state.scrollListener); } catch (_) {}
  }
  if (state.spacerTop && state.spacerTop.parentNode) {
    state.spacerTop.remove();
  }
  if (state.spacerBottom && state.spacerBottom.parentNode) {
    state.spacerBottom.remove();
  }

  virtualizedColumns.delete(colId);
}

function isColumnVirtualized(colId) {
  return virtualizedColumns.has(colId);
}

function getVirtualizedState(colId) {
  return virtualizedColumns.get(colId) || null;
}

function temporarilyRenderAllCards(colId) {
  const state = virtualizedColumns.get(colId);
  if (!state) return;

  const { cardsList, cards, spacerTop, spacerBottom } = state;

  spacerTop.style.height = '0px';
  spacerBottom.style.height = '0px';

  const fragment = document.createDocumentFragment();
  cards.forEach(card => {
    if (!state.renderedCards.has(card.id) && !cardsList.querySelector(`[data-card-id="${card.id}"]`)) {
      fragment.appendChild(buildCard(card, state.colId));
    }
  });

  if (fragment.children.length > 0) {
    cardsList.insertBefore(fragment, spacerBottom);
  }

  cards.forEach(card => {
    const el = cardsList.querySelector(`[data-card-id="${card.id}"]`);
    if (el) state.renderedCards.set(card.id, el);
  });

  state.visibleRange = { start: 0, end: cards.length };
}

function restoreVirtualization(colId) {
  const state = virtualizedColumns.get(colId);
  if (!state) return;
  updateVisibleRange(state);
}

function notifyDragStart() {
  dragInProgress = true;
  virtualizedColumns.forEach((_, colId) => {
    temporarilyRenderAllCards(colId);
  });
}

function notifyDragEnd() {
  dragInProgress = false;
  virtualizedColumns.forEach((state) => {
    if (!state.cardsList.isConnected) return;
    restoreVirtualization(state.colId);
  });
}
