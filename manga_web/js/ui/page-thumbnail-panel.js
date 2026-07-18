// ME.UI.PageThumbnailPanel.create() — ページ一覧オーバーレイ
// ME.UI.PageThumbnailPanel.open(handlers) / close() / isOpen() / refresh()
// handlers:
//   getState: () => { pages:[{id,label}], currentIndex, count }
//   onSelect(index), onAdd(mode?), onRemove(index), onReorder(from,to)
//   onClearAllDrafts?(), renderThumb?(canvas, index)
//   getInsertMode?() → 'blank'|'backing'|'copy'
//   onInsertModeChange?(mode)
// 追加モード: 白紙 / 前ページと同じ台紙 / 前ページのコピー

window.ME = window.ME || {};
window.ME.UI = window.ME.UI || {};
window.ME.UI.PageThumbnailPanel = window.ME.UI.PageThumbnailPanel || {};

(function() {
  'use strict';

  var overlayEl = null;
  var listEl = null;
  var handlers = null;
  var dragFrom = -1;
  var localInsertMode = 'blank';

  function normalizeMode(m) {
    if (m === 'backing' || m === 'copy' || m === 'blank') return m;
    return 'blank';
  }

  function currentInsertMode() {
    if (handlers && typeof handlers.getInsertMode === 'function') {
      return normalizeMode(handlers.getInsertMode());
    }
    return normalizeMode(localInsertMode);
  }

  function setInsertMode(mode) {
    mode = normalizeMode(mode);
    localInsertMode = mode;
    if (handlers && typeof handlers.onInsertModeChange === 'function') {
      handlers.onInsertModeChange(mode);
    }
  }

  function isOpen() {
    return !!(overlayEl && overlayEl.parentNode);
  }

  function close() {
    if (overlayEl && overlayEl.parentNode) {
      overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;
    listEl = null;
    dragFrom = -1;
  }

  function open(h) {
    handlers = h || handlers || {};
    if (handlers.getInsertMode) {
      localInsertMode = normalizeMode(handlers.getInsertMode());
    }
    close();

    overlayEl = document.createElement('div');
    overlayEl.className = 'page-thumb-overlay';

    var panel = document.createElement('div');
    panel.className = 'page-thumb-panel';
    panel.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    panel.addEventListener('click', function(e) { e.stopPropagation(); });

    var header = document.createElement('div');
    header.className = 'page-thumb-header';
    var title = document.createElement('div');
    title.className = 'page-thumb-title';
    title.textContent = 'ページ一覧';
    header.appendChild(title);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'page-thumb-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', close);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    listEl = document.createElement('div');
    listEl.className = 'page-thumb-list';
    panel.appendChild(listEl);

    var footer = document.createElement('div');
    footer.className = 'page-thumb-footer';

    // 追加時の内容設定
    var modeBox = document.createElement('div');
    modeBox.className = 'page-thumb-insert-mode';
    var modeLabel = document.createElement('div');
    modeLabel.className = 'page-thumb-insert-mode-label';
    modeLabel.textContent = '追加時の内容（基準=現在のページ）';
    modeBox.appendChild(modeLabel);

    var modes = [
      { value: 'blank', text: '白紙' },
      { value: 'backing', text: '前ページと同じ台紙' },
      { value: 'copy', text: '前ページのコピー' }
    ];
    var modeGroupName = 'page-insert-mode-' + String(Date.now());
    var curMode = currentInsertMode();
    for (var mi = 0; mi < modes.length; mi++) {
      (function(m) {
        var row = document.createElement('label');
        row.className = 'page-thumb-insert-option';
        var radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = modeGroupName;
        radio.value = m.value;
        radio.checked = (curMode === m.value);
        radio.addEventListener('change', function() {
          if (radio.checked) setInsertMode(m.value);
        });
        row.appendChild(radio);
        var span = document.createElement('span');
        span.textContent = m.text;
        row.appendChild(span);
        modeBox.appendChild(row);
      })(modes[mi]);
    }
    footer.appendChild(modeBox);

    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'page-thumb-btn';
    addBtn.textContent = 'ページを追加';
    addBtn.addEventListener('click', function() {
      var mode = currentInsertMode();
      if (handlers.onAdd) handlers.onAdd(mode);
      refresh();
    });
    footer.appendChild(addBtn);

    var clearDraftsBtn = document.createElement('button');
    clearDraftsBtn.type = 'button';
    clearDraftsBtn.className = 'page-thumb-btn page-thumb-btn-muted';
    clearDraftsBtn.textContent = '全ページの下書きを削除';
    clearDraftsBtn.disabled = false;
    clearDraftsBtn.addEventListener('click', function() {
      if (handlers.onClearAllDrafts) handlers.onClearAllDrafts();
    });
    footer.appendChild(clearDraftsBtn);

    var clearMemosBtn = document.createElement('button');
    clearMemosBtn.type = 'button';
    clearMemosBtn.className = 'page-thumb-btn page-thumb-btn-muted';
    clearMemosBtn.textContent = '全ページのメモを削除';
    clearMemosBtn.addEventListener('click', function() {
      if (handlers.onClearAllMemos) handlers.onClearAllMemos();
    });
    footer.appendChild(clearMemosBtn);

    panel.appendChild(footer);
    overlayEl.appendChild(panel);

    overlayEl.addEventListener('mousedown', function(e) {
      if (e.target === overlayEl) close();
    });

    document.body.appendChild(overlayEl);
    refresh();
  }

  function drawPlaceholder(canvas, index) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var w = canvas.width;
    var h = canvas.height;
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ccc';
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.fillStyle = '#666';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), w / 2, h / 2);
  }

  function refresh() {
    if (!listEl || !handlers || typeof handlers.getState !== 'function') return;
    var st = handlers.getState() || { pages: [], currentIndex: 0, count: 0 };
    var pages = st.pages || [];
    var currentIndex = st.currentIndex | 0;
    listEl.innerHTML = '';

    for (var i = 0; i < pages.length; i++) {
      (function(index) {
        var item = document.createElement('div');
        item.className = 'page-thumb-item' + (index === currentIndex ? ' is-current' : '');
        item.draggable = true;
        item.dataset.index = String(index);

        var canvas = document.createElement('canvas');
        canvas.width = 90;
        canvas.height = 128;
        canvas.className = 'page-thumb-canvas';
        if (handlers.renderThumb) {
          try { handlers.renderThumb(canvas, index); }
          catch (err) { drawPlaceholder(canvas, index); }
        } else {
          drawPlaceholder(canvas, index);
        }
        item.appendChild(canvas);

        var label = document.createElement('div');
        label.className = 'page-thumb-label';
        label.textContent = (pages[index] && pages[index].label) || ('P' + (index + 1));
        item.appendChild(label);

        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'page-thumb-del';
        del.textContent = '削除';
        del.disabled = pages.length <= 1;
        del.addEventListener('click', function(e) {
          e.stopPropagation();
          if (handlers.onRemove) handlers.onRemove(index);
        });
        item.appendChild(del);

        item.addEventListener('click', function() {
          if (handlers.onSelect) handlers.onSelect(index);
          close();
        });

        item.addEventListener('dragstart', function(e) {
          dragFrom = index;
          item.classList.add('is-dragging');
          try { e.dataTransfer.setData('text/plain', String(index)); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
        });
        item.addEventListener('dragend', function() {
          dragFrom = -1;
          item.classList.remove('is-dragging');
        });
        item.addEventListener('dragover', function(e) {
          e.preventDefault();
          item.classList.add('is-drop-target');
        });
        item.addEventListener('dragleave', function() {
          item.classList.remove('is-drop-target');
        });
        item.addEventListener('drop', function(e) {
          e.preventDefault();
          item.classList.remove('is-drop-target');
          var from = dragFrom;
          var to = index;
          if (from < 0 || from === to) return;
          if (handlers.onReorder) handlers.onReorder(from, to);
          refresh();
        });

        listEl.appendChild(item);
      })(i);
    }
  }

  window.ME.UI.PageThumbnailPanel.open = open;
  window.ME.UI.PageThumbnailPanel.close = close;
  window.ME.UI.PageThumbnailPanel.isOpen = isOpen;
  window.ME.UI.PageThumbnailPanel.refresh = refresh;
})();
