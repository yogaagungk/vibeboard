'use strict';

const VIEWPORT_BUFFER = 200;
const ESTIMATED_CARD_HEIGHT = 120;
const RENDER_BATCH_SIZE = 20;

const virtualizedColumns = new Map();
let dragInProgress = false;

function virtualizeColumn(colEl, cards) {
  const colId = colEl.dataset.colId;
  const cardsList = colEl.querySelector('.cards-list');
  if (!cardsList) return;

  if (cards.length < 100) {
    if (virtualizedColumns.has(colId)) {
      destroyVirtualization(colId);
    }
    return;
  }

  let state = virtualizedColumns.get(colId);
  if (!state) {
    state = {
      colId,
      cardsList,
      cards: [],
      visibleRange: { start: 0, end: RENDER_BATCH_SIZE },
      observer: null,
      spacerTop: null,
      spacerBottom: null,
      renderedCards: new Map(),
      scrollListener: null,
      searchActive: false,
    };
    virtualizedColumns.set(colId, state);
  }

  state.cards = cards;

  if (!state.spacerTop) {
    state.spacerTop = document.createElement('div');
    state.spacerTop.className = 'virtual-spacer-top';
    state.spacerTop.style.height = '0px';
    cardsList.insertBefore(state.spacerTop, cardsList.firstChild);
  }

  if (!state.spacerBottom) {
    state.spacerBottom = document.createElement('div');
    state.spacerBottom.className = 'virtual-spacer-bottom';
    state.spacerBottom.style.height = '0px';
    cardsList.appendChild(state.spacerBottom);
  }

  if (!state.scrollListener) {
    state.scrollListener = () => updateVisibleRange(state);
    cardsList.addEventListener('scroll', state.scrollListener, { passive: true });
  }

  updateVisibleRange(state);
}

function updateVisibleRange(state) {
  if (dragInProgress || state.searchActive) return;
  
  const { cardsList, cards } = state;
  const scrollTop = cardsList.scrollTop;
  const viewportHeight = cardsList.clientHeight;

  const startIndex = Math.max(0, Math.floor((scrollTop - VIEWPORT_BUFFER) / ESTIMATED_CARD_HEIGHT));
  const endIndex = Math.min(cards.length, Math.ceil((scrollTop + viewportHeight + VIEWPORT_BUFFER) / ESTIMATED_CARD_HEIGHT) + 1);

  if (startIndex === state.visibleRange.start && endIndex === state.visibleRange.end) {
    return;
  }

  state.visibleRange = { start: startIndex, end: endIndex };
  renderVisibleCards(state);
}

function renderVisibleCards(state) {
  const { cardsList, cards, visibleRange, spacerTop, spacerBottom, renderedCards, colId } = state;

  const visibleCards = cards.slice(visibleRange.start, visibleRange.end);
  const newRendered = new Map();

  const fragment = document.createDocumentFragment();
  const existingCards = Array.from(cardsList.querySelectorAll('.card'));

  existingCards.forEach(el => {
    const cardId = el.dataset.cardId;
    const cardIndex = cards.findIndex(c => c.id === cardId);
    if (cardIndex >= visibleRange.start && cardIndex < visibleRange.end) {
      newRendered.set(cardId, el);
    } else {
      el.remove();
    }
  });

  visibleCards.forEach(card => {
    if (!newRendered.has(card.id)) {
      const cardEl = buildCard(card, colId);
      newRendered.set(card.id, cardEl);
      fragment.appendChild(cardEl);
    }
  });

  if (fragment.children.length > 0) {
    cardsList.insertBefore(fragment, spacerBottom);
  }

  const topHeight = visibleRange.start * ESTIMATED_CARD_HEIGHT;
  const bottomHeight = Math.max(0, (cards.length - visibleRange.end) * ESTIMATED_CARD_HEIGHT);

  spacerTop.style.height = topHeight + 'px';
  spacerBottom.style.height = bottomHeight + 'px';

  state.renderedCards = newRendered;
}

function destroyVirtualization(colId) {
  const state = virtualizedColumns.get(colId);
  if (!state) return;

  if (state.scrollListener) {
    state.cardsList.removeEventListener('scroll', state.scrollListener);
  }

  if (state.spacerTop) state.spacerTop.remove();
  if (state.spacerBottom) state.spacerBottom.remove();

  virtualizedColumns.delete(colId);
}

function isColumnVirtualized(colId) {
  return virtualizedColumns.has(colId);
}

function getVirtualizedState(colId) {
  return virtualizedColumns.get(colId);
}

function temporarilyRenderAllCards(colId) {
  const state = virtualizedColumns.get(colId);
  if (!state) return;

  dragInProgress = true;
  const { cardsList, cards, spacerTop, spacerBottom } = state;

  spacerTop.style.height = '0px';
  spacerBottom.style.height = '0px';

  const fragment = document.createDocumentFragment();
  cards.forEach(card => {
    if (!state.renderedCards.has(card.id)) {
      const cardEl = buildCard(card, colId);
      fragment.appendChild(cardEl);
    }
  });

  if (fragment.children.length > 0) {
    cardsList.insertBefore(fragment, spacerBottom);
  }

  state.visibleRange = { start: 0, end: cards.length };
}

function restoreVirtualization(colId) {
  dragInProgress = false;
  const state = virtualizedColumns.get(colId);
  if (!state) return;

  updateVisibleRange(state);
}

function notifyDragStart() {
  virtualizedColumns.forEach((state, colId) => {
    temporarilyRenderAllCards(colId);
  });
}

function notifyDragEnd() {
  virtualizedColumns.forEach((state, colId) => {
    restoreVirtualization(colId);
  });
}
