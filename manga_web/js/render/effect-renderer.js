// ME.Render.Effect.draw(ctx, effectObj, panelBounds) — 効果描画
//   kind: flatTone, screenTone, concentration, speedLines,
//         horrorLines, dropLines, wavyLines, crackLines,
//         whiteFlash, blackFlash, frame, flatBand, whiteBorder
// ME.Render.Effect.resolveConcentrationOrigin(params, panelBounds) — 焦点のページ座標
//   originRelative=true なら origin はコマ中心からの相対。旧データはページ絶対座標。

window.ME = window.ME || {};
window.ME.Render = window.ME.Render || {};
window.ME.Render.Effect = window.ME.Render.Effect || {};

(function() {
  'use strict';

  function seedFrom(effectObj) {
    var s = (effectObj && effectObj.id) ? String(effectObj.id) : 'effect';
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    // params.seed（乱数）で模様を変えられる。id ベースに混ぜる
    var userSeed = 0;
    if (effectObj && effectObj.params && effectObj.params.seed !== undefined &&
        effectObj.params.seed !== null && effectObj.params.seed !== '') {
      userSeed = Number(effectObj.params.seed);
      if (isNaN(userSeed)) userSeed = 0;
    }
    h ^= Math.imul(userSeed >>> 0, 2654435761);
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h ^= Math.imul(h ^ (h >>> 13), 3266489909);
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
    return { x: o.x, y: o.y, cx: cx, cy: cy };
  }

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

  function usesRotateClip(kind) {
    if (ME.Effects && typeof ME.Effects.usesRotateClip === 'function') {
      return ME.Effects.usesRotateClip(kind);
    }
    return kind === 'concentration' || kind === 'speedLines';
  }

  function draw(ctx, effectObj, panelBounds) {
    if (!effectObj) return;

    var kind = effectObj.kind || 'flatTone';
    var params = effectObj.params || {};
    var t = effectObj.transform || {};
    var rot = (t.rotation || 0) * Math.PI / 180;

    ctx.save();

    var pb = panelBounds;
    if (panelBounds && usesRotateClip(kind)) {
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

    var seed = seedFrom(effectObj);
    switch (kind) {
      case 'flatTone':
        drawFlatTone(ctx, params, panelBounds);
        break;
      case 'screenTone':
        drawScreenTone(ctx, params, panelBounds);
        break;
      case 'concentration':
        drawConcentration(ctx, params, pb, panelBounds, seed);
        break;
      case 'speedLines':
        drawSpeedLines(ctx, params, pb, panelBounds, seed);
        break;
      case 'horrorLines':
        drawHorrorLines(ctx, params, pb, seed);
        break;
      case 'dropLines':
        drawDropLines(ctx, params, pb, seed);
        break;
      case 'wavyLines':
        drawWavyLines(ctx, params, pb, seed);
        break;
      case 'crackLines':
        drawCrackLines(ctx, params, pb, panelBounds, seed);
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

    var patternSize = Math.max(4, Math.floor(20 / density * 10));
    var pCanvas = document.createElement('canvas');
    pCanvas.width = patternSize;
    pCanvas.height = patternSize;
    var pCtx = pCanvas.getContext('2d');

    if (pattern === 'dot') {
      pCtx.fillStyle = '#FFFFFF';
      pCtx.fillRect(0, 0, patternSize, patternSize);
      pCtx.fillStyle = '#000000';
      var dotR = Math.max(1, patternSize * density / 200);
      pCtx.beginPath();
      pCtx.arc(patternSize / 2, patternSize / 2, dotR, 0, Math.PI * 2);
      pCtx.fill();
    } else if (pattern === 'line') {
      pCtx.fillStyle = '#FFFFFF';
      pCtx.fillRect(0, 0, patternSize, patternSize);
      pCtx.strokeStyle = '#000000';
      pCtx.lineWidth = Math.max(1, patternSize * density / 200);
      pCtx.beginPath();
      pCtx.moveTo(0, 0);
      pCtx.lineTo(patternSize, patternSize);
      pCtx.stroke();
    } else if (pattern === 'gradient') {
      var grad = pCtx.createLinearGradient(0, 0, patternSize, 0);
      grad.addColorStop(0, '#FFFFFF');
      grad.addColorStop(density / 100, '#000000');
      grad.addColorStop(1, '#000000');
      pCtx.fillStyle = grad;
      pCtx.fillRect(0, 0, patternSize, patternSize);
    }

    var pat = ctx.createPattern(pCanvas, 'repeat');
    if (pat) {
      ctx.fillStyle = pat;
      var pw = panelBounds ? panelBounds.w : ctx.canvas.width;
      var ph = panelBounds ? panelBounds.h : ctx.canvas.height;
      ctx.scale(scale, scale);
      ctx.fillRect(0, 0, pw / scale, ph / scale);
    }

    ctx.restore();
  }

  function boundsOf(ctx, panelBounds) {
    if (panelBounds) return { x: panelBounds.x, y: panelBounds.y, w: panelBounds.w, h: panelBounds.h };
    return { x: 0, y: 0, w: ctx.canvas.width, h: ctx.canvas.height };
  }

  function readLineCommon(params, defaults) {
    params = params || {};
    defaults = defaults || {};
    var lcDef = defaults.lineCount !== undefined ? defaults.lineCount : 24;
    var lrDef = defaults.lengthRatio !== undefined ? defaults.lengthRatio : 90;
    var thDef = defaults.thickness !== undefined ? defaults.thickness : 100;
    var jDef = defaults.jitter !== undefined ? defaults.jitter : 30;
    return {
      lineCount: params.lineCount !== undefined ? params.lineCount : lcDef,
      lengthRatio: (params.lengthRatio !== undefined ? params.lengthRatio : lrDef) / 100,
      thickness: (params.thickness !== undefined ? params.thickness : thDef) / 100,
      color: params.color || '#000000',
      jitter: (params.jitter !== undefined ? params.jitter : jDef) / 100
    };
  }

  // 長さのばらつき専用係数。0 のとき常に 1（他の乱数と独立・0から連続）
  // scale: 振幅倍率（1=スライダー100で ±100%、0.56 なら ±56%）
  function lengthFactor(rnd, params, scale) {
    if (scale === undefined || scale === null) scale = 1;
    var lengthVar = (params.lengthVariation !== undefined ? params.lengthVariation : 50) / 100;
    var amp = lengthVar * scale;
    if (!(amp > 0)) return 1;
    var f = 1 + (rnd() * 2 - 1) * amp;
    var lo = 1 - amp;
    var hi = 1 + amp;
    if (lo < 0.2) lo = 0.2;
    if (hi > 1.8) hi = 1.8;
    if (f < lo) f = lo;
    if (f > hi) f = hi;
    return f;
  }

  function drawConcentration(ctx, params, drawBounds, originBounds, seed) {
    var rnd = makeRng(seed);
    var b = boundsOf(ctx, drawBounds);
    var ob = originBounds || drawBounds;
    var resolved = resolveConcentrationOrigin(params, ob);
    var origin = { x: resolved.x, y: resolved.y };
    var common = readLineCommon(params, { lineCount: 36, lengthRatio: 90, thickness: 100, jitter: 30 });
    var lineCount = common.lineCount;
    var lengthRatio = common.lengthRatio;
    var color = common.color;
    var j = common.jitter;

    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();

    ctx.fillStyle = color;
    var thick = common.thickness;
    var maxR = Math.sqrt(b.w * b.w + b.h * b.h);
    var baseW = Math.PI * maxR / Math.max(4, lineCount);
    // 角度の揺らぎは「揺らぎ」のみ（長さばらつきとは分離）
    var angJ = (Math.PI / Math.max(4, lineCount)) * (0.35 + j * 1.2);
    // 基準内半径（長さ%）。ばらつき0なら全線この値
    var baseClear = maxR * Math.max(0, 1 - lengthRatio) * 0.9;

    for (var i = 0; i < lineCount; i++) {
      var angle = (i / lineCount) * Math.PI * 2 + (rnd() - 0.5) * angJ;
      // 集中線は scale 0.56（最大時 ±56%前後）
      var lf = lengthFactor(rnd, params, 0.56);
      var clearR = baseClear / lf;
      if (clearR < 0) clearR = 0;
      if (clearR > maxR * 0.88) clearR = maxR * 0.88;
      // 長さ方向の追加ランダムは付けない（0 と >0 の不連続を防ぐ）
      var innerR = clearR;
      var halfW = baseW * (0.35 + rnd() * 0.65) * thick * (0.75 + j * 0.4);
      var outerR = maxR;
      var ca = Math.cos(angle), sa = Math.sin(angle);
      var ax = origin.x + ca * innerR, ay = origin.y + sa * innerR;
      var ox = origin.x + ca * outerR, oy = origin.y + sa * outerR;
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

  function alignOffset(align, full, llen) {
    // llen は 0..1 の使用長。start=始点側から、end=終点側、center=中央
    if (align === 'end') return full * (1 - llen);
    if (align === 'center') return full * (1 - llen) * 0.5;
    return 0;
  }

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
    var align = params.align || 'start';
    var common = readLineCommon(params, { lineCount: 24, lengthRatio: 100, thickness: 100, jitter: 30 });
    var lineCount = common.lineCount;
    var lengthRatio = common.lengthRatio;
    var color = common.color;
    var j = common.jitter;

    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();
    ctx.strokeStyle = color;
    var thick = common.thickness;

    var i, t, jit, llen, off0, lf;
    if (direction === 'vertical') {
      for (i = 0; i < lineCount; i++) {
        t = b.x + (i + 0.5) * (b.w / lineCount);
        jit = (rnd() - 0.5) * (b.w / lineCount) * (0.25 + j * 0.6);
        // 長さは lengthRatio × ばらつきのみ（0 なら全線同じ）
        lf = lengthFactor(rnd, params, 1);
        llen = lengthRatio * lf;
        if (llen < 0.05) llen = 0.05;
        if (llen > 1.2) llen = 1.2;
        off0 = alignOffset(align, b.h, Math.min(1, llen));
        ctx.lineWidth = (1 + rnd() * 2 * (0.35 + j)) * thick;
        ctx.beginPath();
        ctx.moveTo(t + jit, b.y + off0);
        ctx.lineTo(t + jit, b.y + off0 + b.h * Math.min(1, llen));
        ctx.stroke();
      }
    } else if (direction === 'diagonal') {
      var diag = b.w + b.h;
      for (i = 0; i < lineCount; i++) {
        var off = (i + 0.5) * (diag / lineCount);
        lf = lengthFactor(rnd, params, 1);
        llen = lengthRatio * lf;
        if (llen < 0.05) llen = 0.05;
        if (llen > 1.2) llen = 1.2;
        ctx.lineWidth = (1 + rnd() * 2 * (0.35 + j)) * thick;
        var jx = (rnd() - 0.5) * 6 * j;
        ctx.beginPath();
        ctx.moveTo(b.x + off + jx, b.y);
        ctx.lineTo(b.x + off - b.h * llen + jx, b.y + b.h * llen);
        ctx.stroke();
      }
    } else {
      for (i = 0; i < lineCount; i++) {
        t = b.y + (i + 0.5) * (b.h / lineCount);
        jit = (rnd() - 0.5) * (b.h / lineCount) * (0.25 + j * 0.6);
        lf = lengthFactor(rnd, params, 1);
        llen = lengthRatio * lf;
        if (llen < 0.05) llen = 0.05;
        if (llen > 1.2) llen = 1.2;
        off0 = alignOffset(align, b.w, Math.min(1, llen));
        ctx.lineWidth = (1 + rnd() * 2 * (0.35 + j)) * thick;
        ctx.beginPath();
        ctx.moveTo(b.x + off0, t + jit);
        ctx.lineTo(b.x + off0 + b.w * Math.min(1, llen), t + jit);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ホラー線: コマ縁から内側へ不規則短線
  function drawHorrorLines(ctx, params, drawBounds, seed) {
    var rnd = makeRng(seed);
    var b = boundsOf(ctx, drawBounds);
    var common = readLineCommon(params, { lineCount: 48, lengthRatio: 35, thickness: 100, jitter: 40 });
    var edgePad = (params.edgePadding !== undefined ? params.edgePadding : 0) / 100;
    var padX = b.w * edgePad * 0.5;
    var padY = b.h * edgePad * 0.5;
    var x0 = b.x + padX, y0 = b.y + padY;
    var x1 = b.x + b.w - padX, y1 = b.y + b.h - padY;
    var bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
    var n = Math.max(8, common.lineCount | 0);
    var perSide = Math.max(2, Math.floor(n / 4));
    var extras = n - perSide * 4;
    var maxLen = Math.min(bw, bh) * common.lengthRatio;
    var j = common.jitter;

    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();
    ctx.strokeStyle = common.color;
    ctx.lineCap = 'round';

    function edgeLine(side, k, count) {
      var t = (k + 0.5) / count;
      var sx, sy, nx, ny;
      if (side === 0) { sx = x0 + bw * t; sy = y0; nx = 0; ny = 1; }
      else if (side === 1) { sx = x1; sy = y0 + bh * t; nx = -1; ny = 0; }
      else if (side === 2) { sx = x0 + bw * t; sy = y1; nx = 0; ny = -1; }
      else { sx = x0; sy = y0 + bh * t; nx = 1; ny = 0; }
      var ang = Math.atan2(ny, nx) + (rnd() - 0.5) * (0.35 + j * 0.9);
      var len = maxLen * (0.45 + rnd() * 0.7) * (0.7 + j * 0.4);
      ctx.lineWidth = (0.8 + rnd() * 1.8) * common.thickness;
      ctx.beginPath();
      ctx.moveTo(sx + (rnd() - 0.5) * 3 * j, sy + (rnd() - 0.5) * 3 * j);
      ctx.lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
      ctx.stroke();
    }

    var side, k;
    for (side = 0; side < 4; side++) {
      var c = perSide + (side < extras ? 1 : 0);
      for (k = 0; k < c; k++) edgeLine(side, k, c);
    }
    ctx.restore();
  }

  // ドロップ線: 上から落ちる垂直短線（bandWidth=帯の幅% / offsetX=左右位置 -50〜50）
  function drawDropLines(ctx, params, drawBounds, seed) {
    var rnd = makeRng(seed);
    var b = boundsOf(ctx, drawBounds);
    var common = readLineCommon(params, { lineCount: 20, lengthRatio: 55, thickness: 100, jitter: 35 });
    var drift = (params.drift !== undefined ? params.drift : 0) / 100;
    var bandWidth = params.bandWidth !== undefined ? params.bandWidth : 100;
    if (bandWidth < 5) bandWidth = 5;
    if (bandWidth > 100) bandWidth = 100;
    var offsetX = params.offsetX !== undefined ? params.offsetX : 0;
    if (offsetX < -50) offsetX = -50;
    if (offsetX > 50) offsetX = 50;
    var bandW = b.w * (bandWidth / 100);
    var cx = b.x + b.w / 2 + b.w * (offsetX / 100);
    var x0 = cx - bandW / 2;
    if (x0 < b.x) x0 = b.x;
    if (x0 + bandW > b.x + b.w) x0 = b.x + b.w - bandW;
    if (bandW > b.w) { bandW = b.w; x0 = b.x; }
    var n = Math.max(4, common.lineCount | 0);
    var j = common.jitter;

    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();
    ctx.strokeStyle = common.color;
    ctx.lineCap = 'round';

    for (var i = 0; i < n; i++) {
      var t = (i + 0.5) / n;
      var x = x0 + bandW * t + (rnd() - 0.5) * (bandW / n) * (0.3 + j);
      var top = b.y + b.h * 0.05 * rnd();
      var lf = lengthFactor(rnd, params, 1);
      var len = b.h * common.lengthRatio * lf;
      if (len < 4) len = 4;
      if (len > b.h * 1.2) len = b.h * 1.2;
      var dx = (rnd() - 0.5) * bandW * 0.04 * drift * 10;
      ctx.lineWidth = (0.8 + rnd() * 1.6) * common.thickness;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x + dx, top + len);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 揺れ線: 波打つ平行線（lengthVariation で線ごとの長さばらつき）
  function drawWavyLines(ctx, params, drawBounds, seed) {
    var rnd = makeRng(seed);
    var b = boundsOf(ctx, drawBounds);
    var common = readLineCommon(params, { lineCount: 14, lengthRatio: 100, thickness: 100, jitter: 20 });
    var amp = params.amplitude !== undefined ? params.amplitude : 8;
    var wl = params.wavelength !== undefined ? params.wavelength : 36;
    if (wl < 8) wl = 8;
    var direction = params.direction || 'horizontal';
    var n = Math.max(3, common.lineCount | 0);
    var j = common.jitter;

    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();
    ctx.strokeStyle = common.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var i, k, steps, a0, lf, span;
    if (direction === 'vertical') {
      for (i = 0; i < n; i++) {
        var x = b.x + (i + 0.5) * (b.w / n) + (rnd() - 0.5) * 4 * j;
        ctx.lineWidth = (0.9 + rnd() * 1.4) * common.thickness;
        a0 = rnd() * Math.PI * 2;
        lf = lengthFactor(rnd, params);
        span = b.h * common.lengthRatio * lf;
        if (span > b.h * 1.2) span = b.h * 1.2;
        if (span < 4) span = 4;
        ctx.beginPath();
        steps = Math.max(12, Math.floor(span / 4));
        for (k = 0; k <= steps; k++) {
          var yy = b.y + (k / steps) * span;
          var xx = x + Math.sin(a0 + (yy - b.y) / wl * Math.PI * 2) * amp * (0.7 + j * 0.5);
          if (k === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
      }
    } else {
      for (i = 0; i < n; i++) {
        var y = b.y + (i + 0.5) * (b.h / n) + (rnd() - 0.5) * 4 * j;
        ctx.lineWidth = (0.9 + rnd() * 1.4) * common.thickness;
        a0 = rnd() * Math.PI * 2;
        lf = lengthFactor(rnd, params);
        span = b.w * common.lengthRatio * lf;
        if (span > b.w * 1.2) span = b.w * 1.2;
        if (span < 4) span = 4;
        ctx.beginPath();
        steps = Math.max(12, Math.floor(span / 4));
        for (k = 0; k <= steps; k++) {
          var xx2 = b.x + (k / steps) * span;
          var yy2 = y + Math.sin(a0 + (xx2 - b.x) / wl * Math.PI * 2) * amp * (0.7 + j * 0.5);
          if (k === 0) ctx.moveTo(xx2, yy2); else ctx.lineTo(xx2, yy2);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ヒビ: origin から分岐する折れ線
  function drawCrackLines(ctx, params, drawBounds, originBounds, seed) {
    var rnd = makeRng(seed);
    var b = boundsOf(ctx, drawBounds);
    var ob = originBounds || drawBounds;
    var resolved = resolveConcentrationOrigin(params, ob);
    var ox = resolved.x, oy = resolved.y;
    var common = readLineCommon(params, { lineCount: 7, lengthRatio: 70, thickness: 100, jitter: 40 });
    var branch = params.branch !== undefined ? params.branch : 2;
    if (branch < 0) branch = 0;
    if (branch > 4) branch = 4;
    var maxR = Math.sqrt(b.w * b.w + b.h * b.h) * 0.5 * common.lengthRatio;
    var roots = Math.max(3, common.lineCount | 0);
    var j = common.jitter;

    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();
    ctx.strokeStyle = common.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    function crack(x, y, ang, len, depth) {
      if (len < 4 || depth > branch + 1) return;
      var segs = 2 + (rnd() * 2) | 0;
      var cx = x, cy = y;
      ctx.lineWidth = Math.max(0.6, (1.6 - depth * 0.35) * common.thickness);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      var s;
      for (s = 0; s < segs; s++) {
        var segLen = len / segs * (0.7 + rnd() * 0.5);
        ang += (rnd() - 0.5) * (0.4 + j * 0.8);
        cx += Math.cos(ang) * segLen;
        cy += Math.sin(ang) * segLen;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
      if (depth < branch) {
        var nb = 1 + ((rnd() * 2) | 0);
        var bi;
        for (bi = 0; bi < nb; bi++) {
          crack(cx, cy, ang + (rnd() - 0.5) * 1.2, len * (0.35 + rnd() * 0.35), depth + 1);
        }
      }
    }

    var i;
    for (i = 0; i < roots; i++) {
      var a0 = (i / roots) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
      crack(ox, oy, a0, maxR * (0.55 + rnd() * 0.5), 0);
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
