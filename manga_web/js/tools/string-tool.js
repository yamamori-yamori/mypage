// ME.Tools.String.create(canvas, project, selection, commandStack, renderEngine) — 文字列ツール（旧互換）
// クリック → 入力ダイアログ表示 → ENTERで確定 → StringObject生成
// ESCでキャンセル

window.ME = window.ME || {};
window.ME.Tools = window.ME.Tools || {};

(function() {
  'use strict';

  var INPUT_DIALOG_HTML =
    '<div style="margin-bottom:8px;color:#555;">文字列を入力（ENTERで確定、ESCでキャンセル）</div>' +
    '<textarea id="string-input-text" rows="3" cols="40" placeholder="文字列を入力..." ' +
    'style="width:100%;min-width:280px;resize:none;font-size:16px;padding:6px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;text-align:left;direction:ltr;"></textarea>';

  function create(canvas, project, selection, commandStack, renderEngine) {
    var isInputting = false;
    var inputX = 0, inputY = 0;
    var dialogEl = null;
    var textAreaEl = null;
    var onClickHandler = null;
    var onKeyHandler = null;
    var outsideClickTimer = null;
    // ダイアログを開いた同一ジェスチャ(mousedown→click)の外側クリックを無視する
    var ignoreOutsideClicksUntil = 0;

    function getMouse(e) {
      return ME.Render.Engine.getPagePoint(canvas, e);
    }

    function removeOutsideListeners() {
      if (outsideClickTimer != null) {
        clearTimeout(outsideClickTimer);
        outsideClickTimer = null;
      }
      if (onClickHandler) {
        document.removeEventListener('click', onClickHandler, true);
        document.removeEventListener('mousedown', onClickHandler, true);
        onClickHandler = null;
      }
      if (onKeyHandler) {
        document.removeEventListener('keydown', onKeyHandler, true);
        onKeyHandler = null;
      }
    }

    function showInputDialog(mx, my) {
      if (isInputting && dialogEl) {
        hideInputDialog();
      }

      isInputting = true;
      inputX = mx;
      inputY = my;
      // この mousedown に続く mouseup/click が document まで届いても閉じない
      ignoreOutsideClicksUntil = Date.now() + 300;

      dialogEl = document.createElement('div');
      dialogEl.id = 'string-input-dialog';
      dialogEl.style.cssText =
        'position:fixed;z-index:10000;' +
        'background:#fff;border:2px solid #888;border-radius:6px;padding:12px;' +
        'box-shadow:0 4px 12px rgba(0,0,0,0.3);font-family:sans-serif;font-size:14px;';
      dialogEl.innerHTML = INPUT_DIALOG_HTML;
      dialogEl.style.left = Math.min(mx, window.innerWidth - 320) + 'px';
      dialogEl.style.top = Math.min(my, window.innerHeight - 150) + 'px';

      // ESCでキャンセル / ENTERで確定（IME変換中は無視）
      onKeyHandler = function(e) {
        if (!isInputting) return;
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          hideInputDialog();
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          commitInput();
        }
      };
      document.addEventListener('keydown', onKeyHandler, true);

      // 外部クリックで閉じる（capture）。開いた直後の同一ジェスチャは無視。
      onClickHandler = function(e) {
        if (!isInputting || !dialogEl) return;
        if (Date.now() < ignoreOutsideClicksUntil) return;
        if (dialogEl.contains(e.target)) return;
        hideInputDialog();
      };

      // dialog 内操作は document まで伝播させない
      dialogEl.addEventListener('mousedown', function(e) { e.stopPropagation(); });
      dialogEl.addEventListener('click', function(e) { e.stopPropagation(); });
      dialogEl.addEventListener('pointerdown', function(e) { e.stopPropagation(); });

      document.body.appendChild(dialogEl);

      // 現在の click サイクルが終わってから外側検知を登録
      outsideClickTimer = setTimeout(function() {
        outsideClickTimer = null;
        if (!isInputting || !dialogEl) return;
        document.addEventListener('mousedown', onClickHandler, true);
        document.addEventListener('click', onClickHandler, true);
      }, 0);

      textAreaEl = dialogEl.querySelector('#string-input-text') ||
                   dialogEl.querySelector('textarea');
      if (textAreaEl) {
        // focus も次フレームで確実に当てる（キャレットは左端）
        setTimeout(function() {
          if (textAreaEl) {
            textAreaEl.focus();
            if (textAreaEl.setSelectionRange) {
              textAreaEl.setSelectionRange(0, 0);
            }
          }
        }, 0);
      }
    }

    function hideInputDialog() {
      isInputting = false;
      removeOutsideListeners();
      if (dialogEl && dialogEl.parentNode) {
        dialogEl.parentNode.removeChild(dialogEl);
      }
      dialogEl = null;
      textAreaEl = null;
    }

    function commitInput() {
      var content = '';
      if (textAreaEl) {
        content = textAreaEl.value.trim();
      }

      if (!content) {
        hideInputDialog();
        return;
      }

      var transform = ME.Core.Models.createTransform({ x: inputX, y: inputY });
      var stringObj = ME.SceneGraph.addString(project, content, transform);
      commandStack.push(new ME.Commands.AddObject(stringObj));

      hideInputDialog();
      renderEngine.setDirty();
    }

    function onMouseDown(e) {
      if (isInputting) return;

      var m = getMouse(e);

      // 既存のstringオブジェクトがクリックされたか判定（Shift+クリックで選択）
      if (e.shiftKey) {
        var hits = selection.hitTest(m.x, m.y, project);
        for (var i = 0; i < hits.length; i++) {
          var obj = ME.SceneGraph.getObjectById(project, hits[i]);
          if (obj && obj.type === 'string') {
            selection.selectOnly(hits[i]);
            renderEngine.renderNow();
            return;
          }
        }
      }

      // 空白クリック → 入力ダイアログ表示
      showInputDialog(m.x, m.y);
    }

    function disable() {
      hideInputDialog();
      canvas.removeEventListener('mousedown', onMouseDown);
    }

    canvas.addEventListener('mousedown', onMouseDown);

    return {
      disable: disable
    };
  }

  window.ME.Tools.String = { create: create };
})();
