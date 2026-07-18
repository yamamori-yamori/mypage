// ME.Tools.Panel.create(canvas, project, selection, commandStack, renderEngine) — コマ作成ツール
// ドラッグ開始 → 初期矩形生成 → ドラッグ終了でPanel追加（断ち切り余白の外まで配置可能）
// 4頂点それぞれのハンドル描画・ドラッグ移動（選択し直せば後からでも編集可）
// コマ本体クリックで再選択。空き領域ドラッグで新規作成
// マウス座標はME.Render.Engine.getPagePoint()でページ座標へ変換
// グリッド吸着: ME.Tools.Panel.gridEnabled / gridSize / gridOffsetX / gridOffsetY / gridAngle
//   + 平行四辺形: gridShearXDeg（Y軸垂直のままX方向傾き）/ gridShearYDeg（X軸水平のままY方向傾き）

window.ME = window.ME || {};
window.ME.Tools = window.ME.Tools || {};

(function() {
  'use strict';

  var HANDLE_SIZE = 6;

  function create(canvas, project, selection, commandStack, renderEngine) {
    var isCreating = false;
    var createStartX = 0, createStartY = 0;
    var tempPanel = null;
    var editingVertexIdx = -1;
    var editObjId = null;
    var editOldPoint = null;
    var pendingSelectId = null;
    var pendingSelectX = 0;
    var pendingSelectY = 0;

    function getMouse(e) {
      return ME.Render.Engine.getPagePoint(canvas, e);
    }

    function gridState() {
      var P = window.ME.Tools.Panel || {};
      return {
        enabled: !!P.gridEnabled,
        size: (P.gridSize > 0) ? P.gridSize : 20,
        ox: (typeof P.gridOffsetX === 'number') ? P.gridOffsetX : 0,
        oy: (typeof P.gridOffsetY === 'number') ? P.gridOffsetY : 0,
        angle: (typeof P.gridAngle === 'number') ? P.gridAngle : 0,
        // shearX: Y軸は垂直のまま、横辺（X軸方向）だけ傾ける k = tan(deg)
        // shearY: X軸は水平のまま、縦辺（Y軸方向）だけ傾ける
        shearX: (typeof P.gridShearXDeg === 'number') ? P.gridShearXDeg : 0,
        shearY: (typeof P.gridShearYDeg === 'number') ? P.gridShearYDeg : 0
      };
    }

    function shearK(deg) {
      // ±80°超は行列が不安定になりやすいのでクランプ
      var d = deg;
      if (d > 80) d = 80;
      if (d < -80) d = -80;
      return Math.tan(d * Math.PI / 180);
    }

    // ワールド → 格子座標 (u,v)（回転→シア逆変換）
    function worldToGridUV(x, y, g) {
      var rad = g.angle * Math.PI / 180;
      var cos = Math.cos(-rad);
      var sin = Math.sin(-rad);
      var lx = x - g.ox;
      var ly = y - g.oy;
      // 回転解除後の直交近傍座標
      var rx = lx * cos - ly * sin;
      var ry = lx * sin + ly * cos;
      var kX = shearK(g.shearX);
      var kY = shearK(g.shearY);
      // rx = u + v*kY , ry = u*kX + v
      var det = 1 - kX * kY;
      if (Math.abs(det) < 1e-6) det = 1e-6;
      var u = (rx - kY * ry) / det;
      var v = (ry - kX * rx) / det;
      return { u: u, v: v };
    }

    // 格子 (u,v) → ワールド
    function gridUVToWorld(u, v, g) {
      var kX = shearK(g.shearX);
      var kY = shearK(g.shearY);
      var rx = u + v * kY;
      var ry = u * kX + v;
      var rad = g.angle * Math.PI / 180;
      var cos = Math.cos(rad);
      var sin = Math.sin(rad);
      return {
        x: g.ox + rx * cos - ry * sin,
        y: g.oy + rx * sin + ry * cos
      };
    }

    // グリッド吸着（オフセット＋回転＋平行四辺形シア）
    function snapPoint(x, y) {
      var g = gridState();
      if (!g.enabled || !(g.size > 0)) return { x: x, y: y };
      var uv = worldToGridUV(x, y, g);
      var u = Math.round(uv.u / g.size) * g.size;
      var v = Math.round(uv.v / g.size) * g.size;
      return gridUVToWorld(u, v, g);
    }

    // 外部（select-tool など）からグリッド吸着を使えるように公開
    if (!ME.Tools.Panel) ME.Tools.Panel = {};
    ME.Tools.Panel.snapPoint = snapPoint;
    ME.Tools.Panel.drawGrid = drawGrid;

    function panelBounds(verts) {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var i = 0; i < verts.length; i++) {
        if (verts[i].x < minX) minX = verts[i].x;
        if (verts[i].y < minY) minY = verts[i].y;
        if (verts[i].x > maxX) maxX = verts[i].x;
        if (verts[i].y > maxY) maxY = verts[i].y;
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    function pointInPoly(px, py, verts) {
      // 簡易: まずAABB、厳密には ray-cast
      var b = panelBounds(verts);
      if (px < b.x || px > b.x + b.w || py < b.y || py > b.y + b.h) return false;
      var inside = false;
      for (var i = 0, j = verts.length - 1; i < verts.length; j = i++) {
        var xi = verts[i].x, yi = verts[i].y;
        var xj = verts[j].x, yj = verts[j].y;
        var intersect = ((yi > py) !== (yj > py)) &&
          (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-9) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }

    function findVertexHit(mx, my) {
      var panels = project.page.panels || [];
      var zoom = (ME.Render.Engine && ME.Render.Engine.getZoom) ? ME.Render.Engine.getZoom() : 1;
      if (!zoom || zoom <= 0) zoom = 1;
      var hitR = (HANDLE_SIZE + 4) / zoom;
      // 選択中を優先（再編集しやすい）
      var selected = {};
      var ids = selection.getSelectedIds();
      for (var s = 0; s < ids.length; s++) selected[ids[s]] = true;

      function scan(preferSelected) {
        for (var i = panels.length - 1; i >= 0; i--) {
          var panel = panels[i];
          if (panel.locked || !panel.visible || !panel.vertices) continue;
          if (preferSelected && !selected[panel.id]) continue;
          if (!preferSelected && selected[panel.id]) continue;
          for (var v = 0; v < panel.vertices.length; v++) {
            var vert = panel.vertices[v];
            var dx = mx - vert.x;
            var dy = my - vert.y;
            if (dx * dx + dy * dy <= hitR * hitR) {
              return { panel: panel, idx: v };
            }
          }
        }
        return null;
      }
      return scan(true) || scan(false);
    }

    function findPanelBodyHit(mx, my) {
      var panels = project.page.panels || [];
      for (var i = panels.length - 1; i >= 0; i--) {
        var panel = panels[i];
        if (panel.locked || panel.visible === false || !panel.vertices) continue;
        if (pointInPoly(mx, my, panel.vertices)) return panel;
      }
      return null;
    }

    function onMouseDown(e) {
      if (e.button !== 0) return;
      var m = getMouse(e);
      var mx = m.x, my = m.y;
      pendingSelectId = null;
      isCreating = false;
      tempPanel = null;

      // 1) 頂点ハンドル（選択中優先）→ 自由移動
      var vh = findVertexHit(mx, my);
      if (vh) {
        editObjId = vh.panel.id;
        editingVertexIdx = vh.idx;
        editOldPoint = { x: vh.panel.vertices[vh.idx].x, y: vh.panel.vertices[vh.idx].y };
        selection.selectOnly(vh.panel.id);
        renderEngine.setDirty();
        return;
      }

      // 2) コマ本体 → 選択（ドラッグが小さければ確定、大きければ新規作成にしない）
      var body = findPanelBodyHit(mx, my);
      if (body) {
        pendingSelectId = body.id;
        pendingSelectX = mx;
        pendingSelectY = my;
        selection.selectOnly(body.id);
        renderEngine.setDirty();
        return;
      }

      // 3) 空き領域 → 新規作成開始
      selection.clear();
      var sp = snapPoint(mx, my);
      isCreating = true;
      createStartX = sp.x;
      createStartY = sp.y;
      renderEngine.setDirty();
    }

    function onMouseMove(e) {
      // ウィンドウ外で mouseup された場合の取りこぼし対策
      if ((isCreating || editingVertexIdx >= 0 || pendingSelectId) &&
          typeof e.buttons === 'number' && (e.buttons & 1) === 0) {
        onMouseUp(e);
        return;
      }

      var m = getMouse(e);
      var rawX = m.x, rawY = m.y;
      var sp = snapPoint(rawX, rawY);
      var mx = sp.x, my = sp.y;

      // 本体クリック後に大きく動かしたら「空きでの作成」扱いにはせず選択維持
      if (pendingSelectId) {
        var pdx = rawX - pendingSelectX;
        var pdy = rawY - pendingSelectY;
        if (pdx * pdx + pdy * pdy > 16) {
          // 移動は select-tool 側。panel-tool では選択のみ維持
          pendingSelectId = null;
        }
        renderEngine.setDirty();
        return;
      }

      if (isCreating && !tempPanel) {
        tempPanel = ME.Core.Models.Panel.create([
          { x: Math.min(createStartX, mx), y: Math.min(createStartY, my) },
          { x: Math.max(createStartX, mx), y: Math.min(createStartY, my) },
          { x: Math.max(createStartX, mx), y: Math.max(createStartY, my) },
          { x: Math.min(createStartX, mx), y: Math.max(createStartY, my) }
        ]);
      }

      if (isCreating && tempPanel) {
        var minX = Math.min(createStartX, mx);
        var minY = Math.min(createStartY, my);
        var maxX = Math.max(createStartX, mx);
        var maxY = Math.max(createStartY, my);

        tempPanel.vertices[0] = { x: minX, y: minY };
        tempPanel.vertices[1] = { x: maxX, y: minY };
        tempPanel.vertices[2] = { x: maxX, y: maxY };
        tempPanel.vertices[3] = { x: minX, y: maxY };

        renderEngine.renderNow();
      }

      if (editingVertexIdx >= 0 && editObjId) {
        var obj = ME.SceneGraph.getObjectById(project, editObjId);
        if (obj && obj.vertices[editingVertexIdx]) {
          obj.vertices[editingVertexIdx] = { x: mx, y: my };
          renderEngine.renderNow();
        }
      }
    }

    function onMouseUp(e) {
      if (pendingSelectId) {
        // クリックのみ: 選択を維持（頂点ハンドル表示）
        pendingSelectId = null;
        renderEngine.setDirty();
        return;
      }

      if (editingVertexIdx >= 0 && editObjId) {
        var obj = ME.SceneGraph.getObjectById(project, editObjId);
        if (obj && obj.vertices[editingVertexIdx]) {
          var newPoint = JSON.parse(JSON.stringify(obj.vertices[editingVertexIdx]));
          if (JSON.stringify(editOldPoint) !== JSON.stringify(newPoint)) {
            var cmd = new ME.Commands.EditVertex(
              editObjId,
              editOldPoint,
              newPoint,
              editingVertexIdx
            );
            commandStack.push(cmd);
          }
        }
        editingVertexIdx = -1;
        editObjId = null;
        renderEngine.setDirty();
        return;
      }

      if (isCreating && tempPanel) {
        var w = Math.abs(tempPanel.vertices[1].x - tempPanel.vertices[0].x);
        var h = Math.abs(tempPanel.vertices[3].y - tempPanel.vertices[0].y);
        if (w < 5 || h < 5) {
          tempPanel = null;
          isCreating = false;
          renderEngine.setDirty();
          return;
        }

        var maxZ = -1;
        var panels2 = project.page.panels;
        for (var i = 0; i < panels2.length; i++) {
          if (panels2[i].zIndex > maxZ) maxZ = panels2[i].zIndex;
        }
        tempPanel.zIndex = maxZ + 1;
        panels2.push(tempPanel);

        var cmd2 = new ME.Commands.AddPanel(tempPanel);
        commandStack.push(cmd2);

        selection.clear();
        selection.toggle(tempPanel.id);

        tempPanel = null;
        isCreating = false;
        renderEngine.setDirty();
        return;
      }

      if (isCreating && !tempPanel) {
        isCreating = false;
        return;
      }

      isCreating = false;
      renderEngine.setDirty();
    }

    // クリック位置に既存コマがあれば「絵を入れる」ステップへ切り替える通知
    function handlePanelClick(px, py) {
      var panels = project.page.panels || [];
      for (var i = panels.length - 1; i >= 0; i--) {
        var p = panels[i];
        if (p.locked || p.visible === false || !p.vertices) continue;
        var b = panelBounds(p.vertices);
        if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
          if (window.ME.Tools.Panel && typeof window.ME.Tools.Panel.onEmptyPanelClick === 'function') {
            window.ME.Tools.Panel.onEmptyPanelClick(p.id);
          }
          return;
        }
      }
    }

    function drawSizeLabel(ctx, bb) {
      if (!bb || bb.w <= 0 || bb.h <= 0) return;
      var zoom = (ME.Render.Engine && ME.Render.Engine.getZoom) ? ME.Render.Engine.getZoom() : 1;
      if (!zoom || zoom <= 0) zoom = 1;
      var wPx = Math.round(bb.w), hPx = Math.round(bb.h);
      var wMm = Math.round(bb.w * 25.4 / 96), hMm = Math.round(bb.h * 25.4 / 96);
      var label = wPx + '\u00d7' + hPx + 'px\uff08' + wMm + '\u00d7' + hMm + 'mm\uff09';

      ctx.save();
      var fontPx = 12 / zoom;
      var pad = 4 / zoom;
      ctx.font = fontPx + 'px sans-serif';
      ctx.textBaseline = 'top';
      var tw = ctx.measureText(label).width;
      var bx = bb.x, by = bb.y - (fontPx + pad * 2) - (2 / zoom);
      if (by < bb.y - bb.h) by = bb.y;
      ctx.fillStyle = 'rgba(30, 30, 34, 0.85)';
      ctx.fillRect(bx, by, tw + pad * 2, fontPx + pad * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(label, bx + pad, by + pad);
      ctx.restore();
    }

    // グリッド線（オフセット＋角度＋平行四辺形シア）
    function drawGrid(ctx) {
      var g = gridState();
      if (!g.enabled || !(g.size > 0)) return;
      var pw = Math.round(project.page.size.widthMm * 96 / 25.4);
      var ph = Math.round(project.page.size.heightMm * 96 / 25.4);
      var zoom = (ME.Render.Engine && ME.Render.Engine.getZoom) ? ME.Render.Engine.getZoom() : 1;
      if (!zoom || zoom <= 0) zoom = 1;

      ctx.save();
      ctx.strokeStyle = 'rgba(74, 144, 217, 0.25)';
      ctx.lineWidth = 1 / zoom;

      var corners = [
        { x: 0, y: 0 }, { x: pw, y: 0 }, { x: pw, y: ph }, { x: 0, y: ph }
      ];
      var minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      var i, uv;
      for (i = 0; i < corners.length; i++) {
        uv = worldToGridUV(corners[i].x, corners[i].y, g);
        if (uv.u < minU) minU = uv.u;
        if (uv.u > maxU) maxU = uv.u;
        if (uv.v < minV) minV = uv.v;
        if (uv.v > maxV) maxV = uv.v;
      }
      minU = Math.floor(minU / g.size) * g.size - g.size;
      maxU = Math.ceil(maxU / g.size) * g.size + g.size;
      minV = Math.floor(minV / g.size) * g.size - g.size;
      maxV = Math.ceil(maxV / g.size) * g.size + g.size;

      var t0, t1, u, v;
      // u = const の線（主に Y 方向／シア後は傾き得る）
      for (u = minU; u <= maxU + 0.001; u += g.size) {
        t0 = gridUVToWorld(u, minV, g);
        t1 = gridUVToWorld(u, maxV, g);
        ctx.beginPath();
        ctx.moveTo(t0.x, t0.y);
        ctx.lineTo(t1.x, t1.y);
        ctx.stroke();
      }
      // v = const の線
      for (v = minV; v <= maxV + 0.001; v += g.size) {
        t0 = gridUVToWorld(minU, v, g);
        t1 = gridUVToWorld(maxU, v, g);
        ctx.beginPath();
        ctx.moveTo(t0.x, t0.y);
        ctx.lineTo(t1.x, t1.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawOverlay(ctx) {
      drawGrid(ctx);
      // 頂点ハンドル描画（選択中の全panel）＋サイズ表示
      var selectedIds = selection.getSelectedIds();
      for (var s = 0; s < selectedIds.length; s++) {
        var obj = ME.SceneGraph.getObjectById(project, selectedIds[s]);
        if (obj && obj.type === 'panel' && obj.vertices) {
          // 辺を薄く強調
          ctx.save();
          ctx.strokeStyle = 'rgba(255, 107, 53, 0.85)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(obj.vertices[0].x, obj.vertices[0].y);
          for (var ei = 1; ei < obj.vertices.length; ei++) {
            ctx.lineTo(obj.vertices[ei].x, obj.vertices[ei].y);
          }
          ctx.closePath();
          ctx.stroke();
          ctx.restore();

          ctx.fillStyle = '#FF6B35';
          ctx.strokeStyle = '#FFFFFF';
          var zoom = (ME.Render.Engine && ME.Render.Engine.getZoom) ? ME.Render.Engine.getZoom() : 1;
          if (!zoom || zoom <= 0) zoom = 1;
          var r = (HANDLE_SIZE / 2 + 1) / zoom;
          for (var i = 0; i < obj.vertices.length; i++) {
            var v = obj.vertices[i];
            ctx.beginPath();
            ctx.arc(v.x, v.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 1 / zoom;
            ctx.stroke();
          }
          drawSizeLabel(ctx, panelBounds(obj.vertices));
        }
      }

      // 作成中のpanelのプレビュー
      if (isCreating && tempPanel) {
        var verts = tempPanel.vertices;
        ctx.beginPath();
        ctx.moveTo(verts[0].x, verts[0].y);
        for (var j = 1; j < verts.length; j++) {
          ctx.lineTo(verts[j].x, verts[j].y);
        }
        ctx.closePath();
        ctx.strokeStyle = '#4A90D9';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#4A90D9';
        var zoomP = (ME.Render.Engine && ME.Render.Engine.getZoom) ? ME.Render.Engine.getZoom() : 1;
        if (!zoomP || zoomP <= 0) zoomP = 1;
        for (var k = 0; k < verts.length; k++) {
          ctx.beginPath();
          ctx.arc(verts[k].x, verts[k].y, (HANDLE_SIZE / 2 + 1) / zoomP, 0, Math.PI * 2);
          ctx.fill();
        }

        drawSizeLabel(ctx, panelBounds(verts));
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
        isCreating = false;
        tempPanel = null;
        editingVertexIdx = -1;
        editObjId = null;
        pendingSelectId = null;
      }
    };
  }

  window.ME.Tools.Panel = { create: create };
  window.ME.Tools.Panel.gridEnabled = true;
  window.ME.Tools.Panel.gridSize = 20;
  window.ME.Tools.Panel.gridOffsetX = 0;
  window.ME.Tools.Panel.gridOffsetY = 0;
  window.ME.Tools.Panel.gridAngle = 0;
  window.ME.Tools.Panel.gridShearXDeg = 0;
  window.ME.Tools.Panel.gridShearYDeg = 0;
})();
