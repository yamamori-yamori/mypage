// ME.PageManager — 複数ページ配列の単一窓口（JSON 1.3）
// getCurrentPage(project) → Page
// getCurrentIndex(project) → number
// setCurrentIndex(project, index) → number  // clamp
// pageCount(project) → number
// ensurePagesShape(project) → void
// syncPageAlias(project) → void  // 実行時互換: project.page = pages[current]
// addEmptyPage(project, opts?) → Page | null
//   opts.atIndex / size / backgroundColor
//   opts.mode: 'blank' | 'backing' | 'copy'（既定 blank）
//     blank   = 白紙（サイズは基準ページから）
//     backing = オブジェクトなし・台紙色/台紙画像のみ基準ページから
//     copy    = 基準ページの全オブジェクト複製（新 id / fusion / panelId リマップ）
//   opts.fromIndex: 基準ページ index（省略時は current）
// insertPageAt(project, page, index) → boolean
// removePageAt(project, index) → boolean  // 最後の1枚は false
// reorderPages(project, fromIndex, toIndex) → void
// migrateProjectToMultiPage(project) → project  // 1.2 page → pages
// clonePageContent(sourcePage, mode) → Page  // 挿入前の Page オブジェクト生成のみ
// MAX_PAGES = 64

window.ME = window.ME || {};
window.ME.PageManager = window.ME.PageManager || {};

