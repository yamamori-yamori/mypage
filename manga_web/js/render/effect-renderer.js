// ME.Render.Effect.draw(ctx, effectObj, panelBounds) — 効果描画
//   kind別分岐: flatTone, screenTone, concentration(集中線), speedLines(スピード線), whiteFlash, blackFlash, frame, flatBand, whiteBorder
// ME.Render.Effect.resolveConcentrationOrigin(params, panelBounds) — 焦点のページ座標
//   originRelative=true なら origin はコマ中心からの相対。旧データはページ絶対座標。

window.ME = window.ME || {};
window.ME.Render = window.ME.Render || {};
window.ME.Render.Effect = window.ME.Render.Effect || {};

(function() {
  'use strict';

  // 効果ごとに安定した乱数列を作る（描画のたびに線がばらつかないように）。
  function seedFrom(effectObj) {
    var s = (effectObj && effectObj.id) ? String(effectObj.id) : 'effect';
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function() {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // panelBounds 中心 + origin（相対 or 絶対）→ ページ座標の焦点
  // 回転前の座標。描画時は ctx.rotate 後にこの点が視覚上の焦点になる。
  function resolveConcentrationOrigin(params, panelBounds) {
    params = params || {};
    var b = panelBounds;
    var cx = b ? (b.x + b.w / 2) : 0;
    var cy = b ? (b.y + b.h / 2) : 0;
    var o = params.origin;
    if (!o) return { x: cx, y: cy, cx: cx, cy: cy };
    if (params.originRelative) {
      return { x: cx + (o.x || 0), y: cy + (o.y || 0), cx: cx, cy: cy };
    }
    // 旧: ページ絶対座標
    return { x: o.x, y: o.y, cx: cx, cy: cy };
  }

  // 回転適用後の画面上の焦点（オーバーレイ用）
  function concentrationOriginDisplay(params, panelBounds, rotationDeg) {
    var r = resolveConcentrationOrigin(params, panelBounds);
    var rot = ((rotationDeg || 0) * Math.PI) / 180;
    if (!rot) return { x: r.x, y: r.y, cx: r.cx, cy: r.cy };
    var dx = r.x - r.cx;
    var dy = r.y - r.cy;
    var cos = Math.cos(rot);
    var sin = Math.sin(rot);
    return {
      x: r.cx + dx * cos - dy * sin,
      y: r.cy + dx * sin + dy * cos,
      cx: r.cx,
      cy: r.cy
    };
  }

  // 画面上の点 → 保存用 origin（相対 or 絶対）。rotation は描画と同じ定義。
  function concentrationOriginFromDisplay(displayX, displayY, params, panelBounds, rotationDeg) {
    params = params || {};
    var b = panelBounds;
    var cx = b ? (b.x + b.w / 2) : 0;
    var cy = b ? (b.y + b.h / 2) : 0;
    var rot = ((rotationDeg || 0) * Math.PI) / 180;
    var px = displayX;
    var py = displayY;
    if (rot) {
      var dx = displayX - cx;
      var dy = displayY - cy;
      var cos = Math.cos(-rot);
      var sin = Math.sin(-rot);
      px = cx + dx * cos - dy * sin;
      py = cy + dx * sin + dy * cos;
    }
    if (params.originRelative) {
      return { x: px - cx, y: py - cy };
    }
    return { x: px, y: py };
  }

  function draw(ctx, effectObj, panelBounds) {
    if (!effectObj) return;

    var kind = effectObj.kind || 'flatTone';
    var params = effectObj.params || {};
    var t = effectObj.transform || {};
    var rot = (t.rotation || 0) * Math.PI / 180;

    ctx.save();

    // 集中線・スピード線は回転できる（コマにクリップしたまま模様だけ回す）
    // 角度0のときも同じ描画境界(pb)計算を行うため、rotの有無で分岐せず常に処理（角度0特殊処理を撤去）
    var pb = panelBounds;
    if (panelBounds && (kind === 'concentration' || kind === 'speedLines')) {
      ctx.beginPath();
      ctx.rect(panelBounds.x, panelBounds.y, panelBounds.w, panelBounds.h);
      ctx.clip();
      var rcx = panelBounds.x + panelBounds.w / 2;
      var rcy = panelBounds.y + panelBounds.h / 2;
      ctx.translate(rcx, rcy);
      ctx.rotate(rot);
      ctx.translate(-rcx, -rcy);
      var rdiag = Math.sqrt(panelBounds.w * panelBounds.w + panelBounds.h * panelBounds.h) * 1.1;
      pb = { x: rcx - rdiag / 2, y: rcy - rdiag / 2, w: rdiag, h: rdiag };
    }

    switch (kind) {
      case 'flatTone':
        drawFlatTone(ctx, params, panelBounds);
        break;
      case 'screenTone':
        drawScreenTone(ctx, params, panelBounds);
        break;
      case 'concentration':
        drawConcentration(ctx, params, pb, panelBounds, seedFrom(effectObj));
        break;
      case 'speedLines':
        drawSpeedLines(ctx, params, pb, panelBounds, seedFrom(effectObj));
        break;
      case 'whiteFlash':
        drawWhiteFlash(ctx, panelBounds);
        break;
      case 'blackFlash':
        drawBlackFlash(ctx, panelBounds);
        break;
      case 'frame':
        drawFrame(ctx, params, panelBounds);
        break;
      case 'flatBand':
        drawFlatBand(ctx, params, panelBounds);
        break;
      case 'whiteBorder':
        drawWhiteBorder(ctx, params, panelBounds);
        break;
    }

    ctx.restore();
  }

  function drawFlatTone(ctx, params, panelBounds) {
    var color = params.color || '#000000';
    ctx.fillStyle = color;
    // panel boundsがあればその範囲、なければページ全体を塗りつぶし
    if (panelBounds) {
      ctx.fillRect(panelBounds.x, panelBounds.y, panelBounds.w, panelBounds.h);
    } else if (ctx.canvas && ctx.canvas.width) {
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
  }

  function drawScreenTone(ctx, params, panelBounds) {
    var pattern = params.pattern || 'dot';
    var density = params.density !== undefined ? params.density : 50;
    if (!(density > 0)) density = 1;
    if (density > 100) density = 100;
    var angle = params.angle || 0;
    var scale = params.scale || 1;

    ctx.save();
    if (panelBounds) {
      ctx.translate(panelBounds.x, panelBounds.y);
    }
    ctx.rotate(angle * Math.PI / 180);

    // パターン生成（オフスクリーンキャンバス）
    var patternSize = Math.max(4, Math.floor(20 / density * 10));
    var pCanvas = document.createElement('canvas');
    pCanvas.width = patternSize;
    pCanvas.height = patternSize;
    var pCtx = pCanvas.getContext('2d');

    if (pattern === 'dot') {
      // ドットパターン
      pCtx.fillStyle = '#FFFFFF';
      pCtx.fillRect(0, 0, patternSize, patternSize);
      pCtx.fillStyle = '#000000';
      var dotR = Math.max(1, patternSize * density / 200);
      pCtx.beginPath();
      pCtx.arc(patternSize / 2, patternSize / 2, dotR, 0, Math.PI * 2);
      pCtx.fill();
    } else if (pattern === 'line') {
      // ラインパターン
      pCtx.fillStyle = '#FFFFFF';
      pCtx.fillRect(0, 0, patternSize, patternSize);
      pCtx.strokeStyle = '#000000';
      pCtx.lineWidth = Math.max(1, patternSize * density / 200);
      pCtx.beginPath();
      pCtx.moveTo(0, 0);
      pCtx.lineTo(patternSize, patternSize);
      pCtx.stroke();
    } else if (pattern === 'gradient') {
      // グラデーションパターン
      var grad = pCtx.createLinearGradient(0, 0, patternSize, 0);
      grad.addColorStop(0, '#FFFFFF');
      grad.addColorStop(density / 100, '#000000');
      grad.addColorStop(1, '#000000');
      pCtx.fillStyle = grad;
      pCtx.fillRect(0, 0, patternSize, patternSize);
    }

    // パターンとして描画
    var pat = ctx.createPattern(pCanvas, 'repeat');
    if (pat) {
      ctx.fillStyle = pat;
      var pw = panelBounds ? panelBounds.w : ctx.canvas.width;
      var ph = panelBounds ? panelBounds.h : ctx.canvas.height;
      // scale倍の座標系で pw/scale × ph/scale を塗ると、元座標系ではちょうど pw × ph になる
      ctx.scale(scale, scale);
      ctx.fillRect(0, 0, pw / scale, ph / scale);
    }

    ctx.restore();
  }

  // panelBoundsが無い場合のフォールバック矩形
  function boundsOf(ctx, panelBounds) {
    if (panelBounds) return { x: panelBounds.x, y: panelBounds.y, w: panelBounds.w, h: panelBounds.h };
    return { x: 0, y: 0, w: ctx.canvas.width, h: ctx.canvas.height };
  }

  // 集中線: 焦点(origin)から放射状に伸びる三角形（トンガリ）。太さ・長さに乱数。
  // drawBounds: 描画クリップ範囲（回転時は拡張矩形）。originBounds: 焦点解決用の本来のコマ外接。
  function drawConcentration(ctx, params, drawBounds, originBounds, seed) {
    var rnd = makeRng(seed);
    var b = boundsOf(ctx, drawBounds);
    var ob = originBounds || drawBounds;
    var resolved = resolveConcentrationOrigin(params, ob);
    var origin = { x: resolved.x, y: resolved.y };
    var lineCount = params.lineCount !== undefined ? params.lineCount : 36;
    var lengthRatio = (params.lengthRatio !== undefined ? params.lengthRatio : 90) / 100;
    var color = params.color || '#000000';

    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();

    ctx.fillStyle = color;
    var thick = (params.thickness !== undefined ? params.thickness : 100) / 100;
    var maxR = Math.sqrt(b.w * b.w + b.h * b.h);
    var clearR = maxR * Math.max(0, 1 - lengthRatio) * 0.9;
    var baseW = Math.PI * maxR / Math.max(4, lineCount);

    for (var i = 0; i < lineCount; i++) {
      var angle = (i / lineCount) * Math.PI * 2 + (rnd() - 0.5) * (Math.PI / lineCount);
      var innerR = clearR * (0.7 + rnd() * 0.6);
      var halfW = baseW * (0.25 + rnd() * 0.85) * thick;
      var ca = Math.cos(angle), sa = Math.sin(angle);
      var ax = origin.x + ca * innerR, ay = origin.y + sa * innerR;
      var ox = origin.x + ca * maxR,   oy = origin.y + sa * maxR;
      var nx = -sa, ny = ca;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ox + nx * halfW, oy + ny * halfW);
      ctx.lineTo(ox - nx * halfW, oy - ny * halfW);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // スピード線: 一定方向の平行線（横/縦/斜め）
  function drawSpeedLines(ctx, params, drawBounds, originBounds, seed) {
    var rnd = makeRng(seed);
    if (params.style && params.direction === undefined) {
      if (params.style === 'radial' || params.style === 'concentration') {
        drawConcentration(ctx, params, drawBounds, originBounds, seed);
        return;
      }
    }
    var b = boundsOf(ctx, drawBounds);
    var direction = params.direction || 'horizontal';
    var lineCount = params.lineCount !== undefined ? params.lineCount : 24;
    var lengthRatio = (params.lengthRatio !== undefined ? params.lengthRatio : 100) / 100;
    var color = params.color || '#000000';

    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();
    ctx.strokeStyle = color;
    var thick = (params.thickness !== undefined ? params.thickness : 100) / 100;

    var i, t, jitter, llen;
    if (direction === 'vertical') {
      for (i = 0; i < lineCount; i++) {
        t = b.x + (i + 0.5) * (b.w / lineCount);
        jitter = (rnd() - 0.5) * (b.w / lineCount) * 0.4;
        llen = lengthRatio * (0.5 + rnd() * 0.5);
        ctx.lineWidth = (1 + rnd() * 2) * thick;
        ctx.beginPath();
        ctx.moveTo(t + jitter, b.y);
        ctx.lineTo(t + jitter, b.y + b.h * llen);
        ctx.stroke();
      }
    } else if (direction === 'diagonal') {
      var diag = b.w + b.h;
      for (i = 0; i < lineCount; i++) {
        var off = (i + 0.5) * (diag / lineCount);
        llen = lengthRatio * (0.5 + rnd() * 0.5);
        ctx.lineWidth = (1 + rnd() * 2) * thick;
        ctx.beginPath();
        ctx.moveTo(b.x + off, b.y);
        ctx.lineTo(b.x + off - b.h * llen, b.y + b.h * llen);
        ctx.stroke();
      }
    } else {
      for (i = 0; i < lineCount; i++) {
        t = b.y + (i + 0.5) * (b.h / lineCount);
        jitter = (rnd() - 0.5) * (b.h / lineCount) * 0.4;
        llen = lengthRatio * (0.5 + rnd() * 0.5);
        ctx.lineWidth = (1 + rnd() * 2) * thick;
        ctx.beginPath();
        ctx.moveTo(b.x, t + jitter);
        ctx.lineTo(b.x + b.w * llen, t + jitter);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawWhiteFlash(ctx, panelBounds) {
    ctx.fillStyle = '#FFFFFF';
    if (panelBounds) {
      ctx.fillRect(panelBounds.x, panelBounds.y, panelBounds.w, panelBounds.h);
    } else {
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
  }

  function drawBlackFlash(ctx, panelBounds) {
    ctx.fillStyle = '#000000';
    if (panelBounds) {
      ctx.fillRect(panelBounds.x, panelBounds.y, panelBounds.w, panelBounds.h);
    } else {
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
  }

  function drawFrame(ctx, params, panelBounds) {
    var width = params.width !== undefined ? params.width : 4;
    var color = params.color || '#000000';
    ctx.strokeStyle = color;
    ctx.lineWidth = width;

    if (panelBounds) {
      ctx.strokeRect(panelBounds.x, panelBounds.y, panelBounds.w, panelBounds.h);
    } else if (ctx.canvas && ctx.canvas.width) {
      ctx.strokeRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
  }

  function drawFlatBand(ctx, params, panelBounds) {
    var height = params.height !== undefined ? params.height : 30;
    var color = params.color || '#000000';
    ctx.fillStyle = color;

    if (panelBounds) {
      // panelの中央に帯を描画
      var bandY = panelBounds.y + panelBounds.h / 2 - height / 2;
      ctx.fillRect(panelBounds.x, bandY, panelBounds.w, height);
    } else if (ctx.canvas && ctx.canvas.width) {
      var cy = ctx.canvas.height / 2 - height / 2;
      ctx.fillRect(0, cy, ctx.canvas.width, height);
    }
  }

  function drawWhiteBorder(ctx, params, panelBounds) {
    var width = params.width !== undefined ? params.width : 8;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = width;

    if (panelBounds) {
      // panelの内側に白縁を描画
      ctx.strokeRect(
        panelBounds.x + width / 2,
        panelBounds.y + width / 2,
        panelBounds.w - width,
        panelBounds.h - width
      );
    } else if (ctx.canvas && ctx.canvas.width) {
      ctx.strokeRect(width / 2, width / 2, ctx.canvas.width - width, ctx.canvas.height - width);
    }
  }

  window.ME.Render.Effect.draw = draw;
  window.ME.Render.Effect.resolveConcentrationOrigin = resolveConcentrationOrigin;
  window.ME.Render.Effect.concentrationOriginDisplay = concentrationOriginDisplay;
  window.ME.Render.Effect.concentrationOriginFromDisplay = concentrationOriginFromDisplay;
})();
