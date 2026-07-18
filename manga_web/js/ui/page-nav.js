// ME.UI.PageNav.create(containerEl, handlers) — 上部ページナビ（切替のみ）
// ME.UI.PageNav.update(state) — { index, count } 0-based index
// ME.UI.PageNav.refresh() — handlers.getState で再描画
// handlers: getState, onPrev, onNext, onOpenThumbnails
// ページ追加・削除はサムネ一覧（PageThumbnailPanel）側のみ

window.ME = window.ME || {};
window.ME.UI = window.ME.UI || {};
window.ME.UI.PageNav = window.ME.UI.PageNav || {};

(function() {
  'use strict';

  var rootEl = null;
  var labelEl = null;
  var prevBtn = null;
  var nextBtn = null;
  var thumbsBtn = null;
  var handlers = null;

  function create(containerEl, h) {
    if (!containerEl) return;
    handlers = h || {};
    containerEl.innerHTML = '';
    rootEl = containerEl;
    rootEl.className = (rootEl.className ? rootEl.className + ' ' : '') + 'page-nav';
    rootEl.setAttribute('role', 'navigation');
    rootEl.setAttribute('aria-label', 'ページ');

    prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'page-nav-btn';
    prevBtn.title = '前のページ ([)';
    prevBtn.textContent = '◀';
    prevBtn.addEventListener('click', function() {
      if (handlers.onPrev) handlers.onPrev();
    });
    rootEl.appendChild(prevBtn);

    labelEl = document.createElement('span');
    labelEl.className = 'page-nav-label';
    labelEl.textContent = '1/1';
    rootEl.appendChild(labelEl);

    nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'page-nav-btn';
    nextBtn.title = '次のページ (])';
    nextBtn.textContent = '▶';
    nextBtn.addEventListener('click', function() {
      if (handlers.onNext) handlers.onNext();
    });
    rootEl.appendChild(nextBtn);

    thumbsBtn = document.createElement('button');
    thumbsBtn.type = 'button';
    thumbsBtn.className = 'page-nav-btn page-nav-thumbs';
    thumbsBtn.title = 'ページ一覧';
    thumbsBtn.textContent = 'サムネ';
    thumbsBtn.addEventListener('click', function() {
      if (handlers.onOpenThumbnails) handlers.onOpenThumbnails();
    });
    rootEl.appendChild(thumbsBtn);

    refresh();
  }

  function update(state) {
    if (!labelEl || !state) return;
    var index = state.index | 0;
    var count = state.count | 0;
    if (count < 1) count = 1;
    if (index < 0) index = 0;
    if (index >= count) index = count - 1;
    labelEl.textContent = (index + 1) + '/' + count;
    if (prevBtn) prevBtn.disabled = (index <= 0);
    if (nextBtn) nextBtn.disabled = (index >= count - 1);
  }

  function refresh() {
    if (!handlers || typeof handlers.getState !== 'function') {
      update({ index: 0, count: 1 });
      return;
    }
    var st = handlers.getState() || { index: 0, count: 1 };
    update(st);
  }

  window.ME.UI.PageNav.create = create;
  window.ME.UI.PageNav.update = update;
  window.ME.UI.PageNav.refresh = refresh;
})();