(function() {
  'use strict';

  var MAX_PAGES = 64;

  function pageCount(project) {
    if (!project || !project.pages || !project.pages.length) return 0;
    return project.pages.length;
  }

  function clampIndex(project, index) {
    var n = pageCount(project);
    if (n <= 0) return 0;
    index = index | 0;
    if (index < 0) return 0;
    if (index >= n) return n - 1;
    return index;
  }

  function getCurrentIndex(project) {
    if (!project) return 0;
    return clampIndex(project, project.currentPageIndex);
  }

  function syncPageAlias(project) {
    if (!project || !project.pages || !project.pages.length) return;
    var i = getCurrentIndex(project);
    project.currentPageIndex = i;
    // 実行時互換: 既存コードの project.page 直参照を同じオブジェクトに向ける
    project.page = project.pages[i];
  }

  function ensurePagesShape(project) {
    if (!project) return;

    if (!project.pages || !project.pages.length) {
      if (project.page) {
        project.pages = [project.page];
      } else if (ME.SceneGraph && typeof ME.SceneGraph.createPage === 'function') {
        project.pages = [ME.SceneGraph.createPage()];
      } else {
        project.pages = [{
          id: (ME.Core && ME.Core.ID && ME.Core.ID.generate) ? ME.Core.ID.generate() : ('p' + Date.now()),
          size: { preset: 'B5', widthMm: 182, heightMm: 257, dpi: 350 },
          backgroundColor: '#FFFFFF',
          backingImage: null,
          trimMarks: { enabled: false, bleedMm: 5, marginMm: 10 },
          layers: ['background', 'panel', 'image', 'effect', 'balloon', 'text', 'draft'],
          panels: [],
          images: [],
          balloons: [],
          texts: [],
          effects: [],
          drafts: [],
          memos: [],
          strings: []
        }];
      }
    }

    if (typeof project.currentPageIndex !== 'number' || isNaN(project.currentPageIndex)) {
      project.currentPageIndex = 0;
    }
    project.currentPageIndex = clampIndex(project, project.currentPageIndex);
    syncPageAlias(project);
  }

  function getCurrentPage(project) {
    ensurePagesShape(project);
    return project.pages[getCurrentIndex(project)];
  }

  function setCurrentIndex(project, index) {
    ensurePagesShape(project);
    project.currentPageIndex = clampIndex(project, index);
    syncPageAlias(project);
    return project.currentPageIndex;
  }

  function copySizeFromPage(page) {
    if (!page || !page.size) {
      return { preset: 'B5', widthMm: 182, heightMm: 257, dpi: 350 };
    }
    return {
      preset: page.size.preset || 'B5',
      widthMm: page.size.widthMm || 182,
      heightMm: page.size.heightMm || 257,
      dpi: page.size.dpi || 350
    };
  }

  function newPageId() {
    if (ME.Core && ME.Core.ID && typeof ME.Core.ID.generate === 'function') {
      return ME.Core.ID.generate();
    }
    return 'p' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
  }

  function createBlankPageShell(sizeOpts) {
    sizeOpts = sizeOpts || { preset: 'B5', widthMm: 182, heightMm: 257, dpi: 350 };
    if (ME.SceneGraph && typeof ME.SceneGraph.createPage === 'function') {
      return ME.SceneGraph.createPage(sizeOpts);
    }
    return {
      id: newPageId(),
      size: {
        preset: sizeOpts.preset || 'B5',
        widthMm: sizeOpts.widthMm || 182,
        heightMm: sizeOpts.heightMm || 257,
        dpi: sizeOpts.dpi || 350
      },
      backgroundColor: '#FFFFFF',
      backingImage: null,
      trimMarks: { enabled: false, bleedMm: 5, marginMm: 10 },
      layers: ['background', 'panel', 'image', 'effect', 'balloon', 'text', 'draft'],
      panels: [],
      images: [],
      balloons: [],
      texts: [],
      effects: [],
      drafts: [],
      memos: [],
      strings: []
    };
  }

  // オブジェクト配列の id / fusionGroup / panelId を付け替え（assetId はプロジェクト共有のまま）
  function remapPageObjectIds(page) {
    if (!page) return page;
    var collections = ['panels', 'images', 'balloons', 'texts', 'effects', 'drafts', 'memos', 'strings'];
    var idMap = {};
    var fusionMap = {};
    var c;
    var i;
    var arr;
    var obj;
    var oldId;

    for (c = 0; c < collections.length; c++) {
      arr = page[collections[c]];
      if (!arr) continue;
      for (i = 0; i < arr.length; i++) {
        obj = arr[i];
        if (!obj) continue;
        oldId = obj.id;
        obj.id = newPageId();
        if (oldId) idMap[oldId] = obj.id;
        if (obj.fusionGroup) {
          if (!fusionMap[obj.fusionGroup]) {
            fusionMap[obj.fusionGroup] = newPageId();
          }
          obj.fusionGroup = fusionMap[obj.fusionGroup];
        }
      }
    }

    for (c = 0; c < collections.length; c++) {
      arr = page[collections[c]];
      if (!arr) continue;
      for (i = 0; i < arr.length; i++) {
        obj = arr[i];
        if (!obj || !obj.panelId) continue;
        if (idMap[obj.panelId]) {
          obj.panelId = idMap[obj.panelId];
        } else {
          // コマがコピーに含まれない参照は破棄
          obj.panelId = null;
        }
      }
    }
    return page;
  }

  // sourcePage から挿入用 Page を作る（配列には入れない）
  // mode: 'blank' | 'backing' | 'copy'
  function clonePageContent(sourcePage, mode) {
    mode = mode || 'blank';
    if (mode !== 'blank' && mode !== 'backing' && mode !== 'copy') {
      mode = 'blank';
    }

    var sizeOpts = copySizeFromPage(sourcePage);
    var page;

    if (mode === 'copy' && sourcePage) {
      page = JSON.parse(JSON.stringify(sourcePage));
      page.id = newPageId();
      if (!page.drafts) page.drafts = [];
      if (!page.memos) page.memos = [];
      if (!page.strings) page.strings = [];
      if (page.backingImage === undefined) page.backingImage = null;
      remapPageObjectIds(page);
      return page;
    }

    page = createBlankPageShell(sizeOpts);

    if (mode === 'backing' && sourcePage) {
      page.backgroundColor = sourcePage.backgroundColor || '#FFFFFF';
      if (sourcePage.trimMarks) {
        page.trimMarks = JSON.parse(JSON.stringify(sourcePage.trimMarks));
      }
      if (sourcePage.backingImage) {
        page.backingImage = JSON.parse(JSON.stringify(sourcePage.backingImage));
      } else {
        page.backingImage = null;
      }
    }

    return page;
  }

  function addEmptyPage(project, opts) {
    opts = opts || {};
    ensurePagesShape(project);
    if (project.pages.length >= MAX_PAGES) {
      return null;
    }

    var fromIdx = (typeof opts.fromIndex === 'number')
      ? clampIndex(project, opts.fromIndex)
      : getCurrentIndex(project);
    var source = project.pages[fromIdx] || getCurrentPage(project);
    var mode = opts.mode || 'blank';

    var page;
    if (mode === 'blank' && !opts.backgroundColor && !opts.size) {
      // 従来互換: 白紙 + 現在ページのサイズ
      page = clonePageContent(source, 'blank');
    } else if (mode === 'blank') {
      page = createBlankPageShell(opts.size || copySizeFromPage(source));
    } else {
      page = clonePageContent(source, mode);
    }

    if (opts.backgroundColor) page.backgroundColor = opts.backgroundColor;

    var at = (typeof opts.atIndex === 'number') ? (opts.atIndex | 0) : project.pages.length;
    if (at < 0) at = 0;
    if (at > project.pages.length) at = project.pages.length;
    project.pages.splice(at, 0, page);
    project.currentPageIndex = at;
    if (project.meta) {
      project.meta.updatedAt = new Date().toISOString();
    }
    syncPageAlias(project);
    return page;
  }

  // 既に作った Page オブジェクトを指定位置へ挿入（Command redo 用）
  function insertPageAt(project, page, index) {
    ensurePagesShape(project);
    if (!page) return false;
    if (project.pages.length >= MAX_PAGES) return false;
    index = index | 0;
    if (index < 0) index = 0;
    if (index > project.pages.length) index = project.pages.length;
    project.pages.splice(index, 0, page);
    project.currentPageIndex = index;
    if (project.meta) {
      project.meta.updatedAt = new Date().toISOString();
    }
    syncPageAlias(project);
    return true;
  }

  function removePageAt(project, index) {
    ensurePagesShape(project);
    if (project.pages.length <= 1) return false;
    index = index | 0;
    if (index < 0 || index >= project.pages.length) return false;
    project.pages.splice(index, 1);
    if (project.currentPageIndex > index) {
      project.currentPageIndex = project.currentPageIndex - 1;
    }
    project.currentPageIndex = clampIndex(project, project.currentPageIndex);
    if (project.meta) {
      project.meta.updatedAt = new Date().toISOString();
    }
    syncPageAlias(project);
    return true;
  }

  function reorderPages(project, fromIndex, toIndex) {
    ensurePagesShape(project);
    var n = project.pages.length;
    fromIndex = fromIndex | 0;
    toIndex = toIndex | 0;
    if (fromIndex < 0 || fromIndex >= n) return;
    if (toIndex < 0 || toIndex >= n) return;
    if (fromIndex === toIndex) return;

    var curId = project.pages[getCurrentIndex(project)].id;
    var item = project.pages.splice(fromIndex, 1)[0];
    project.pages.splice(toIndex, 0, item);

    // 現在ページを id で追従
    var found = 0;
    for (var i = 0; i < project.pages.length; i++) {
      if (project.pages[i].id === curId) {
        found = i;
        break;
      }
    }
    project.currentPageIndex = found;
    if (project.meta) {
      project.meta.updatedAt = new Date().toISOString();
    }
    syncPageAlias(project);
  }

  function migrateProjectToMultiPage(project) {
    if (!project) return project;

    if (project.pages && project.pages.length) {
      if (project.version === '1.2') project.version = '1.3';
      ensurePagesShape(project);
      if (project.page && project.pages.indexOf(project.page) < 0) {
        // page が pages 外なら破棄して alias のみ
      }
      // 1.3 本線ではトップレベル page は保存しないが runtime alias は維持
      syncPageAlias(project);
      return project;
    }

    if (project.page) {
      project.pages = [project.page];
      project.currentPageIndex = 0;
      project.version = '1.3';
      // キーは残すと toJSON で二重になるため ensure 後に alias として付け直す
      delete project.page;
      ensurePagesShape(project);
      return project;
    }

    ensurePagesShape(project);
    project.version = project.version || '1.3';
    return project;
  }

  window.ME.PageManager = {
    MAX_PAGES: MAX_PAGES,
    getCurrentPage: getCurrentPage,
    getCurrentIndex: getCurrentIndex,
    setCurrentIndex: setCurrentIndex,
    pageCount: pageCount,
    ensurePagesShape: ensurePagesShape,
    syncPageAlias: syncPageAlias,
    addEmptyPage: addEmptyPage,
    clonePageContent: clonePageContent,
    insertPageAt: insertPageAt,
    removePageAt: removePageAt,
    reorderPages: reorderPages,
    migrateProjectToMultiPage: migrateProjectToMultiPage
  };
})();
