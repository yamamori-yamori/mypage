// ME.Tools.Memo.create(canvas, project, selection, commandStack, renderEngine)
// 校閲メモ: クリック→文字列 / ドラッグ→自由曲線（同一赤+白縁）
// Shift 中は描画せず（main の select に任せる）

window.ME = window.ME || {};
window.ME.Tools = window.ME.Tools || {};

(function() {
  'use strict';

  var CLICK_SLOP = 4;
  var POINT_MIN_DIST = 2;
  var DEF = (window.ME && ME.Core && ME.Core.MemoDefaults) || {};
  var MEMO_COLOR = DEF.COLOR || '#cc2222';
  var MEMO_WIDTH = DEF.WIDTH != null ? DEF.WIDTH : 2.5;
  var EDGE_COLOR = DEF.EDGE_COLOR || 'rgba(255,255,255,0.95)';
  var EDGE_EXTRA = DEF.EDGE_EXTRA != null ? DEF.EDGE_EXTRA : 2;

  var INPUT_DIALOG_HTML =
    '<div style="margin-bottom:8px;color:#555;">メモを入力（ENTERで確定、ESCでキャンセル）</div>' +
    '<textarea id="memo-string-input-text" rows="3" cols="40" placeholder="メモを入力..." ' +
    'style="width:100%;min-width:280px;resize:none;font-size:16px;padding:6px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;text-align:left;direction:ltr;"></textarea>';

  function create(canvas, project, selection, commandStack, renderEngine) {
    var isDown = false;
    var mode = null; // null | 'freehand'
    var startX = 0, startY = 0;
    var clientStartX = 0, clientStartY = 0;
    var absPoints = []; // ページ絶対座標（描画中）

    var isInputting = false;
    var inputX = 0, inputY = 0;
    var dialogEl = null;
    var textAreaEl = null;
    var onClickHandler = null;
    var onKeyHandler = null;
    var outsideClickTimer = null;
    var ignoreOutsideClicksUntil = 0;

    function getMouse(e) {
      return ME.Render.Engine.getPagePoint(canvas, e);
    }

    function dist(ax, ay, bx, by) {
      var dx = ax - bx, dy = ay - by;
      return Math.sqrt(dx * dx + dy * dy);
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

    function hideInputDialog() {
      isInputting = false;
      removeOutsideListeners();
      if (dialogEl && dialogEl.parentNode) {
        dialogEl.parentNode.removeChild(dialogEl);
      }
      dialogEl = null;
      textAreaEl = null;
    }

    function commitStringInput() {
      var content = '';
      if (textAreaEl) content = textAreaEl.value.trim();
      if (!content) {
        hideInputDialog();
        return;
      }
      var transform = ME.Core.Models.createTransform({ x: inputX, y: inputY });
      var memoObj = ME.SceneGraph.addMemo(project, 'string', { content: content }, transform);
      commandStack.push(new ME.Commands.AddMemo(memoObj));
      hideInputDialog();
      renderEngine.setDirty();
    }

    function showInputDialog(mx, my, clientX, clientY) {
      if (isInputting && dialogEl) hideInputDialog();
      isInputting = true;
      inputX = mx;
      inputY = my;
      ignoreOutsideClicksUntil = Date.now() + 300;

      var sx = (clientX != null) ? clientX : mx;
      var sy = (clientY != null) ? clientY : my;

      dialogEl = document.createElement('div');
      dialogEl.id = 'memo-string-input-dialog';
      dialogEl.style.cssText =
        'position:fixed;z-index:10000;' +
        'background:#fff;border:2px solid #888;border-radius:6px;padding:12px;' +
        'box-shadow:0 4px 12px rgba(0,0,0,0.3);font-family:sans-serif;font-size:14px;';
      dialogEl.innerHTML = INPUT_DIALOG_HTML;
      dialogEl.style.left = Math.min(sx, window.innerWidth - 320) + 'px';
      dialogEl.style.top = Math.min(sy, window.innerHeight - 150) + 'px';

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
          commitStringInput();
        }
      };
      document.addEventListener('keydown', onKeyHandler, true);

      onClickHandler = function(e) {
        if (!isInputting || !dialogEl) return;
        if (Date.now() < ignoreOutsideClicksUntil) return;
        if (dialogEl.contains(e.target)) return;
        hideInputDialog();
      };

      dialogEl.addEventListener('mousedown', function(e) { e.stopPropagation(); });
      dialogEl.addEventListener('click', function(e) { e.stopPropagation(); });
      dialogEl.addEventListener('pointerdown', function(e) { e.stopPropagation(); });

      document.body.appendChild(dialogEl);

      outsideClickTimer = setTimeout(function() {
        outsideClickTimer = null;
        if (!isInputting || !dialogEl) return;
        document.addEventListener('mousedown', onClickHandler, true);
        document.addEventListener('click', onClickHandler, true);
      }, 0);

      textAreaEl = dialogEl.querySelector('#memo-string-input-text') ||
                   dialogEl.querySelector('textarea');
      if (textAreaEl) {
        setTimeout(function() {
          if (textAreaEl) {
            textAreaEl.focus();
            if (textAreaEl.setSelectionRange) textAreaEl.setSelectionRange(0, 0);
          }
        }, 0);
      }
    }

    function bakeRelativePoints(points) {
      if (!points || points.length < 2) return null;
      var ox = points[0].x;
      var oy = points[0].y;
      var rel = [];
      for (var i = 0; i < points.length; i++) {
        rel.push({ x: points[i].x - ox, y: points[i].y - oy });
      }
      return { origin: { x: ox, y: oy }, points: rel };
    }

    function onMouseDown(e) {
      if (isInputting) return;
      if (typeof e.button === 'number' && e.button !== 0) return;
      // Shift は select モード（main）。描画しない
      if (e.shiftKey || ME.shiftHeld) return;

      var m = getMouse(e);
      isDown = true;
      mode = null;
      startX = m.x;
      startY = m.y;
      clientStartX = e.clientX;
      clientStartY = e.clientY;
      absPoints = [{ x: m.x, y: m.y }];
    }

    function onMouseMove(e) {
      if (!isDown || isInputting) return;
      // ウィンドウ外で mouseup された場合の取りこぼし対策
      if (typeof e.buttons === 'number' && (e.buttons & 1) === 0) {
        onMouseUp(e);
        return;
      }
      var m = getMouse(e);
      var d0 = dist(startX, startY, m.x, m.y);
      if (mode !== 'freehand' && d0 > CLICK_SLOP) {
        mode = 'freehand';
        // 開始点に加え現在位置を必ず入れてプレビューが線になるようにする
        if (absPoints.length === 1) {
          absPoints.push({ x: m.x, y: m.y });
        }
      }
      if (mode === 'freehand') {
        var last = absPoints[absPoints.length - 1];
        if (!last || dist(last.x, last.y, m.x, m.y) >= POINT_MIN_DIST) {
          absPoints.push({ x: m.x, y: m.y });
        } else {
          // 間引き距離未満でも先端を追従させてドラッグ中の線を更新
          last.x = m.x;
          last.y = m.y;
        }
        if (renderEngine.renderNow) renderEngine.renderNow();
        else renderEngine.setDirty();
      }
    }

    function onMouseUp(e) {
      if (typeof e.button === 'number' && e.button !== 0) return;
      if (!isDown) return;
      isDown = false;

      var m = getMouse(e);
      var total = dist(startX, startY, m.x, m.y);

      if (mode === 'freehand' && absPoints.length >= 2) {
        var last = absPoints[absPoints.length - 1];
        if (!last || dist(last.x, last.y, m.x, m.y) >= POINT_MIN_DIST) {
          absPoints.push({ x: m.x, y: m.y });
        }
        var baked = bakeRelativePoints(absPoints);
        absPoints = [];
        mode = null;
        if (baked) {
          var transform = ME.Core.Models.createTransform({ x: baked.origin.x, y: baked.origin.y });
          var memoObj = ME.SceneGraph.addMemo(project, 'freehand', {
            points: baked.points,
            strokeColor: MEMO_COLOR,
            strokeWidth: MEMO_WIDTH
          }, transform);
          commandStack.push(new ME.Commands.AddMemo(memoObj));
        }
        renderEngine.setDirty();
        return;
      }

      // クリック扱い → 文字列
      absPoints = [];
      mode = null;
      if (total <= CLICK_SLOP) {
        showInputDialog(startX, startY, clientStartX, clientStartY);
      }
      renderEngine.setDirty();
    }

    function drawOverlay(ctx) {
      if (!isDown || mode !== 'freehand' || absPoints.length < 2) return;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      function strokePath(width, style) {
        ctx.beginPath();
        ctx.moveTo(absPoints[0].x, absPoints[0].y);
        for (var i = 1; i < absPoints.length; i++) {
          ctx.lineTo(absPoints[i].x, absPoints[i].y);
        }
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.stroke();
      }

      strokePath(MEMO_WIDTH + EDGE_EXTRA, EDGE_COLOR);
      strokePath(MEMO_WIDTH, MEMO_COLOR);
      ctx.restore();
    }

    function disable() {
      isDown = false;
      mode = null;
      absPoints = [];
      hideInputDialog();
      renderEngine.removeSelectionOverlayCallback(overlayCallback);
      canvas.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    function resize() {}

    var overlayCallback = function(ctx) { drawOverlay(ctx); };

    canvas.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    renderEngine.setSelectionOverlayCallback(overlayCallback);

    return {
      disable: disable,
      resize: resize
    };
  }

  window.ME.Tools.Memo = { create: create };
})();
