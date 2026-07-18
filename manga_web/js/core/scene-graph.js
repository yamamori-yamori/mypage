// ME.SceneGraph.createProject(title) — 空のProject生成（JSON 1.3 / pages[]）
// ME.SceneGraph.createPage(sizeOpts) — 空のPage生成
// ME.SceneGraph.getProject() — 現在プロジェクト取得
// ME.SceneGraph.getActivePage(project) — 編集中 Page（PageManager 経由）
// ME.SceneGraph.addPanel(project, vertices) — Panel追加、ID採番
// ME.SceneGraph.removeObject(project, id) — オブジェクト削除
// ME.SceneGraph.getObjectById(project, id) → EditableObject | null
// ME.SceneGraph.addEffect(project, effect, panelId) — EffectObject追加
// ME.SceneGraph.addDraft(project, kind, params, transform) — DraftObject追加（下書き）
// ME.SceneGraph.addMemo(project, kind, params, transform) — MemoObject追加（校閲メモ）
// ME.SceneGraph.getAllMemos(project) — カレントページのメモ一覧（Ctrl+A 対象外）
// ME.SceneGraph.updateTransform(id, transform) — Transform更新
// ME.SceneGraph.setZIndex(id, zIndex) — zIndex変更
// ME.SceneGraph.addImageToPanel(project, panelId, assetId) — ImageObject追加

window.ME = window.ME || {};
window.ME.SceneGraph = window.ME.SceneGraph || {};

