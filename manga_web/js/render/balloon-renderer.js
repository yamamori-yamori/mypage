// ME.Render.Balloon — 吹き出し描画
// draw(ctx, balloon, opts?) — 1つ描画（drawGroupの単体版）
// drawGroup(ctx, balloons, opts?) — 融合グループを「ひとつの形」として描画
//   ・全メンバーの本体+しっぽを合併シルエットとして塗り、外周だけの一体輪郭線を重ねる
//   ・スタイル（塗り/線/α）は先頭メンバーのものを使用
//   ・しっぽ type: normal | normalThick | thought | thoughtFew | jagged | jaggedThick | lightning | spiral
//   opts: {
//     scale: 出力スケール(既定1、PNG出力時はdpi/96),
//     offsetX/offsetY: レイヤー座標オフセット(既定0、編集時は断ち切り余白),
//     clipFn: function(ctx) — コマ内クロップ用（呼び出し側のクリップパス設定関数）
//   }

window.ME = window.ME || {};
window.ME.Render = window.ME.Render || {};
window.ME.Render.Balloon = window.ME.Render.Balloon || {};

(function() {
  'use strict';

  // オフスクリーンレイヤー（使い回し）
  var fillLayer = null;
  var strokeLayer = null;

  function getLayer(which, w, h) {
    var c = which === 'fill' ? fillLayer : strokeLayer;
    if (!c) {
      c = document.createElement('canvas');
      if (which === 'fill') fillLayer = c; else strokeLayer = c;
    }
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    var octx = c.getContext('2d');
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, w, h);
    return octx;
  }

  function draw(ctx, balloon, opts) {
    if (!balloon) return;
    drawGroup(ctx, [balloon], opts);
  }

  function drawGroup(ctx, balloons, opts) {
    if (!balloons || balloons.length === 0) return;
    opts = opts || {};
    var scale = opts.scale || 1;
    var offX = opts.offsetX || 0;
    var offY = opts.offsetY || 0;

    var lead = balloons[0];
    var w = ctx.canvas.width;
    var h = ctx.canvas.height;
    var opacity = lead.opacity !== undefined ? lead.opacity / 100 : 1;
    var fillAlpha = (lead.fillAlpha !== undefined ? lead.fillAlpha : 100) / 100;
    var strokeAlpha = (lead.strokeAlpha !== undefined ? lead.strokeAlpha : 100) / 100;
    var strokeWidth = lead.strokeWidth !== undefined ? lead.strokeWidth : 2;

    // --- 塗りレイヤー: 全メンバーの本体+しっぽの合併シルエット ---
    var f = getLayer('fill', w, h);
    f.setTransform(scale, 0, 0, scale, offX * scale, offY * scale);
    f.fillStyle = lead.fillColor || '#FFFFFF';
    forEachPath(f, balloons, function(c) { c.fill(); });

    // --- 線レイヤー: 各輪郭を描いてから合併内部を消去 → 一体化した外周線 ---
    var s = getLayer('stroke', w, h);
    s.setTransform(scale, 0, 0, scale, offX * scale, offY * scale);
    s.strokeStyle = lead.strokeColor || '#000000';
    s.lineWidth = strokeWidth;
    s.lineJoin = 'round';

    // 破線サポート（間隔を広めに：dash長め / gapを大きくして見やすく）
    var useDash = !!(lead.dashed);
    var dashPattern = useDash ? [Math.max(3, strokeWidth * 1.8), Math.max(5, strokeWidth * 2.8)] : [];

    // 内側線がONのときは外形（メイン外周線）を描かない（外側は余白＝吹き出し外形に線を引かない）
    if (!lead.innerLine) {
      if (useDash && dashPattern.length > 0) {
        s.setLineDash(dashPattern);
      }
      forEachPath(s, balloons, function(c) { c.stroke(); });
      if (useDash && dashPattern.length > 0) {
        s.setLineDash([]);
      }
    }

    s.globalCompositeOperation = 'destination-out';
    forEachPath(s, balloons, function(c) { c.fill(); });
    s.globalCompositeOperation = 'source-over';

    // 二重線: 本体の内側にもう一本の輪郭線（消去後に描くので内側の線が残る）
    if (lead.doubleStroke) {
      s.lineWidth = Math.max(0.5, strokeWidth * 0.4);
      var gap = Math.max(3, strokeWidth * 1.5 + 2);
      if (useDash && dashPattern.length > 0) {
        s.setLineDash(dashPattern);
      }
      for (var bi = 0; bi < balloons.length; bi++) {
        var bb2 = balloons[bi];
        if (!bb2 || bb2.visible === false) continue;
        var bw = (bb2.size && bb2.size.width) || 150;
        var bh = (bb2.size && bb2.size.height) || 80;
        var f2 = Math.min(Math.max(0.5, (bw - gap * 2) / bw), Math.max(0.5, (bh - gap * 2) / bh));
        buildBodyPath(s, bb2, f2);
        s.stroke();
      }
      if (useDash && dashPattern.length > 0) {
        s.setLineDash([]);
      }
    }

    // 内側線（外側に余白があるスタイル）: さらに内側にオフセットした線（二重線と同時選択可で多重内線に）
    if (lead.innerLine) {
      s.lineWidth = Math.max(0.5, strokeWidth * 0.28);
      var gapI = Math.max(7, strokeWidth * 2.3 + 4); // 外側に視認できる余白を確保した大きめオフセット
      if (useDash && dashPattern.length > 0) {
        s.setLineDash(dashPattern);
      }
      for (var bi = 0; bi < balloons.length; bi++) {
        var bb3 = balloons[bi];
        if (!bb3 || bb3.visible === false) continue;
        var bw3 = (bb3.size && bb3.size.width) || 150;
        var bh3 = (bb3.size && bb3.size.height) || 80;
        var f3 = Math.min(Math.max(0.5, (bw3 - gapI * 2) / bw3), Math.max(0.5, (bh3 - gapI * 2) / bh3));
        buildBodyPath(s, bb3, f3);
        s.stroke();
      }
      if (useDash && dashPattern.length > 0) {
        s.setLineDash([]);
      }
    }

    // 線のガサつき（セリフ袋 outline.roughness と同系: 粗い周期の縁歪み）
    // 全キャンバスではなく吹き出し付近の矩形だけ処理（重いので）
    var rough = normalizeStrokeRoughness(lead.strokeRoughness);
    if (rough > 0 && strokeWidth > 0) {
      applyStrokeRoughness(s, balloons, rough, strokeWidth, scale, offX, offY, lead.id || 'balloon');
    }

    // 短い集中線 / ケバケバ線 の境界垂直短線装飾（strokeレイヤー上に追加描画）
    if (lead.shape === 'shortConcLines' || lead.shape === 'kebaKebaLines') {
      drawShortConcentrationDecor(s, balloons);
    }

    // --- 合成（コマ内クロップがあればクリップしてから） ---
    ctx.save();
    if (opts.clipFn) {
      opts.clipFn(ctx); // 現在の変換（ページ座標）でクリップ
    }
    var t = ctx.getTransform ? null : null; // （互換のため何もしない）
    // ピクセル等倍で合成
    var fa = Math.max(0, Math.min(1, opacity * fillAlpha));
    var sa = Math.max(0, Math.min(1, opacity * strokeAlpha));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (fa > 0) {
      ctx.globalAlpha = fa;
      ctx.drawImage(fillLayer, 0, 0);
    }
    if (sa > 0 && strokeWidth > 0) {
      ctx.globalAlpha = sa;
      ctx.drawImage(strokeLayer, 0, 0);
    }
    ctx.restore();
  }

  function normalizeStrokeRoughness(raw) {
    var rough = raw !== undefined && raw !== null ? Number(raw) : 0;
    if (isNaN(rough) || rough < 0) rough = 0;
    // 旧 0-100 → 0-10
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

  // シード付き乱数（mulberry32系）。描画のたびに線がばらつかないように使う。
  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function() {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash01(n) {
    n = (n | 0) * 374761393 + 668265263;
    n = (n ^ (n >>> 13)) * 1274126177;
    n = n ^ (n >>> 16);
    return ((n >>> 0) % 10000) / 10000;
  }

  function coarseNoise01(x, y, seed, cell) {
    var c = cell < 2 ? 2 : cell;
    var gx = Math.floor(x / c);
    var gy = Math.floor(y / c);
    return hash01(seed + gx * 374761 + gy * 668265 + (gx * 31 + gy) * 17);
  }

  function coarseNoiseSmooth01(x, y, seed, cell) {
    var c = cell < 2 ? 2 : cell;
    var fx = x / c;
    var fy = y / c;
    var x0 = Math.floor(fx);
    var y0 = Math.floor(fy);
    var tx = fx - x0;
    var ty = fy - y0;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    var n00 = hash01(seed + x0 * 374761 + y0 * 668265);
    var n10 = hash01(seed + (x0 + 1) * 374761 + y0 * 668265);
    var n01 = hash01(seed + x0 * 374761 + (y0 + 1) * 668265);
    var n11 = hash01(seed + (x0 + 1) * 374761 + (y0 + 1) * 668265);
    var a = n00 + (n10 - n00) * tx;
    var b = n01 + (n11 - n01) * tx;
    return a + (b - a) * ty;
  }

  // 吹き出し群のページ座標 AABB（しっぽ tip 含む）
  function balloonsPageBounds(balloons) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var any = false;
    for (var i = 0; i < balloons.length; i++) {
      var b = balloons[i];
      if (!b || b.visible === false) continue;
      var t = b.transform || {};
      var tx = t.x || 0;
      var ty = t.y || 0;
      var sw = (b.size && b.size.width) || 150;
      var sh = (b.size && b.size.height) || 80;
      var half = Math.max(sw, sh) * 0.75 + 40;
      // 回転・変形を粗く見積もる
      var pad = half;
      if (minX > tx - pad) minX = tx - pad;
      if (minY > ty - pad) minY = ty - pad;
      if (maxX < tx + pad) maxX = tx + pad;
      if (maxY < ty + pad) maxY = ty + pad;
      if (b.tail && b.tail.tipPoint) {
        var tip = b.tail.tipPoint;
        if (minX > tip.x) minX = tip.x;
        if (minY > tip.y) minY = tip.y;
        if (maxX < tip.x) maxX = tip.x;
        if (maxY < tip.y) maxY = tip.y;
      }
      any = true;
    }
    if (!any) return null;
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  // strokeLayer 上の縁を粗い周期で歪める（セリフ strokeOutlineText と同系）
  function applyStrokeRoughness(sctx, balloons, rough, strokeWidth, scale, offX, offY, seedStr) {
    var bounds = balloonsPageBounds(balloons);
    if (!bounds) return;
    // スライダー最大(10) ≈ 旧実装の「4」相当（ユーザー指定）
    var t = (rough / 10) * 0.4;
    // 変位量: 線幅とスケールに連動（毛羽ではなく輪郭のうねり）
    var amp = (1.0 + strokeWidth * 0.55) * (0.05 + t * 0.9) * (scale || 1);
    if (amp < 0.05) amp = 0.05;
    var cell = Math.max(6, Math.round((8 + strokeWidth * 1.2) * (0.85 + (1 - t) * 0.25) * (scale || 1)));
    var pad = Math.ceil(strokeWidth * scale * 0.5 + amp + 6);

    var x0 = Math.floor((bounds.minX + offX) * scale) - pad;
    var y0 = Math.floor((bounds.minY + offY) * scale) - pad;
    var x1 = Math.ceil((bounds.maxX + offX) * scale) + pad;
    var y1 = Math.ceil((bounds.maxY + offY) * scale) + pad;
    var cw = sctx.canvas.width;
    var ch = sctx.canvas.height;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > cw) x1 = cw;
    if (y1 > ch) y1 = ch;
    var rw = x1 - x0;
    var rh = y1 - y0;
    if (rw < 2 || rh < 2) return;
    // 巨大領域は安全に制限（ズーム高すぎ対策）
    if (rw * rh > 4e6) {
      // 中心寄りにクリップ
      var maxSide = Math.floor(Math.sqrt(4e6));
      var cx = (x0 + x1) / 2;
      var cy = (y0 + y1) / 2;
      x0 = Math.max(0, Math.floor(cx - maxSide / 2));
      y0 = Math.max(0, Math.floor(cy - maxSide / 2));
      x1 = Math.min(cw, x0 + maxSide);
      y1 = Math.min(ch, y0 + maxSide);
      rw = x1 - x0;
      rh = y1 - y0;
      if (rw < 2 || rh < 2) return;
    }

    var seed = hashStr(seedStr);
    var img = sctx.getImageData(x0, y0, rw, rh);
    var src = img.data;
    var copy = new Uint8ClampedArray(src);
    var px, py, i, j, n1, n2, sx, sy;
    var ampPx = amp;

    for (py = 0; py < rh; py++) {
      for (px = 0; px < rw; px++) {
        i = (py * rw + px) * 4;
        n1 = coarseNoiseSmooth01(px, py, seed, cell);
        n2 = coarseNoiseSmooth01(px + 19.7, py + 7.3, seed + 101, cell);
        sx = px + Math.round((n1 - 0.5) * 2 * ampPx);
        sy = py + Math.round((n2 - 0.5) * 2 * ampPx);
        if (sx < 0 || sy < 0 || sx >= rw || sy >= rh) {
          src[i] = 0;
          src[i + 1] = 0;
          src[i + 2] = 0;
          src[i + 3] = 0;
          continue;
        }
        j = (sy * rw + sx) * 4;
        src[i] = copy[j];
        src[i + 1] = copy[j + 1];
        src[i + 2] = copy[j + 2];
        src[i + 3] = copy[j + 3];
      }
    }

    if (t > 0.15) {
      var copy2 = new Uint8ClampedArray(src);
      var chewCell = Math.max(cell, 6);
      for (py = 1; py < rh - 1; py++) {
        for (px = 1; px < rw - 1; px++) {
          i = (py * rw + px) * 4;
          if (copy2[i + 3] < 12) continue;
          var edge = copy2[i + 3 - 4] < 12 || copy2[i + 3 + 4] < 12 ||
            copy2[i + 3 - rw * 4] < 12 || copy2[i + 3 + rw * 4] < 12;
          if (!edge) continue;
          if (coarseNoise01(px, py, seed + 9000, chewCell) < 0.12 + t * 0.28) {
            src[i + 3] = 0;
          }
        }
      }
    }

    sctx.putImageData(img, x0, y0);
  }

  // 全メンバーの本体パス・しっぽパスを順に構築してop（fill/stroke）を適用
  function forEachPath(c, balloons, op) {
    for (var i = 0; i < balloons.length; i++) {
      var b = balloons[i];
      if (!b || b.visible === false) continue;
      buildBodyPath(c, b);
      op(c);
      if (b.tail && b.tail.tipPoint) {
        buildTailPath(c, b);
        op(c);
      }
    }
  }

  // 本体パス（transformの位置・回転を反映したページ座標のパス）
  function buildBodyPath(c, balloon, factor) {
    var t = balloon.transform || {};
    var f = factor || 1;
    var w = ((balloon.size && balloon.size.width) || 150) * f;
    var h = ((balloon.size && balloon.size.height) || 80) * f;

    c.save();
    c.translate(t.x || 0, t.y || 0);
    if (t.rotation) c.rotate(t.rotation * Math.PI / 180);
    buildShapePath(c, balloon.shape || 'ellipse', w, h);
    c.restore(); // パスは構築時の変換で確定する
  }

  function buildShapePath(ctx, shape, w, h) {
    switch (shape) {
      case 'ellipse':     pathEllipse(ctx, w, h); break;
      case 'softEllipse': pathSoftEllipse(ctx, w, h); break;
      case 'rect':        pathRect(ctx, w, h); break;
      case 'roughRect':   pathRoughRect(ctx, w, h); break;
      case 'softBurst':   pathSoftBurst(ctx, w, h); break;
      case 'jaggedRect':  pathJaggedRect(ctx, w, h); break;
      case 'roundedRect': pathRoundedRect(ctx, w, h, Math.min(w, h) * 0.25); break;
      case 'superEllipse': pathSuperEllipse(ctx, w, h); break;
      case 'handDrawnSpiky': pathHandDrawnSpiky(ctx, w, h); break;
      case 'handDrawnPolygon': pathHandDrawnPolygon(ctx, w, h); break;
      case 'spikyExplosion': pathSpikyExplosion(ctx, w, h); break;
      case 'wobble':      pathWobble(ctx, w, h); break;
      case 'wobble2':     pathWobble2(ctx, w, h); break;
      case 'roughPoly':   pathRoughPoly(ctx, w, h); break;
      case 'heptagon':    pathPolygon(ctx, w, h, 7); break;
      case 'nonagon':     pathPolygon(ctx, w, h, 9); break;
      case 'jagged':      pathJagged(ctx, w, h); break;
      case 'explosion':   pathExplosion(ctx, w, h); break;
      case 'thought':     pathThought(ctx, w, h); break;
      // 新規: 凹曲面 / 縦六角形 / 不等変八角形 / 短い集中線 / ケバケバ線
      case 'concaveCurve':        pathConcaveCurve(ctx, w, h); break;
      case 'concaveCurveShallow': pathConcaveCurveShallow(ctx, w, h); break;
      case 'verticalHexagon':     pathVerticalHexagon(ctx, w, h); break;
      case 'irregularOctagon': pathIrregularOctagon(ctx, w, h); break;
      case 'shortConcLines':
      case 'kebaKebaLines':
        ctx.beginPath(); // 外側の四角枠（本体）を一切描かない。短線のみ表示
        break;
      default:            pathEllipse(ctx, w, h);
    }
  }

  function pathEllipse(ctx, w, h) {
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(w / 2, 1), Math.max(h / 2, 1), 0, 0, Math.PI * 2);
  }

  // 少し歪んだ楕円（卵形＋非対称。手描きゆらゆらより穏やかだが歪みははっきり）
  function pathSoftEllipse(ctx, w, h) {
    var rx = Math.max(w / 2, 1);
    var ry = Math.max(h / 2, 1);
    var n = 72;
    ctx.beginPath();
    for (var i = 0; i <= n; i++) {
      // 上から時計回り
      var a = (i / n) * Math.PI * 2 - Math.PI / 2;
      // 下側を膨らませる（卵形）
      var egg = 1 + 0.16 * Math.sin(a);
      // 左右の非対称
      var side = 1 + 0.09 * Math.cos(a + 0.4);
      // 低周波のうねり（高周波のガタつきは入れない）
      var soft = 1 + 0.05 * Math.sin(a * 2 + 0.7) + 0.035 * Math.sin(a * 3 - 0.4)
        + 0.02 * Math.cos(a * 1.5 + 1.2);
      var x = Math.cos(a) * rx * side * soft;
      var y = Math.sin(a) * ry * egg * soft;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function pathRect(ctx, w, h) {
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2, w, h);
  }

  // ちょっとだけガタついた四角（角を落とした八角形ベース＋頂点の短いトゲ）
  function pathRoughRect(ctx, w, h) {
    var hw = Math.max(w / 2, 1);
    var hh = Math.max(h / 2, 1);
    var cutX = hw * 0.2;
    var cutY = hh * 0.16;
    // 角を落とした八角形の頂点（上辺左→時計回り）
    var base = [
      { x: -hw + cutX, y: -hh },
      { x:  hw - cutX, y: -hh },
      { x:  hw,        y: -hh + cutY },
      { x:  hw,        y:  hh - cutY },
      { x:  hw - cutX, y:  hh },
      { x: -hw + cutX, y:  hh },
      { x: -hw,        y:  hh - cutY },
      { x: -hw,        y: -hh + cutY }
    ];
    var spikeBase = Math.min(hw, hh) * 0.07;
    ctx.beginPath();
    for (var i = 0; i < base.length; i++) {
      var p = base[i];
      // 頂点位置のわずかなガタ
      var jx = hw * 0.025 * Math.sin(i * 2.15 + 0.5);
      var jy = hh * 0.025 * Math.cos(i * 1.75 + 0.9);
      var px = p.x + jx;
      var py = p.y + jy;
      var len = Math.sqrt(px * px + py * py) || 1;
      // 角から外へ短いトゲ（参考スクショの角の飛び出し）
      var spike = spikeBase * (0.85 + 0.35 * Math.sin(i * 3.4 + 0.2));
      var sx = px + (px / len) * spike;
      var sy = py + (py / len) * spike;
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
  }

  // やわらかトゲ（スクショ3: 丸みのある凹凸。振幅は控えめ＝旧の約1/3）
  function pathSoftBurst(ctx, w, h) {
    var rx = Math.max(w / 2, 1);
    var ry = Math.max(h / 2, 1);
    var lobes = 9;
    var n = 96;
    ctx.beginPath();
    for (var i = 0; i <= n; i++) {
      var a = (i / n) * Math.PI * 2 - Math.PI / 2;
      // 谷〜峰を smoothstep でつなぎ、角ばらないトゲに
      var wave = Math.sin(a * lobes + 0.35);
      var t = (wave + 1) * 0.5;
      t = t * t * (3 - 2 * t);
      // 峰〜谷の振れ幅を 1/3 に（中心 0.85、±0.073）
      var r = 0.85 + 0.147 * (t - 0.5) * 2;
      // 峰ごとに長さを少しばらす（こちらも弱め）
      var lobePhase = a * lobes + 0.35;
      r *= 1 + 0.02 * Math.sin(lobePhase * 0.5 + 1.1);
      // 全体をわずかに縦長の卵っぽく
      r *= 1 + 0.015 * Math.sin(a);
      var x = Math.cos(a) * rx * r;
      var y = Math.sin(a) * ry * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // ギザ四角（スクショ4: 四角いシルエット＋周縁のギザギザ）
  function pathJaggedRect(ctx, w, h) {
    var rx = Math.max(w / 2, 1);
    var ry = Math.max(h / 2, 1);
    // 偶数: 角数が多めで矩形感のあるギザ
    var n = 28;
    var seN = 4; // スーパー楕円指数（四角寄り）
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 - Math.PI / 2;
      var cosA = Math.cos(a);
      var sinA = Math.sin(a);
      var ax = Math.abs(cosA);
      var ay = Math.abs(sinA);
      // 単位スーパー楕円の半径係数
      var se = 1 / Math.pow(Math.pow(ax, seN) + Math.pow(ay, seN) || 1e-6, 1 / seN);
      // 内外交互のギザ（深さは中程度）
      var jag = (i % 2 === 0) ? 1.02 : 0.76;
      jag *= 1 + 0.07 * Math.sin(i * 2.4 + 0.6) + 0.04 * Math.cos(i * 1.3);
      var x = cosA * rx * se * jag;
      var y = sinA * ry * se * jag;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function pathRoundedRect(ctx, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(-w / 2 + r, -h / 2);
    ctx.lineTo(w / 2 - r, -h / 2);
    ctx.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    ctx.lineTo(w / 2, h / 2 - r);
    ctx.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    ctx.lineTo(-w / 2 + r, h / 2);
    ctx.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    ctx.lineTo(-w / 2, -h / 2 + r);
    ctx.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    ctx.closePath();
  }

  // スーパー楕円（楕円より角張った、しかし滑らかな形状）
  function pathSuperEllipse(ctx, w, h) {
    var rx = w / 2, ry = h / 2;
    ctx.beginPath();
    for (var i = 0; i <= 64; i++) {
      var a = (i / 64) * Math.PI * 2;
      // superellipse: |x/a|^n + |y/b|^n = 1 のパラメトリック式
      // x = rx * sign(cos(a)) * |cos(a)|^(2/n), y = ry * sign(sin(a)) * |sin(a)|^(2/n)
      var n = 3;
      var cosA = Math.cos(a), sinA = Math.sin(a);
      var px = Math.pow(Math.abs(cosA), 2 / n);
      var py = Math.pow(Math.abs(sinA), 2 / n);
      var x = (cosA >= 0 ? 1 : -1) * px * rx;
      var y = (sinA >= 0 ? 1 : -1) * py * ry;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // 手書き風（トゲ）: 楕円に不規則なトゲを付けた、漫画的な表現
  function pathHandDrawnSpiky(ctx, w, h) {
    var rx = w / 2, ry = h / 2;
    var spikes = 18;
    ctx.beginPath();
    for (var i = 0; i < spikes * 2; i++) {
      var angle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      // 外側はトゲ、内側は谷。ランダムだがseed固定で再現性あり
      var spikeDepth = 1 + 0.35 * Math.sin(i * 3.7 + 1.2);
      var r = (i % 2 === 0) ? rx * spikeDepth : rx * 0.85;
      var ryFactor = (i % 2 === 0) ? 1 + 0.2 * Math.sin(i * 2.3) : 0.9;
      var yR = ry * ryFactor;
      if (i === 0) {
        ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * yR);
      } else {
        ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * yR);
      }
    }
    ctx.closePath();
  }

  // 手書き風多角形: 内外交互の頂点で凹凸をもたせた閉じた多角形、手描き感を強調
  function pathHandDrawnPolygon(ctx, w, h) {
    var outerN = 8;                       // 外側頂点数
    var innerRatios = [0.55, 0.65, 0.50, 0.70, 0.58, 0.62, 0.53, 0.68]; // 内側/外側の半径比（不規則）
    var totalPts = outerN * 2;            // 内外交互で 16 頂点
    var cx = 0, cy = 0;
    var rx = w / 2, ry = h / 2;

    ctx.beginPath();
    for (var i = 0; i < totalPts; i++) {
      var a = (i / totalPts) * Math.PI * 2 - Math.PI / 2;
      var r;
      if (i % 2 === 0) {
        // 外側頂点: ランダムな揺れ（振幅を大きく）
        var jitter = 1 + 0.25 * Math.sin(i * 3.7 + 1.1) - 0.15 * Math.cos(i * 2.3);
        r = rx * jitter;
      } else {
        // 内側頂点: 不規則な凹み量（振幅を大きく）
        var idx = (i / 2) % outerN;
        r = rx * innerRatios[idx] * (1 + 0.15 * Math.sin(i * 5.1));
      }
      // x, y を外半径/内半径の比で計算（ry/rx で縦方向もスケーリング）
      var x = cx + Math.cos(a) * r;
      var y = cy + Math.sin(a) * (r * ry / rx);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // トゲが不揃いな爆発: 通常のexplosionよりトゲの長さがばらつき、不規則な印象
  function pathSpikyExplosion(ctx, w, h) {
    var spikes = 20;
    var outerR = Math.max(w, h) / 2;
    var innerR = outerR * 0.45;

    ctx.beginPath();
    for (var i = 0; i < spikes * 2; i++) {
      var angle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      // トゲの長さを不規則に（奇数番目のみ変動）
      var r;
      if (i % 2 === 0) {
        // 外側トゲ: ランダムな深さ
        r = outerR * (0.7 + 0.3 * Math.sin(i * 1.3 + 0.5) + 0.2 * Math.cos(i * 2.7));
      } else {
        // 内側谷: 少し変動させる
        r = innerR * (0.85 + 0.15 * Math.sin(i * 1.9 + 3.1));
      }
      if (i === 0) {
        ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
      } else {
        ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
      }
    }
    ctx.closePath();
  }

  // 手描き風（ゆらゆらした楕円）
  function pathWobble(ctx, w, h) {
    var rx = w / 2, ry = h / 2, n = 48;
    ctx.beginPath();
    for (var i = 0; i <= n; i++) {
      var a = (i / n) * Math.PI * 2;
      var r = 1 + 0.045 * Math.sin(a * 7) + 0.03 * Math.sin(a * 3 + 1.1);
      var x = Math.cos(a) * rx * r, y = Math.sin(a) * ry * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // n角形（少しだけ崩してキレイすぎないように）: 七角/九角など
  function pathPolygon(ctx, w, h, n) {
    var rx = w / 2, ry = h / 2;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 - Math.PI / 2;
      var jit = 1 + 0.06 * Math.sin(i * 3.1 + 0.4);
      var x = Math.cos(a) * rx * jit, y = Math.sin(a) * ry * jit;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // 新規形状: 凹曲面（内側に弓なりのRを持った曲線で構成・非対称強化版）
  function pathConcaveCurve(ctx, w, h) {
    var hw = Math.max(w / 2, 1);
    var hh = Math.max(h / 2, 1);
    // 角を10個に増やした非対称凹曲面（8→10角）
    var pts = [
      { x: -hw * 0.72, y: -hh * 0.92 },           // 1
      { x: -hw * 0.35, y: -hh * 0.98 },           // 2
      { x:  hw * 0.42, y: -hh * 0.88 },           // 3
      { x:  hw * 0.95, y: -hh * 0.72 },           // 4
      { x:  hw * 1.08, y: -hh * 0.25 },           // 5
      { x:  hw * 0.88, y:  hh * 0.55 },           // 6
      { x:  hw * 0.55, y:  hh * 1.05 },           // 7
      { x: -hw * 0.25, y:  hh * 0.92 },           // 8
      { x: -hw * 0.88, y:  hh * 0.68 },           // 9
      { x: -hw * 1.05, y: -hh * 0.35 }            // 10
    ];
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 0; i < pts.length; i++) {
      var p1 = pts[i];
      var p2 = pts[(i + 1) % pts.length];
      // 制御点を内側に強く引く（凹み強調）。非対称に pull 係数を変える
      var pull = 0.46 + 0.14 * Math.sin(i * 1.1);
      var cx = (p1.x + p2.x) * 0.5 * pull;
      var cy = (p1.y + p2.y) * 0.5 * pull;
      // 手書き風ジッタも非対称
      var jx = (hw + hh) * 0.009 * Math.sin(i * 2.4 + 0.7);
      var jy = (hw + hh) * 0.008 * Math.cos(i * 1.9 - 0.5);
      ctx.quadraticCurveTo(cx + jx, cy + jy, p2.x + jx * 0.45, p2.y + jy * 0.45);
    }
    ctx.closePath();
  }

  // 凹曲面（浅） — へこみを控えめ・角を8個程度に抑えた穏やかな凹み版
  function pathConcaveCurveShallow(ctx, w, h) {
    var hw = Math.max(w / 2, 1);
    var hh = Math.max(h / 2, 1);
    // 8点ベースで浅めの凹み（pullを高めに = へこみ控えめ）
    var pts = [
      { x: -hw * 0.78, y: -hh * 0.88 },
      { x:  hw * 0.35, y: -hh * 0.95 },
      { x:  hw * 0.92, y: -hh * 0.58 },
      { x:  hw * 0.85, y:  hh * 0.42 },
      { x:  hw * 0.48, y:  hh * 0.92 },
      { x: -hw * 0.32, y:  hh * 0.88 },
      { x: -hw * 0.88, y:  hh * 0.55 },
      { x: -hw * 0.92, y: -hh * 0.48 }
    ];
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 0; i < pts.length; i++) {
      var p1 = pts[i];
      var p2 = pts[(i + 1) % pts.length];
      // pullを高めに（0.72前後）して凹みを浅くする
      var pull = 0.72 + 0.08 * Math.sin(i * 0.9);
      var cx = (p1.x + p2.x) * 0.5 * pull;
      var cy = (p1.y + p2.y) * 0.5 * pull;
      // ジッタも控えめ
      var jx = (hw + hh) * 0.006 * Math.sin(i * 1.8 + 0.4);
      var jy = (hw + hh) * 0.005 * Math.cos(i * 2.1 - 0.3);
      ctx.quadraticCurveTo(cx + jx, cy + jy, p2.x + jx * 0.4, p2.y + jy * 0.4);
    }
    ctx.closePath();
  }

  // 縦六角形（縦長にストレッチした六角形）
  function pathVerticalHexagon(ctx, w, h) {
    var rx = Math.max(w / 2, 1);
    var ry = Math.max(h / 2 * 1.28, 1); // 縦長強調
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      var jit = 1 + 0.05 * Math.sin(i * 2.7 + 0.9);
      var x = Math.cos(a) * rx * jit;
      var y = Math.sin(a) * ry * jit;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // 角を直線で落とした四角形（不等辺八角形の代替・ chamfered rect）
  function pathIrregularOctagon(ctx, w, h) {
    var hw = Math.max(w / 2, 1);
    var hh = Math.max(h / 2, 1);
    // 各角の切り落とし量を少し不等に（不等辺感）
    var c1 = hw * 0.16, c2 = hh * 0.19;
    var c3 = hw * 0.14, c4 = hh * 0.17;
    ctx.beginPath();
    ctx.moveTo(-hw + c1, -hh);
    ctx.lineTo( hw - c3, -hh);
    ctx.lineTo( hw,      -hh + c2);
    ctx.lineTo( hw,       hh - c4);
    ctx.lineTo( hw - c1,  hh);
    ctx.lineTo(-hw + c3,  hh);
    ctx.lineTo(-hw,       hh - c2);
    ctx.lineTo(-hw,      -hh + c4);
    ctx.closePath();
  }

  // 手描き風（ラフ）: ゆらゆら楕円の別バリエーション
  function pathWobble2(ctx, w, h) {
    var rx = w / 2, ry = h / 2, n = 56;
    ctx.beginPath();
    for (var i = 0; i <= n; i++) {
      var a = (i / n) * Math.PI * 2;
      var r = 1 + 0.06 * Math.sin(a * 5 + 0.5) + 0.045 * Math.sin(a * 11 + 2.0) + 0.02 * Math.cos(a * 2);
      var x = Math.cos(a) * rx * r, y = Math.sin(a) * ry * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // 手描き風・多角形: 頂点を少し崩し、辺を軽く膨らませて手描きっぽく
  function pathRoughPoly(ctx, w, h) {
    var rx = w / 2, ry = h / 2, n = 7;
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 - Math.PI / 2;
      var jit = 1 + 0.05 * Math.sin(i * 2.3 + 0.7) - 0.04 * Math.cos(i * 1.3);
      pts.push({ x: Math.cos(a) * rx * jit, y: Math.sin(a) * ry * jit });
    }
    var bowAmt = Math.min(rx, ry) * 0.06;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var j = 0; j < n; j++) {
      var p0 = pts[j], p1 = pts[(j + 1) % n];
      var mmx = (p0.x + p1.x) / 2, mmy = (p0.y + p1.y) / 2;
      var nx = -(p1.y - p0.y), ny = (p1.x - p0.x);
      var len = Math.sqrt(nx * nx + ny * ny) || 1;
      var bow = (j % 2 === 0 ? 1 : -1) * bowAmt;
      ctx.quadraticCurveTo(mmx + nx / len * bow, mmy + ny / len * bow, p1.x, p1.y);
    }
    ctx.closePath();
  }

  function pathJagged(ctx, w, h) {
    var points = 12;
    var outerRx = w / 2, outerRy = h / 2;
    var innerRx = w / 3, innerRy = h / 3;

    ctx.beginPath();
    for (var i = 0; i < points * 2; i++) {
      var angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      var rx = (i % 2 === 0) ? outerRx : innerRx;
      var ry = (i % 2 === 0) ? outerRy : innerRy;
      if (i === 0) {
        ctx.moveTo(Math.cos(angle) * rx, Math.sin(angle) * ry);
      } else {
        ctx.lineTo(Math.cos(angle) * rx, Math.sin(angle) * ry);
      }
    }
    ctx.closePath();
  }

  function pathExplosion(ctx, w, h) {
    var spikes = 16;
    var outerR = Math.max(w, h) / 2;
    var innerR = outerR * 0.5;

    ctx.beginPath();
    for (var i = 0; i < spikes * 2; i++) {
      var angle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      var r = (i % 2 === 0) ? outerR : innerR;
      if (i === 0) {
        ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
      } else {
        ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
      }
    }
    ctx.closePath();
  }

  function pathThought(ctx, w, h) {
    pathEllipse(ctx, w, h);
    var bubbleR = Math.min(w, h) * 0.08;
    ctx.moveTo(-w / 6 - bubbleR, h / 2 + bubbleR);
    ctx.arc(-w / 6, h / 2 + bubbleR, bubbleR, 0, Math.PI * 2);
    ctx.moveTo(0 - bubbleR, h / 2 + bubbleR * 2.5);
    ctx.arc(0, h / 2 + bubbleR * 2.5, bubbleR * 0.7, 0, Math.PI * 2);
    ctx.moveTo(w / 6 - bubbleR * 0.5, h / 2 + bubbleR * 4);
    ctx.arc(w / 6, h / 2 + bubbleR * 4, bubbleR * 0.4, 0, Math.PI * 2);
  }

  // しっぽパス（ページ座標）: basePoint/curvePoint/tipPoint（旧angle形式にも対応）
  function buildTailPath(c, balloon) {
    var tail = balloon.tail;
    var t = balloon.transform || {};
    var cx = t.x || 0;
    var cy = t.y || 0;
    var w = (balloon.size && balloon.size.width) || 150;
    var h = (balloon.size && balloon.size.height) || 80;

    var bx, by;
    if (tail.basePoint && tail.basePoint.x !== undefined) {
      bx = tail.basePoint.x;
      by = tail.basePoint.y;
    } else if (tail.basePoint && tail.basePoint.angle !== undefined) {
      var angleRad = tail.basePoint.angle * Math.PI / 180;
      bx = cx + Math.cos(angleRad) * (w / 2);
      by = cy + Math.sin(angleRad) * (h / 2);
    } else {
      bx = cx;
      by = cy + h / 2;
    }

    var tx = tail.tipPoint.x;
    var ty = tail.tipPoint.y;

    var midX, midY;
    if (tail.curvePoint && tail.curvePoint.x !== undefined) {
      midX = tail.curvePoint.x;
      midY = tail.curvePoint.y;
    } else {
      var curveAmount = (tail.curve || 0) * Math.min(w, h) / 200;
      midX = (bx + tx) / 2 + curveAmount;
      midY = (by + ty) / 2;
    }

    var baseHalfWidth = Math.max(tail.width !== undefined ? tail.width : Math.min(w, h) * 0.12, 4);
    var dx = tx - bx;
    var dy = ty - by;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len;
    var ny = dx / len;

    var type = tail.type || 'normal';
    // 「太」版は根元半幅を2倍（tail.width 自体は触らない → 切り替えで戻せる）
    var halfW = baseHalfWidth;
    if (type === 'normalThick' || type === 'jaggedThick') {
      halfW = baseHalfWidth * 2;
    }
    if (type === 'thought') {
      buildThoughtTail(c, bx, by, dx, dy, baseHalfWidth, null);
      return;
    }
    if (type === 'thoughtFew') {
      // 内心の〇が少ない版（2〜3個）
      buildThoughtTail(c, bx, by, dx, dy, baseHalfWidth, 'few');
      return;
    }
    if (type === 'jagged' || type === 'jaggedThick') {
      buildJaggedTail(c, bx, by, tx, ty, halfW, nx, ny);
      return;
    }
    if (type === 'lightning') {
      buildLightningTail(c, bx, by, tx, ty, baseHalfWidth, nx, ny);
      return;
    }
    if (type === 'spiral') {
      buildSpiralTail(c, bx, by, tx, ty, baseHalfWidth);
      return;
    }

    // 通常（三角のしっぽ） / 通常（太）
    c.beginPath();
    c.moveTo(bx + nx * halfW, by + ny * halfW);
    c.quadraticCurveTo(midX + nx * halfW * 0.3, midY + ny * halfW * 0.3, tx, ty);
    c.quadraticCurveTo(midX - nx * halfW * 0.3, midY - ny * halfW * 0.3, bx - nx * halfW, by - ny * halfW);
    c.closePath();
  }

  // 〇しっぽ（内心）: baseからtipへ小さくなる丸を並べる
  // mode: null=通常(距離で3〜6)、'few'=少ない(2〜3)
  function buildThoughtTail(c, bx, by, dx, dy, baseHalfWidth, mode) {
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    var count;
    if (mode === 'few') {
      count = Math.max(2, Math.min(3, Math.round(dist / 40)));
    } else {
      count = Math.max(3, Math.min(6, Math.round(dist / 22)));
    }
    c.beginPath();
    for (var i = 0; i < count; i++) {
      var f = mode === 'few'
        ? (i + 1) / (count + 0.5)
        : (i + 1) / count;
      if (f > 1) f = 1;
      var px = bx + dx * f;
      var py = by + dy * f;
      var rScale = mode === 'few' ? (1 - f * 0.55) : (1 - f * 0.7);
      var r = Math.max(2, baseHalfWidth * rScale * (mode === 'few' ? 1.15 : 1));
      c.moveTo(px + r, py);
      c.arc(px, py, r, 0, Math.PI * 2);
    }
  }

  // ギザギザ（叫び）: のこぎり歯のトゲしっぽ
  function buildJaggedTail(c, bx, by, tx, ty, baseHalfWidth, nx, ny) {
    var p1x = bx + nx * baseHalfWidth, p1y = by + ny * baseHalfWidth;
    var p2x = bx - nx * baseHalfWidth, p2y = by - ny * baseHalfWidth;
    var seg = 5;
    c.beginPath();
    c.moveTo(p1x, p1y);
    for (var i = 1; i < seg; i++) {
      var f = i / seg;
      var mx = p1x + (tx - p1x) * f;
      var my = p1y + (ty - p1y) * f;
      var o = (i % 2 === 0 ? 1 : -1) * baseHalfWidth * 0.5 * (1 - f);
      c.lineTo(mx + nx * o, my + ny * o);
    }
    c.lineTo(tx, ty);
    for (var j = 1; j < seg; j++) {
      var f2 = j / seg;
      var mx2 = tx + (p2x - tx) * f2;
      var my2 = ty + (p2y - ty) * f2;
      var o2 = (j % 2 === 0 ? 1 : -1) * baseHalfWidth * 0.5 * f2;
      c.lineTo(mx2 + nx * o2, my2 + ny * o2);
    }
    c.lineTo(p2x, p2y);
    c.closePath();
  }

  // 稲妻（ボルト）: ピカチュウのしっぽ風の鋭いジグザグ
  function buildLightningTail(c, bx, by, tx, ty, baseHalfWidth, nx, ny) {
    var dx = tx - bx;
    var dy = ty - by;
    // 中心線の折れ: 片側に大きく張り出すボルト形
    var fracs = [0, 0.16, 0.34, 0.52, 0.70, 0.86, 1.0];
    var side = [0, 1.0, -0.55, 1.05, -0.45, 0.55, 0];
    var ampS = [1.0, 1.15, 0.95, 0.8, 0.55, 0.35, 0];
    var left = [];
    var right = [];
    var i;
    for (i = 0; i < fracs.length; i++) {
      var f = fracs[i];
      var cx = bx + dx * f;
      var cy = by + dy * f;
      var a = baseHalfWidth * ampS[i];
      var lat = side[i] * a * 1.05;
      var thick = (i === fracs.length - 1) ? 0 : Math.max(2, a * 0.62);
      left.push({ x: cx + nx * (lat + thick), y: cy + ny * (lat + thick) });
      right.push({ x: cx + nx * (lat - thick), y: cy + ny * (lat - thick) });
    }
    // 先端は tip に収束
    left[left.length - 1] = { x: tx, y: ty };
    right[right.length - 1] = { x: tx, y: ty };

    c.beginPath();
    c.moveTo(left[0].x, left[0].y);
    for (i = 1; i < left.length; i++) c.lineTo(left[i].x, left[i].y);
    for (i = right.length - 2; i >= 0; i--) c.lineTo(right[i].x, right[i].y);
    c.closePath();
  }

  // クルクル: 細長いしっぽの途中でワンループ
  function buildSpiralTail(c, bx, by, tx, ty, baseHalfWidth) {
    var dx = tx - bx;
    var dy = ty - by;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len;
    var uy = dy / len;
    var nx = -uy;
    var ny = ux;
    // ループ半径（細め）・経路上の位置
    var loopR = Math.max(baseHalfWidth * 0.85, Math.min(len * 0.13, baseHalfWidth * 1.6));
    var loopStart = 0.38;
    var loopEnd = 0.72;
    var steps = 56;
    var pts = [];
    var i;

    for (i = 0; i <= steps; i++) {
      var t = i / steps;
      var px;
      var py;
      if (t < loopStart || t > loopEnd) {
        // 直線部
        px = bx + dx * t;
        py = by + dy * t;
      } else {
        // 入口固定 + 軸方向に出口まで進めつつ R で一回転
        // p = enter + axisAdvance + R*sinθ * T + R*(1-cosθ) * N
        var u = (t - loopStart) / (loopEnd - loopStart);
        var theta = u * Math.PI * 2;
        var enterX = bx + dx * loopStart;
        var enterY = by + dy * loopStart;
        var axisAdvance = (loopEnd - loopStart) * len * u;
        px = enterX + ux * axisAdvance + ux * (loopR * Math.sin(theta)) + nx * (loopR * (1 - Math.cos(theta)));
        py = enterY + uy * axisAdvance + uy * (loopR * Math.sin(theta)) + ny * (loopR * (1 - Math.cos(theta)));
      }
      if (i === 0) {
        px = bx;
        py = by;
      }
      if (i === steps) {
        px = tx;
        py = ty;
      }
      pts.push({ x: px, y: py });
    }

    // 細長いリボン（根元も細く先端は尖る）
    var thin = Math.max(1.6, baseHalfWidth * 0.38);
    var left = [];
    var right = [];
    var n = pts.length;
    for (i = 0; i < n; i++) {
      var p0 = pts[i === 0 ? 0 : i - 1];
      var p1 = pts[i];
      var p2 = pts[i === n - 1 ? n - 1 : i + 1];
      var tdx = p2.x - p0.x;
      var tdy = p2.y - p0.y;
      var tlen = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
      var nnx = -tdy / tlen;
      var nny = tdx / tlen;
      var f = i / (n - 1);
      var half = (i === n - 1) ? 0 : Math.max(0.7, thin * (1 - f * 0.7));
      left.push({ x: p1.x + nnx * half, y: p1.y + nny * half });
      right.push({ x: p1.x - nnx * half, y: p1.y - nny * half });
    }
    left[n - 1] = { x: tx, y: ty };
    right[n - 1] = { x: tx, y: ty };

    c.beginPath();
    c.moveTo(left[0].x, left[0].y);
    for (i = 1; i < n; i++) c.lineTo(left[i].x, left[i].y);
    for (i = n - 2; i >= 0; i--) c.lineTo(right[i].x, right[i].y);
    c.closePath();
  }

  // 短い集中線 / ケバケバ線 用の境界垂直短線描画（strokeレイヤー s 上で実行）
  // 円は描かず、rectベースの本体＋ランダム散らした短線（長さ・位置・角度に乱数）
  function drawShortConcentrationDecor(ctx, balloons) {
    if (!balloons || balloons.length === 0) return;
    for (var bi = 0; bi < balloons.length; bi++) {
      var b = balloons[bi];
      if (!b || b.visible === false) continue;
      var t = b.transform || { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
      var bw = (b.size && b.size.width) || 150;
      var bh = (b.size && b.size.height) || 80;
      var cx = t.x || 0;
      var cy = t.y || 0;
      var rot = (t.rotation || 0) * Math.PI / 180;
      var sx = (t.scaleX !== undefined ? t.scaleX : 1);
      var sy = (t.scaleY !== undefined ? t.scaleY : 1);
      var isKeba = (b.shape === 'kebaKebaLines');

      // balloonのid（なければインデックス）をシードにした決定論的乱数（再描画で線が揺れないように）
      var rand = makeRng(hashStr(b.id !== undefined && b.id !== null ? b.id : 'shortconc:' + bi));

      // 本数（ケバケバは短い集中線の「ランダム少なめ・本数多め」バージョン）
      var numLines = isKeba
        ? (210 + Math.floor(rand() * 90))   // 210〜300本
        : (52 + Math.floor(rand() * 16));   // 52〜68本

      var baseLen = isKeba ? 12.5 : 29;   // 短い集中線は今の2倍の長さ（29px基準）
      var lineW = Math.max(0.5, (b.strokeWidth || 2) * (isKeba ? 0.42 : 0.55));

      ctx.save();
      ctx.translate(cx, cy);
      if (rot) ctx.rotate(rot);
      if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
      ctx.strokeStyle = b.strokeColor || '#000000';
      ctx.lineWidth = lineW;
      ctx.lineCap = 'round';

      var rxBase = bw * 0.48;
      var ryBase = bh * 0.48;

      for (var k = 0; k < numLines; k++) {
        var a = rand() * Math.PI * 2;
        var rJit = isKeba ? 0.08 : 0.28;
        var jit = (0.90 + rand() * rJit);
        var ex = Math.cos(a) * rxBase * jit;
        var ey = Math.sin(a) * ryBase * jit;

        // 中心を向く方向（内向き）
        // ケバケバは「短い集中線のランダム少なめ・本数多めバージョン」
        var lenJit = isKeba
          ? baseLen * (0.92 + rand() * 0.16)   // さらにランダムを抑えて長さをそろえる
          : baseLen * (0.72 + rand() * 0.56);
        var distToCenter = Math.sqrt(ex * ex + ey * ey) || 1;
        var dx = -ex / distToCenter * lenJit;
        var dy = -ey / distToCenter * lenJit;

        // 開始位置を少し内側にずらして「境界あたり」から描く
        var startInset = 2.5 + rand() * 2.0;
        var x1 = ex - (ex / distToCenter) * startInset;
        var y1 = ey - (ey / distToCenter) * startInset;
        var x2 = ex + dx;
        var y2 = ey + dy;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  window.ME.Render.Balloon.draw = draw;
  window.ME.Render.Balloon.drawGroup = drawGroup;
})();
