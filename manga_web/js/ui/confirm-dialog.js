// ME.UI.ConfirmDialog.show(opts) — モーダル確認
// opts: title, message, okLabel, cancelLabel, danger, onOK, onCancel
// ME.UI.ConfirmDialog.hide()

window.ME = window.ME || {};
window.ME.UI = window.ME.UI || {};
window.ME.UI.ConfirmDialog = window.ME.UI.ConfirmDialog || {};

(function() {
  'use strict';

  var overlayEl = null;
  var keyHandler = null;

  function hide() {
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler, true);
      keyHandler = null;
    }
    if (overlayEl && overlayEl.parentNode) {
      overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;
  }

  function show(opts) {
    opts = opts || {};
    hide();

    overlayEl = document.createElement('div');
    overlayEl.className = 'confirm-dialog-overlay';

    var box = document.createElement('div');
    box.className = 'confirm-dialog';
    if (opts.danger) box.className += ' confirm-dialog-danger';

    var title = document.createElement('div');
    title.className = 'confirm-dialog-title';
    title.textContent = opts.title || '確認';
    box.appendChild(title);

    var msg = document.createElement('div');
    msg.className = 'confirm-dialog-message';
    msg.textContent = opts.message || '';
    box.appendChild(msg);

    var actions = document.createElement('div');
    actions.className = 'confirm-dialog-actions';

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'confirm-dialog-btn';
    cancelBtn.textContent = opts.cancelLabel || 'キャンセル';
    cancelBtn.addEventListener('click', function() {
      hide();
      if (opts.onCancel) opts.onCancel();
    });
    actions.appendChild(cancelBtn);

    var okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'confirm-dialog-btn confirm-dialog-ok';
    if (opts.danger) okBtn.className += ' is-danger';
    okBtn.textContent = opts.okLabel || 'OK';
    okBtn.addEventListener('click', function() {
      hide();
      if (opts.onOK) opts.onOK();
    });
    actions.appendChild(okBtn);

    box.appendChild(actions);
    overlayEl.appendChild(box);

    overlayEl.addEventListener('mousedown', function(e) {
      if (e.target === overlayEl) {
        // 外側クリックはキャンセル扱い
        hide();
        if (opts.onCancel) opts.onCancel();
      }
    });

    keyHandler = function(e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        e.preventDefault();
        hide();
        if (opts.onCancel) opts.onCancel();
      } else if (e.key === 'Enter' || e.keyCode === 13) {
        if (e.isComposing || e.keyCode === 229) return;
        if (document.activeElement === cancelBtn) {
          e.preventDefault();
          hide();
          if (opts.onCancel) opts.onCancel();
          return;
        }
        e.preventDefault();
        hide();
        if (opts.onOK) opts.onOK();
      }
    };
    document.addEventListener('keydown', keyHandler, true);

    document.body.appendChild(overlayEl);
    // フォーカスを OK に
    setTimeout(function() {
      try { okBtn.focus(); } catch (err) {}
    }, 0);
  }

  window.ME.UI.ConfirmDialog.show = show;
  window.ME.UI.ConfirmDialog.hide = hide;
})();
