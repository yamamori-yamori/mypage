// ME.Render.Panel — コマ描画
// draw(ctx, panel) — 塗り+枠線（後方互換）
// drawFill(ctx, panel) / drawBorder(ctx, panel) — 単体コマの塗り/枠線（α対応）
// drawFillUnion(ctx, panels, opts) / drawBorderUnion(ctx, panels, opts)
//   — 融合コマ用: 複数コマを1つの形として塗り/外周線のみ描画
//   opts: { scale: 出力スケール(既定1), offsetX/offsetY: レイヤー座標オフセット(既定0) }
// createClipPath(ctx, panel) — 単体コマのクリップ
// createClipPathMulti(ctx, panels) — 融合コマのクリップ（合併領域）
// borderRoughness 0-10: 枠線の「太さ」ガサつきのみ（頂点・中心線は不変。線幅だけ沿線で揺らす）

window.ME = window.ME || {};
window.ME.Render = window.ME.Render || {};
window.ME.Render.Panel = window.ME.Render.Panel || {};

(function() {
  'use strict';

  // 融合描画用オフスクリーン（使い回し）
  var unionLayer = null;

  function getUnionLayer(w, h) {
    if (!unionLayer) unionLayer = document.createElement('canvas');
    if (unionLayer.width !== w || unionLayer.height !== h) {
      unionLayer.width = w;
      unionLayer.height = h;
    }
    var octx = unionLayer.getContext('2d');
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, w, h);
    return octx;
  }

  function addPolygonPath(ctx, panel) {
    var verts = panel.vertices;
    ctx.moveTo(verts[0].x, verts[0].y);
    for (var i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x, verts[i].y);
    }
    ctx.closePath();
  }

  function buildPath(ctx, panel) {
    ctx.beginPath();
    addPolygonPath(ctx, panel);
  }

  // 複数コマの合併パス（nonzero windingで合併塗り/クリップになる）
  function buildUnionPath(ctx, panels) {
    ctx.beginPath();
    for (var i = 0; i < panels.length; i++) {
      if (panels[i] && panels[i].vertices && panels[i].vertices.length >= 4) {
        addPolygonPath(ctx, panels[i]);
      }
    }
  }

  // --- 単体コマ ---
  function drawFill(ctx, panel) {
    if (!panel || !panel.vertices || panel.vertices.length < 4) return;
    if (!panel.fillColor) return;

    buildPath(ctx, panel);
    ctx.fillStyle = ME.Core.Color.toRgba(panel.fillColor, panel.fillAlpha !== undefined ? panel.fillAlpha : 100);
    ctx.fill();
  }

  function drawBorder(ctx, panel) {
    if (!panel || !panel.vertices || panel.vertices.length < 4) return;

    var borderWidth = panel.borderWidth !== undefined ? panel.borderWidth : 2;
    var rough = normalizeBorderRoughness(panel.borderRoughness);
    ctx.strokeStyle = ME.Core.Color.toRgba(
      panel.borderColor || '#000000',
      panel.borderAlpha !== undefined ? panel.borderAlpha : 100
    );
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (rough > 0 && borderWidth > 0) {
      // 中心線=頂点固定。太さだけ沿線で揺らす
      strokeVariableWidthPolygon(ctx, panel.vertices, borderWidth, rough, panel.id || 'panel');
      return;
    }

    buildPath(ctx, panel);
    ctx.lineWidth = borderWidth;
    ctx.lineJoin = 'miter';
    ctx.stroke();
  }

  function draw(ctx, panel) {
    drawFill(ctx, panel);
    drawBorder(ctx, panel);
  }

  // --- 融合コマ（複数を1つの形として描画） ---
  // スタイルは先頭コマのものを使用する
  function drawFillUnion(ctx, panels, opts) {
    if (!panels || panels.length === 0) return;
    if (panels.length === 1) { drawFill(ctx, panels[0]); return; }
    var lead = panels[0];
    if (!lead.fillColor) return;

    opts = opts || {};
    var scale = opts.scale || 1;
    var offX = opts.offsetX || 0;
    var offY = opts.offsetY || 0;

    var o = getUnionLayer(ctx.canvas.width, ctx.canvas.height);
    o.setTransform(scale, 0, 0, scale, offX * scale, offY * scale);
    buildUnionPath(o, panels);
    o.fillStyle = lead.fillColor; // 不透明で描き、合成時にαを適用
    o.fill();

    compose(ctx, (lead.fillAlpha !== undefined ? lead.fillAlpha : 100) / 100);
  }

  function drawBorderUnion(ctx, panels, opts) {
    if (!panels || panels.length === 0) return;
    var lead = panels[0];
    var rough = normalizeBorderRoughness(lead.borderRoughness);
    opts = opts || {};
    var scale = opts.scale || 1;
    var offX = opts.offsetX || 0;
    var offY = opts.offsetY || 0;
    var borderWidth = lead.borderWidth !== undefined ? lead.borderWidth : 2;

    // 単体: メイン ctx に直接（既存の zoom/BLEED 変換を利用）
    if (panels.length === 1) {
      drawBorder(ctx, panels[0]);
      return;
    }

    var o = getUnionLayer(ctx.canvas.width, ctx.canvas.height);
    o.setTransform(scale, 0, 0, scale, offX * scale, offY * scale);
    o.strokeStyle = lead.borderColor || '#000000';
    o.lineJoin = 'round';
    o.lineCap = 'round';

    // 各コマの輪郭（vertices は変更しない）
    for (var i = 0; i < panels.length; i++) {
      var p = panels[i];
      if (!p || !p.vertices || p.vertices.length < 4) continue;
      if (rough > 0 && borderWidth > 0) {
        strokeVariableWidthPolygon(o, p.vertices, borderWidth, rough, (lead.id || 'panel') + ':' + i);
      } else {
        o.lineWidth = borderWidth;
        o.lineJoin = 'miter';
        buildPath(o, p);
        o.stroke();
      }
    }
    // 合併領域の内側を消去 → 外周線だけ
    o.globalCompositeOperation = 'destination-out';
    buildUnionPath(o, panels);
    o.fill();
    o.globalCompositeOperation = 'source-over';

    compose(ctx, (lead.borderAlpha !== undefined ? lead.borderAlpha : 100) / 100);
  }

  // レイヤーをαを掛けて等倍合成（現在の変換を無視してピクセル等倍で置く）
  function compose(ctx, alpha) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.drawImage(unionLayer, 0, 0);
    ctx.restore();
  }

  function normalizeBorderRoughness(raw) {
    var rough = raw !== undefined && raw !== null ? Number(raw) : 0;
    if (isNaN(rough) || rough < 0) rough = 0;
    if (rough > 10) rough = Math.round(rough / 10);
    if (rough > 10) rough = 10;
    return rough;
  }

  function hashStr(str) {
    var s = 2166136261;
    str = String(str || '');
    for (var i = 0; i < str.length; i++) {
      s ^= str.charCodeAt(i);
      s = Math.imul(s, 16777619);
    }
    return s | 0;
  }

  function hash01(n) {
    n = (n | 0) * 374761393 + 668265263;
    n = (n ^ (n >>> 13)) * 1274126177;
    n = n ^ (n >>> 16);
    return ((n >>> 0) % 10000) / 10000;
  }

  // 1D なめらかノイズ 0..1（セル間を補間 → 太さ変化がガクつかない）
  function smoothNoise1D(x, seed, cell) {
    var c = cell < 1 ? 1 : cell;
    var fx = x / c;
    var i0 = Math.floor(fx);
    var t = fx - i0;
    t = t * t * (3 - 2 * t);
    var n0 = hash01(seed + i0 * 374761);
    var n1 = hash01(seed + (i0 + 1) * 374761);
    return n0 + (n1 - n0) * t;
  }

  /**
   * 多角形の各辺を短い線分に分割し、線分ごとに lineWidth だけ揺らす。
   * 中心線は verts の直線上（座標ブラなし）。
   * rough 1 でも控えめ、10 で太さ ±約42% 程度。
   */
  function strokeVariableWidthPolygon(ctx, verts, borderWidth, rough, seedStr) {
    if (!verts || verts.length < 2 || borderWidth <= 0) return;
    var seed = hashStr(seedStr);
    // 太さの振れ幅: rough=1 → ±約4%、rough=10 → ±約42%（位置は動かさない）
    var amp = 0.02 + (rough / 10) * 0.40;
    // 沿線の変化周期（ページ px）。大きいほどゆっくり太さが変わる
    var period = Math.max(10, borderWidth * 3 + 14 - rough);
    var step = Math.max(3, Math.min(10, borderWidth * 0.9 + 2.5));
    var n = verts.length;
    var edge;
    var a;
    var b;
    var dx;
    var dy;
    var len;
    var steps;
    var s;
    var t0;
    var t1;
    var x0;
    var y0;
    var x1;
    var y1;
    var distAlong = 0;
    var mid;
    var noise;
    var w;
    var minW = Math.max(0.35, borderWidth * 0.55);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (edge = 0; edge < n; edge++) {
      a = verts[edge];
      b = verts[(edge + 1) % n];
      if (!a || !b) continue;
      dx = b.x - a.x;
      dy = b.y - a.y;
      len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.5) continue;
      steps = Math.max(1, Math.ceil(len / step));
      for (s = 0; s < steps; s++) {
        t0 = s / steps;
        t1 = (s + 1) / steps;
        x0 = a.x + dx * t0;
        y0 = a.y + dy * t0;
        x1 = a.x + dx * t1;
        y1 = a.y + dy * t1;
        mid = distAlong + len * ((t0 + t1) * 0.5);
        // 2 周波を混ぜて単調さを避ける（いずれも粗い）
        noise = smoothNoise1D(mid, seed + edge * 997, period) * 0.65 +
          smoothNoise1D(mid * 0.55, seed + 44027 + edge * 13, period * 1.7) * 0.35;
        w = borderWidth * (1 + (noise - 0.5) * 2 * amp);
        if (w < minW) w = minW;
        if (w > borderWidth * 1.35) w = borderWidth * 1.35;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.lineWidth = w;
        ctx.stroke();
      }
      distAlong += len;
    }
  }

  // --- クリップ ---
  function createClipPath(ctx, panel) {
    if (!panel || !panel.vertices || panel.vertices.length < 4) return;
    buildPath(ctx, panel);
    ctx.clip();
  }

  function createClipPathMulti(ctx, panels) {
    if (!panels || panels.length === 0) return;
    if (panels.length === 1) { createClipPath(ctx, panels[0]); return; }
    buildUnionPath(ctx, panels);
    ctx.clip();
  }

  window.ME.Render.Panel.draw = draw;
  window.ME.Render.Panel.drawFill = drawFill;
  window.ME.Render.Panel.drawBorder = drawBorder;
  window.ME.Render.Panel.drawFillUnion = drawFillUnion;
  window.ME.Render.Panel.drawBorderUnion = drawBorderUnion;
  window.ME.Render.Panel.createClipPath = createClipPath;
  window.ME.Render.Panel.createClipPathMulti = createClipPathMulti;
})();