(function() {
  'use strict';

  var currentProject = null;

  function createPage(sizeOpts) {
    sizeOpts = sizeOpts || {};
    return {
      id: ME.Core.ID.generate(),
      size: {
        preset: sizeOpts.preset || 'B5',
        widthMm: sizeOpts.widthMm || 182,
        heightMm: sizeOpts.heightMm || 257,
        dpi: sizeOpts.dpi || 350
      },
      backgroundColor: '#FFFFFF',
      // 台紙画像（コマの下・ページ色の上）。null=なし
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

  // 編集対象ページ。PageManager があればそちらを正とする
  function getActivePage(project) {
    if (!project) return null;
    if (window.ME && ME.PageManager && typeof ME.PageManager.getCurrentPage === 'function') {
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

  function createProject(title) {
    var now = new Date().toISOString();
    var firstPage = createPage();
    currentProject = {
      version: (window.ME && ME.JSON_VERSION) ? ME.JSON_VERSION : '1.3',
      meta: {
        title: title || '無題の作品',
        createdAt: now,
        updatedAt: now
      },
      pages: [firstPage],
      currentPageIndex: 0,
      // 実行時互換エイリアス（toJSON では除去）
      page: firstPage,
      assets: { images: {} }
    };
    if (window.ME && ME.PageManager && typeof ME.PageManager.ensurePagesShape === 'function') {
      ME.PageManager.ensurePagesShape(currentProject);
    }
    return currentProject;
  }

  function getProject() {
    return currentProject;
  }

  // 外部（JSON読込等）で生成したProjectを現在プロジェクトとして設定
  function setProject(project) {
    currentProject = project;
    if (currentProject && window.ME && ME.PageManager && typeof ME.PageManager.ensurePagesShape === 'function') {
      ME.PageManager.ensurePagesShape(currentProject);
    }
    return currentProject;
  }

  // オブジェクトを適切な配列に追加するヘルパ
  function addObjectToCollection(project, collectionName, obj) {
    var page = getActivePage(project);
    if (!page[collectionName]) page[collectionName] = [];
    page[collectionName].push(obj);
    updateTimestamp(project);
    return obj;
  }

  function addPanel(project, vertices, opts) {
    var page = getActivePage(project);
    var panel = ME.Core.Models.Panel.create(vertices, opts || {});
    // zIndex自動採番（既存の最大+1）
    panel.zIndex = getNextZIndex(page.panels);
    addObjectToCollection(project, 'panels', panel);
    return panel;
  }

  function removeObject(project, id) {
    var pages = pagesToSearch(project);
    var collections = ['panels', 'images', 'balloons', 'texts', 'effects', 'drafts', 'memos', 'strings'];
    for (var p = 0; p < pages.length; p++) {
      var page = pages[p];
      if (!page) continue;
      for (var i = 0; i < collections.length; i++) {
        var arr = page[collections[i]];
        if (!arr) continue;
        for (var j = 0; j < arr.length; j++) {
          if (arr[j].id === id) {
            arr.splice(j, 1);
            updateTimestamp(project);
            return true;
          }
        }
      }
    }
    return false;
  }

  function pagesToSearch(project) {
    if (!project) return [];
    if (project.pages && project.pages.length) return project.pages;
    if (project.page) return [project.page];
    return [];
  }

  function getObjectById(project, id) {
    var pages = pagesToSearch(project);
    var collections = ['panels', 'images', 'balloons', 'texts', 'effects', 'drafts', 'memos', 'strings'];
    for (var p = 0; p < pages.length; p++) {
      var page = pages[p];
      if (!page) continue;
      for (var i = 0; i < collections.length; i++) {
        var arr = page[collections[i]];
        if (!arr) continue;
        for (var j = 0; j < arr.length; j++) {
          if (arr[j].id === id) {
            return arr[j];
          }
        }
      }
    }
    return null;
  }

  // 本線+下書き。memos は Ctrl+A 対象外のため含めない
  function getAllObjects(project) {
    var page = getActivePage(project);
    var result = [];
    var collections = ['panels', 'images', 'balloons', 'texts', 'effects', 'drafts', 'strings'];
    for (var i = 0; i < collections.length; i++) {
      if (page[collections[i]]) {
        result = result.concat(page[collections[i]]);
      }
    }
    // zIndex順にソート
    result.sort(function(a, b) { return a.zIndex - b.zIndex; });
    return result;
  }

  function getAllMemos(project) {
    var page = getActivePage(project);
    if (!page || !page.memos) return [];
    return page.memos.slice().sort(function(a, b) { return (a.zIndex || 0) - (b.zIndex || 0); });
  }

  function updateTransform(id, transform) {
    var obj = getObjectById(currentProject, id);
    if (obj) {
      obj.transform.x = transform.x;
      obj.transform.y = transform.y;
      obj.transform.rotation = transform.rotation;
      obj.transform.scaleX = transform.scaleX;
      obj.transform.scaleY = transform.scaleY;
      updateTimestamp(currentProject);
    }
  }

  function setZIndex(id, zIndex) {
    var obj = getObjectById(currentProject, id);
    if (obj) {
      obj.zIndex = zIndex;
      updateTimestamp(currentProject);
    }
  }

  function addImageToPanel(project, panelId, assetId, transform) {
    var page = getActivePage(project);
    var img = ME.Core.Models.Image.create(panelId, assetId, transform);
    img.zIndex = getNextZIndex(page.images);
    addObjectToCollection(project, 'images', img);
    return img;
  }

  function addBalloon(project, balloon, transform) {
    // transform未指定時はデフォルト値（ME.Core.Models.createTransformを利用）
    if (!transform) {
      transform = ME.Core.Models.createTransform ? ME.Core.Models.createTransform() : { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
    }
    // Balloon.createは既にtransformを取るが、引数で上書き
    var obj = ME.Core.Models.Balloon.create(balloon.shape || 'ellipse', balloon.size || { width: 150, height: 80 }, transform);
    if (balloon.fillColor) obj.fillColor = balloon.fillColor;
    if (balloon.strokeColor) obj.strokeColor = balloon.strokeColor;
    if (balloon.strokeWidth !== undefined) obj.strokeWidth = balloon.strokeWidth;
    if (balloon.panelId) obj.panelId = balloon.panelId;
    obj.zIndex = getNextZIndex(getActivePage(project).balloons);
    // デフォルト: クロップOFF（明示指定時のみ panelId）
    addObjectToCollection(project, 'balloons', obj);
    return obj;
  }

  function addText(project, content, transform) {
    var textObj = ME.Core.Models.Text.create(content, transform);
    textObj.zIndex = getNextZIndex(getActivePage(project).texts);
    addObjectToCollection(project, 'texts', textObj);
    return textObj;
  }

  function addEffect(project, effect, panelId) {
    var obj = ME.Core.Models.Effect.create(effect.scope || 'page', effect.kind, effect.params, effect.transform);
    if (panelId) obj.panelId = panelId;
    obj.zIndex = getNextZIndex(getActivePage(project).effects);
    addObjectToCollection(project, 'effects', obj);
    return obj;
  }

  function panelBBox(panel) {
    var verts = panel && panel.vertices;
    if (!verts || verts.length < 2) return null;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var j = 0; j < verts.length; j++) {
      if (!verts[j]) continue;
      var vx = Number(verts[j].x);
      var vy = Number(verts[j].y);
      if (isNaN(vx) || isNaN(vy)) continue;
      if (vx < minX) minX = vx;
      if (vy < minY) minY = vy;
      if (vx > maxX) maxX = vx;
      if (vy > maxY) maxY = vy;
    }
    if (!isFinite(minX) || !isFinite(minY)) return null;
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  function rectsIntersect(a, b) {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
  }

  // 点 (x,y) を含むコマのうち zIndex が最も上のもの（外接矩形）
  function findTopPanelAt(project, x, y) {
    var page = getActivePage(project);
    if (!project || !page) return null;
    x = Number(x); y = Number(y);
    if (isNaN(x) || isNaN(y)) return null;
    var panels = (page.panels || []).slice().sort(function(a, b) {
      return (a.zIndex || 0) - (b.zIndex || 0);
    });
    var found = null;
    for (var i = 0; i < panels.length; i++) {
      var p = panels[i];
      if (!p || p.visible === false) continue;
      var bb = panelBBox(p);
      if (!bb) continue;
      if (x >= bb.minX && x <= bb.maxX && y >= bb.minY && y <= bb.maxY) {
        found = p;
      }
    }
    return found;
  }

  // オブジェクトの見た目バウンディングと中心（ページ座標）
  function objectWorldBounds(obj) {
    if (!obj) return null;
    var t = obj.transform || {};
    var tx = Number(t.x); if (isNaN(tx)) tx = 0;
    var ty = Number(t.y); if (isNaN(ty)) ty = 0;
    var sx = Math.abs(t.scaleX != null ? Number(t.scaleX) : 1) || 1;
    var sy = Math.abs(t.scaleY != null ? Number(t.scaleY) : 1) || 1;

    if (obj.type === 'balloon') {
      var bw = (obj.size && obj.size.width) || 150;
      var bh = (obj.size && obj.size.height) || 80;
      return {
        minX: tx - bw / 2, minY: ty - bh / 2,
        maxX: tx + bw / 2, maxY: ty + bh / 2,
        cx: tx, cy: ty
      };
    }

    if (obj.type === 'draft') {
      if (obj.kind === 'circle' || obj.kind === 'rect') {
        var w = Math.abs((obj.params && obj.params.width) || 60) * sx;
        var h = Math.abs((obj.params && obj.params.height) || 40) * sy;
        return {
          minX: tx - w / 2, minY: ty - h / 2,
          maxX: tx + w / 2, maxY: ty + h / 2,
          cx: tx, cy: ty
        };
      }
      if (obj.kind === 'line') {
        var p = obj.params || {};
        var x1 = tx + (Number(p.startX) || 0) * sx;
        var y1 = ty + (Number(p.startY) || 0) * sy;
        var x2 = tx + (Number(p.endX) || 0) * sx;
        var y2 = ty + (Number(p.endY) || 0) * sy;
        return {
          minX: Math.min(x1, x2), minY: Math.min(y1, y2),
          maxX: Math.max(x1, x2), maxY: Math.max(y1, y2),
          cx: (x1 + x2) / 2, cy: (y1 + y2) / 2
        };
      }
      // string など: transform を中心候補に
      return { minX: tx - 10, minY: ty - 10, maxX: tx + 10, maxY: ty + 10, cx: tx, cy: ty };
    }

    return { minX: tx, minY: ty, maxX: tx, maxY: ty, cx: tx, cy: ty };
  }

  // オブジェクトが載っているコマを推定
  // 優先: 中心/原点/端点ヒット → 矩形交差 → 最寄りコマ
  // コマが1つでもあれば最寄りを返す（クロップ判定は緩め）
  function findTopPanelForObject(project, obj) {
    var page = getActivePage(project);
    if (!project || !page || !obj) return null;
    var bounds = objectWorldBounds(obj);
    if (!bounds) return null;

    var hit = findTopPanelAt(project, bounds.cx, bounds.cy);
    if (hit) return hit;

    var t = obj.transform || {};
    hit = findTopPanelAt(project, t.x, t.y);
    if (hit) return hit;

    if (obj.type === 'draft' && obj.kind === 'line' && obj.params) {
      var lsx = Math.abs((t.scaleX != null ? t.scaleX : 1)) || 1;
      var lsy = Math.abs((t.scaleY != null ? t.scaleY : 1)) || 1;
      var ox = Number(t.x) || 0;
      var oy = Number(t.y) || 0;
      hit = findTopPanelAt(project, ox + (Number(obj.params.startX) || 0) * lsx, oy + (Number(obj.params.startY) || 0) * lsy);
      if (hit) return hit;
      hit = findTopPanelAt(project, ox + (Number(obj.params.endX) || 0) * lsx, oy + (Number(obj.params.endY) || 0) * lsy);
      if (hit) return hit;
    }

    var panels = (page.panels || []).slice().sort(function(a, b) {
      return (a.zIndex || 0) - (b.zIndex || 0);
    });
    var found = null;
    var best = null;
    var bestDist = Infinity;
    var bestArea = -1;

    for (var i = 0; i < panels.length; i++) {
      var p = panels[i];
      if (!p || p.visible === false) continue;
      var pbb = panelBBox(p);
      if (!pbb) continue;

      if (rectsIntersect(bounds, pbb)) {
        var ix1 = Math.max(bounds.minX, pbb.minX);
        var iy1 = Math.max(bounds.minY, pbb.minY);
        var ix2 = Math.min(bounds.maxX, pbb.maxX);
        var iy2 = Math.min(bounds.maxY, pbb.maxY);
        var area = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
        if (area >= bestArea) {
          bestArea = area;
          found = p;
        }
      }

      var dx = 0;
      if (bounds.cx < pbb.minX) dx = pbb.minX - bounds.cx;
      else if (bounds.cx > pbb.maxX) dx = bounds.cx - pbb.maxX;
      var dy = 0;
      if (bounds.cy < pbb.minY) dy = pbb.minY - bounds.cy;
      else if (bounds.cy > pbb.maxY) dy = bounds.cy - pbb.maxY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist || (dist === bestDist && (!best || (p.zIndex || 0) >= (best.zIndex || 0)))) {
        bestDist = dist;
        best = p;
      }
    }

    if (found) return found;
    return best;
  }

  function addDraft(project, kind, params, transform) {
    var draftObj = ME.Core.Models.Draft.create(kind, params, transform);
    draftObj.zIndex = getNextZIndex(getActivePage(project).drafts);
    // デフォルト: クロップOFF（明示指定時のみ panelId）
    addObjectToCollection(project, 'drafts', draftObj);
    return draftObj;
  }

  function addMemo(project, kind, params, transform) {
    var page = getActivePage(project);
    if (!page.memos) page.memos = [];
    var memoObj = ME.Core.Models.Memo.create(kind, params, transform);
    memoObj.zIndex = getNextZIndex(page.memos);
    addObjectToCollection(project, 'memos', memoObj);
    return memoObj;
  }

  function addString(project, content, transform) {
    // 注釈は draft kind:'string' として drafts に追加（旧 strings は使わない）
    return addDraft(project, 'string', { content: content || '' }, transform);
  }

  function updateTimestamp(project) {
    project.meta.updatedAt = new Date().toISOString();
  }

  function getNextZIndex(arr) {
    if (!arr || arr.length === 0) return 0;
    var max = -1;
    for (var i = 0; i < arr.length; i++) {
      var z = Number(arr[i].zIndex);
      if (!isNaN(z) && isFinite(z) && z > max) max = z;
    }
    return max + 1;
  }

  window.ME.SceneGraph = {
    createProject: createProject,
    createPage: createPage,
    getActivePage: getActivePage,
    getProject: getProject,
    setProject: setProject,
    addPanel: addPanel,
    removeObject: removeObject,
    getObjectById: getObjectById,
    getAllObjects: getAllObjects,
    updateTransform: updateTransform,
    setZIndex: setZIndex,
    addImageToPanel: addImageToPanel,
    addBalloon: addBalloon,
    addText: addText,
    addEffect: addEffect,
    addDraft: addDraft,
    addMemo: addMemo,
    addString: addString,
    getAllMemos: getAllMemos,
    findTopPanelAt: findTopPanelAt,
    findTopPanelForObject: findTopPanelForObject
  };
})();
