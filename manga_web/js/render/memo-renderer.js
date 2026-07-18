// ME.Render.Memo.draw(ctx, obj) — 校閲メモ描画（白縁→赤本体）
// kind: 'freehand' | 'string'
// PNG/印刷では呼ばない（render-engine 編集専用）

window.ME = window.ME || {};
window.ME.Render = window.ME.Render || {};
window.ME.Render.Memo = window.ME.Render.Memo || {};

(function() {
  'use strict';

  var DEF = (ME.Core && ME.Core.MemoDefaults) || {};
  var MEMO_COLOR = DEF.COLOR || '#cc2222';
  var MEMO_WIDTH = DEF.WIDTH != null ? DEF.WIDTH : 2.5;
  var EDGE_COLOR = DEF.EDGE_COLOR || 'rgba(255,255,255,0.95)';
  var EDGE_EXTRA = DEF.EDGE_EXTRA != null ? DEF.EDGE_EXTRA : 2;

  function strokeStyleOf(obj) {
    return (obj && obj.strokeColor) || MEMO_COLOR;
  }

  function strokeWidthOf(obj) {
    return (obj && obj.strokeWidth != null) ? obj.strokeWidth : MEMO_WIDTH;
  }

  function drawFreehand(ctx, obj) {
    var pts = (obj.params && obj.params.points) || [];
    if (pts.length < 2) return;
    var t = obj.transform || {};
    var tx = t.x || 0;
    var ty = t.y || 0;
    var rot = t.rotation || 0;
    var sx = t.scaleX || 1;
    var sy = t.scaleY || 1;
    var w = strokeWidthOf(obj);
    var color = strokeStyleOf(obj);

    ctx.save();
    ctx.translate(tx, ty);
    if (rot) ctx.rotate(rot * Math.PI / 180);
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    function strokePath(width, style) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x || 0, pts[0].y || 0);
      for (var i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x || 0, pts[i].y || 0);
      }
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.stroke();
    }

    strokePath(w + EDGE_EXTRA, EDGE_COLOR);
    strokePath(w, color);
    ctx.restore();
  }

  function draw(ctx, obj) {
    if (!obj || obj.visible === false) return;
    if (obj.kind === 'string') {
      if (ME.Render.String && ME.Render.String.draw) {
        ME.Render.String.draw(ctx, obj);
      }
      return;
    }
    if (obj.kind === 'freehand') {
      drawFreehand(ctx, obj);
    }
  }

  window.ME.Render.Memo.draw = draw;
  window.ME.Render.Memo.COLOR = MEMO_COLOR;
  window.ME.Render.Memo.EDGE_COLOR = EDGE_COLOR;
  window.ME.Render.Memo.EDGE_EXTRA = EDGE_EXTRA;
})();
