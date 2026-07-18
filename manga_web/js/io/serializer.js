// ME.IO.Serializer.toJSON(project) → string — ProjectをJSON文字列に
// ME.IO.Serializer.fromJSON(jsonString) → Project — JSONからProject復元
// version: 1.3 本線、1.2 は読込時に pages[] へマイグレート
// 保存時に appTag を付与（読込時は無くても可）
// AssetLibraryのBase64データをそのまま保持

window.ME = window.ME || {};
window.ME.IO = window.ME.IO || {};
window.ME.IO.Serializer = window.ME.IO.Serializer || {};

(function() {
  'use strict';

  var SUPPORTED_VERSION = (window.ME && ME.JSON_VERSION) ? ME.JSON_VERSION : '1.3';
  var LEGACY_VERSION = '1.2';
  /** セーブファイル識別タグ（読込必須ではない） */
  var APP_TAG = 'manga page editor @yamamori_yamori';

  function normalizePageFields(page) {
    if (!page) return;
    if (!page.drafts) page.drafts = [];
    if (!page.memos) page.memos = [];
    if (!page.strings) page.strings = [];
    if (!page.panels) page.panels = [];
    if (!page.images) page.images = [];
    if (!page.balloons) page.balloons = [];
    if (!page.texts) page.texts = [];
    if (!page.effects) page.effects = [];
    if (page.backingImage === undefined) page.backingImage = null;
    if (!page.backgroundColor) page.backgroundColor = '#FFFFFF';

    // 旧 type:'string' を draft kind:'string' へ移行
    if (page.strings && page.strings.length) {
      for (var si = 0; si < page.strings.length; si++) {
        var s = page.strings[si];
        if (!s) continue;
        page.drafts.push({
          id: s.id,
          type: 'draft',
          kind: 'string',
          content: s.content || '',
          font: s.font || {
            family: 'sans-serif', size: 24, bold: true, color: '#555555',
            alpha: 100, letterSpacing: 0, lineHeight: 1.2
          },
          writingMode: s.writingMode || 'horizontal',
          outline: s.outline || null,
          transform: s.transform || { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
          zIndex: s.zIndex || 0,
          locked: !!s.locked,
          visible: s.visible !== false,
          params: {}
        });
      }
      page.strings = [];
    }
  }

  function toJSON(project) {
    if (!project) {
      throw new Error('Unsupported project version: null');
    }
    if (project.version === LEGACY_VERSION) {
      if (ME.PageManager && ME.PageManager.migrateProjectToMultiPage) {
        ME.PageManager.migrateProjectToMultiPage(project);
      }
    }
    if (project.version !== SUPPORTED_VERSION) {
      throw new Error('Unsupported project version: ' + project.version);
    }

    if (ME.PageManager && ME.PageManager.ensurePagesShape) {
      ME.PageManager.ensurePagesShape(project);
    }
    if (!project.pages || !project.pages.length) {
      throw new Error('Project has no pages');
    }

    // 実行時エイリアス project.page は保存しない（pages と二重になる）
    // 識別タグはファイル先頭キーに固定（読込必須ではない）
    project.appTag = APP_TAG;

    var exportObj = {
      appTag: APP_TAG,
      version: project.version,
      meta: project.meta,
      pages: project.pages,
      currentPageIndex: project.currentPageIndex,
      assets: project.assets
    };

    // 将来のトップレベル拡張を落とさない（page / 既知キー以外）
    for (var k in project) {
      if (!Object.prototype.hasOwnProperty.call(project, k)) continue;
      if (k === 'page' || k === 'appTag' || k === 'version' || k === 'meta' ||
          k === 'pages' || k === 'currentPageIndex' || k === 'assets') {
        continue;
      }
      exportObj[k] = project[k];
    }

    return JSON.stringify(exportObj, null, 2);
  }

  function fromJSON(jsonString) {
    if (!jsonString || typeof jsonString !== 'string') {
      throw new Error('Invalid JSON string');
    }

    var project;
    try {
      project = JSON.parse(jsonString);
    } catch (e) {
      throw new Error('Failed to parse JSON: ' + e.message);
    }

    if (!project.version) {
      throw new Error('Unsupported version: null. Expected: ' + SUPPORTED_VERSION);
    }

    if (project.version !== SUPPORTED_VERSION && project.version !== LEGACY_VERSION) {
      throw new Error('Unsupported version: ' + project.version + '. Expected: ' + SUPPORTED_VERSION + ' or ' + LEGACY_VERSION);
    }

    // assets.imagesが存在しない場合は初期化
    if (!project.assets) {
      project.assets = { images: {} };
    } else if (!project.assets.images) {
      project.assets.images = {};
    }

    // 1.2: 単一 page → pages
    if (project.version === LEGACY_VERSION) {
      if (ME.PageManager && ME.PageManager.migrateProjectToMultiPage) {
        ME.PageManager.migrateProjectToMultiPage(project);
      } else if (project.page && (!project.pages || !project.pages.length)) {
        project.pages = [project.page];
        project.currentPageIndex = 0;
        delete project.page;
        project.version = SUPPORTED_VERSION;
      } else {
        project.version = SUPPORTED_VERSION;
      }
    }

    if (ME.PageManager && ME.PageManager.ensurePagesShape) {
      ME.PageManager.ensurePagesShape(project);
    } else if (!project.pages || !project.pages.length) {
      throw new Error('Project has no pages after migrate');
    }

    project.version = SUPPORTED_VERSION;

    // 各 page に drafts/strings/台紙 の後方互換
    for (var pi = 0; pi < project.pages.length; pi++) {
      normalizePageFields(project.pages[pi]);
    }

    if (ME.PageManager && ME.PageManager.syncPageAlias) {
      ME.PageManager.syncPageAlias(project);
    } else {
      project.page = project.pages[project.currentPageIndex | 0];
    }

    // appTag は任意。無くても読める。あれば正規化だけする
    if (project.appTag == null || project.appTag === '') {
      // 旧 .json 等はそのまま
    } else if (typeof project.appTag !== 'string') {
      project.appTag = APP_TAG;
    }

    return project;
  }

  window.ME.IO.Serializer.toJSON = toJSON;
  window.ME.IO.Serializer.fromJSON = fromJSON;
  window.ME.IO.Serializer.SUPPORTED_VERSION = SUPPORTED_VERSION;
  window.ME.IO.Serializer.APP_TAG = APP_TAG;
})();
