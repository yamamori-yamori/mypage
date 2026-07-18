// ME.Render.Text.draw(ctx, textObj) — テキスト描画
//   複数行対応（\nで行/列分け）。font.lineHeight=行間、font.letterSpacing=文字間(px)
//   横書き: transform = 左上（左端・上端）
//   縦書き: transform = 先頭列の上端（列は右→左）
//   outline.enabled=trueの場合: outline.color / outline.alpha / outline.width で縁取り
//   outline.roughness 0-10: 袋のガサつき（0=なめらか。旧0-100は描画時に/10）
//   outline.rounded (bool): 丸みON/OFF（平滑化＋丸い線端/結合）。アウトライン化で使用
//     rough>0 はグリフ輪郭をベクター化（Path2D）して頂点を粗いノイズで変位。
//     stroke/fill ともベクターなので zoom / scaleX/scaleY / exportScale でも滲まない。
//   outline.trapezoidTop / trapezoidBottom -100〜100: 台形変形（中央縦軸固定）
//     各辺とも −=縮小 / 0=なし / ＋=拡大（旧 trapezoid 単一値は描画時に互換読込）
//     ★ アウトライン化（レイアウト化）のベクター輪郭に適用。スキャンライン伸縮は使わない（ぼやけ防止）

window.ME = window.ME || {};
window.ME.Render = window.ME.Render || {};
window.ME.Render.Text = window.ME.Render.Text || {};

