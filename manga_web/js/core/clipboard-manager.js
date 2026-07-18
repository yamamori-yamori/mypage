// ME.Clipboard.create() — インスタンス生成
// メソッド: copy(selectedData, project), paste(project, commandStack, onDone)
// クロスブラウザ: OS クリップボードへ text/plain (magic+JSON) を書き出し、別タブ/別ブラウザへペースト可
// 画像アセット(Base64)も同梱。受け側アプリの CLIPBOARD_VERSION が payload 以上なら受け入れ
// コピー時 sourcePageId を記録。別ページへ貼るときは位置オフセット 0（ページ間完全コピー）
// 同一ページへ貼るときは +20px（重なり回避）
//
// 権限ダイアログ回避: navigator.clipboard.readText/writeText は使わない
// （Safari 等が毎回「クリップボードへのアクセス」を出するため）
// 書込 = document 'copy' + execCommand / 読取 = paste イベントの clipboardData + アプリ内 buffer

window.ME = window.ME || {};
window.ME.Clipboard = window.ME.Clipboard || {};

(function() {
  'use strict';

  // 受け側がこのバージョン以上ならペースト可（ペイロード側 version と比較）
  var CLIPBOARD_VERSION = '1.2';
  var CLIPBOARD_MAGIC = '__mangaEditorClipboard';
  var TEXT_PREFIX = 'MECLIP:';
  var PASTE_OFFSET_X = 20;
  var PASTE_OFFSET_Y = 20;

  // アプリ内クリップボードバッファ（同一タブ用）
  var buffer = null;
  // copy イベントで setData するための一時テキスト
  var pendingCopyText = null;
  var copyListenerBound = false;

  function ensureCopyListener() {
    if (copyListenerBound) return;
    copyListenerBound = true;
    document.addEventListener('copy', function(e) {
      if (pendingCopyText == null) return;
      try {
        if (e.clipboardData) {
          e.clipboardData.setData('text/plain', pendingCopyText);
          e.preventDefault();
        }
      } catch (err) {}
      pendingCopyText = null;
    });
  }

  function activePage(project) {
    if (!project) return null;
    if (ME.SceneGraph && typeof ME.SceneGraph.getActivePage === 'function') {
      return ME.SceneGraph.getActivePage(project);
    }
    if (ME.PageManager && typeof ME.PageManager.getCurrentPage === 'function') {
      return ME.PageManager.getCurrentPage(project);
    }
    if (project.pages && project.pages.length) {
      var idx = project.currentPageIndex | 0;
      if (idx < 0) idx = 0;
      if (idx >= project.pages.length) idx = project.pages.length - 1;
      return project.pages[idx];
    }
    return project.page || null;
  }

  function create() {
    return {
      copy: copy,
      paste: paste,
      parseText: parseClipboardText,
      applyPayload: applyPayload,
      getBuffer: function() { return buffer; }
    };
  }

  function parseVersion(v) {
    if (v == null || v === '') return [0, 0];
    var parts = String(v).split('.');
    return [parseInt(parts[0], 10) || 0, parseInt(parts[1], 10) || 0];
  }

  // appVer >= payloadVer なら true
  function versionAccepts(payloadVer) {
    var a = parseVersion(CLIPBOARD_VERSION);
    var b = parseVersion(payloadVer);
    if (a[0] !== b[0]) return a[0] > b[0];
    return a[1] >= b[1];
  }

  function isPayload(obj) {
    return !!(obj && (obj.__mangaEditorClipboard === true || obj[CLIPBOARD_MAGIC] === true) &&
      obj.objects && obj.objects.length);
  }

  function parseClipboardText(text) {
    if (!text || typeof text !== 'string') return null;
    var s = text.replace(/^\uFEFF/, '').trim();
    if (s.indexOf(TEXT_PREFIX) === 0) {
      s = s.slice(TEXT_PREFIX.length);
    }
    // magic 行 + JSON 形式
    if (s.indexOf(CLIPBOARD_MAGIC) === 0) {
      var nl = s.indexOf('\n');
      if (nl >= 0) s = s.slice(nl + 1);
      else {
        // magic 直後に JSON
        var brace = s.indexOf('{');
        if (brace >= 0) s = s.slice(brace);
      }
    }
    if (s.charAt(0) !== '{') return null;
    try {
      var data = JSON.parse(s);
      if (!isPayload(data)) return null;
      if (!versionAccepts(data.version || '0')) {
        console.warn('[ME.Clipboard] ペイロード version=' + data.version +
          ' はこのアプリ (' + CLIPBOARD_VERSION + ') より新しいため拒否');
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  function collectAssets(objects, project) {
    var assets = {};
    var assetIds = [];
    if (!project || !project.assets || !project.assets.images) {
      return { assets: assets, assetIds: assetIds };
    }
    var seen = {};
    for (var i = 0; i < objects.length; i++) {
      var obj = objects[i];
      if (!obj || !obj.assetId) continue;
      var aid = obj.assetId;
      if (seen[aid]) continue;
      var entry = project.assets.images[aid];
      if (!entry) continue;
      seen[aid] = true;
      assetIds.push(aid);
      assets[aid] = JSON.parse(JSON.stringify(entry));
    }
    return { assets: assets, assetIds: assetIds };
  }

  // selectedData: { objects: [...] }  / project は画像同梱用
  function copy(selectedData, project) {
    if (!selectedData || !selectedData.objects || selectedData.objects.length === 0) return false;

    var objects = JSON.parse(JSON.stringify(selectedData.objects));
    var pack = collectAssets(objects, project);
    var srcPage = activePage(project);
    var sourcePageId = srcPage && srcPage.id ? srcPage.id : null;

    buffer = {
      __mangaEditorClipboard: true,
      version: CLIPBOARD_VERSION,
      objects: objects,
      assetIds: pack.assetIds,
      assets: pack.assets,
      // 貼り付け先が別ページなら位置オフセット 0（ページ間完全コピー）
      sourcePageId: sourcePageId
    };
    // コピー（バッファ更新）ごとに連続ペーストのオフセット段数をリセット
    buffer.__pasteCount = 0;

    var textOut = TEXT_PREFIX + JSON.stringify(buffer);

    // 権限ダイアログなし: copy イベント + execCommand（ユーザージェスチャ内）
    ensureCopyListener();
    pendingCopyText = textOut;
    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      // フォーカスが canvas 等のとき失敗することがあるので textarea 経由
      fallbackWriteText(textOut);
    }
    // execCommand が別経路で成功して pending が残った場合の掃除
    pendingCopyText = null;

    return true;
  }

  function fallbackWriteText(text) {
    ensureCopyListener();
    pendingCopyText = text;
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
    } catch (e) {}
    document.body.removeChild(ta);
    pendingCopyText = null;
  }

  // onDone(objects|null) — 同期（アプリ内 buffer のみ。OS 読取は paste イベント側）
  function paste(project, commandStack, onDone) {
    if (typeof onDone !== 'function') onDone = function() {};

    if (buffer && isPayload(buffer) && project) {
      var result = applyPayload(buffer, project, commandStack);
      onDone(result);
      return;
    }
    onDone(null);
  }

  // paste イベント (e.clipboardData) からも使える
  function applyPayload(payload, project, commandStack) {
    if (!payload || !project || !isPayload(payload)) return null;
    if (!versionAccepts(payload.version || '0')) return null;

    // 同一タブ再貼り付け用に保持
    buffer = payload;

    var objects = JSON.parse(JSON.stringify(payload.objects));
    var newIds = {};
    var fusionMap = {};
    var assetMap = {};

    // アセットを新IDで取り込み（衝突回避 + クロスブラウザ）
    if (payload.assets) {
      var keys = Object.keys(payload.assets);
      for (var ai = 0; ai < keys.length; ai++) {
        var oldAid = keys[ai];
        var entry = payload.assets[oldAid];
        if (!entry) continue;
        if (!project.assets) project.assets = { images: {} };
        if (!project.assets.images) project.assets.images = {};
        var existing = project.assets && project.assets.images ? project.assets.images[oldAid] : null;
        if (existing && entry && existing.dataBase64 === entry.dataBase64) {
          assetMap[oldAid] = oldAid;
        } else {
          var newAid = ME.Core.ID.generate();
          assetMap[oldAid] = newAid;
          project.assets.images[newAid] = JSON.parse(JSON.stringify(entry));
        }
      }
    }

    // 同一バッファの連続ペーストごとにオフセット段数を増やして重なりを回避
    if (typeof payload.__pasteCount !== 'number') payload.__pasteCount = 0;
    payload.__pasteCount++;
    var pasteCount = payload.__pasteCount;

    // 別ページへの貼り付けは初回オフセット 0（完全コピー）。同一ページは段数×20 で重なり回避
    var destPage = activePage(project);
    var destPageId = destPage && destPage.id ? destPage.id : null;
    var srcPageId = payload.sourcePageId || null;
    var crossPage = !!(srcPageId && destPageId && srcPageId !== destPageId);
    var ox, oy;
    if (crossPage) {
      ox = PASTE_OFFSET_X * (pasteCount - 1);
      oy = PASTE_OFFSET_Y * (pasteCount - 1);
    } else {
      ox = PASTE_OFFSET_X * pasteCount;
      oy = PASTE_OFFSET_Y * pasteCount;
    }

    // 第一パス: 新ID・オフセット
    for (var i = 0; i < objects.length; i++) {
      var obj = objects[i];
      var oldId = obj.id;
      obj.id = ME.Core.ID.generate();
      newIds[oldId] = obj.id;

      if (obj.transform && (ox !== 0 || oy !== 0)) {
        obj.transform.x += ox;
        obj.transform.y += oy;
      }

      if (obj.vertices && Array.isArray(obj.vertices) && (ox !== 0 || oy !== 0)) {
        for (var j = 0; j < obj.vertices.length; j++) {
          obj.vertices[j].x += ox;
          obj.vertices[j].y += oy;
        }
      }

      // balloon tail 等の絶対座標
      if (obj.tail && (ox !== 0 || oy !== 0)) {
        var tkeys = ['basePoint', 'curvePoint', 'tipPoint'];
        for (var tk = 0; tk < tkeys.length; tk++) {
          var pt = obj.tail[tkeys[tk]];
          if (pt && typeof pt.x === 'number') {
            pt.x += ox;
            pt.y += oy;
          }
        }
      }

      if (obj.assetId && assetMap[obj.assetId]) {
        obj.assetId = assetMap[obj.assetId];
      }

      if (obj.fusionGroup) {
        if (!fusionMap[obj.fusionGroup]) {
          fusionMap[obj.fusionGroup] = ME.Core.ID.generate();
        }
        obj.fusionGroup = fusionMap[obj.fusionGroup];
      }
    }

    // 第二パス: panelId 参照（コピーに含まれるコマのみリマップ）
    // 別ページかつ未リマップなら、存在しないコマ参照を落とす
    for (var k = 0; k < objects.length; k++) {
      var o2 = objects[k];
      if (!o2.panelId) continue;
      if (newIds[o2.panelId]) {
        o2.panelId = newIds[o2.panelId];
      } else if (crossPage) {
        o2.panelId = null;
      }
    }

    // drafts 配列保証
    var page = activePage(project);
    if (!page.drafts) page.drafts = [];
    if (!page.memos) page.memos = [];
    if (!page.strings) page.strings = [];

    for (var n = 0; n < objects.length; n++) {
      var o = objects[n];
      if (o.type === 'panel') page.panels.push(o);
      else if (o.type === 'image') page.images.push(o);
      else if (o.type === 'balloon') page.balloons.push(o);
      else if (o.type === 'text') page.texts.push(o);
      else if (o.type === 'effect') page.effects.push(o);
      else if (o.type === 'draft') page.drafts.push(o);
      else if (o.type === 'memo') page.memos.push(o);
      else if (o.type === 'string') page.strings.push(o);
    }

    var cmd = new ME.Commands.PasteObjects(objects);
    if (commandStack) commandStack.push(cmd);

    return objects;
  }

  window.ME.Clipboard = {
    create: create,
    // ユーティリティ（テスト・外部用）
    parseText: parseClipboardText,
    TEXT_PREFIX: TEXT_PREFIX,
    VERSION: CLIPBOARD_VERSION
  };
})();
