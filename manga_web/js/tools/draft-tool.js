// ME.Tools.Draft.create(canvas, project, selection, commandStack, renderEngine) — 下書き描画ツール
// kind: 'circle' | 'rect' | 'line' | 'string'
// 円/四角/直線: ドラッグ描画
// 文字列: クリック → 入力ダイアログ → ENTERで確定

window.ME = window.ME || {};
window.ME.Tools = window.ME.Tools || {};

(function() {
  'use strict';

  var DRAFT_COLOR = 'rgba(140,140,140,0.55)';
  var DRAFT_LINE_WIDTH = 4.5;

  var INPUT_DIALOG_HTML =
    '<div style="margin-bottom:8px;color:#555;">文字列を入力（ENTERで確定、ESCでキャンセル）</div>' +
    '<textarea id="draft-string-input-text" rows="3" cols="40" placeholder="文字列を入力..." ' +
    'style="width:100%;min-width:280px;resize:none;font-size:16px;padding:6px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;text-align:left;direction:ltr;"></textarea>';

  function create(canvas, project, selection, commandStack, renderEngine) {
    var currentKind = (window.ME.Tools.Draft && ME.Tools.Draft.defaultKind) || 'circle';
    var isDrawing = false;
    var drawStartX = 0, drawStartY = 0;

    var isDraggingDraft = false;
    var dragTargets = null; // [{ id, oldTransform }, ...] 融合一体移動用
    var dragMoved = false;

    // Shift+空白ドラッグ: 下書きのみラバーバンド選択（select切替失敗時のフォールバック）
    var isRubberBand = false;
    var rubberBandX1 = 0, rubberBandY1 = 0, rubberBandX2 = 0, rubberBandY2 = 0;

    var previewDraft = { kind: null, x1: 0, y1: 0, x2: 0, y2: 0 };

    // 文字列入力ダイアログ
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

    function setKind(kind) {
      if (kind === 'circle' || kind === 'rect' || kind === 'line' || kind === 'string') {
        currentKind = kind;
        ME.Tools.Draft.defaultKind = kind;
      }
    }

    function getKind() {
      return currentKind;
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
      var params = { content: content };
      var draftObj = ME.SceneGraph.addDraft(project, 'string', params, transform);
      commandStack.push(new ME.Commands.AddDraft(draftObj));

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
      dialogEl.id = 'draft-string-input-dialog';
      dialogEl.style.cssText =
        'position:fixed;z-index:10000;' +
        'background:#fff;border:2px solid #888;border-radius:6px;padding:12px;' +
        'box-shadow:0 4px 12px rgba(0,0,0,0.3);font-family:sans-serif;font-size:14px;';
      dialogEl.innerHTML = INPUT_DIALOG_HTML;
      dialogEl.style.left = Math.min(sx, window.innerWidth - 320) + 'px';
      dialogEl.style.top = Math.min(sy, window.innerHeight - 150) + 'px';

      onKeyHandler = function(e) {
        if (!isInputting) return;
        // 日本語変換確定の Enter は無視
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

      textAreaEl = dialogEl.querySelector('#draft-string-input-text') ||
                   dialogEl.querySelector('textarea');
      if (textAreaEl) {
        setTimeout(function() {
          if (textAreaEl) {
            textAreaEl.focus();
            // 全選択せずキャレットを左端へ
            if (textAreaEl.setSelectionRange) {
              textAreaEl.setSelectionRange(0, 0);
            }
          }
        }, 0);
      }
    }

    function onMouseDown(e) {
      if (isInputting) return;
      if (typeof e.button === 'number' && e.button !== 0) return;

      var m = getMouse(e);
      var mx = m.x, my = m.y;

      // 既存 draft の Shift+選択移動（融合グループは一体・draft のみヒット）
      // enterSelectMode で select ツールへ切り替わるのが主経路。ここはフォールバック。
      var draftHits = selection.hitTest(mx, my, project, { typeFilter: 'draft' });
      var draftHitIds = [];
      for (var i = 0; i < draftHits.length; i++) {
        var obj = ME.SceneGraph.getObjectById(project, draftHits[i]);
        if (obj && obj.type === 'draft') {
          draftHitIds.push(draftHits[i]);
        }
      }

      if (e.shiftKey || ME.shiftHeld) {
        if (draftHitIds.length > 0) {
          var hitId = draftHitIds[0];
          var members = [hitId];
          if (selection.expandFusionIds) {
            var expanded = selection.expandFusionIds(project, [hitId]);
            if (expanded && expanded.length) members = expanded;
          }
          selection.selectOnly(members[0]);
          if (members.length > 1) selection.addRange(members);
          isDraggingDraft = true;
          dragTargets = [];
          for (var mi = 0; mi < members.length; mi++) {
            var mo = ME.SceneGraph.getObjectById(project, members[mi]);
            if (mo && mo.transform && !mo.locked) {
              dragTargets.push({
                id: members[mi],
                oldTransform: JSON.parse(JSON.stringify(mo.transform))
              });
            }
          }
          dragMoved = false;
          drawStartX = mx;
          drawStartY = my;
          renderEngine.renderNow();
          return;
        }
        // Shift+空白: 描画せずラバーバンド（下書きのみ一括選択）
        isRubberBand = true;
        rubberBandX1 = rubberBandX2 = mx;
        rubberBandY1 = rubberBandY2 = my;
        renderEngine.renderNow();
        return;
      }

      // 文字列: クリック位置に入力ダイアログ（画面座標で配置）
      if (currentKind === 'string') {
        showInputDialog(mx, my, e.clientX, e.clientY);
        return;
      }

      // 図形: ドラッグ描画開始
      drawStartX = mx;
      drawStartY = my;
      isDrawing = true;
    }

    function onMouseMove(e) {
      // ウィンドウ外で mouseup された場合の取りこぼし対策
      if ((isDraggingDraft || isRubberBand || isDrawing) &&
          typeof e.buttons === 'number' && (e.buttons & 1) === 0) {
        onMouseUp(e);
        return;
      }

      var m = getMouse(e);
      var mx = m.x, my = m.y;

      if (isDraggingDraft && dragTargets && dragTargets.length) {
        var dx = mx - drawStartX;
        var dy = my - drawStartY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
        for (var di = 0; di < dragTargets.length; di++) {
          var tObj = ME.SceneGraph.getObjectById(project, dragTargets[di].id);
          if (tObj && tObj.transform) {
            tObj.transform.x = dragTargets[di].oldTransform.x + dx;
            tObj.transform.y = dragTargets[di].oldTransform.y + dy;
          }
        }
        renderEngine.renderNow();
        return;
      }

      if (isRubberBand) {
        rubberBandX2 = mx;
        rubberBandY2 = my;
        renderEngine.renderNow();
        return;
      }

      if (!isDrawing) return;

      previewDraft.kind = currentKind;
      previewDraft.x1 = drawStartX;
      previewDraft.y1 = drawStartY;
      previewDraft.x2 = mx;
      previewDraft.y2 = my;

      renderEngine.renderNow();
    }

    function onMouseUp(e) {
      if (typeof e.button === 'number' && e.button !== 0) {
        return;
      }

      if (isDraggingDraft && dragTargets && dragTargets.length) {
        if (dragMoved) {
          if (dragTargets.length === 1) {
            var movedObj = ME.SceneGraph.getObjectById(project, dragTargets[0].id);
            if (movedObj) {
              commandStack.push(new ME.Commands.EditDraft(
                dragTargets[0].id,
                JSON.parse(JSON.stringify(dragTargets[0].oldTransform)),
                JSON.parse(JSON.stringify(movedObj.transform))
              ));
            }
          } else {
            var ids = [];
            var olds = [];
            var news = [];
            for (var ui = 0; ui < dragTargets.length; ui++) {
              var uo = ME.SceneGraph.getObjectById(project, dragTargets[ui].id);
              if (!uo) continue;
              ids.push(dragTargets[ui].id);
              olds.push({ transform: JSON.parse(JSON.stringify(dragTargets[ui].oldTransform)) });
              news.push({ transform: JSON.parse(JSON.stringify(uo.transform)) });
            }
            if (ids.length > 0) {
              commandStack.push(new ME.Commands.BatchEdit(ids, olds, news));
            }
          }
        } else {
          // 閾値未満の微小ドラッグ: ドラッグ開始時の座標へ書き戻す（位置ズレを残さない）
          for (var vi = 0; vi < dragTargets.length; vi++) {
            var vo = ME.SceneGraph.getObjectById(project, dragTargets[vi].id);
            if (vo && vo.transform) {
              vo.transform.x = dragTargets[vi].oldTransform.x;
              vo.transform.y = dragTargets[vi].oldTransform.y;
            }
          }
          renderEngine.setDirty();
        }
        isDraggingDraft = false;
        dragTargets = null;
        dragMoved = false;
      }

      if (isRubberBand) {
        var rx1 = Math.min(rubberBandX1, rubberBandX2);
        var ry1 = Math.min(rubberBandY1, rubberBandY2);
        var rx2 = Math.max(rubberBandX1, rubberBandX2);
        var ry2 = Math.max(rubberBandY1, rubberBandY2);
        isRubberBand = false;
        if (rx2 - rx1 >= 3 || ry2 - ry1 >= 3) {
          var hits = selection.hitTestRect(rx1, ry1, rx2, ry2, project, { typeFilter: 'draft' });
          if (selection.expandFusionIds) {
            hits = selection.expandFusionIds(project, hits);
          }
          if (e.shiftKey || ME.shiftHeld) {
            selection.addRange(hits);
          } else {
            selection.clear();
            selection.addRange(hits);
          }
        }
        renderEngine.setDirty();
        return;
      }

      if (!isDrawing) return;
      isDrawing = false;

      var m = getMouse(e);
      var mx = m.x, my = m.y;

      previewDraft.kind = null;
      renderEngine.setDirty();

      var params;
      if (currentKind === 'circle') {
        var ew = mx - drawStartX;
        var eh = my - drawStartY;
        var absEw = Math.abs(ew);
        var absEh = Math.abs(eh);
        if (absEw < 2 && absEh < 2) return;
        params = { width: absEw, height: absEh };
      } else if (currentKind === 'rect') {
        var rw = Math.abs(mx - drawStartX);
        var rh = Math.abs(my - drawStartY);
        if (rw < 2 || rh < 2) return;
        params = { width: rw, height: rh };
      } else if (currentKind === 'line') {
        var dist = Math.sqrt((mx - drawStartX) * (mx - drawStartX) + (my - drawStartY) * (my - drawStartY));
        if (dist < 2) return;
        params = { startX: 0, startY: 0, endX: mx - drawStartX, endY: my - drawStartY };
      } else {
        return;
      }

      var transform = { x: drawStartX, y: drawStartY, rotation: 0, scaleX: 1, scaleY: 1 };
      if (currentKind === 'rect' || currentKind === 'circle') {
        transform.x = (drawStartX + mx) / 2;
        transform.y = (drawStartY + my) / 2;
      }

      var draftObj = ME.SceneGraph.addDraft(project, currentKind, params, transform);
      commandStack.push(new ME.Commands.AddDraft(draftObj));

      renderEngine.setDirty();
    }

    function disable() {
      isDrawing = false;
      isDraggingDraft = false;
      dragTargets = null;
      dragMoved = false;
      isRubberBand = false;
      previewDraft.kind = null;
      hideInputDialog();
      renderEngine.removeSelectionOverlayCallback(overlayCallback);
      canvas.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    function resize() {}

    function drawOverlay(ctx) {
      if (isRubberBand) {
        var x = Math.min(rubberBandX1, rubberBandX2);
        var y = Math.min(rubberBandY1, rubberBandY2);
        var w = Math.abs(rubberBandX2 - rubberBandX1);
        var h = Math.abs(rubberBandY2 - rubberBandY1);
        ctx.save();
        ctx.strokeStyle = '#4A90D9';
        ctx.fillStyle = 'rgba(74, 144, 217, 0.12)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
        return;
      }

      if (previewDraft.kind && isDrawing) {
        ctx.save();
        ctx.strokeStyle = DRAFT_COLOR;
        ctx.lineWidth = DRAFT_LINE_WIDTH;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        var kind = previewDraft.kind;
        var x1 = previewDraft.x1, y1 = previewDraft.y1;
        var x2 = previewDraft.x2, y2 = previewDraft.y2;

        if (kind === 'circle') {
          var ew = x2 - x1;
          var eh = y2 - y1;
          ctx.beginPath();
          ctx.ellipse(x1 + ew / 2, y1 + eh / 2, Math.abs(ew) / 2, Math.abs(eh) / 2, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (kind === 'rect') {
          var cx = (x1 + x2) / 2;
          var cy = (y1 + y2) / 2;
          var rw = Math.abs(x2 - x1);
          var rh = Math.abs(y2 - y1);
          ctx.strokeRect(cx - rw / 2, cy - rh / 2, rw, rh);
        } else if (kind === 'line') {
          ctx.translate(x1, y1);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(x2 - x1, y2 - y1);
          ctx.stroke();
        }

        ctx.restore();
      }
    }

    var overlayCallback = function(ctx) { drawOverlay(ctx); };

    canvas.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    renderEngine.setSelectionOverlayCallback(overlayCallback);

    return {
      setKind: setKind,
      getKind: getKind,
      disable: disable,
      resize: resize
    };
  }

  window.ME.Tools.Draft = { create: create, defaultKind: 'circle' };
})();
