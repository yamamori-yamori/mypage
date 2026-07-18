// ME.Tools.Select.create(canvas, project, selection, commandStack, renderEngine) — 選択・移動ツール
// ・クリック選択 / Shift+クリック加算 / ラバーバンド（Shiftで加算）
// ・複数選択の一括移動対応（panelは頂点を、balloonはしっぽも一緒に移動）。コマ移動時は中の画像も一緒に動く
// ・角ハンドルで拡縮（panelは頂点編集、imageは縦横比維持）、回転ハンドルで回転（panel以外）
// ・Shift+クリックで加算選択／選択済みをShift+クリックでそのアイテムだけ選択解除
// ・エフェクトはエフェクトが選択されている時以外はクリック選択の対象にしない
// ・選択中の吹き出しのしっぽ(base/curve/tip)ハンドルもこのツールで掴んで編集できる
// ・選択中の集中線は params.origin のオレンジ焦点ハンドルをドラッグできる
// ・マウス座標はME.Render.Engine.getPagePoint()でページ座標へ変換（断ち切り余白対応）

window.ME = window.ME || {};
window.ME.Tools = window.ME.Tools || {};

(function() {
  'use strict';

  var HANDLE_SIZE = 6;
  var HANDLE_HIT = 8;
  var ROTATE_HANDLE_OFFSET = 25;
  var ORIGIN_HANDLE_R = 6;

  function create(canvas, project, selection, commandStack, renderEngine) {
    var isDragging = false;
    var dragStartX = 0, dragStartY = 0;

    var moveTargets = null;
    var moved = false;
    var toggleCandidate = null;

    var resizeHandleIdx = -1;
    var resizeObjId = null;
    var resizeOldState = null;

    // 回転（相対回転方式）: 掴んだ時点のピボット・角度・回転値
    var rotatePivot = null;
    var rotateStartAngle = 0;
    var rotateBaseRotation = 0;

    var tailEdit = null; // { objId, key, old:{x,y} } 吹き出しのしっぽ編集中
    var lineEdit = null; // { objId, end: 'start'|'end', oldState } 下書き直線の端点編集
    var originEdit = null; // { objId, old:{params} } 集中線の焦点

    var isRubberBand = false;
    var rubberBandX1 = 0, rubberBandY1 = 0, rubberBandX2 = 0, rubberBandY2 = 0;

    var overlayCallback = function(ctx) { drawHandles(ctx); };

    renderEngine.setSelectionOverlayCallback(overlayCallback);

    function getMouse(e) {
      return ME.Render.Engine.getPagePoint(canvas, e);
    }

    function getZoom() {
      var z = (ME.Render.Engine && ME.Render.Engine.getZoom) ? ME.Render.Engine.getZoom() : 1;
      return (z && z > 0) ? z : 1;
    }

    function objType(id) {
      var o = ME.SceneGraph.getObjectById(project, id);
      return o ? o.type : null;
    }

    // 現在の選択が全て同じ種類ならその種類、空または混在ならnull
    function commonSelectedType() {
      var ids = selection.getSelectedIds();
      if (ids.length === 0) return null;
      var t = null;
      for (var i = 0; i < ids.length; i++) {
        var ty = objType(ids[i]);
        if (t === null) t = ty;
        else if (ty !== t) return null;
      }
      return t;
    }

    function anyEffectSelected() {
      var ids = selection.getSelectedIds();
      for (var i = 0; i < ids.length; i++) {
        if (objType(ids[i]) === 'effect') return true;
      }
      return false;
    }

    // エフェクトが選択されている時以外は、クリック対象からエフェクトを除外
    function filterEffectHits(hits) {
      if (anyEffectSelected()) return hits;
      var out = [];
      for (var i = 0; i < hits.length; i++) {
        if (objType(hits[i]) !== 'effect') out.push(hits[i]);
      }
      return out;
    }

    // ステップごとの選択可能 type（配列。paper=nullで全種）
    function allowedStepTypes() {
      var map = {
        panel:   ['panel', 'balloon', 'text', 'effect', 'draft'],
        image:   ['image'],
        balloon: ['balloon', 'text'],
        text:    ['balloon', 'text'],
        effect:  ['effect'],
        draft:   ['draft'],
        memo:    ['memo']
      };
      return map[ME.currentStep] || null; // paper=null（全種・memosはhitTest非対象）
    }

    function hitTestOpts() {
      var types = allowedStepTypes();
      if (!types) return null;
      // typeFilterは単一typeのみ対応。1種類なら指定、複数ならフィルタなしでfilterHitsで後処理
      if (types.length === 1) return { typeFilter: types[0] };
      return null;
    }

    function filterHits(hits) {
      var filtered = filterEffectHits(hits);
      var allowed = allowedStepTypes();
      if (!allowed) return filtered;
      var out = [];
      for (var i = 0; i < filtered.length; i++) {
        var ty = objType(filtered[i]);
        for (var j = 0; j < allowed.length; j++) {
          if (ty === allowed[j]) { out.push(filtered[i]); break; }
        }
      }
      return out;
    }

    // 融合グループを一体選択（全メンバーを選択状態に）
    // 必ず hitId 自体は選択に残す（expand 失敗でも選択不能にしない）
    function selectFusionOnly(hitId) {
      if (!hitId) return;
      var members = [hitId];
      if (selection.expandFusionIds) {
        var expanded = selection.expandFusionIds(project, [hitId]);
        if (expanded && expanded.length) members = expanded;
      }
      selection.selectOnly(members[0]);
      if (members.length > 1) {
        selection.addRange(members);
      }
    }

    // Shift 加算時: 融合メンバーをまとめて追加/トグル
    function toggleFusion(hitId) {
      if (!hitId) return;
      var members = [hitId];
      if (selection.expandFusionIds) {
        var expanded = selection.expandFusionIds(project, [hitId]);
        if (expanded && expanded.length) members = expanded;
      }
      var allSelected = members.length > 0;
      for (var i = 0; i < members.length; i++) {
        if (!selection.isSelected(members[i])) {
          allSelected = false;
          break;
        }
      }
      if (allSelected) {
        for (var j = 0; j < members.length; j++) {
          if (selection.isSelected(members[j])) selection.toggle(members[j]);
        }
      } else {
        selection.addRange(members);
      }
    }

    // 選択中の吹き出しのしっぽハンドル（tip/curve/base）を掴んだか判定
    function findTailHandle(mx, my) {
      var ids = selection.getSelectedIds();
      var tailHitR = (HANDLE_HIT + 2) / getZoom();
      for (var i = 0; i < ids.length; i++) {
        var o = ME.SceneGraph.getObjectById(project, ids[i]);
        if (!o || o.type !== 'balloon' || !o.tail || o.locked) continue;
        var keys = ['tipPoint', 'curvePoint', 'basePoint'];
        for (var k = 0; k < keys.length; k++) {
          var p = o.tail[keys[k]];
          if (p && p.x !== undefined) {
            var d = Math.sqrt((mx - p.x) * (mx - p.x) + (my - p.y) * (my - p.y));
            if (d <= tailHitR) return { objId: o.id, key: keys[k], old: { x: p.x, y: p.y } };
          }
        }
      }
      return null;
    }

    // 選択中の集中線の焦点（params.origin）— 画面座標（相対+回転込み）
    function effectPanelBounds(obj) {
      if (!obj || !obj.panelId) return null;
      var panel = ME.SceneGraph.getObjectById(project, obj.panelId);
      if (!panel) return null;
      var bb = selection.getBoundingBox(panel, project);
      if (!bb) return null;
      return { x: bb.x, y: bb.y, w: bb.w, h: bb.h };
    }

    function originDisplayOf(obj) {
      if (!obj || !obj.params || !obj.params.origin) return null;
      var b = effectPanelBounds(obj);
      var rot = (obj.transform && obj.transform.rotation) || 0;
      if (ME.Render.Effect && ME.Render.Effect.concentrationOriginDisplay) {
        return ME.Render.Effect.concentrationOriginDisplay(obj.params, b, rot);
      }
      return { x: obj.params.origin.x, y: obj.params.origin.y };
    }

    function setOriginFromDisplay(obj, dx, dy) {
      if (!obj.params) obj.params = {};
      var b = effectPanelBounds(obj);
      var rot = (obj.transform && obj.transform.rotation) || 0;
      if (!obj.params.originRelative) {
        if (b && obj.params.origin) {
          obj.params.origin = {
            x: obj.params.origin.x - (b.x + b.w / 2),
            y: obj.params.origin.y - (b.y + b.h / 2)
          };
        }
        obj.params.originRelative = true;
      }
      if (ME.Render.Effect && ME.Render.Effect.concentrationOriginFromDisplay) {
        obj.params.origin = ME.Render.Effect.concentrationOriginFromDisplay(
          dx, dy, obj.params, b, rot
        );
      } else {
        obj.params.origin = { x: dx, y: dy };
      }
    }

    function findOriginHandle(mx, my) {
      var ids = selection.getSelectedIds();
      var zoom = getZoom();
      var hitR = (ORIGIN_HANDLE_R * 2 + 6) / zoom;
      for (var i = 0; i < ids.length; i++) {
        var o = ME.SceneGraph.getObjectById(project, ids[i]);
        if (!o || o.locked) continue;
        if (o.type !== 'effect' || o.kind !== 'concentration') continue;
        if (!o.params || !o.params.origin) continue;
        var disp = originDisplayOf(o);
        if (!disp) continue;
        var d = Math.sqrt((mx - disp.x) * (mx - disp.x) + (my - disp.y) * (my - disp.y));
        if (d <= hitR) {
          return {
            objId: o.id,
            old: { params: JSON.parse(JSON.stringify(o.params)) }
          };
        }
      }
      return null;
    }

    // 下書き直線のワールド座標端点（scale/rotation 込み）
    function getDraftLineWorldEnds(obj) {
      var t = obj.transform || {};
      var p = obj.params || {};
      var sx = t.scaleX || 1;
      var sy = t.scaleY || 1;
      var rad = ((t.rotation || 0) * Math.PI) / 180;
      var cos = Math.cos(rad);
      var sin = Math.sin(rad);
      function localToWorld(lx, ly) {
        var x = (lx || 0) * sx;
        var y = (ly || 0) * sy;
        return {
          x: (t.x || 0) + x * cos - y * sin,
          y: (t.y || 0) + x * sin + y * cos
        };
      }
      return {
        start: localToWorld(p.startX, p.startY),
        end: localToWorld(p.endX, p.endY)
      };
    }

    // 端点をワールド座標で書き戻す（始点=transform、終点=相対、scale/rotation リセット）
    function setDraftLineWorldEnds(obj, start, end) {
      if (!obj.params) obj.params = {};
      obj.transform.x = start.x;
      obj.transform.y = start.y;
      obj.transform.rotation = 0;
      obj.transform.scaleX = 1;
      obj.transform.scaleY = 1;
      obj.params.startX = 0;
      obj.params.startY = 0;
      obj.params.endX = end.x - start.x;
      obj.params.endY = end.y - start.y;
    }

    // 選択中の下書き直線の端点ハンドルを掴んだか判定
    function findDraftLineHandle(mx, my) {
      var ids = selection.getSelectedIds();
      for (var i = 0; i < ids.length; i++) {
        var o = ME.SceneGraph.getObjectById(project, ids[i]);
        if (!o || o.type !== 'draft' || o.kind !== 'line' || o.locked) continue;
        var ends = getDraftLineWorldEnds(o);
        var lineHitR = (HANDLE_HIT + 2) / getZoom();
        var ds = Math.sqrt((mx - ends.start.x) * (mx - ends.start.x) + (my - ends.start.y) * (my - ends.start.y));
        if (ds <= lineHitR) {
          return { objId: o.id, end: 'start', oldState: JSON.parse(JSON.stringify(o)) };
        }
        var de = Math.sqrt((mx - ends.end.x) * (mx - ends.end.x) + (my - ends.end.y) * (my - ends.end.y));
        if (de <= lineHitR) {
          return { objId: o.id, end: 'end', oldState: JSON.parse(JSON.stringify(o)) };
        }
      }
      return null;
    }

    function snapshotFor(obj) {
      if (obj.type === 'panel') {
        return { vertices: JSON.parse(JSON.stringify(obj.vertices)) };
      }
      var snap = { transform: JSON.parse(JSON.stringify(obj.transform)) };
      if (obj.type === 'balloon' && obj.tail) {
        snap.tail = JSON.parse(JSON.stringify(obj.tail));
      }
      // 旧集中線: origin がページ絶対 → コマ移動時に一緒にずらす
      if (obj.type === 'effect' && obj.params && obj.params.origin && !obj.params.originRelative) {
        snap.origin = { x: obj.params.origin.x, y: obj.params.origin.y };
      }
      return snap;
    }

    function applyOffset(obj, snap, dx, dy) {
      if (snap.vertices) {
        var nv = [];
        for (var i = 0; i < snap.vertices.length; i++) {
          nv.push({ x: snap.vertices[i].x + dx, y: snap.vertices[i].y + dy });
        }
        obj.vertices = nv;
        return;
      }
      obj.transform.x = snap.transform.x + dx;
      obj.transform.y = snap.transform.y + dy;
      if (snap.tail && obj.tail) {
        var keys = ['basePoint', 'curvePoint', 'tipPoint'];
        for (var k = 0; k < keys.length; k++) {
          if (snap.tail[keys[k]] && obj.tail[keys[k]]) {
            obj.tail[keys[k]].x = snap.tail[keys[k]].x + dx;
            obj.tail[keys[k]].y = snap.tail[keys[k]].y + dy;
          }
        }
      }
      if (snap.origin && obj.params && obj.params.origin && !obj.params.originRelative) {
        obj.params.origin.x = snap.origin.x + dx;
        obj.params.origin.y = snap.origin.y + dy;
      }
    }

    function beginGroupMove(mx, my) {
      var ids = selection.getSelectedIds();
      // 融合グループは必ず一体で移動（片割れだけ動いて見た目が分離しないように）
      if (selection.expandFusionIds) {
        ids = selection.expandFusionIds(project, ids) || ids;
      }
      moveTargets = [];
      var added = {};
      var selectedPanelIds = {};
      for (var i = 0; i < ids.length; i++) {
        var obj = ME.SceneGraph.getObjectById(project, ids[i]);
        if (obj && !obj.locked) {
          moveTargets.push({ id: ids[i], old: snapshotFor(obj) });
          added[ids[i]] = true;
          if (obj.type === 'panel') selectedPanelIds[obj.id] = true;
        }
      }
      // 選択したコマに属する画像・効果も一緒に動かす
      var images = project.page.images || [];
      for (var j = 0; j < images.length; j++) {
        var im = images[j];
        if (im.panelId && selectedPanelIds[im.panelId] && !added[im.id] && !im.locked) {
          moveTargets.push({ id: im.id, old: snapshotFor(im) });
          added[im.id] = true;
        }
      }
      var effects = project.page.effects || [];
      for (var ei = 0; ei < effects.length; ei++) {
        var ef = effects[ei];
        if (ef.panelId && selectedPanelIds[ef.panelId] && !added[ef.id] && !ef.locked) {
          moveTargets.push({ id: ef.id, old: snapshotFor(ef) });
          added[ef.id] = true;
        }
      }
      isDragging = true;
      moved = false;
      dragStartX = mx;
      dragStartY = my;
    }

    function onMouseDown(e) {
      // 左ボタンのみ（中/右クリックで選択操作を始めない）
      if (typeof e.button === 'number' && e.button !== 0) return;

      var m = getMouse(e);
      var mx = m.x, my = m.y;

      // 0) 選択中の吹き出しのしっぽハンドルを最優先で編集
      var th = findTailHandle(mx, my);
      if (th) {
        tailEdit = th;
        isDragging = true;
        dragStartX = mx;
        dragStartY = my;
        return;
      }

      // 0.5) 下書き直線の端点ハンドル
      var lh = findDraftLineHandle(mx, my);
      if (lh) {
        lineEdit = lh;
        isDragging = true;
        dragStartX = mx;
        dragStartY = my;
        return;
      }

      // 0.6) 集中線の焦点ハンドル
      var oh = findOriginHandle(mx, my);
      if (oh) {
        originEdit = oh;
        isDragging = true;
        dragStartX = mx;
        dragStartY = my;
        return;
      }

      // 1) 選択中オブジェクトのハンドル判定を最優先
      var selIds = selection.getSelectedIds();
      for (var i = 0; i < selIds.length; i++) {
        var sObj = ME.SceneGraph.getObjectById(project, selIds[i]);
        if (!sObj || sObj.locked) continue;

        // 直線は矩形コーナー/回転ではなく端点ハンドルのみ
        if (sObj.type === 'memo') continue;
        if (sObj.type === 'draft' && sObj.kind === 'line') continue;

        var handleIdx = findHandleAt(mx, my, sObj);
        if (handleIdx >= 0) {
          resizeHandleIdx = handleIdx;
          resizeObjId = selIds[i];
          resizeOldState = JSON.parse(JSON.stringify(sObj));
          isDragging = true;
          dragStartX = mx;
          dragStartY = my;
          return;
        }

        if (sObj.type !== 'panel' && isOnRotateHandle(mx, my, sObj)) {
          resizeHandleIdx = 4;
          resizeObjId = selIds[i];
          resizeOldState = JSON.parse(JSON.stringify(sObj));
          // 相対回転方式: bbox中心をピボットとし、掴んだ時点の角度と回転値を保存
          var rotBB = selection.getBoundingBox(sObj, project);
          if (rotBB) {
            rotatePivot = { x: rotBB.x + rotBB.w / 2, y: rotBB.y + rotBB.h / 2 };
          } else {
            rotatePivot = { x: sObj.transform.x, y: sObj.transform.y };
          }
          rotateStartAngle = Math.atan2(my - rotatePivot.y, mx - rotatePivot.x);
          rotateBaseRotation = (sObj.transform && sObj.transform.rotation) || 0;
          isDragging = true;
          dragStartX = mx;
          dragStartY = my;
          return;
        }
      }

      var hits = filterHits(selection.hitTest(mx, my, project, hitTestOpts()));

      // 2) Shift: 加算選択して一括移動（動かさなければトグル解除）
      //    融合グループは一体として加算/解除
      if (e.shiftKey) {
        if (hits.length > 0) {
          var hitId = hits[0];
          if (!selection.isSelected(hitId)) {
            toggleFusion(hitId);
            toggleCandidate = null;
          } else {
            // 融合メンバー全体を候補に（mouseupで動かなければ一体解除）
            toggleCandidate = hitId;
          }
          beginGroupMove(mx, my);
          renderEngine.setDirty();
          return;
        }
        isRubberBand = true;
        rubberBandX1 = rubberBandX2 = mx;
        rubberBandY1 = rubberBandY2 = my;
        renderEngine.renderNow();
        return;
      }

      // 3) 通常クリック（Shiftなし）
      if (hits.length > 0) {
        var hitId2 = hits[0];
        if (selection.isSelected(hitId2)) {
          beginGroupMove(mx, my);
          renderEngine.setDirty();
          return;
        }
        // 別のオブジェクトをクリックした場合:
        //  ・現在の選択と同じ種類（セリフ同士など）→ 選択を移す + 移動開始
        //  ・違う種類 → 選択をクリア（空白クリックと同様）。これにより
        //    テキスト選択中に吹き出しをクリックしても選択が残らず、evaluateSelectMode で
        //    元の作成ツール（text/balloon など）に復帰しやすくなる。
        var curType = commonSelectedType();
        var hitType = objType(hitId2);
        if (curType === null || hitType === curType) {
          selectFusionOnly(hitId2);
          beginGroupMove(mx, my);
          renderEngine.setDirty();
        } else {
          // 違う種類（例: テキスト選択中に吹き出しクリック）→ 空白クリックと同じくクリア
          selection.clear();
          renderEngine.setDirty();
        }
        return;
      }

      // 4) 空白クリック
      // 吹き出し（またはセリフ）ステップで一時的に select モードになっている状態で、
      // Shiftなしの空ドラッグを検知したらラバーバンドを開始せず、selection.clear() のみ行う。
      // mouseup 時に evaluateSelectMode がツールを balloon/text に復帰させる。
      // これにより「選択中に空ドラッグ → エリアセレクトモード」にならず、次の作成に移行しやすくなる。
      if (e.button === 0) {
        selection.clear();
        if (ME.currentStep === 'paper' || e.shiftKey) {
          isRubberBand = true;
          rubberBandX1 = rubberBandX2 = mx;
          rubberBandY1 = rubberBandY2 = my;
        }
        renderEngine.setDirty();
      }
    }

    function onMouseMove(e) {
      // ウィンドウ外で mouseup された場合の取りこぼし対策:
      // ドラッグ中に左ボタンが離れていたら mouseup 扱いで確定する
      if ((isDragging || isRubberBand) &&
          typeof e.buttons === 'number' && (e.buttons & 1) === 0) {
        onMouseUp(e);
        return;
      }

      var m = getMouse(e);
      var mx = m.x, my = m.y;

      if (isDragging && tailEdit) {
        var to = ME.SceneGraph.getObjectById(project, tailEdit.objId);
        if (to && to.tail && to.tail[tailEdit.key]) {
          to.tail[tailEdit.key].x = mx;
          to.tail[tailEdit.key].y = my;
          renderEngine.setDirty();
        }
        return;
      }

      if (isDragging && lineEdit) {
        var lo = ME.SceneGraph.getObjectById(project, lineEdit.objId);
        if (lo && lo.type === 'draft' && lo.kind === 'line') {
          var ends = getDraftLineWorldEnds(lineEdit.oldState || lo);
          // oldState 基準の反対側端点を固定しつつ、掴んだ側をマウスへ
          var fixedStart = ends.start;
          var fixedEnd = ends.end;
          if (lineEdit.end === 'start') {
            setDraftLineWorldEnds(lo, { x: mx, y: my }, fixedEnd);
          } else {
            setDraftLineWorldEnds(lo, fixedStart, { x: mx, y: my });
          }
          renderEngine.setDirty();
        }
        return;
      }

      if (isDragging && originEdit) {
        var oo = ME.SceneGraph.getObjectById(project, originEdit.objId);
        if (oo && oo.params) {
          setOriginFromDisplay(oo, mx, my);
          renderEngine.setDirty();
        }
        return;
      }

      if (isDragging && moveTargets) {
        var dx = mx - dragStartX;
        var dy = my - dragStartY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
        for (var i = 0; i < moveTargets.length; i++) {
          var obj = ME.SceneGraph.getObjectById(project, moveTargets[i].id);
          if (obj) applyOffset(obj, moveTargets[i].old, dx, dy);
        }
        renderEngine.setDirty();
        return;
      }

      if (isDragging && resizeObjId) {
        var rObj = ME.SceneGraph.getObjectById(project, resizeObjId);
        if (rObj) {
          if (resizeHandleIdx === 4) {
            var cx = rotatePivot ? rotatePivot.x : rObj.transform.x;
            var cy = rotatePivot ? rotatePivot.y : rObj.transform.y;
            var curAngle = Math.atan2(my - cy, mx - cx);
            var deg = rotateBaseRotation + (curAngle - rotateStartAngle) * 180 / Math.PI;
            rObj.transform.rotation = ((deg % 360) + 360) % 360;
          } else if (rObj.type === 'panel') {
            var HANDLE_TO_VERTEX = [0, 1, 3, 2];
            var vIdx = HANDLE_TO_VERTEX[resizeHandleIdx];
            var dx2 = mx - dragStartX;
            var dy2 = my - dragStartY;
            var newVertices = JSON.parse(JSON.stringify(resizeOldState.vertices));
            if (vIdx !== undefined && newVertices[vIdx]) {
              var rawX = resizeOldState.vertices[vIdx].x + dx2;
              var rawY = resizeOldState.vertices[vIdx].y + dy2;
              if (ME.Tools && ME.Tools.Panel && typeof ME.Tools.Panel.snapPoint === 'function') {
                var sp = ME.Tools.Panel.snapPoint(rawX, rawY);
                newVertices[vIdx].x = sp.x;
                newVertices[vIdx].y = sp.y;
              } else {
                newVertices[vIdx].x = rawX;
                newVertices[vIdx].y = rawY;
              }
            }
            rObj.vertices = newVertices;
          } else if (rObj.type === 'image') {
            // 画像は縦横比を保って拡縮（中心からの距離比）
            var cxI = rObj.transform.x, cyI = rObj.transform.y;
            var d0I = Math.sqrt((dragStartX - cxI) * (dragStartX - cxI) + (dragStartY - cyI) * (dragStartY - cyI)) || 1;
            var d1I = Math.sqrt((mx - cxI) * (mx - cxI) + (my - cyI) * (my - cyI));
            var nsI = Math.max(0.1, (resizeOldState.transform.scaleX || 1) * (d1I / d0I));
            rObj.transform.scaleX = nsI;
            rObj.transform.scaleY = nsI;
          } else if (rObj.type === 'balloon' && resizeOldState.size) {
            // 吹き出し: size をピクセル単位で変更し、対角の隅を固定
            // サイズ符号: 左/上ハンドルは dx/dy と逆方向にサイズ変化
            // 中心: 固定辺から再計算（min クランプ後も対角がずれない）
            var dx3 = mx - dragStartX;
            var dy3 = my - dragStartY;
            var sx = (resizeHandleIdx === 0 || resizeHandleIdx === 2) ? -1 : 1;
            var sy = (resizeHandleIdx === 0 || resizeHandleIdx === 1) ? -1 : 1;
            var oldBW = resizeOldState.size.width;
            var oldBH = resizeOldState.size.height;
            var newBW = Math.max(20, oldBW + sx * dx3);
            var newBH = Math.max(15, oldBH + sy * dy3);
            rObj.size.width = newBW;
            rObj.size.height = newBH;
            if (sx < 0) {
              rObj.transform.x = (resizeOldState.transform.x + oldBW / 2) - newBW / 2;
            } else {
              rObj.transform.x = (resizeOldState.transform.x - oldBW / 2) + newBW / 2;
            }
            if (sy < 0) {
              rObj.transform.y = (resizeOldState.transform.y + oldBH / 2) - newBH / 2;
            } else {
              rObj.transform.y = (resizeOldState.transform.y - oldBH / 2) + newBH / 2;
            }
            rObj.transform.scaleX = resizeOldState.transform.scaleX || 1;
            rObj.transform.scaleY = resizeOldState.transform.scaleY || 1;
          } else if (rObj.type === 'draft') {
            // 下書き: 円/四角は params をピクセル単位で変更（吹き出しと同じ対角固定）
            // 直線は表示サイズから scale を再計算
            var ddx = mx - dragStartX;
            var ddy = my - dragStartY;
            var dsx = (resizeHandleIdx === 0 || resizeHandleIdx === 2) ? -1 : 1;
            var dsy = (resizeHandleIdx === 0 || resizeHandleIdx === 1) ? -1 : 1;
            var oldScaleX = resizeOldState.transform.scaleX || 1;
            var oldScaleY = resizeOldState.transform.scaleY || 1;
            var op = resizeOldState.params || {};

            if (rObj.kind === 'circle' || rObj.kind === 'rect') {
              var baseW = Math.abs(op.width != null ? op.width : (op.radius != null ? op.radius * 2 : 60));
              var baseH = Math.abs(op.height != null ? op.height : (op.radius != null ? op.radius * 2 : 40));
              var dispW = baseW * Math.abs(oldScaleX);
              var dispH = baseH * Math.abs(oldScaleY);
              var newW = Math.max(4, dispW + dsx * ddx);
              var newH = Math.max(4, dispH + dsy * ddy);
              if (!rObj.params) rObj.params = {};
              rObj.params.width = newW;
              rObj.params.height = newH;
              if (rObj.params.radius != null) delete rObj.params.radius;
              if (dsx < 0) {
                rObj.transform.x = (resizeOldState.transform.x + dispW / 2) - newW / 2;
              } else {
                rObj.transform.x = (resizeOldState.transform.x - dispW / 2) + newW / 2;
              }
              if (dsy < 0) {
                rObj.transform.y = (resizeOldState.transform.y + dispH / 2) - newH / 2;
              } else {
                rObj.transform.y = (resizeOldState.transform.y - dispH / 2) + newH / 2;
              }
              rObj.transform.scaleX = 1;
              rObj.transform.scaleY = 1;
            } else if (rObj.kind === 'line') {
              var lsx = op.startX || 0, lsy = op.startY || 0;
              var lex = op.endX || 0, ley = op.endY || 0;
              var lineBaseW = Math.abs(lex - lsx) || 1;
              var lineBaseH = Math.abs(ley - lsy) || 1;
              var lineDispW = lineBaseW * Math.abs(oldScaleX);
              var lineDispH = lineBaseH * Math.abs(oldScaleY);
              var lineNewW = Math.max(1, lineDispW + dsx * ddx);
              var lineNewH = Math.max(1, lineDispH + dsy * ddy);
              rObj.transform.scaleX = lineNewW / lineBaseW;
              rObj.transform.scaleY = lineNewH / lineBaseH;
              // transform は始点。左/上を動かすときは始点をずらし、右/下は始点固定
              if (dsx < 0) {
                rObj.transform.x = resizeOldState.transform.x + (lineDispW - lineNewW);
              } else {
                rObj.transform.x = resizeOldState.transform.x;
              }
              if (dsy < 0) {
                rObj.transform.y = resizeOldState.transform.y + (lineDispH - lineNewH);
              } else {
                rObj.transform.y = resizeOldState.transform.y;
              }
            } else if (rObj.kind === 'string') {
              // 文字列: 原点=左上。scale で拡縮し、左/上ハンドル時は原点をずらす
              var oldBB = selection.getBoundingBox(resizeOldState, project) || { w: 40, h: 24 };
              var strDispW = Math.max(4, oldBB.w);
              var strDispH = Math.max(4, oldBB.h);
              var strNewW = Math.max(4, strDispW + dsx * ddx);
              var strNewH = Math.max(4, strDispH + dsy * ddy);
              rObj.transform.scaleX = Math.max(0.1, (strNewW / strDispW) * Math.abs(oldScaleX));
              rObj.transform.scaleY = Math.max(0.1, (strNewH / strDispH) * Math.abs(oldScaleY));
              if (dsx < 0) {
                rObj.transform.x = resizeOldState.transform.x + (strDispW - strNewW);
              } else {
                rObj.transform.x = resizeOldState.transform.x;
              }
              if (dsy < 0) {
                rObj.transform.y = resizeOldState.transform.y + (strDispH - strNewH);
              } else {
                rObj.transform.y = resizeOldState.transform.y;
              }
            }
          } else {
            // その他: 従来の近似スケール
            var dx3b = mx - dragStartX;
            var dy3b = my - dragStartY;
            if (resizeHandleIdx === 0 || resizeHandleIdx === 2) {
              rObj.transform.scaleX = Math.max(0.1, (resizeOldState.transform.scaleX || 1) - dx3b / 100);
            } else {
              rObj.transform.scaleX = Math.max(0.1, (resizeOldState.transform.scaleX || 1) + dx3b / 100);
            }
            if (resizeHandleIdx === 0 || resizeHandleIdx === 1) {
              rObj.transform.scaleY = Math.max(0.1, (resizeOldState.transform.scaleY || 1) - dy3b / 100);
            } else {
              rObj.transform.scaleY = Math.max(0.1, (resizeOldState.transform.scaleY || 1) + dy3b / 100);
            }
          }
          renderEngine.setDirty();
        }
        return;
      }

      if (isRubberBand) {
        rubberBandX2 = mx;
        rubberBandY2 = my;
        renderEngine.renderNow();
      }
    }

    function onMouseUp(e) {
      // 左ボタン以外（または button 未定義でない非0）はジェスチャを確定しない
      // ※ 途中の余計な mouseup でラバーバンドが即確定するのを防ぐ
      if (typeof e.button === 'number' && e.button !== 0) {
        return;
      }

      if (isDragging && tailEdit) {
        var to2 = ME.SceneGraph.getObjectById(project, tailEdit.objId);
        if (to2 && to2.tail && to2.tail[tailEdit.key]) {
          var tailNew = { x: to2.tail[tailEdit.key].x, y: to2.tail[tailEdit.key].y };
          if (JSON.stringify(tailEdit.old) !== JSON.stringify(tailNew)) {
            commandStack.push(new ME.Commands.EditVertex(
              tailEdit.objId, tailEdit.old,
              tailNew,
              tailEdit.key
            ));
          }
        }
        tailEdit = null;
      }

      if (isDragging && lineEdit) {
        var lo2 = ME.SceneGraph.getObjectById(project, lineEdit.objId);
        if (lo2) {
          // 全オブジェクト丸ごとではなく変形関連のみ（fusionGroup 等を巻き戻さない）
          var oldSnap = lineEdit.oldState || {};
          var oldPartial = {
            transform: oldSnap.transform ? JSON.parse(JSON.stringify(oldSnap.transform)) : null,
            params: oldSnap.params ? JSON.parse(JSON.stringify(oldSnap.params)) : null
          };
          var newPartial = {
            transform: JSON.parse(JSON.stringify(lo2.transform)),
            params: lo2.params ? JSON.parse(JSON.stringify(lo2.params)) : null
          };
          if (JSON.stringify(oldPartial) !== JSON.stringify(newPartial)) {
            commandStack.push(new ME.Commands.BatchEdit(
              [lineEdit.objId],
              [oldPartial],
              [newPartial]
            ));
          }
        }
        lineEdit = null;
      }

      if (isDragging && originEdit) {
        var oo2 = ME.SceneGraph.getObjectById(project, originEdit.objId);
        if (oo2 && oo2.params) {
          var originNew = { params: JSON.parse(JSON.stringify(oo2.params)) };
          if (JSON.stringify(originEdit.old) !== JSON.stringify(originNew)) {
            commandStack.push(new ME.Commands.BatchEdit(
              [originEdit.objId],
              [originEdit.old],
              [originNew]
            ));
          }
        }
        originEdit = null;
      }

      if (isDragging && moveTargets) {
        if (moved) {
          var ids = [], olds = [], news = [];
          for (var i = 0; i < moveTargets.length; i++) {
            var obj = ME.SceneGraph.getObjectById(project, moveTargets[i].id);
            if (!obj) continue;
            ids.push(moveTargets[i].id);
            olds.push(moveTargets[i].old);
            news.push(snapshotFor(obj));
          }
          if (ids.length > 0) {
            commandStack.push(new ME.Commands.BatchEdit(ids, olds, news));
          }
        } else {
          // 閾値未満の微小ドラッグ: ドラッグ開始時のスナップショットへ書き戻す（位置ズレを残さない）
          for (var ri = 0; ri < moveTargets.length; ri++) {
            var robj = ME.SceneGraph.getObjectById(project, moveTargets[ri].id);
            if (robj) applyOffset(robj, moveTargets[ri].old, 0, 0);
          }
          if (toggleCandidate) {
            // 融合グループは一体としてトグル解除
            toggleFusion(toggleCandidate);
          }
        }
        moveTargets = null;
        toggleCandidate = null;
        moved = false;
      }

      if (isDragging && resizeObjId) {
        var rObj = ME.SceneGraph.getObjectById(project, resizeObjId);
        if (rObj && resizeOldState) {
          // 変形関連フィールドだけ記録（fusionGroup / panelId を巻き込まない）
          function partialSnap(o) {
            var s = {};
            if (o.transform) s.transform = JSON.parse(JSON.stringify(o.transform));
            if (o.vertices) s.vertices = JSON.parse(JSON.stringify(o.vertices));
            if (o.size) s.size = JSON.parse(JSON.stringify(o.size));
            if (o.params) s.params = JSON.parse(JSON.stringify(o.params));
            if (o.tail) s.tail = JSON.parse(JSON.stringify(o.tail));
            return s;
          }
          var resizeOldSnap = partialSnap(resizeOldState);
          var resizeNewSnap = partialSnap(rObj);
          if (JSON.stringify(resizeOldSnap) !== JSON.stringify(resizeNewSnap)) {
            commandStack.push(new ME.Commands.BatchEdit(
              [resizeObjId],
              [resizeOldSnap],
              [resizeNewSnap]
            ));
          }
        }
        resizeObjId = null;
        resizeHandleIdx = -1;
        resizeOldState = null;
        rotatePivot = null;
        rotateStartAngle = 0;
        rotateBaseRotation = 0;
      }

      if (isRubberBand) {
        var rx1 = Math.min(rubberBandX1, rubberBandX2);
        var ry1 = Math.min(rubberBandY1, rubberBandY2);
        var rx2 = Math.max(rubberBandX1, rubberBandX2);
        var ry2 = Math.max(rubberBandY1, rubberBandY2);

        if (rx2 - rx1 >= 3 || ry2 - ry1 >= 3) {
          var hits = filterHits(selection.hitTestRect(rx1, ry1, rx2, ry2, project, hitTestOpts()));
          // 融合グループは一体選択に展開
          hits = selection.expandFusionIds
            ? selection.expandFusionIds(project, hits)
            : hits;
          if (e.shiftKey) {
            selection.addRange(hits);
          } else {
            selection.clear();
            selection.addRange(hits);
          }
        }
        isRubberBand = false;
      }

      // 選択解除・移動・拡縮などの後は必ず再描画（個別解除でハンドルが残るバグの修正）
      renderEngine.setDirty();
      isDragging = false;
    }

    function drawHandles(ctx) {
      // パネルモード（またはグリッド有効時）にグリッドを表示（selectツール使用時も維持）
      if (ME.currentStep === 'panel' &&
          ME.Tools && ME.Tools.Panel && typeof ME.Tools.Panel.drawGrid === 'function') {
        ME.Tools.Panel.drawGrid(ctx);
      }

      var selectedIds = selection.getSelectedIds();
      for (var i = 0; i < selectedIds.length; i++) {
        var obj = ME.SceneGraph.getObjectById(project, selectedIds[i]);
        if (!obj || !obj.visible) continue;

        // 校閲メモ: 選択枠のみ（リサイズ・回転なし）
        if (obj.type === 'memo') {
          var mbb = selection.getBoundingBox(obj, project);
          if (mbb && mbb.w > 0) {
            ctx.strokeStyle = '#cc2222';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(mbb.x, mbb.y, mbb.w, mbb.h);
            ctx.setLineDash([]);
          }
          continue;
        }
        // 下書き直線: 端点の◯のみ（矩形ハンドル・回転なし）
        if (obj.type === 'draft' && obj.kind === 'line') {
          var lineEnds = getDraftLineWorldEnds(obj);
          ctx.strokeStyle = '#4A90D9';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(lineEnds.start.x, lineEnds.start.y);
          ctx.lineTo(lineEnds.end.x, lineEnds.end.y);
          ctx.stroke();
          ctx.setLineDash([]);
          drawTailHandle(ctx, lineEnds.start, '#4A90D9');
          drawTailHandle(ctx, lineEnds.end, '#4A90D9');
          continue;
        }

        var bb = selection.getBoundingBox(obj, project);
        if (!bb || bb.w <= 0) continue;

        ctx.fillStyle = '#4A90D9';
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1;

        var corners = cornersOf(bb);
        var hs = HANDLE_SIZE / getZoom();
        for (var j = 0; j < corners.length; j++) {
          var h = corners[j];
          ctx.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
          ctx.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
        }

        if (obj.type !== 'panel') {
          var rotX = bb.x + bb.w / 2;
          var rotY = bb.y - ROTATE_HANDLE_OFFSET;
          ctx.beginPath();
          ctx.moveTo(rotX, bb.y);
          ctx.lineTo(rotX, rotY);
          ctx.strokeStyle = '#4A90D9';
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(rotX, rotY, (HANDLE_SIZE / 2 + 1) / getZoom(), 0, Math.PI * 2);
          ctx.fillStyle = '#4A90D9';
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.stroke();
        }

        ctx.strokeStyle = '#4A90D9';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(bb.x, bb.y, bb.w, bb.h);
        ctx.setLineDash([]);

        // 吹き出しのしっぽハンドル（掴んで動かせる）
        if (obj.type === 'balloon' && obj.tail) {
          drawTailHandle(ctx, obj.tail.basePoint, '#FF6B35');
          drawTailHandle(ctx, obj.tail.tipPoint, '#FF6B35');
          drawTailHandle(ctx, obj.tail.curvePoint, '#FFB347');
        }

        // 集中線の焦点（オレンジ十字）— 相対座標＋回転を考慮した画面位置
        if (obj.type === 'effect' && obj.kind === 'concentration' &&
            obj.params && obj.params.origin) {
          var od = originDisplayOf(obj);
          if (od) drawOriginHandle(ctx, od);
        }
      }

      if (isRubberBand) {
        var rX = Math.min(rubberBandX1, rubberBandX2);
        var rY = Math.min(rubberBandY1, rubberBandY2);
        var rW = Math.abs(rubberBandX2 - rubberBandX1);
        var rH = Math.abs(rubberBandY2 - rubberBandY1);
        ctx.strokeStyle = '#4A90D9';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(rX, rY, rW, rH);
        ctx.setLineDash([]);
      }
    }

    function drawTailHandle(ctx, p, color) {
      if (!p || p.x === undefined) return;
      ctx.fillStyle = color;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (HANDLE_SIZE / 2 + 1) / getZoom(), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 集中線の焦点（ズームに対して画面上ほぼ一定サイズ）
    function drawOriginHandle(ctx, o) {
      if (!o || o.x === undefined) return;
      var zoom = getZoom();
      var r = ORIGIN_HANDLE_R / zoom;
      ctx.save();
      ctx.lineWidth = 1.5 / zoom;
      ctx.fillStyle = '#FF6B35';
      ctx.strokeStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#FF6B35';
      ctx.beginPath();
      ctx.moveTo(o.x - r * 2.2, o.y); ctx.lineTo(o.x + r * 2.2, o.y);
      ctx.moveTo(o.x, o.y - r * 2.2); ctx.lineTo(o.x, o.y + r * 2.2);
      ctx.stroke();
      ctx.restore();
    }

    function cornersOf(bb) {
      return [
        { x: bb.x, y: bb.y },
        { x: bb.x + bb.w, y: bb.y },
        { x: bb.x, y: bb.y + bb.h },
        { x: bb.x + bb.w, y: bb.y + bb.h }
      ];
    }

    function findHandleAt(mx, my, obj) {
      var bb = selection.getBoundingBox(obj, project);
      if (!bb) return -1;
      var corners = cornersOf(bb);
      var hitR = HANDLE_HIT / getZoom();
      for (var i = 0; i < corners.length; i++) {
        if (Math.abs(mx - corners[i].x) <= hitR && Math.abs(my - corners[i].y) <= hitR) {
          return i;
        }
      }
      return -1;
    }

    function isOnRotateHandle(mx, my, obj) {
      var bb = selection.getBoundingBox(obj, project);
      if (!bb) return false;
      var rotX = bb.x + bb.w / 2;
      var rotY = bb.y - ROTATE_HANDLE_OFFSET;
      var dist = Math.sqrt((mx - rotX) * (mx - rotX) + (my - rotY) * (my - rotY));
      return dist <= (HANDLE_HIT + 2) / getZoom();
    }

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return {
      disable: function() {
        renderEngine.removeSelectionOverlayCallback(overlayCallback);
        canvas.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }
    };
  }

  window.ME.Tools.Select = { create: create };
})();
