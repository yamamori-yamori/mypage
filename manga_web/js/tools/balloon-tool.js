// ME.Tools.Balloon.create(canvas, project, selection, commandStack, renderEngine) — 吹き出し作成ツール
// 既存の吹き出しはクリックで選択→ドラッグ移動（しっぽ3点(base/curve/tip)ハンドルが出る）
// 空き場所のドラッグ → BalloonObject生成 / しっぽ3点ドラッグ編集
// マウス座標はME.Render.Engine.getPagePoint()でページ座標へ変換

window.ME = window.ME || {};
window.ME.Tools = window.ME.Tools || {};

(function() {
  'use strict';

  var HANDLE_SIZE = 8;
  var HANDLE_HIT = 10;

  function create(canvas, project, selection, commandStack, renderEngine) {
    var isCreating = false;
    var createStartX = 0, createStartY = 0;
    var tempBalloon = null;
    var editingTailTip = false;
    var editingPointKey = null;
    var editObjId = null;
    var oldTipPoint = null;
    var movingBalloon = false;
    var moveObjId = null, moveOld = null, moved = false;
    var dragStartX = 0, dragStartY = 0;
    var balloonWasSelected = false;
    // リサイズ用
    var isResizing = false, resizeObjId = null, resizeHandleIdx = -1, resizeOld = null;

    function getMouse(e) {
      return ME.Render.Engine.getPagePoint(canvas, e);
    }

    function selectedBalloon() {
      var ids = selection.getSelectedIds();
      for (var i = 0; i < ids.length; i++) {
        var o = ME.SceneGraph.getObjectById(project, ids[i]);
        if (o && o.type === 'balloon') return o;
      }
      return null;
    }

    function balloonBBox(b) {
      var t = b.transform || {};
      var w = (b.size && b.size.width) || 150;
      var h = (b.size && b.size.height) || 80;
      return { x: (t.x || 0) - w / 2, y: (t.y || 0) - h / 2, w: w, h: h };
    }

    function cornersOf(bb) {
      return [
        { x: bb.x, y: bb.y },
        { x: bb.x + bb.w, y: bb.y },
        { x: bb.x, y: bb.y + bb.h },
        { x: bb.x + bb.w, y: bb.y + bb.h }
      ];
    }

    function findHandleAt(mx, my, b) {
      var cs = cornersOf(balloonBBox(b));
      var _z = (ME.Render.Engine.getZoom ? ME.Render.Engine.getZoom() : 1);
      if (!_z || _z <= 0) _z = 1;
      var hitR = HANDLE_HIT / _z;
      for (var i = 0; i < cs.length; i++) {
        if (Math.abs(mx - cs[i].x) <= hitR && Math.abs(my - cs[i].y) <= hitR) return i;
      }
      return -1;
    }

    function onMouseDown(e) {
      if (e.button !== 0) return;
      var m = getMouse(e);
      var mx = m.x, my = m.y;

      // 選択中の吹き出しの角ハンドル → リサイズ開始（確定後も変形できる）
      var selB = selectedBalloon();
      if (selB && !selB.locked) {
        var hi = findHandleAt(mx, my, selB);
        if (hi >= 0) {
          isResizing = true;
          resizeObjId = selB.id;
          resizeHandleIdx = hi;
          resizeOld = JSON.parse(JSON.stringify(selB));
          dragStartX = mx; dragStartY = my;
          return;
        }
      }

      // しっぽハンドル上のクリックかチェック
      if (!isCreating) {
        var _zt = (ME.Render.Engine.getZoom ? ME.Render.Engine.getZoom() : 1);
        if (!_zt || _zt <= 0) _zt = 1;
        var tailHitR = HANDLE_SIZE / _zt;
        var selectedIds = selection.getSelectedIds();
        for (var i = 0; i < selectedIds.length; i++) {
          var id = selectedIds[i];
          var obj = ME.SceneGraph.getObjectById(project, id);
          if (!obj || obj.type !== 'balloon' || !obj.tail) continue;

          if (obj.tail.basePoint) {
            var bdx = mx - obj.tail.basePoint.x;
            var bdy = my - obj.tail.basePoint.y;
            var baseDist = Math.sqrt(bdx * bdx + bdy * bdy);
            if (baseDist <= tailHitR) {
              editingTailTip = true;
              editingPointKey = 'basePoint';
              editObjId = id;
              oldTipPoint = { x: obj.tail.basePoint.x, y: obj.tail.basePoint.y };
              return;
            }
          }

          if (obj.tail.tipPoint) {
            var tdx = mx - obj.tail.tipPoint.x;
            var tdy = my - obj.tail.tipPoint.y;
            var tipDist = Math.sqrt(tdx * tdx + tdy * tdy);
            if (tipDist <= tailHitR) {
              editingTailTip = true;
              editingPointKey = 'tipPoint';
              editObjId = id;
              oldTipPoint = { x: obj.tail.tipPoint.x, y: obj.tail.tipPoint.y };
              return;
            }
          }

          if (obj.tail.curvePoint) {
            var cdx = mx - obj.tail.curvePoint.x;
            var cdy = my - obj.tail.curvePoint.y;
            var curveDist = Math.sqrt(cdx * cdx + cdy * cdy);
            if (curveDist <= tailHitR) {
              editingTailTip = true;
              editingPointKey = 'curvePoint';
              editObjId = id;
              oldTipPoint = { x: obj.tail.curvePoint.x, y: obj.tail.curvePoint.y };
              return;
            }
          }
        }
      }

      // 既存の吹き出しをクリック → 選択して移動（しっぽハンドルを表示）
      var hits = selection.hitTest(mx, my, project);
      var hitBalloonId = null;
      for (var k = 0; k < hits.length; k++) {
        var ho = ME.SceneGraph.getObjectById(project, hits[k]);
        if (ho && ho.type === 'balloon') { hitBalloonId = hits[k]; break; }
      }
      if (hitBalloonId) {
        // 既存吹き出しクリック時は、常に「回転付セレクト」ツールへ統合（回転ハンドルを使えるように）
        // すでに選択済みなら、セリフ入力リクエストを発火（テキストステップへ）
        if (selection.isSelected(hitBalloonId)) {
          var alreadyB = ME.SceneGraph.getObjectById(project, hitBalloonId);
          if (alreadyB && window.ME.Tools.Balloon && window.ME.Tools.Balloon.onBalloonTextRequest) {
            window.ME.Tools.Balloon.onBalloonTextRequest(alreadyB);
          }
          renderEngine.setDirty();
          return;
        }
        if (ME.enterSelectModeForObject) {
          ME.enterSelectModeForObject(hitBalloonId);
        } else {
          selection.selectOnly(hitBalloonId);
        }
        renderEngine.setDirty();
        return;
      }

      // 吹き出し以外をクリックした場合（テキスト・空白など）も、既存選択をクリアしてから新規作成モードへ
      // （テキスト選択中に吹き出しクリックでクリアするのと対称。吹き出し選択中にテキストをクリックしても
      //  選択を外して連続作成しやすくする）
      selection.clear();

      isCreating = true;
      createStartX = mx;
      createStartY = my;
    }

    function onMouseMove(e) {
      // ウィンドウ外で mouseup された場合の取りこぼし対策
      if ((isCreating || isResizing || editingTailTip || movingBalloon) &&
          typeof e.buttons === 'number' && (e.buttons & 1) === 0) {
        onMouseUp(e);
        return;
      }

      var m = getMouse(e);
      var mx = m.x, my = m.y;

      if (isResizing && resizeObjId) {
        var ro = ME.SceneGraph.getObjectById(project, resizeObjId);
        if (ro && ro.size && resizeOld.size) {
          var dxr = mx - dragStartX, dyr = my - dragStartY;
          var sx = (resizeHandleIdx === 0 || resizeHandleIdx === 2) ? -1 : 1;
          var sy = (resizeHandleIdx === 0 || resizeHandleIdx === 1) ? -1 : 1;
          var oldBW = resizeOld.size.width;
          var oldBH = resizeOld.size.height;
          var newBW = Math.max(20, oldBW + sx * dxr);
          var newBH = Math.max(15, oldBH + sy * dyr);
          ro.size.width = newBW;
          ro.size.height = newBH;
          // 固定辺から中心を再計算（左/上ドラッグでも対角が固定される）
          if (sx < 0) {
            ro.transform.x = (resizeOld.transform.x + oldBW / 2) - newBW / 2;
          } else {
            ro.transform.x = (resizeOld.transform.x - oldBW / 2) + newBW / 2;
          }
          if (sy < 0) {
            ro.transform.y = (resizeOld.transform.y + oldBH / 2) - newBH / 2;
          } else {
            ro.transform.y = (resizeOld.transform.y - oldBH / 2) + newBH / 2;
          }
          renderEngine.setDirty();
        }
        return;
      }

      if (editingTailTip && editObjId) {
        var obj = ME.SceneGraph.getObjectById(project, editObjId);
        if (!obj || !obj.tail) return;

        var point = obj.tail[editingPointKey];
        if (point) {
          point.x = mx;
          point.y = my;
        }

        renderEngine.setDirty();
        return;
      }

      if (movingBalloon && moveObjId) {
        var mobj = ME.SceneGraph.getObjectById(project, moveObjId);
        if (mobj) {
          var ddx = mx - dragStartX;
          var ddy = my - dragStartY;
          if (Math.abs(ddx) > 2 || Math.abs(ddy) > 2) moved = true;
          mobj.transform.x = moveOld.transform.x + ddx;
          mobj.transform.y = moveOld.transform.y + ddy;
          // しっぽも一緒に移動
          if (mobj.tail && moveOld.tail) {
            var keys = ['basePoint', 'curvePoint', 'tipPoint'];
            for (var ki = 0; ki < keys.length; ki++) {
              var kk = keys[ki];
              if (mobj.tail[kk] && moveOld.tail[kk] && moveOld.tail[kk].x !== undefined) {
                mobj.tail[kk].x = moveOld.tail[kk].x + ddx;
                mobj.tail[kk].y = moveOld.tail[kk].y + ddy;
              }
            }
          }
          renderEngine.setDirty();
        }
        return;
      }

      if (isCreating && !tempBalloon) {
        var w = Math.abs(mx - createStartX);
        var h = Math.abs(my - createStartY);
        tempBalloon = ME.Core.Models.Balloon.create('ellipse', { width: w, height: h }, { x: mx, y: my });
      }

      if (isCreating && tempBalloon) {
        var cx = (createStartX + mx) / 2;
        var cy = (createStartY + my) / 2;
        var w = Math.abs(mx - createStartX);
        var h = Math.abs(my - createStartY);

        tempBalloon.transform.x = cx;
        tempBalloon.transform.y = cy;
        tempBalloon.size.width = Math.max(w, 30);
        tempBalloon.size.height = Math.max(h, 20);

        renderEngine.renderNow();
      }
    }

    function onMouseUp(e) {
      if (isResizing && resizeObjId) {
        var rob = ME.SceneGraph.getObjectById(project, resizeObjId);
        if (rob) {
          var resizeOldPart = { size: resizeOld.size, transform: resizeOld.transform };
          var resizeNewPart = { size: JSON.parse(JSON.stringify(rob.size)), transform: JSON.parse(JSON.stringify(rob.transform)) };
          if (JSON.stringify(resizeOldPart) !== JSON.stringify(resizeNewPart)) {
            commandStack.push(new ME.Commands.BatchEdit(
              [resizeObjId],
              [resizeOldPart],
              [resizeNewPart]
            ));
          }
        }
        isResizing = false; resizeObjId = null; resizeHandleIdx = -1; resizeOld = null;
        renderEngine.setDirty();
        return;
      }

      if (movingBalloon && moveObjId) {
        var mobj = ME.SceneGraph.getObjectById(project, moveObjId);
        if (mobj && moved) {
          var newState = {
            transform: JSON.parse(JSON.stringify(mobj.transform)),
            tail: mobj.tail ? JSON.parse(JSON.stringify(mobj.tail)) : null
          };
          commandStack.push(new ME.Commands.BatchEdit([moveObjId], [moveOld], [newState]));
        }
        // ドラッグせず、選択済みの吹き出しを再クリック → その場でセリフ入力へ
        var wantText = (mobj && !moved && balloonWasSelected);
        var textTarget = mobj;
        movingBalloon = false;
        moveObjId = null;
        moveOld = null;
        moved = false;
        renderEngine.setDirty();
        if (wantText && window.ME.Tools.Balloon && window.ME.Tools.Balloon.onBalloonTextRequest) {
          window.ME.Tools.Balloon.onBalloonTextRequest(textTarget);
        }
        return;
      }

      if (editingTailTip && editObjId) {
        var obj = ME.SceneGraph.getObjectById(project, editObjId);
        if (obj && obj.tail && obj.tail[editingPointKey]) {
          var point = obj.tail[editingPointKey];
          var newTailPoint = { x: point.x, y: point.y };
          if (JSON.stringify(oldTipPoint) !== JSON.stringify(newTailPoint)) {
            var cmd = new ME.Commands.EditVertex(
              editObjId,
              oldTipPoint,
              newTailPoint,
              editingPointKey
            );
            commandStack.push(cmd);
          }
        }
      }

      if (isCreating && tempBalloon) {
        var balloonObj = ME.SceneGraph.addBalloon(project, { shape: 'ellipse' }, { x: tempBalloon.transform.x, y: tempBalloon.transform.y });
        balloonObj.size.width = Math.max(tempBalloon.size.width, 30);
        balloonObj.size.height = Math.max(tempBalloon.size.height, 20);

        commandStack.push(new ME.Commands.AddObject(balloonObj));

        selection.clear();
        selection.toggle(balloonObj.id);
        // 作成直後から回転ハンドル付きセレクト状態に統一（要望）。selectツールへ移行して即 rotate 可能に
        if (ME.enterSelectModeForObject) {
          ME.enterSelectModeForObject(balloonObj.id);
        }

        tempBalloon = null;
      }

      isCreating = false;
      editingTailTip = false;
      editingPointKey = null;
      editObjId = null;
      oldTipPoint = null;
      renderEngine.setDirty();
    }

    function drawOverlay(ctx) {
      if (isCreating && tempBalloon) {
        // プレビューは簡易輪郭のみ（レイヤー合成は本描画で）
        var _z = (ME.Render.Engine.getZoom ? ME.Render.Engine.getZoom() : 1);
        ME.Render.Balloon.draw(ctx, tempBalloon, { scale: _z, offsetX: ME.Render.Engine.BLEED, offsetY: ME.Render.Engine.BLEED });
      }

      var selectedIds = selection.getSelectedIds();

      // 角ハンドル（リサイズ用）＋点線枠
      for (var ci = 0; ci < selectedIds.length; ci++) {
        var cobj = ME.SceneGraph.getObjectById(project, selectedIds[ci]);
        if (!cobj || cobj.type !== 'balloon') continue;
        var bb = balloonBBox(cobj);
        ctx.save();
        ctx.strokeStyle = '#4A90D9';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(bb.x, bb.y, bb.w, bb.h);
        ctx.setLineDash([]);
        var cs = cornersOf(bb);
        ctx.fillStyle = '#4A90D9';
        ctx.strokeStyle = '#FFFFFF';
        var _zd = (ME.Render.Engine.getZoom ? ME.Render.Engine.getZoom() : 1);
        if (!_zd || _zd <= 0) _zd = 1;
        var hs = HANDLE_SIZE / _zd;
        for (var cj = 0; cj < cs.length; cj++) {
          ctx.fillRect(cs[cj].x - hs / 2, cs[cj].y - hs / 2, hs, hs);
          ctx.strokeRect(cs[cj].x - hs / 2, cs[cj].y - hs / 2, hs, hs);
        }
        ctx.restore();
      }

      var _zh = (ME.Render.Engine.getZoom ? ME.Render.Engine.getZoom() : 1);
      if (!_zh || _zh <= 0) _zh = 1;
      var tailR = (HANDLE_SIZE / 2 + 1) / _zh;
      for (var i = 0; i < selectedIds.length; i++) {
        var id = selectedIds[i];
        var obj = ME.SceneGraph.getObjectById(project, id);
        if (!obj || obj.type !== 'balloon' || !obj.tail) continue;

        if (obj.tail.basePoint) {
          ctx.fillStyle = '#FF6B35';
          ctx.beginPath();
          ctx.arc(obj.tail.basePoint.x, obj.tail.basePoint.y, tailR, 0, Math.PI * 2);
          ctx.fill();
        }

        if (obj.tail.tipPoint) {
          ctx.fillStyle = '#FF6B35';
          ctx.beginPath();
          ctx.arc(obj.tail.tipPoint.x, obj.tail.tipPoint.y, tailR, 0, Math.PI * 2);
          ctx.fill();
        }

        if (obj.tail.curvePoint) {
          ctx.fillStyle = '#FFB347';
          ctx.beginPath();
          ctx.arc(obj.tail.curvePoint.x, obj.tail.curvePoint.y, tailR, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    var overlayCallback = function(ctx) { drawOverlay(ctx); };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    renderEngine.setSelectionOverlayCallback(overlayCallback);

    return {
      disable: function() {
        renderEngine.removeSelectionOverlayCallback(overlayCallback);
        canvas.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }
    };
  }

  window.ME.Tools.Balloon = { create: create };
})();
