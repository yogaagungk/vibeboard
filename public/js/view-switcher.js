'use strict';

let currentView = 'board';

function initViewSwitcher() {
  const viewTabs = document.querySelectorAll('.view-tab');
  const boardWrap = document.getElementById('board-wrap');
  const timelineWrap = document.getElementById('timeline-wrap');

  viewTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.view;
      if (view === currentView) return;

      currentView = view;

      viewTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      if (view === 'board') {
        boardWrap.style.display = 'flex';
        timelineWrap.style.display = 'none';
      } else if (view === 'timeline') {
        boardWrap.style.display = 'none';
        timelineWrap.style.display = 'flex';
        if (board) renderTimeline(board);
      }
    });
  });
}
