// ME.Tools.Effect.create(canvas, project, selection, commandStack, renderEngine) — 効果配置ツール
// ME.Tools.Effect.defaultKind — ステップパネルで選択された効果種類（配置時に使用）
// 挙動:
//  ・効果の無いコマをクリック → クリックしたコマに新規配置 → select モードへ（回転ハンドル付き）
//  ・既存の効果をクリック → 選択し select モードへ（重ね置きはしない＝選択しやすさ優先）
//  ・集中線の焦点ハンドルは select-tool 側で編集（effect ツール上でも同一見た目）
// マウス座標はME.Render.Engine.getPagePoint()でページ座標へ変換

window.ME = window.ME || {};
window.ME.Tools = window.ME.Tools || {};

(function() {
  'use strict';

  var HANDLE_R = 6;

  function create(canvas, project, selection, commandStack, renderEngine) {
    var pendingEffectObj = null;
    var originDrag = null; // { objId, old:{params} }
    var isDragging = false;

    var overlayCallback = function(ctx) { drawOriginHandle(ctx); };

    renderEngine.setSelectionOverlayCallback(overlayCallback);

    function getMouse(e) { return ME.Render.Engine.getPagePoint(canvas, e); }
    function getZoom() {
      var z = (ME.Render.Engine && ME.Render.Engine.getZoom) ? ME.Render.Engine.getZoom() : 1;
      return (z && z > 0) ? z : 1;
    }

    function effectAt(mx, my) {
      var hits = selection.hitTest(mx, my, project);
      for (var i = 0; i < hits.length; i++) {
        var o = ME.SceneGraph.getObjectById(project, hits[i]);
        if (o && o.type === 'effect') return o;
      }
      return null;
    }

    // 選択中の焦点ハンドル付きエフェクト
    function selectedOriginEffect() {
      var ids = selection.getSelectedIds();
      for (var i = 0; i < ids.length; i++) {
        var o = ME.SceneGraph.getObjectById(project, ids[i]);
        if (o && o.type === 'effect' && hasOriginHandle(o.kind)) return o;
      }
      return null;
    }
    function hasOriginHandle(kind) {
      if (ME.Effects && typeof ME.Effects.hasOriginHandle === 'function') {
        return ME.Effects.hasOriginHandle(kind);
      }
      return kind === 'concentration';
    }

    function onMouseDown(e) {
      if (e.button !== 0) return;
      var m = getMouse(e);
      var mx = m.x, my = m.y;

      // 集中線の焦点ハンドルを掴んだら位置ドラッグ開始
      var conc = selectedOriginEffect();
      if (conc && conc.params && conc.params.origin) {
        var disp = originDisplayOf(conc);
        if (disp) {
          var hitR = (HANDLE_R * 2 + 6) / getZoom();
          var d = Math.sqrt((mx - disp.x) * (mx - disp.x) + (my - disp.y) * (my - disp.y));
          if (d <= hitR) {
            originDrag = { objId: conc.id, old: { params: JSON.parse(JSON.stringify(conc.params)) } };
            isDragging = true;
            return;
          }
        }
      }

      // 既存の効果をクリック → 選択し、回転/移動できる select モードへ（Shift 不要）
      var hitEffect = effectAt(mx, my);
      if (hitEffect && !hitEffect.locked) {
        pendingEffectObj = hitEffect;
        if (ME.enterSelectModeForObject) {
          ME.enterSelectModeForObject(hitEffect.id);
        } else {
          selection.selectOnly(hitEffect.id);
          renderEngine.setDirty();
        }
        return;
      }

      // 効果の無いコマをクリック → 新規配置（クリックしたコマに付ける）
      var panelId = null;
      var panels = project.page.panels || [];
      for (var i = panels.length - 1; i >= 0; i--) {
        if (pointInPanel(mx, my, panels[i])) { panelId = panels[i].id; break; }
      }
      if (!panelId) return;

      var kind = window.ME.Tools.Effect.defaultKind || 'concentration';
      var effectData = {
        scope: 'panel',
        kind: kind,
        panelId: panelId,
        transform: { x: mx, y: my, rotation: 0, scaleX: 1, scaleY: 1 }
      };
      if (ME.Effects && typeof ME.Effects.defaultParams === 'function') {
        effectData.params = ME.Effects.defaultParams(kind, null);
      }
      var effectObj = ME.SceneGraph.addEffect(project, effectData, panelId);
      if (!effectObj) return;
      if (hasOriginHandle(kind) && effectObj.params) {
        // コマ中心からの相対座標（コマ移動で焦点がズレない）
        var c = panelCenter(panels, panelId);
        effectObj.params.origin = { x: mx - c.x, y: my - c.y };
        effectObj.params.originRelative = true;
      } else if (kind === 'speedLines' && effectObj.params) {
        effectObj.params.origin = { x: 0, y: 0 };
        effectObj.params.originRelative = true;
      }
      commandStack.push(new ME.Commands.AddObject(effectObj));
      pendingEffectObj = effectObj;
      // 配置直後も select へ（回転ハンドル・集中線焦点をすぐ使える）
      if (ME.enterSelectModeForObject) {
        ME.enterSelectModeForObject(effectObj.id);
      } else {
        selection.clear();
        selection.toggle(effectObj.id);
        renderEngine.setDirty();
      }
    }

    function onMouseMove(e) {
      if (!isDragging || !originDrag) return;
      // ウィンドウ外で mouseup された場合の取りこぼし対策
      if (typeof e.buttons === 'number' && (e.buttons & 1) === 0) {
        onMouseUp(e);
        return;
      }
      var m = getMouse(e);
      var o = ME.SceneGraph.getObjectById(project, originDrag.objId);
      if (o && o.params) {
        setOriginFromDisplay(o, m.x, m.y);
        renderEngine.setDirty();
      }
    }

    function onMouseUp(e) {
      if (isDragging && originDrag) {
        var o = ME.SceneGraph.getObjectById(project, originDrag.objId);
        if (o && o.params) {
          commandStack.push(new ME.Commands.BatchEdit(
            [originDrag.objId],
            [originDrag.old],
            [{ params: JSON.parse(JSON.stringify(o.params)) }]
          ));
        }
        originDrag = null;
        isDragging = false;
        renderEngine.setDirty();
      }
    }

    // 選択中の集中線の焦点ハンドル（オレンジの十字）を描画。ズームに関係なく一定サイズ。
    function drawOriginHandle(ctx) {
      var conc = selectedOriginEffect();
      if (!conc || !conc.params || !conc.params.origin) return;
      var o = originDisplayOf(conc);
      if (!o) return;
      var zoom = getZoom();
      var r = HANDLE_R / zoom;
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

    function panelCenter(panels, panelId) {
      for (var i = 0; i < panels.length; i++) {
        if (panels[i].id === panelId) return panelCenterOf(panels[i]);
      }
      return { x: 0, y: 0 };
    }

    function panelCenterOf(panel) {
      var verts = panel.vertices || [];
      if (!verts.length) return { x: 0, y: 0 };
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var i = 0; i < verts.length; i++) {
        if (verts[i].x < minX) minX = verts[i].x;
        if (verts[i].y < minY) minY = verts[i].y;
        if (verts[i].x > maxX) maxX = verts[i].x;
        if (verts[i].y > maxY) maxY = verts[i].y;
      }
      return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    }

    function panelBoundsOfEffect(obj) {
      if (!obj || !obj.panelId) return null;
      var panels = project.page.panels || [];
      for (var i = 0; i < panels.length; i++) {
        if (panels[i].id === obj.panelId) {
          var c = panelCenterOf(panels[i]);
          var verts = panels[i].vertices || [];
          var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (var j = 0; j < verts.length; j++) {
            if (verts[j].x < minX) minX = verts[j].x;
            if (verts[j].y < minY) minY = verts[j].y;
            if (verts[j].x > maxX) maxX = verts[j].x;
            if (verts[j].y > maxY) maxY = verts[j].y;
          }
          return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, cx: c.x, cy: c.y };
        }
      }
      return null;
    }

    function originDisplayOf(obj) {
      var b = panelBoundsOfEffect(obj);
      var rot = (obj.transform && obj.transform.rotation) || 0;
      if (ME.Render.Effect && ME.Render.Effect.concentrationOriginDisplay) {
        return ME.Render.Effect.concentrationOriginDisplay(obj.params, b, rot);
      }
      if (!obj.params || !obj.params.origin) return null;
      return { x: obj.params.origin.x, y: obj.params.origin.y };
    }

    function setOriginFromDisplay(obj, dx, dy) {
      if (!obj.params) obj.params = {};
      var b = panelBoundsOfEffect(obj);
      var rot = (obj.transform && obj.transform.rotation) || 0;
      // 新規操作は相対座標に統一
      if (!obj.params.originRelative) {
        // 旧絶対 → 相対へ一度変換してから編集
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

    function pointInPanel(px, py, panel) {
      var verts = panel.vertices;
      if (!verts || verts.length < 4) return false;
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var i = 0; i < verts.length; i++) {
        if (verts[i].x < minX) minX = verts[i].x;
        if (verts[i].y < minY) minY = verts[i].y;
        if (verts[i].x > maxX) maxX = verts[i].x;
        if (verts[i].y > maxY) maxY = verts[i].y;
      }
      return px >= minX && px <= maxX && py >= minY && py <= maxY;
    }

    function onPropertyChange(objId, prop, value) {
      if (!pendingEffectObj || objId !== pendingEffectObj.id) return;
      if (prop === 'kind') {
        pendingEffectObj.kind = value;
        applyDefaultParams(pendingEffectObj, value);
        renderEngine.setDirty();
      } else if (prop === 'params' && typeof value === 'object') {
        if (!pendingEffectObj.params) pendingEffectObj.params = {};
        for (var pk in value) {
          if (Object.prototype.hasOwnProperty.call(value, pk)) {
            pendingEffectObj.params[pk] = value[pk];
          }
        }
        renderEngine.setDirty();
      }
    }

    function applyDefaultParams(effectObj, kind) {
      if (ME.Effects && typeof ME.Effects.defaultParams === 'function') {
        effectObj.params = ME.Effects.defaultParams(kind, effectObj.params || {});
        return;
      }
      effectObj.params = effectObj.params || {};
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
      },
      onPropertyChange: onPropertyChange
    };
  }

  window.ME.Tools.Effect = window.ME.Tools.Effect || {};
  window.ME.Tools.Effect.create = create;
  window.ME.Tools.Effect.defaultKind = 'concentration';
})();
