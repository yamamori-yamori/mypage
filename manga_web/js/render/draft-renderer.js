// ME.Render.Draft.draw(ctx, obj, opts?) — 単体描画（opts.clipFn でコマクロップ可）
// ME.Render.Draft.drawGroup(ctx, drafts, opts?) — 融合グループを「ひとつの形」として描画
//   ・円/四角は輪郭を合体（吹き出しと同様: stroke → destination-out fill）
//   ・直線はストロークのみ（閉領域を貫く線は内側が消えて繋がって見える）
//   ・文字列は合体後に通常描画
//   ・opts.clipFn: コマ内クロップ（吹き出しと同様）
// kind: 'circle' | 'rect' | 'line' | 'string'
// 線: obj.strokeColor / obj.strokeWidth（未設定時はグレー 4.5px）

window.ME = window.ME || {};
window.ME.Render = window.ME.Render || {};
window.ME.Render.Draft = window.ME.Render.Draft || {};

(function() {
  'use strict';

  var DRAFT_COLOR = 'rgba(140,140,140,0.55)';
  var DRAFT_LINE_WIDTH = 4.5;

  var strokeLayer = null;

  function getStrokeLayer(w, h) {
    if (!strokeLayer) strokeLayer = document.createElement('canvas');
    if (strokeLayer.width !== w || strokeLayer.height !== h) {
      strokeLayer.width = w;
      strokeLayer.height = h;
    }
    var octx = strokeLayer.getContext('2d');
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, w, h);
    return octx;
  }

  function isClosedShape(kind) {
    return kind === 'circle' || kind === 'rect';
  }

  function strokeOf(obj) {
    return {
      color: (obj && obj.strokeColor) || DRAFT_COLOR,
      width: (obj && obj.strokeWidth != null) ? obj.strokeWidth : DRAFT_LINE_WIDTH
    };
  }

  // 現在の transform を適用したうえでパスを構築（stroke/fill は呼び出し側）
  function buildShapePath(c, obj) {
    if (!obj || obj.visible === false) return false;
    var kind = obj.kind;
    if (kind === 'string') return false;

    var t = obj.transform || {};
    var tx = t.x || 0;
    var ty = t.y || 0;
    var rotation = t.rotation || 0;
    var sx = t.scaleX || 1;
    var sy = t.scaleY || 1;

    c.save();
    c.translate(tx, ty);
    if (rotation) c.rotate(rotation * Math.PI / 180);
    if (sx !== 1 || sy !== 1) c.scale(sx, sy);

    c.beginPath();
    if (kind === 'circle') {
      var ew = (obj.params && obj.params.width) || 60;
      var eh = (obj.params && obj.params.height) || 40;
      c.ellipse(0, 0, Math.abs(ew) / 2, Math.abs(eh) / 2, 0, 0, Math.PI * 2);
    } else if (kind === 'rect') {
      var w = (obj.params && obj.params.width) || 60;
      var h = (obj.params && obj.params.height) || 40;
      c.rect(-w / 2, -h / 2, w, h);
    } else if (kind === 'line') {
      var startX = (obj.params && obj.params.startX) || 0;
      var startY = (obj.params && obj.params.startY) || 0;
      var endX = (obj.params && obj.params.endX) || 0;
      var endY = (obj.params && obj.params.endY) || 0;
      c.moveTo(startX, startY);
      c.lineTo(endX, endY);
    } else {
      c.restore();
      return false;
    }
    // path は save 中に構築。stroke/fill 前に restore すると path が消えるため、
    // transform は呼び出し側で restore する必要がある → ここでは restore せず true
    // → 呼び出し側で stroke/fill 後に c.restore()
    return true;
  }

  function strokeShape(c, obj) {
    if (!buildShapePath(c, obj)) return;
    var s = strokeOf(obj);
    c.strokeStyle = s.color;
    c.lineWidth = s.width;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.stroke();
    c.restore();
  }

  function fillClosedShape(c, obj) {
    if (!obj || !isClosedShape(obj.kind)) return;
    if (!buildShapePath(c, obj)) return;
    c.fill();
    c.restore();
  }

  function draw(ctx, obj, opts) {
    if (!obj || (obj.visible === false)) return;
    opts = opts || {};

    ctx.save();
    if (opts.clipFn) opts.clipFn(ctx);

    if (obj.kind === 'string') {
      if (ME.Render.String && ME.Render.String.draw) {
        ME.Render.String.draw(ctx, obj);
      }
      ctx.restore();
      return;
    }

    strokeShape(ctx, obj);
    ctx.restore();
  }

  // 融合グループ描画（吹き出し drawGroup と同じ offscreen 方式）
  // 線色・太さが異なるメンバーが混在する場合は先頭の非stringのスタイルを外周に使う
  function drawGroup(ctx, drafts, opts) {
    if (!drafts || drafts.length === 0) return;
    opts = opts || {};

    // 単体なら通常描画（ページ座標系のまま・clipFn 対応）
    if (drafts.length === 1 && !drafts[0].fusionGroup) {
      draw(ctx, drafts[0], opts);
      return;
    }

    var scale = opts.scale || 1;
    var offX = opts.offsetX || 0;
    var offY = opts.offsetY || 0;
    var w = ctx.canvas.width;
    var h = ctx.canvas.height;

    var s = getStrokeLayer(w, h);
    s.setTransform(scale, 0, 0, scale, offX * scale, offY * scale);
    // 融合シルエットはメンバーごとに stroke してから内部消去
    s.fillStyle = '#000000';

    // 1) 全図形の輪郭を描く（各オブジェクトの線色・太さ）
    for (var i = 0; i < drafts.length; i++) {
      var d = drafts[i];
      if (!d || d.visible === false || d.kind === 'string') continue;
      strokeShape(s, d);
    }

    // 2) 閉図形の内部を消去 → 重なりが1本の外周になる
    s.globalCompositeOperation = 'destination-out';
    for (var i = 0; i < drafts.length; i++) {
      var d2 = drafts[i];
      if (!d2 || d2.visible === false) continue;
      fillClosedShape(s, d2);
    }
    s.globalCompositeOperation = 'source-over';

    // 3) ピクセル等倍で本体キャンバスへ合成（コマ内クロップがあればクリップ）
    // 吹き出しと同様: ページ座標で clip → identity で drawImage
    ctx.save();
    if (opts.clipFn) {
      opts.clipFn(ctx);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(strokeLayer, 0, 0);
    ctx.restore();

    // 4) 文字列はページ座標で通常描画（融合シルエットの上・同じクリップ）
    for (var i = 0; i < drafts.length; i++) {
      var ds = drafts[i];
      if (!ds || ds.visible === false || ds.kind !== 'string') continue;
      draw(ctx, ds, { clipFn: opts.clipFn || null });
    }
  }

  window.ME.Render.Draft.draw = draw;
  window.ME.Render.Draft.drawGroup = drawGroup;
  window.ME.Render.Draft.DEFAULT_COLOR = DRAFT_COLOR;
  window.ME.Render.Draft.DEFAULT_LINE_WIDTH = DRAFT_LINE_WIDTH;
})();
