// ME.Render.Image.draw(ctx, imageObj, assetLibrary) — 画像描画
// ME.Render.Image.applyTone(img, tone) — トーンカーブ(中間調ガンマ)適用済みcanvasを返す(tone=0はimgそのまま)
//   assetLibraryからBase64画像データをロード
//   transform (x,y,rotation,scaleX,scaleY) を適用して配置
//   colorAdjustをCanvas filter文字列に変換（tone=中間調ガンマはピクセルLUTで別途適用）
//   panelIdが指すPanelのクリッピングを適用してから描画
//   flipX/flipY対応

window.ME = window.ME || {};
window.ME.Render = window.ME.Render || {};
window.ME.Render.Image = window.ME.Render.Image || {};

(function() {
  'use strict';

  // 画像キャッシュ（assetId → Imageオブジェクト）。挿入順キー配列で件数上限を管理
  var imageCache = {};
  var imageCacheKeys = [];
  var IMAGE_CACHE_MAX = 64;

  // トーンカーブ（中間調ガンマ）適用済みキャンバスのキャッシュ
  // キー: assetId + '|' + tone（assetId不明な外部画像は img.src ベース）
  var toneCache = {};
  var toneCacheKeys = [];
  var TONE_CACHE_MAX = 64;

  // 白レベル/黒レベルを固定して中間の明るさだけ上下させる（ガンマ補正）。
  // tone>0で中間調を明るく、tone<0で暗く。tone=0は元画像をそのまま返す。
  function applyTone(img, tone) {
    tone = tone || 0;
    if (!tone || !img || !img.naturalWidth) return img;
    var key = (img._meAssetId || img.src) + '|' + tone;
    var cached = toneCache[key];
    if (cached && cached.tone === tone && cached.canvas) return cached.canvas;

    var w = img.naturalWidth, h = img.naturalHeight;
    var off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    var octx = off.getContext('2d');
    octx.drawImage(img, 0, 0);

    var data;
    try {
      data = octx.getImageData(0, 0, w, h);
    } catch (e) {
      return img; // getImageDataが失敗（タイント等）した場合は元画像
    }

    var g = Math.pow(2, -tone / 100); // 中間調ガンマ
    var lut = [];
    for (var i = 0; i < 256; i++) {
      lut[i] = Math.max(0, Math.min(255, Math.round(255 * Math.pow(i / 255, g))));
    }
    var px = data.data;
    for (var p = 0; p < px.length; p += 4) {
      px[p]     = lut[px[p]];
      px[p + 1] = lut[px[p + 1]];
      px[p + 2] = lut[px[p + 2]];
    }
    octx.putImageData(data, 0, 0);
    if (!toneCache.hasOwnProperty(key)) {
      toneCacheKeys.push(key);
      if (toneCacheKeys.length > TONE_CACHE_MAX) {
        delete toneCache[toneCacheKeys.shift()];
      }
    }
    toneCache[key] = { tone: tone, canvas: off };
    return off;
  }

  // 画像ロード完了時の再描画コールバック（render-engineが登録）
  var redrawCallback = null;
  function setRedrawCallback(cb) {
    redrawCallback = cb;
  }

  function draw(ctx, imageObj, assetLibrary) {
    if (!imageObj || !assetLibrary) return;

    var assetId = imageObj.assetId;
    var asset = assetLibrary.images ? assetLibrary.images[assetId] : null;
    if (!asset || !asset.dataBase64) return;

    // 画像キャッシュから取得（またはロード）
    var img = loadImage(assetId, asset.dataBase64);
    if (!img || !img.complete || !img.naturalWidth) return;

    ctx.save();

    // panelIdが指すPanelのクリッピングを適用
    // ※クリップパスはページ座標系なので、transform適用の前に行う
    if (imageObj.panelId && assetLibrary._panelClipCache) {
      var clipFn = assetLibrary._panelClipCache[imageObj.panelId];
      if (clipFn) {
        clipFn(ctx);
      }
    }

    // transform適用: 中心回転・スケール
    var t = imageObj.transform || {};
    ctx.translate(t.x, t.y);
    ctx.rotate((t.rotation || 0) * Math.PI / 180);
    ctx.scale(
      (imageObj.flipX ? -1 : 1) * (t.scaleX || 1),
      (imageObj.flipY ? -1 : 1) * (t.scaleY || 1)
    );

    // colorAdjustをCanvas filterに変換
    var filterStr = buildFilterString(imageObj.colorAdjust);
    if (filterStr) {
      ctx.filter = filterStr;
    }

    // opacity適用
    var opacity = (imageObj.colorAdjust && imageObj.colorAdjust.opacity !== undefined)
      ? imageObj.colorAdjust.opacity / 100 : 1;
    ctx.globalAlpha = Math.max(0, Math.min(1, opacity));

    // 画像描画（中心基準）— ImageObjectにwidth/heightがあればそれを使用
    var drawW = (imageObj.width && imageObj.width > 0) ? imageObj.width : img.naturalWidth;
    var drawH = (imageObj.height && imageObj.height > 0) ? imageObj.height : img.naturalHeight;
    var toned = applyTone(img, imageObj.colorAdjust && imageObj.colorAdjust.tone);
    ctx.drawImage(toned, -drawW / 2, -drawH / 2, drawW, drawH);

    ctx.restore();
  }

  function buildFilterString(colorAdjust) {
    if (!colorAdjust) return '';
    var b = clamp(colorAdjust.brightness || 0);
    var c = clamp(colorAdjust.contrast || 0);
    var s = clamp(colorAdjust.saturation || 0);
    var g = clamp(colorAdjust.grayscale || 0);
    var h = colorAdjust.hue || 0;

    // brightness/contrast/saturation/grayscaleは相対値(%)、hue-rotateは度数
    // 各項目を独立に判定（全て0なら parts が空になり '' を返す）
    var parts = [];
    if (b !== 0) parts.push('brightness(' + (100 + b) + '%)');
    if (c !== 0) parts.push('contrast(' + clampPercent(100 + c) + '%)');
    if (s !== 0) parts.push('saturate(' + clampPercent(100 + s) + '%)');
    if (g > 0) parts.push('grayscale(' + g + '%)');
    if (h !== 0) parts.push('hue-rotate(' + h + 'deg)');

    return parts.join(' ');
  }

  function clamp(val) {
    return Math.max(-100, Math.min(100, val));
  }

  function clampPercent(val) {
    return Math.max(0, Math.min(200, val));
  }

  function loadImage(assetId, base64) {
    var cached = imageCache[assetId];
    // 同一assetIdでも画像データが差し替えられた場合は再ロード
    if (cached && cached._meSrc === base64) return cached;

    var img = new Image();
    img._meAssetId = assetId;
    img._meSrc = base64;
    // ロード完了時に再描画を要求（初回は complete=false でスキップされるため）
    img.onload = function() {
      if (redrawCallback) redrawCallback();
    };
    img.src = base64;
    if (!imageCache.hasOwnProperty(assetId)) {
      imageCacheKeys.push(assetId);
      if (imageCacheKeys.length > IMAGE_CACHE_MAX) {
        var evicted = imageCacheKeys.shift();
        delete imageCache[evicted];
      }
    }
    imageCache[assetId] = img;
    return img;
  }

  // 指定assetIdの画像キャッシュ・トーンキャッシュを破棄（アセット削除/差し替え時用）
  function evictAsset(assetId) {
    if (imageCache.hasOwnProperty(assetId)) {
      delete imageCache[assetId];
      var idx = imageCacheKeys.indexOf(assetId);
      if (idx !== -1) imageCacheKeys.splice(idx, 1);
    }
    var prefix = assetId + '|';
    for (var i = toneCacheKeys.length - 1; i >= 0; i--) {
      if (toneCacheKeys[i].indexOf(prefix) === 0) {
        delete toneCache[toneCacheKeys[i]];
        toneCacheKeys.splice(i, 1);
      }
    }
  }

  window.ME.Render.Image.draw = draw;
  window.ME.Render.Image.setRedrawCallback = setRedrawCallback;
  window.ME.Render.Image.applyTone = applyTone;
  window.ME.Render.Image.evictAsset = evictAsset;
})();
