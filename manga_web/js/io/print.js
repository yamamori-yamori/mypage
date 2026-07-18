// ME.IO.Print.printProject(project) — 全ページ印刷（下書きなし・選択なし）
// offscreen + PageDraw → iframe に img 列挙 → window.print()

window.ME = window.ME || {};
window.ME.IO = window.ME.IO || {};
window.ME.IO.Print = window.ME.IO.Print || {};

(function() {
  'use strict';

  var SCREEN_DPI = 96;

  function mmToPx(mm, dpi) {
    return Math.round(mm * dpi / 25.4);
  }

  function printProject(project) {
    if (!project) {
      alert('プロジェクトが有効ではありません');
      return;
    }
    if (ME.PageManager && ME.PageManager.ensurePagesShape) {
      ME.PageManager.ensurePagesShape(project);
    }
    var pages = project.pages || (project.page ? [project.page] : []);
    if (!pages.length) {
      alert('印刷するページがありません');
      return;
    }

    // ポップアップブロック対策: クリック起点の同期処理内で先にウィンドウを開く
    var w = window.open('', '_blank');
    if (!w) {
      alert('ポップアップがブロックされました。ブラウザの設定を確認してください。');
      return;
    }
    w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>印刷</title></head><body><p>印刷データを準備中…</p></body></html>');

    var preload = (ME.IO.Exporter && ME.IO.Exporter.preloadImages)
      ? ME.IO.Exporter.preloadImages(project.assets)
      : Promise.resolve({});

    preload.then(function(imgMap) {
      var dataUrls = [];
      var sizes = [];

      for (var i = 0; i < pages.length; i++) {
        var page = pages[i];
        var dpi = (page.size && page.size.dpi) || 350;
        // 印刷プレビュー用は軽めに 150dpi 相当でも可。品質のため page dpi を使うが上限 200
        var printDpi = Math.min(dpi, 200);
        var widthPx = mmToPx(page.size.widthMm, printDpi);
        var heightPx = mmToPx(page.size.heightMm, printDpi);
        var canvas = document.createElement('canvas');
        canvas.width = widthPx;
        canvas.height = heightPx;
        var ctx = canvas.getContext('2d');
        if (!ctx) continue;
        var exportScale = printDpi / SCREEN_DPI;
        ctx.save();
        ctx.scale(exportScale, exportScale);
        if (ME.Render && ME.Render.PageDraw) {
          ME.Render.PageDraw.draw(ctx, project, page, {
            showDrafts: false,
            showTrimGuides: false,
            scale: exportScale,
            offsetX: 0,
            offsetY: 0,
            pageW: widthPx / exportScale,
            pageH: heightPx / exportScale,
            imgMap: imgMap,
            assetLibrary: project.assets
          });
        }
        ctx.restore();
        dataUrls.push(canvas.toDataURL('image/png'));
        sizes.push({
          w: (page.size && page.size.widthMm) || 182,
          h: (page.size && page.size.heightMm) || 257
        });
      }

      openPrintWindow(w, dataUrls, sizes);
    }).catch(function(err) {
      try { w.close(); } catch (e) {}
      alert('印刷準備に失敗しました: ' + (err && err.message ? err.message : err));
    });
  }

  function openPrintWindow(w, dataUrls, sizes) {
    // @page はページごとに変えられないため最大サイズを指定する
    // （サイズ混在時も各ページの div は個別サイズなのでアスペクト比は崩れない）
    var maxW = (sizes[0] && sizes[0].w) || 182;
    var maxH = (sizes[0] && sizes[0].h) || 257;
    var i;
    for (i = 1; i < sizes.length; i++) {
      if (sizes[i].w > maxW) maxW = sizes[i].w;
      if (sizes[i].h > maxH) maxH = sizes[i].h;
    }
    var html = [
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>印刷</title>',
      '<style>',
      '@page { size: ' + maxW + 'mm ' + maxH + 'mm; margin: 0; }',
      'html, body { margin: 0; padding: 0; }',
      '.page { page-break-after: always; overflow: hidden; }',
      '.page:last-child { page-break-after: auto; }',
      '.page img { width: 100%; height: 100%; display: block; }',
      '@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }',
      '</style></head><body>'
    ];
    for (i = 0; i < dataUrls.length; i++) {
      html.push('<div class="page" style="width: ' + sizes[i].w + 'mm; height: ' + sizes[i].h + 'mm;"><img src="' + dataUrls[i] + '" alt="page ' + (i + 1) + '"></div>');
    }
    html.push('<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},200);};</script>');
    html.push('</body></html>');

    w.document.open();
    w.document.write(html.join(''));
    w.document.close();
  }

  window.ME.IO.Print.printProject = printProject;
})();