(function() {
  'use strict';

  function fillColorOf(font) {
    return ME.Core.Color.toRgba(font.color || '#000000', font.alpha !== undefined ? font.alpha : 100);
  }

  function outlineColorOf(outline) {
    return ME.Core.Color.toRgba(outline.color || '#FFFFFF', outline.alpha !== undefined ? outline.alpha : 100);
  }

  // canvas の font 文字列用。空白・日本語は引用符。カンマ区切りスタック可
  function formatOneFamily(name) {
    if (!name) return '';
    name = String(name).trim();
    if ((name.charAt(0) === '"' && name.charAt(name.length - 1) === '"') ||
        (name.charAt(0) === "'" && name.charAt(name.length - 1) === "'")) {
      name = name.slice(1, -1);
    }
    name = name.replace(/"/g, '').trim();
    if (!name) return '';
    if (/^(sans-serif|serif|monospace|cursive|fantasy|system-ui)$/i.test(name)) return name;
    if (/^[A-Za-z0-9_-]+$/.test(name)) return name;
    return '"' + name + '"';
  }

  function formatFontFamily(fam) {
    if (!fam) return 'sans-serif';
    fam = String(fam).trim();
    var parts = [];
    var cur = '';
    var inQ = false;
    var qch = '';
    var i;
    for (i = 0; i < fam.length; i++) {
      var ch = fam.charAt(i);
      if (inQ) {
        cur += ch;
        if (ch === qch) inQ = false;
      } else if (ch === '"' || ch === "'") {
        inQ = true;
        qch = ch;
        cur += ch;
      } else if (ch === ',') {
        var p = formatOneFamily(cur);
        if (p) parts.push(p);
        cur = '';
      } else {
        cur += ch;
      }
    }
    var last = formatOneFamily(cur);
    if (last) parts.push(last);
    return parts.length ? parts.join(', ') : 'sans-serif';
  }

  // 決定論 0..1（再描画で形が変わらない）
  function hash01(n) {
    var x = (n | 0) * 374761393 + 668265263;
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    x = x ^ (x >>> 16);
    return ((x >>> 0) % 10000) / 10000;
  }

  function seedFromId(id) {
    var s = 2166136261;
    var str = String(id || '');
    for (var i = 0; i < str.length; i++) {
      s ^= str.charCodeAt(i);
      s = Math.imul(s, 16777619);
    }
    return s | 0;
  }

  // 袋縁。roughness=0 は従来 strokeText。
  // roughness 1-10: 高解像度オフスクリーンに fillText → marching squares で輪郭抽出
  //   → 等間隔リサンプル → 粗いノイズで頂点変位 → Path2D 化してキャッシュ
  //   → stroke（袋）+ fill（本体）をベクター描画（ラスタ拡大が無いので滲まない）
  // 旧データ 11-100 は /10 で 1-10 に読み替え
  var _traceCanvas = null;
  var _wobbleCache = {};
  var _wobbleKeys = [];
  var WOBBLE_CACHE_MAX = 1024;

  function parseFontSizePx(fontStr) {
    var m = /(\d+(?:\.\d+)?)px/.exec(fontStr || '');
    return m ? (parseFloat(m[1]) || 16) : 16;
  }

  // 双線形で格子をなめらかに（ギザギザの「角」は残しつつ毛羽立ちを防ぐ）
  function coarseNoiseSmooth01(x, y, seed, cell) {
    var c = cell < 2 ? 2 : cell;
    var fx = x / c;
    var fy = y / c;
    var x0 = Math.floor(fx);
    var y0 = Math.floor(fy);
    var tx = fx - x0;
    var ty = fy - y0;
    // smoothstep
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

  function normalizeRoughness(raw) {
    var rough = raw !== undefined ? raw : 0;
    if (rough < 0) rough = 0;
    // 旧 0-100 → 0-10
    if (rough > 10) rough = Math.round(rough / 10);
    if (rough > 10) rough = 10;
    return rough;
  }

  function clampOutlineWidth(w) {
    var width = w !== undefined ? w : 2;
    if (width > 10) width = 10;
    if (width < 0.5) width = 0.5;
    return width;
  }

  // alpha(RGBA) を閾値128で輪郭抽出（marching squares）。
  // 閉ループの配列（各ループは [x,y,x,y,...] のフラット配列・trace px）を返す
  function traceAlphaContours(data, w, h) {
    var TH = 128;
    var segs = [];
    var byKey = {};

    function ptKey(x, y) {
      return Math.round(x * 8) + '_' + Math.round(y * 8);
    }

    function frac(a0, a1) {
      var f = (TH - a0) / (a1 - a0);
      if (f < 0.001) f = 0.001;
      if (f > 0.999) f = 0.999;
      return f;
    }

    function addSeg(p, q) {
      var idx = segs.length;
      segs.push({ x0: p[0], y0: p[1], x1: q[0], y1: q[1], used: false });
      var k0 = ptKey(p[0], p[1]);
      var k1 = ptKey(q[0], q[1]);
      (byKey[k0] = byKey[k0] || []).push(idx);
      (byKey[k1] = byKey[k1] || []).push(idx);
    }

    var x;
    var y;
    for (y = 0; y < h - 1; y++) {
      var row = y * w;
      for (x = 0; x < w - 1; x++) {
        var tl = data[(row + x) * 4 + 3];
        var tr = data[(row + x + 1) * 4 + 3];
        var bl = data[(row + w + x) * 4 + 3];
        var br = data[(row + w + x + 1) * 4 + 3];
        var idx = (tl >= TH ? 8 : 0) | (tr >= TH ? 4 : 0) | (br >= TH ? 2 : 0) | (bl >= TH ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        var T = [x + frac(tl, tr), y];
        var R = [x + 1, y + frac(tr, br)];
        var B = [x + frac(bl, br), y + 1];
        var L = [x, y + frac(tl, bl)];
        switch (idx) {
          case 1: addSeg(L, B); break;
          case 2: addSeg(B, R); break;
          case 3: addSeg(L, R); break;
          case 4: addSeg(T, R); break;
          case 5: addSeg(T, R); addSeg(L, B); break; // saddle
          case 6: addSeg(T, B); break;
          case 7: addSeg(L, T); break;
          case 8: addSeg(L, T); break;
          case 9: addSeg(T, B); break;
          case 10: addSeg(T, L); addSeg(B, R); break; // saddle
          case 11: addSeg(T, R); break;
          case 12: addSeg(L, R); break;
          case 13: addSeg(B, R); break;
          case 14: addSeg(L, B); break;
        }
      }
    }

    // 端点をたどって閉ループ化
    var loops = [];
    var si;
    for (si = 0; si < segs.length; si++) {
      if (segs[si].used) continue;
      var s = segs[si];
      s.used = true;
      var pts = [s.x0, s.y0, s.x1, s.y1];
      var cx = s.x1;
      var cy = s.y1;
      var startKey = ptKey(s.x0, s.y0);
      var guard = segs.length + 4;
      while (guard-- > 0) {
        var ck = ptKey(cx, cy);
        if (ck === startKey) break; // 一周
        var cands = byKey[ck];
        var next = -1;
        var ci;
        if (cands) {
          for (ci = 0; ci < cands.length; ci++) {
            if (!segs[cands[ci]].used) { next = cands[ci]; break; }
          }
        }
        if (next < 0) break; // 開いた鎖（パディングがあれば起きない）
        var ns = segs[next];
        ns.used = true;
        if (ptKey(ns.x0, ns.y0) === ck) { cx = ns.x1; cy = ns.y1; }
        else { cx = ns.x0; cy = ns.y0; }
        pts.push(cx, cy);
      }
      if (pts.length >= 12) loops.push(pts);
    }
    return loops;
  }

  // 閉ループを弧長 step で等間隔リサンプル（ピクセル階段を消し、ノイズ周期を拾える点密度にする）
  function resampleLoop(pts, step) {
    var n = pts.length / 2;
    if (n > 1 &&
        Math.abs(pts[0] - pts[(n - 1) * 2]) < 0.01 &&
        Math.abs(pts[1] - pts[(n - 1) * 2 + 1]) < 0.01) {
      n--; // 終点重複を落とす
    }
    if (n < 3) return null;
    var out = [];
    var acc = 0;
    var px = pts[0];
    var py = pts[1];
    out.push(px, py);
    var i;
    for (i = 1; i <= n; i++) {
      var qx = pts[(i % n) * 2];
      var qy = pts[(i % n) * 2 + 1];
      var dx = qx - px;
      var dy = qy - py;
      var d = Math.sqrt(dx * dx + dy * dy);
      while (acc + d >= step && d > 0) {
        var r = (step - acc) / d;
        px += dx * r;
        py += dy * r;
        out.push(px, py);
        dx = qx - px;
        dy = qy - py;
        d = Math.sqrt(dx * dx + dy * dy);
        acc = 0;
      }
      acc += d;
      px = qx;
      py = qy;
    }
    if (out.length < 6) return null;
    return out;
  }

  // 円環1パス平滑（1/4, 1/2, 1/4）
  function smoothLoop(pts) {
    var n = pts.length / 2;
    var out = new Array(pts.length);
    var i;
    for (i = 0; i < n; i++) {
      var p = ((i - 1 + n) % n) * 2;
      var c = i * 2;
      var q = ((i + 1) % n) * 2;
      out[c] = (pts[p] + pts[c] * 2 + pts[q]) / 4;
      out[c + 1] = (pts[p + 1] + pts[c + 1] * 2 + pts[q + 1]) / 4;
    }
    return out;
  }

  function sharpenLoop(pts, strength) {
    if (!(strength > 0)) return pts.slice();
    if (strength > 2) strength = 2;
    var sm = smoothLoop(smoothLoop(pts));
    var out = new Array(pts.length);
    var i;
    for (i = 0; i < pts.length; i++) { out[i] = pts[i] + strength * (pts[i] - sm[i]); }
    return out;
  }

  var _sharpenCanvas = null;
  function unionFontWithSharpenedLoops(fontImg, ow, oh, sharpLoops) {
    if (!_sharpenCanvas) _sharpenCanvas = document.createElement('canvas');
    var sc = _sharpenCanvas;
    if (sc.width !== ow) sc.width = ow;
    if (sc.height !== oh) sc.height = oh;
    var sctx = sc.getContext('2d', { willReadFrequently: true });
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, ow, oh);
    sctx.fillStyle = '#000';
    if (typeof Path2D !== 'undefined') {
      var p = new Path2D();
      var li;
      for (li = 0; li < sharpLoops.length; li++) {
        var pts = sharpLoops[li];
        if (!pts || pts.length < 6) continue;
        var n = pts.length / 2;
        p.moveTo(pts[0], pts[1]);
        for (var i = 1; i < n; i++) p.lineTo(pts[i * 2], pts[i * 2 + 1]);
        p.closePath();
      }
      sctx.fill(p, 'evenodd');
    }
    var simg = sctx.getImageData(0, 0, ow, oh);
    var sd = simg.data;
    var fd = fontImg.data;
    for (var k = 3; k < sd.length; k += 4) { if (fd[k] > sd[k]) sd[k] = fd[k]; }
    return simg;
  }

  function resolveRoundness(outline) {
    if (!outline) return 0;
    if (typeof outline.roundness === 'number' && !isNaN(outline.roundness)) {
      var r = Math.round(outline.roundness);
      if (r > 10) r = 10;
      if (r < -10) r = -10;
      return r;
    }
    if (outline.rounded === true) return 6;
    return 0;
  }

  // グリフ輪郭 → 揺らした Path2D を生成。
  // rounded=true: 平滑化＋quadraticで手書き丸み / false: シャープな角（直線）
  // 戻り値 { path, w, fa, fd }（textAlign=left / textBaseline=alphabetic 基準のグリフ座標）
  function buildWobbleEntry(fontStr, letterSpacing, text, rough, seed, roundness) {
    if (typeof Path2D === 'undefined') return null;
    var fontSize = parseFontSizePx(fontStr);
    var t = (rough / 10); // 従来と同じ強度スケール
    var amp = (0.95 + fontSize * 0.05) * (0.05 + t * 0.95);
    if (amp < 0.05) amp = 0.05;
    var cell = Math.max(6, Math.round(fontSize * (0.22 + (1 - t) * 0.08) + 5));

    if (!_traceCanvas) _traceCanvas = document.createElement('canvas');
    var cv = _traceCanvas;
    var octx = cv.getContext('2d', { willReadFrequently: true });
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.font = fontStr;
    if ('letterSpacing' in octx) octx.letterSpacing = (letterSpacing || 0) + 'px';
    octx.textAlign = 'left';
    octx.textBaseline = 'alphabetic';
    var m = octx.measureText(text);
    var w = m.width;
    if (!(w > 0)) return null;
    var aL = m.actualBoundingBoxLeft !== undefined ? Math.max(0, m.actualBoundingBoxLeft) : 0;
    var aR = m.actualBoundingBoxRight !== undefined ? Math.max(w, m.actualBoundingBoxRight) : w;
    var aA = m.actualBoundingBoxAscent !== undefined ? m.actualBoundingBoxAscent : fontSize * 0.9;
    var aD = m.actualBoundingBoxDescent !== undefined ? m.actualBoundingBoxDescent : fontSize * 0.3;
    // ラスタ切り出しは actual（タイト）。baseline 変換は fontBounding を優先
    // （actual だと top 基準の fillText より上へ寄る。font のみだと以前下へ寄りすぎた事例あり → 無いときだけ actual）
    var fa = (m.fontBoundingBoxAscent !== undefined && m.fontBoundingBoxAscent > 0)
      ? m.fontBoundingBoxAscent
      : (m.actualBoundingBoxAscent !== undefined ? m.actualBoundingBoxAscent : fontSize * 0.88);
    var fd = (m.fontBoundingBoxDescent !== undefined && m.fontBoundingBoxDescent >= 0)
      ? m.fontBoundingBoxDescent
      : (m.actualBoundingBoxDescent !== undefined ? m.actualBoundingBoxDescent : fontSize * 0.28);

    // トレース解像度: 文字高さ約160pxで一度だけラスタ化（最終描画はベクター）。
    var ss = 160 / fontSize;
    if (ss > 4) ss = 4;
    if (ss < 0.75) ss = 0.75;
    var gw = aL + aR + 2;
    var gh = aA + aD + 2;
    if (gw * ss > 3000) ss = 3000 / gw;
    if (gh * ss > 1500) ss = 1500 / gh;

    var pad = Math.ceil(2 * ss) + 2;
    var ow = Math.ceil(gw * ss) + pad * 2;
    var oh = Math.ceil(gh * ss) + pad * 2;
    if (ow < 4 || oh < 4) return null;
    if (cv.width !== ow) cv.width = ow;
    if (cv.height !== oh) cv.height = oh;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, ow, oh);
    var scaledFont = fontStr.replace(/(\d+(?:\.\d+)?)px/, function(s0, n0) {
      return (parseFloat(n0) * ss) + 'px';
    });
    octx.font = scaledFont;
    if ('letterSpacing' in octx) octx.letterSpacing = ((letterSpacing || 0) * ss) + 'px';
    octx.textAlign = 'left';
    octx.textBaseline = 'alphabetic';
    octx.fillStyle = '#000';
    // 座標合わせ: +1 のバイアスを除去し 0.5 でサブピクセル中央寄せ（レイアウト化ON時の垂直位置ずれ修正）
    var origX = pad + aL * ss + 0.5;
    var origY = pad + aA * ss + 0.5;
    octx.fillText(text, origX, origY);

    var img = octx.getImageData(0, 0, ow, oh);
    var loops = traceAlphaContours(img.data, ow, oh);
    if (!loops.length) return null;

    // リサンプル → 平滑 → 粗いノイズで変位 → Path2D（グリフ座標）
    // 大きなフォント(160px前後)でガタガタになる問題対策: 点密度を高く（0.06→0.03）
    var stepG = Math.max(0.5, Math.min(cell / 4, fontSize * 0.03));

    var rnd = typeof roundness === 'number' ? roundness : 0;
    if (rnd > 10) rnd = 10;
    if (rnd < -10) rnd = -10;
    var mode = rnd < 0 ? 'sharp' : (rnd > 0 ? 'round' : 'straight');
    var isRounded = (mode === 'round');

    if (mode === 'sharp') {
      var strength = 2 * (-rnd) / 10;
      if (strength > 2) strength = 2;
      var sharpLoops = [];
      var sli;
      for (sli = 0; sli < loops.length; sli++) {
        var sp = resampleLoop(loops[sli], stepG * ss);
        if (!sp) continue;
        sharpLoops.push(sharpenLoop(sp, strength));
      }
      var unionImg = unionFontWithSharpenedLoops(img, ow, oh, sharpLoops);
      loops = traceAlphaContours(unionImg.data, ow, oh);
      if (!loops.length) return null;
    }

    var path = new Path2D();
    var loopsPts = [];
    var li;
    for (li = 0; li < loops.length; li++) {
      var pts = resampleLoop(loops[li], stepG * ss);
      if (!pts) continue;
      if (mode === 'round') {
        var passes = Math.min(5, 2 + Math.floor((rnd - 1) / 3));
        for (var sp2 = 0; sp2 < passes; sp2++) pts = smoothLoop(pts);
      }
      var n = pts.length / 2;
      var i;
      for (i = 0; i < n; i++) {
        var gx = (pts[i * 2] - origX) / ss;
        var gy = (pts[i * 2 + 1] - origY) / ss;
        // 位置ベースの滑らかなノイズ場 → 近接点が同方向に動き線の太さが保たれる
        var n1 = coarseNoiseSmooth01(gx, gy, seed, cell);
        var n2 = coarseNoiseSmooth01(gx + 19.7, gy + 7.3, seed + 101, cell);
        pts[i * 2] = gx + (n1 - 0.5) * 2 * amp;
        pts[i * 2 + 1] = gy + (n2 - 0.5) * 2 * amp;
      }
      // 台形変形時に再構築できるよう点列を保持
      loopsPts.push(pts);
      appendLoopToPath(path, pts, isRounded);
    }
    return { path: path, loops: loopsPts, rounded: isRounded, w: w, fa: fa, fd: fd };
  }

  // 点列 → Path2D に1ループ追加（rounded: quadratic / false: 直線）
  function appendLoopToPath(path, pts, rounded) {
    if (!pts || pts.length < 6) return;
    var n = pts.length / 2;
    var i;
    if (rounded) {
      path.moveTo((pts[0] + pts[2]) / 2, (pts[1] + pts[3]) / 2);
      for (i = 1; i <= n; i++) {
        var cxp = pts[(i % n) * 2];
        var cyp = pts[(i % n) * 2 + 1];
        var nxp = pts[((i + 1) % n) * 2];
        var nyp = pts[((i + 1) % n) * 2 + 1];
        path.quadraticCurveTo(cxp, cyp, (cxp + nxp) / 2, (cyp + nyp) / 2);
      }
      path.closePath();
    } else {
      path.moveTo(pts[0], pts[1]);
      for (i = 1; i < n; i++) {
        path.lineTo(pts[i * 2], pts[i * 2 + 1]);
      }
      path.closePath();
    }
  }

  // 台形ワープ: テキスト原点座標系の点 (x,y) の X を上辺〜下辺スケールで変形
  function warpTrapezoidX(x, y, warp) {
    if (!warp) return x;
    var h = warp.botY - warp.topY;
    var t = h <= 0 ? 0.5 : (y - warp.topY) / h;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    var scale = warp.topScale * (1 - t) + warp.botScale * t;
    return warp.centerX + (x - warp.centerX) * scale;
  }

  // グリフ点列をテキスト原点座標へ移し台形変形した Path2D を生成
  function buildWarpedPath(entry, ox, oy, warp) {
    if (!entry || !entry.loops || !entry.loops.length) return entry ? entry.path : null;
    var path = new Path2D();
    var rounded = entry.rounded !== false;
    var li;
    for (li = 0; li < entry.loops.length; li++) {
      var src = entry.loops[li];
      if (!src || src.length < 6) continue;
      var n = src.length / 2;
      var warped = new Array(src.length);
      var i;
      for (i = 0; i < n; i++) {
        var gx = src[i * 2];
        var gy = src[i * 2 + 1];
        var wx = warpTrapezoidX(ox + gx, oy + gy, warp);
        // translate(ox,oy) 後の座標系へ戻す
        warped[i * 2] = wx - ox;
        warped[i * 2 + 1] = gy;
      }
      appendLoopToPath(path, warped, rounded);
    }
    return path;
  }

  function getWobbleEntry(ctx, text, rough, seed, roundness) {
    var ls = 0;
    if ('letterSpacing' in ctx) ls = parseFloat(ctx.letterSpacing) || 0;
    var rnum = typeof roundness === 'number' ? Math.round(roundness) : 0;
    var k = ctx.font + '|' + ls + '|' + rough + '|' + seed + '|' + text + '|r' + rnum;
    if (_wobbleCache.hasOwnProperty(k)) {
      // true-LRU: ヒットしたキーを最近使用として末尾へ移動
      var hitIdx = _wobbleKeys.indexOf(k);
      if (hitIdx !== -1) {
        _wobbleKeys.splice(hitIdx, 1);
        _wobbleKeys.push(k);
      }
      return _wobbleCache[k];
    }
    var entry = null;
    try {
      entry = buildWobbleEntry(ctx.font, ls, text, rough, seed, roundness);
    } catch (e) {
      entry = null;
    }
    _wobbleCache[k] = entry;
    _wobbleKeys.push(k);
    if (_wobbleKeys.length > WOBBLE_CACHE_MAX) {
      delete _wobbleCache[_wobbleKeys.shift()];
    }
    return entry;
  }

  // 揺れ袋文字（袋 stroke + 本体 fill をベクターで）。
  // entry.path は align=left / baseline=alphabetic 基準なので現在の設定に合わせて平行移動
  // trapWarp がある場合は点列をテキスト原点座標で台形変形してから描画（ぼやけない）
  function drawWobbleEntry(ctx, entry, x, y, font, outline, trapWarp) {
    var align = ctx.textAlign || 'left';
    var baseline = ctx.textBaseline || 'alphabetic';
    var dx = 0;
    if (align === 'center') dx = -entry.w / 2;
    else if (align === 'right') dx = -entry.w;
    var dy = 0;
    if (baseline === 'top' || baseline === 'hanging') dy = entry.fa;
    else if (baseline === 'middle') dy = (entry.fa - entry.fd) / 2;
    else if (baseline === 'bottom' || baseline === 'ideographic') dy = -entry.fd;
    var ox = x + dx;
    var oy = y + dy;
    var path = entry.path;
    if (trapWarp && entry.loops && entry.loops.length) {
      path = buildWarpedPath(entry, ox, oy, trapWarp);
      if (!path) path = entry.path;
    }
    ctx.save();
    ctx.translate(ox, oy);
    ctx.strokeStyle = outlineColorOf(outline);
    ctx.lineWidth = clampOutlineWidth(outline.width);
    var isRounded = (entry.rounded !== false);
    ctx.lineCap = isRounded ? 'round' : 'butt';
    ctx.lineJoin = isRounded ? 'round' : 'miter';

    ctx.stroke(path);
    ctx.fillStyle = fillColorOf(font);
    ctx.fill(path, 'evenodd');
    ctx.restore();
  }

  // 袋文字・アウトライン化描画。戻り値 true = 本体塗りも済（呼び出し側の fillText 不要）
  // trapWarp: 台形変形パラメータ（アウトライン化ベクターに適用。ピクセル伸縮しない）
  function drawTextWithOutline(ctx, text, x, y, font, outline, seed, trapWarp) {
    var rough = normalizeRoughness(outline.roughness);
    // 台形ありのときは必ずベクター輪郭（アウトライン化相当）で描く
    var useVector = !!(outline.artisticEnabled) || !!trapWarp;
    if (useVector && text) {
      // 台形のみ（アウトライン化OFF）のときはガサつき0のクリーン輪郭
      if (!outline.artisticEnabled) rough = 0;
      var roundness = resolveRoundness(outline);
      var entry = getWobbleEntry(ctx, text, rough, seed, roundness);
      if (entry) {
        drawWobbleEntry(ctx, entry, x, y, font, outline, trapWarp || null);
        return true;
      }
      // アウトライン化がONなのにwobble生成に失敗した場合、袋文字にフォールバックしない
      return true;
    }

    // なめらか袋（outline.enabled の場合のみ）
    if (outline.enabled) {
      ctx.strokeStyle = outlineColorOf(outline);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = clampOutlineWidth(outline.width);
      ctx.strokeText(text, x, y);
    }
    return false;
  }

  function getTextBBox(textObj) {
    var font = textObj.font || {};
    var fontSize = font.size || 16;
    var lineHeight = font.lineHeight || 1.2;
    var letterSpacing = font.letterSpacing !== undefined ? font.letterSpacing : 0;
    var content = textObj.content || '';

    if (textObj.writingMode === 'vertical') {
      var lines = content.split('\n');
      var colWidth = fontSize * lineHeight;
      var charStep = fontSize + letterSpacing;
      // 縦書き: linesは列の数。各列の文字数が高さ。
      // 描画座標: x=0が右端（先頭列）、y=0が上端
      // 実際の描画領域: X=[-(lines.length-1)*colWidth, 0], Y=[0, maxChars*charStep]
      var maxCharsPerCol = 0;
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].length > maxCharsPerCol) maxCharsPerCol = lines[i].length;
      }
      // bbox.w/h は描画領域の外接矩形（transform基準）
      var totalW = lines.length * colWidth;
      var totalH = maxCharsPerCol * charStep;
      // 描画原点は「先頭列の上端（右端・上端）」= transform座標
      // 幾何学的中心の相対座標: x = -(totalW - colWidth) / 2, y = totalH / 2
      return { w: totalW, h: totalH, offsetX: (totalW - colWidth) / 2, offsetY: totalH / 2 };
    } else {
      var lines2 = content.split('\n');
      var maxWidth = 0;
      for (var j = 0; j < lines2.length; j++) {
        // 簡易幅：文字数 × fontSize（measureTextより安定）
        var charW = 0;
        for (var k = 0; k < lines2[j].length; k++) {
          charW += fontSize + letterSpacing;
        }
        if (charW > maxWidth) maxWidth = charW;
      }
      return { w: maxWidth, h: lines2.length * fontSize * lineHeight };
    }
  }

  // 台形変形用: テキスト原点基準の描画領域（左右・上下）
  function getContentExtents(textObj) {
    var font = textObj.font || {};
    var fontSize = font.size || 16;
    var lineHeight = font.lineHeight || 1.2;
    var letterSpacing = font.letterSpacing !== undefined ? font.letterSpacing : 0;
    var content = textObj.content || '';
    var lines = content.split('\n');
    var outline = textObj.outline || {};
    var edge = 0;
    var edges0 = resolveTrapezoidEdges(outline);
    if (outline.enabled || outline.artisticEnabled || edges0.top || edges0.bot) {
      edge = clampOutlineWidth(outline.width) + 2;
    }
    if (textObj.writingMode === 'vertical') {
      var colWidth = fontSize * lineHeight;
      var maxChars = 0;
      var i;
      for (i = 0; i < lines.length; i++) {
        if (lines[i].length > maxChars) maxChars = lines[i].length;
      }
      var left = -(Math.max(0, lines.length - 1)) * colWidth - fontSize / 2 - edge;
      var right = fontSize / 2 + edge;
      var top = -edge;
      var bottom = Math.max(1, maxChars) * (fontSize + letterSpacing) + edge;
      return { left: left, right: right, top: top, bottom: bottom };
    }
    var maxWidth = 0;
    var j;
    for (j = 0; j < lines.length; j++) {
      var charW = 0;
      var k;
      for (k = 0; k < lines[j].length; k++) {
        charW += fontSize + letterSpacing;
      }
      if (charW > maxWidth) maxWidth = charW;
    }
    return {
      left: -edge,
      right: Math.max(1, maxWidth) + edge,
      top: -edge,
      bottom: lines.length * fontSize * lineHeight + edge
    };
  }

  // エッジ値 -100〜100 → 幅スケール（0=1.0、−=縮小、＋=拡大）
  function trapezoidEdgeToScale(v) {
    if (typeof v !== 'number' || isNaN(v)) v = 0;
    if (v > 100) v = 100;
    if (v < -100) v = -100;
    var s = 1 + (v / 100) * 0.85;
    if (s < 0.15) s = 0.15;
    if (s > 1.85) s = 1.85;
    return s;
  }

  // 旧 trapezoid 単一値を上辺/下辺へ（描画時互換）
  function resolveTrapezoidEdges(outline) {
    var top = 0;
    var bot = 0;
    if (!outline) return { top: 0, bot: 0 };
    if (typeof outline.trapezoidTop === 'number') top = outline.trapezoidTop;
    else if (typeof outline.trapezoid === 'number' && outline.trapezoid > 0) {
      top = -outline.trapezoid;
    }
    if (typeof outline.trapezoidBottom === 'number') bot = outline.trapezoidBottom;
    else if (typeof outline.trapezoid === 'number' && outline.trapezoid < 0) {
      bot = outline.trapezoid;
    }
    return { top: top, bot: bot };
  }

  // 台形パラメータをテキスト原点座標系のワープ情報へ
  function makeTrapezoidWarp(textObj, topVal, botVal) {
    var topScale = trapezoidEdgeToScale(topVal);
    var botScale = trapezoidEdgeToScale(botVal);
    if (topScale === 1 && botScale === 1) return null;
    var ext = getContentExtents(textObj);
    return {
      centerX: (ext.left + ext.right) / 2,
      topY: ext.top,
      botY: ext.bottom,
      topScale: topScale,
      botScale: botScale
    };
  }

  function draw(ctx, textObj) {
    if (!textObj) return;

    var t = textObj.transform || {};
    ctx.save();

    // 回転の中心をオブジェクト中央にするため、bbox の半分だけオフセット
    var bbox = getTextBBox(textObj);
    var cx = (bbox.offsetX !== undefined ? -bbox.offsetX : bbox.w / 2);
    var cy = (bbox.offsetY !== undefined ? bbox.offsetY : bbox.h / 2);

    ctx.translate(t.x + cx, t.y + cy);
    if (t.rotation) {
      ctx.rotate(t.rotation * Math.PI / 180);
    }
    var sx = t.scaleX || 1;
    var sy = t.scaleY || 1;
    // scale → translate(-cx,-cy) の順で、中心基準のスケール＋位置調整
    if (sx !== 1 || sy !== 1) {
      ctx.scale(sx, sy);
    }
    ctx.translate(-cx, -cy);

    var font = textObj.font || {};
    var fam = formatFontFamily(font.family);
    ctx.font = (font.bold ? 'bold ' : '') + ((font.size || 16)) + 'px ' + fam;

    var content = textObj.content || '';
    if (!content) {
      ctx.restore();
      return;
    }

    // 台形はアウトライン化（レイアウト化）ON時のみ、ベクター輪郭に適用（スキャンライン伸縮は使わない）
    var edges = resolveTrapezoidEdges(textObj.outline);
    var trapWarp = null;
    if ((textObj.outline && textObj.outline.artisticEnabled) && (edges.top || edges.bot)) {
      trapWarp = makeTrapezoidWarp(textObj, edges.top, edges.bot);
    }
    if (textObj.writingMode === 'vertical') {
      drawVertical(ctx, textObj, content, trapWarp);
    } else {
      drawHorizontal(ctx, textObj, content, trapWarp);
    }

    ctx.restore();
  }

  // --- 取り消し線・傍点描画ヘルパー ---

  // 横書き用: 各文字の中心に水平の取り消し線
  function drawStrikethroughChar(ctx, x, y, fontSize) {
    var strikeY = y + fontSize * 0.4;
    ctx.save();
    ctx.strokeStyle = ME.Core.Color.toRgba('#000000', 100);
    ctx.lineWidth = Math.max(1, fontSize * 0.08);
    ctx.beginPath();
    ctx.moveTo(x - fontSize * 0.5, strikeY);
    ctx.lineTo(x + fontSize * 0.5, strikeY);
    ctx.stroke();
    ctx.restore();
  }

  // 縦書き用: 1列の取り消し線は文字中央を縦に真っ直ぐな直線を1本引く
  function drawStrikethroughVertical(ctx, x, y, charCount, fontSize, letterSpacing) {
    if (charCount <= 0) return;
    var totalLen = charCount * (fontSize + letterSpacing);
    // 取り消し線は列の範囲内（y から y+totalLen）を縦に真っ直ぐ
    ctx.save();
    ctx.strokeStyle = ME.Core.Color.toRgba('#000000', 100);
    ctx.lineWidth = Math.max(1, fontSize * 0.08);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + totalLen);
    ctx.stroke();
    ctx.restore();
  }

  function drawRubyDot(ctx, x, y, fontSize) {
    var dotR = Math.max(1.2, fontSize * 0.1);
    ctx.save();
    ctx.fillStyle = ME.Core.Color.toRgba('#000000', 100);
    ctx.beginPath();
    ctx.arc(x, y - fontSize * 0.15, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawHorizontal(ctx, textObj, content, trapWarp) {
    var font = textObj.font || {};
    var outline = textObj.outline || {};
    var fontSize = font.size || 16;
    var lineHeight = font.lineHeight || 1.2;
    var letterSpacing = font.letterSpacing !== undefined ? font.letterSpacing : 0;
    var baseSeed = seedFromId(textObj.id);

    // 原点 = 左上
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    if (letterSpacing !== 0 && 'letterSpacing' in ctx) {
      ctx.letterSpacing = letterSpacing + 'px';
    }

    var doStrike = !!font.strikethrough;
    var doRuby = !!font.ruby;
    // 台形あり → ベクター輪郭必須（ぼやけ防止）
    var useVector = !!(outline.artisticEnabled) || !!trapWarp;

    var lines = content.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var y = i * fontSize * lineHeight;

      var bodyDrawn = false;
      if (useVector) {
        bodyDrawn = drawTextWithOutline(ctx, line, 0, y, font, outline, baseSeed + i * 97, trapWarp);
      } else if (outline.enabled) {
        bodyDrawn = drawTextWithOutline(ctx, line, 0, y, font, outline, baseSeed + i * 97, null);
      }

      if (!bodyDrawn) {
        ctx.fillStyle = fillColorOf(font);
        ctx.fillText(line, 0, y);
      }

      // 横書き: 取り消し線・傍点は文字ごとに描画（位置合わせ）
      if (doStrike || doRuby) {
        var cx = 0;
        for (var ci = 0; ci < line.length; ci++) {
          var chW = ctx.measureText(line[ci]).width;
          var charCenterX = cx + chW / 2;
          if (doStrike) drawStrikethroughChar(ctx, charCenterX, y, fontSize);
          if (doRuby) drawRubyDot(ctx, charCenterX, y, fontSize);
          cx += chW;
        }
      }
    }

    if (letterSpacing !== 0 && 'letterSpacing' in ctx) {
      ctx.letterSpacing = '0px';
    }
  }

  // 縦書きで90°回転する記号（全角ダッシュ・括弧・句読点など）
  // 注意: 漢字「一」(U+4E00) は直立のまま（横棒の字形が正しい）。長音符「ー」は回転。
  // 回転時は文字セル中央を原点にし textBaseline=middle にしないと左にズレる
  // （top+rotate90 だとグリフ本体が -X へ伸びる）
  var VERTICAL_ROTATE_CHARS =
    '、。ー−―—–‐─━〜～…‥：；「」『』【】（）()[]［］｛｝〈〉《》＜＞';

  function shouldRotateVerticalChar(ch) {
    if (!ch) return false;
    // 上リスト + その他の dash / box-drawing 水平線
    if (VERTICAL_ROTATE_CHARS.indexOf(ch) >= 0) return true;
    var code = ch.charCodeAt(0);
    // U+2010-2015 hyphens/dashes, U+2212 minus, U+30FC prolonged sound mark
    if (code === 0x30FC || code === 0x2212) return true;
    if (code >= 0x2010 && code <= 0x2015) return true;
    // U+FF0D fullwidth hyphen-minus
    if (code === 0xFF0D) return true;
    return false;
  }

  function drawVertical(ctx, textObj, content, trapWarp) {
    var font = textObj.font || {};
    var outline = textObj.outline || {};
    var fontSize = font.size || 16;
    var letterSpacing = font.letterSpacing !== undefined ? font.letterSpacing : 0;
    var lineHeight = font.lineHeight || 1.2;
    var baseSeed = seedFromId(textObj.id);

    // 原点 = 先頭列の上端。各文字は列中心 x・セル上端 y
    ctx.textAlign = 'center';

    var lines = content.split('\n');
    var colWidth = fontSize * lineHeight;
    var charStep = fontSize + letterSpacing;
    var doStrike = !!font.strikethrough;
    var doRuby = !!font.ruby;
    // 台形あり → ベクター輪郭必須（ぼやけ防止）
    var useVector = !!(outline.artisticEnabled) || !!trapWarp;

    for (var li = 0; li < lines.length; li++) {
      // 縦書き: 1列目が右端、以降は左へ
      var x = -li * colWidth;
      var chars = lines[li];

      for (var ci = 0; ci < chars.length; ci++) {
        var ch = chars[ci];
        var y = ci * charStep;
        var needRotate = shouldRotateVerticalChar(ch);
        // セル中心（直立・回転どちらも同じ中心に揃える）
        var cellCx = x;
        var cellCy = y + fontSize * 0.5;

        // 台形はテキスト原点座標系で計算するため、回転前のワールド座標で渡す
        // （回転文字はセル内ローカル描画のまま、ワープはセル中心付近のYで近似）
        ctx.save();
        ctx.translate(cellCx, cellCy);
        if (needRotate) ctx.rotate(Math.PI / 2);
        ctx.textBaseline = 'middle';

        var bodyDrawn = false;
        // 縦書きは文字ごとに translate 済みのため、trapWarp をセル原点基準にオフセット
        var localWarp = null;
        if (trapWarp) {
          localWarp = {
            centerX: trapWarp.centerX - cellCx,
            topY: trapWarp.topY - cellCy,
            botY: trapWarp.botY - cellCy,
            topScale: trapWarp.topScale,
            botScale: trapWarp.botScale
          };
        }
        if (useVector) {
          bodyDrawn = drawTextWithOutline(ctx, ch, 0, 0, font, outline, baseSeed + li * 131 + ci * 17, localWarp);
        } else if (outline.enabled) {
          bodyDrawn = drawTextWithOutline(ctx, ch, 0, 0, font, outline, baseSeed + li * 131 + ci * 17, null);
        }

        if (!bodyDrawn) {
          ctx.fillStyle = fillColorOf(font);
          ctx.fillText(ch, 0, 0);
        }
        ctx.restore();

        // 傍点: 列の右側（+X）。drawRubyDot は y から上へ 0.15fs ずらすので打ち消してセル中央に
        if (doRuby) drawRubyDot(ctx, x + fontSize * 0.55, cellCy + fontSize * 0.15, fontSize);
      }

      // 縦書き: 1列の取り消し線は文字中央を縦に真っ直ぐな直線を1本
      if (doStrike) drawStrikethroughVertical(ctx, x, 0, chars.length, fontSize, letterSpacing);
    }
  }

  window.ME.Render.Text.draw = draw;
})();
