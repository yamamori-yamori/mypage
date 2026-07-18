// ME.IO.Exporter.exportPNG(project) — 現在ページ PNG
// 複数ページ時ファイル名: {title}-{n}.png（n は 1 始まり）
// 描画は ME.Render.PageDraw.draw

window.ME = window.ME || {};
window.ME.IO = window.ME.IO || {};
window.ME.IO.Exporter = window.ME.IO.Exporter || {};

(function() {
  'use strict';

  var SCREEN_DPI = 96;

  function mmToPx(mm, dpi) {
    return Math.round(mm * dpi / 25.4);
  }

  function sanitizeFilename(name) {
    name = String(name || 'manga-page');
    name = name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
    if (!name) name = 'manga-page';
    return name;
  }

  function saveBlob(blob, suggestedName, mimeType, description, extensions) {
    if (window.showSaveFilePicker) {
      // showSaveFilePicker の accept は「.」1個で始まる拡張子のみ有効（例: '.manga.json' は不可）
      var validExts = [];
      for (var i = 0; i < (extensions || []).length; i++) {
        if (/^\.[^.]+$/.test(extensions[i])) validExts.push(extensions[i]);
      }
      if (!validExts.length) {
        downloadBlob(blob, suggestedName);
        return Promise.resolve();
      }
      var accept = {};
      accept[mimeType] = validExts;
      var opts = { suggestedName: suggestedName, types: [{ description: description, accept: accept }] };
      return window.showSaveFilePicker(opts).then(function(handle) {
        return handle.createWritable();
      }).then(function(writable) {
        return Promise.resolve(writable.write(blob)).then(function() { return writable.close(); });
      }).catch(function(err) {
        if (err && err.name === 'AbortError') return;
        if (err && err.name === 'TypeError') {
          downloadBlob(blob, suggestedName);
          return;
        }
        alert('保存に失敗しました: ' + (err && err.message ? err.message : err));
      });
    }
    downloadBlob(blob, suggestedName);
    return Promise.resolve();
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function getPage(project) {
    if (!project) return null;
    if (ME.PageManager && typeof ME.PageManager.getCurrentPage === 'function') {
      return ME.PageManager.getCurrentPage(project);
    }
    return project.page || null;
  }

  function exportPNG(project) {
    var page = getPage(project);
    if (!project || !page) {
      alert('プロジェクトが有効ではありません');
      return;
    }

    var widthPx = mmToPx(page.size.widthMm, page.size.dpi);
    var heightPx = mmToPx(page.size.heightMm, page.size.dpi);

    var offscreen = document.createElement('canvas');
    offscreen.width = widthPx;
    offscreen.height = heightPx;
    var ctx = offscreen.getContext('2d');
    if (!ctx) {
      alert('Canvas 2D context not available');
      return;
    }

    preloadImages(project.assets).then(function(imgMap) {
      drawToCanvas(ctx, widthPx, heightPx, project, page, imgMap);

      offscreen.toBlob(function(blob) {
        if (!blob) {
          alert('PNG生成に失敗しました');
          return;
        }
        var base = sanitizeFilename((project.meta && project.meta.title) ? project.meta.title : 'manga-page');
        var count = (ME.PageManager && ME.PageManager.pageCount)
          ? ME.PageManager.pageCount(project)
          : ((project.pages && project.pages.length) || 1);
        var fname = base + '.png';
        if (count > 1) {
          var idx = (ME.PageManager && ME.PageManager.getCurrentIndex)
            ? ME.PageManager.getCurrentIndex(project)
            : 0;
          fname = base + '-' + (idx + 1) + '.png';
        }
        saveBlob(blob, fname, 'image/png', 'PNG画像', ['.png']);
      }, 'image/png');
    });
  }

  function preloadImages(assetLibrary) {
    if (!assetLibrary || !assetLibrary.images) return Promise.resolve({});
    var ids = [];
    var promises = [];
    for (var id in assetLibrary.images) {
      var asset = assetLibrary.images[id];
      if (asset && asset.dataBase64) {
        ids.push(id);
        promises.push(loadImageAsync(asset.dataBase64));
      }
    }
    return Promise.all(promises).then(function(imgs) {
      var map = {};
      for (var i = 0; i < ids.length; i++) {
        map[ids[i]] = imgs[i];
      }
      return map;
    });
  }

  function loadImageAsync(base64) {
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() { resolve(img); };
      img.onerror = function() { resolve(null); };
      img.src = base64;
    });
  }

  function drawToCanvas(ctx, canvasW, canvasH, project, page, imgMap) {
    page = page || getPage(project);
    if (!page) return;
    imgMap = imgMap || {};
    var exportScale = (page.size.dpi || 350) / SCREEN_DPI;
    var pageW = canvasW / exportScale;
    var pageH = canvasH / exportScale;

    ctx.save();
    ctx.scale(exportScale, exportScale);
    if (ME.Render && ME.Render.PageDraw && ME.Render.PageDraw.draw) {
      ME.Render.PageDraw.draw(ctx, project, page, {
        showDrafts: true,
        showTrimGuides: false,
        scale: exportScale,
        offsetX: 0,
        offsetY: 0,
        pageW: pageW,
        pageH: pageH,
        imgMap: imgMap,
        assetLibrary: project.assets
      });
    }
    ctx.restore();
  }

  window.ME.IO.Exporter.exportPNG = exportPNG;
  window.ME.IO.Exporter.drawToCanvas = drawToCanvas;
  window.ME.IO.Exporter.preloadImages = preloadImages;
  window.ME.IO.Exporter.sanitizeFilename = sanitizeFilename;
  window.ME.IO.saveBlob = saveBlob;
  window.ME.IO.downloadBlob = downloadBlob;
})();
