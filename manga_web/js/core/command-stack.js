// ME.CommandStack.create() — スタック生成（戻り値はスタックインスタンス）
// インスタンスメソッド: push, undo, redo, canUndo, canRedo
// push 時に pageId 未設定のオブジェクト系コマンドへ現在ページ id を刻印
// 各コマンドは resolvePage(pageId) で正しいページを操作（他ページへ切替後も Undo 可）

window.ME = window.ME || {};
window.ME.CommandStack = window.ME.CommandStack || {};
window.ME.Commands = window.ME.Commands || {};

(function() {
  'use strict';

  var MAX_STACK = 50;

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

  function resolvePage(project, pageId) {
    if (!project) return null;
    if (pageId && project.pages && project.pages.length) {
      for (var i = 0; i < project.pages.length; i++) {
        if (project.pages[i] && project.pages[i].id === pageId) {
          return project.pages[i];
        }
      }
    }
    return activePage(project);
  }

  function currentPageId(project) {
    var page = activePage(project);
    return page && page.id ? page.id : null;
  }

  function shouldAutoStampPageId(cmd) {
    if (!cmd || cmd.pageId) return false;
    if (cmd.snaps) return false;
    if (typeof cmd.fromIndex === 'number' && typeof cmd.toIndex === 'number' &&
        typeof cmd.oldCurrentIndex === 'number') return false;
    if (cmd.pageData && typeof cmd.index === 'number') {
      if (typeof cmd.prevCurrentIndex === 'number' || typeof cmd.wasCurrentIndex === 'number') {
        return false;
      }
    }
    return true;
  }

  function stampPageId(command) {
    if (!shouldAutoStampPageId(command)) return;
    var project = ME.SceneGraph && ME.SceneGraph.getProject
      ? ME.SceneGraph.getProject() : null;
    var pid = currentPageId(project);
    if (pid) command.pageId = pid;
  }

  function pageOf(cmd, project) {
    return resolvePage(project, cmd && cmd.pageId);
  }

  function create() {
    var undoStack = [];
    var redoStack = [];

    function push(command) {
      stampPageId(command);
      undoStack.push(command);
      while (undoStack.length > MAX_STACK) {
        undoStack.shift();
      }
      redoStack = [];
    }

    function undo() {
      if (!canUndo()) return null;
      var command = undoStack.pop();
      command.undo();
      redoStack.push(command);
      return command;
    }

    function redo() {
      if (!canRedo()) return null;
      var command = redoStack.pop();
      command.redo();
      undoStack.push(command);
      return command;
    }

    function canUndo() {
      return undoStack.length > 0;
    }

    function canRedo() {
      return redoStack.length > 0;
    }

    // 連続操作の合算（矢印キーの 1px 移動など）用。末尾コマンド参照のみ
    function peekUndo() {
      return undoStack.length > 0 ? undoStack[undoStack.length - 1] : null;
    }

    return {
      push: push,
      undo: undo,
      redo: redo,
      canUndo: canUndo,
      canRedo: canRedo,
      peekUndo: peekUndo
    };
  }

  function MoveObject(id, oldTransform, newTransform) {
    this.id = id;
    this.oldTransform = JSON.parse(JSON.stringify(oldTransform));
    this.newTransform = JSON.parse(JSON.stringify(newTransform));
  }
  MoveObject.prototype.undo = function() {
    ME.SceneGraph.updateTransform(this.id, this.oldTransform);
  };
  MoveObject.prototype.redo = function() {
    ME.SceneGraph.updateTransform(this.id, this.newTransform);
  };

  function ResizePanel(panelId, oldVertices, newVertices) {
    this.panelId = panelId;
    this.oldVertices = JSON.parse(JSON.stringify(oldVertices));
    this.newVertices = JSON.parse(JSON.stringify(newVertices));
  }
  ResizePanel.prototype.undo = function() {
    var obj = ME.SceneGraph.getObjectById(ME.SceneGraph.getProject(), this.panelId);
    if (obj) obj.vertices = JSON.parse(JSON.stringify(this.oldVertices));
  };
  ResizePanel.prototype.redo = function() {
    var obj = ME.SceneGraph.getObjectById(ME.SceneGraph.getProject(), this.panelId);
    if (obj) obj.vertices = JSON.parse(JSON.stringify(this.newVertices));
  };

  function AddPanel(panelObj) {
    this.panelData = JSON.parse(JSON.stringify(panelObj));
  }
  AddPanel.prototype.undo = function() {
    ME.SceneGraph.removeObject(ME.SceneGraph.getProject(), this.panelData.id);
  };
  AddPanel.prototype.redo = function() {
    var project = ME.SceneGraph.getProject();
    var page = pageOf(this, project);
    if (!page) return;
    if (!page.panels) page.panels = [];
    page.panels.push(JSON.parse(JSON.stringify(this.panelData)));
    recalcZIndices(project, page);
  };

  function DeleteObject(id, objBefore) {
    this.id = id;
    this.objBefore = JSON.parse(JSON.stringify(objBefore));
    this.collectionName = getCollectionName(objBefore.type);
  }
  DeleteObject.prototype.undo = function() {
    var project = ME.SceneGraph.getProject();
    var page = pageOf(this, project);
    if (!page) return;
    if (this.collectionName) {
      if (!page[this.collectionName]) page[this.collectionName] = [];
      page[this.collectionName].push(JSON.parse(JSON.stringify(this.objBefore)));
    } else {
      if (!page.panels) page.panels = [];
      page.panels.push(JSON.parse(JSON.stringify(this.objBefore)));
    }
  };
  DeleteObject.prototype.redo = function() {
    ME.SceneGraph.removeObject(ME.SceneGraph.getProject(), this.id);
  };

  function DeleteObjects(objectsBefore) {
    this.items = [];
    for (var i = 0; i < objectsBefore.length; i++) {
      var ob = JSON.parse(JSON.stringify(objectsBefore[i]));
      this.items.push({
        id: ob.id,
        objBefore: ob,
        collectionName: getCollectionName(ob.type)
      });
    }
  }
  DeleteObjects.prototype.undo = function() {
    var project = ME.SceneGraph.getProject();
    var page = pageOf(this, project);
    if (!page) return;
    for (var i = 0; i < this.items.length; i++) {
      var item = this.items[i];
      var name = item.collectionName || 'panels';
      if (!page[name]) page[name] = [];
      page[name].push(JSON.parse(JSON.stringify(item.objBefore)));
    }
  };
  DeleteObjects.prototype.redo = function() {
    var project = ME.SceneGraph.getProject();
    for (var i = 0; i < this.items.length; i++) {
      ME.SceneGraph.removeObject(project, this.items[i].id);
    }
  };

  function EditVertex(panelId, oldPoint, newPoint, vertexIndex) {
    this.panelId = panelId;
    this.oldPoint = JSON.parse(JSON.stringify(oldPoint));
    this.newPoint = JSON.parse(JSON.stringify(newPoint));
    this.vertexIndex = vertexIndex;
  }
  function applyVertexEdit(obj, vertexIndex, point) {
    if (Array.isArray(vertexIndex)) {
      for (var i = 0; i < vertexIndex.length; i++) {
        if (obj.vertices[vertexIndex[i]]) {
          obj.vertices[vertexIndex[i]] = point[i];
        }
      }
    } else if (typeof vertexIndex === 'string') {
      if (obj.tail) {
        if (vertexIndex === 'basePoint' && obj.tail.basePoint) {
          obj.tail.basePoint.x = point.x;
          obj.tail.basePoint.y = point.y;
        } else if (vertexIndex === 'curvePoint' && obj.tail.curvePoint) {
          obj.tail.curvePoint.x = point.x;
          obj.tail.curvePoint.y = point.y;
        } else if (vertexIndex === 'tipPoint' || vertexIndex === 0) {
          obj.tail.tipPoint.x = point.x;
          obj.tail.tipPoint.y = point.y;
        }
      }
    } else {
      if (obj.vertices && obj.vertices[vertexIndex]) {
        obj.vertices[vertexIndex] = point;
      } else if (obj.tail && obj.tail.tipPoint) {
        obj.tail.tipPoint.x = point.x;
        obj.tail.tipPoint.y = point.y;
      }
    }
  }
  EditVertex.prototype.undo = function() {
    var obj = ME.SceneGraph.getObjectById(ME.SceneGraph.getProject(), this.panelId);
    if (!obj) return;
    applyVertexEdit(obj, this.vertexIndex, JSON.parse(JSON.stringify(this.oldPoint)));
  };
  EditVertex.prototype.redo = function() {
    var obj = ME.SceneGraph.getObjectById(ME.SceneGraph.getProject(), this.panelId);
    if (!obj) return;
    applyVertexEdit(obj, this.vertexIndex, JSON.parse(JSON.stringify(this.newPoint)));
  };

  function ColorAdjust(imageId, oldAdj, newAdj) {
    this.imageId = imageId;
    this.oldAdj = JSON.parse(JSON.stringify(oldAdj));
    this.newAdj = JSON.parse(JSON.stringify(newAdj));
  }
  ColorAdjust.prototype.undo = function() {
    var obj = ME.SceneGraph.getObjectById(ME.SceneGraph.getProject(), this.imageId);
    if (obj) obj.colorAdjust = JSON.parse(JSON.stringify(this.oldAdj));
  };
  ColorAdjust.prototype.redo = function() {
    var obj = ME.SceneGraph.getObjectById(ME.SceneGraph.getProject(), this.imageId);
    if (obj) obj.colorAdjust = JSON.parse(JSON.stringify(this.newAdj));
  };

  function BatchEdit(ids, oldStates, newStates) {
    this.ids = ids.slice();
    this.oldStates = JSON.parse(JSON.stringify(oldStates));
    this.newStates = JSON.parse(JSON.stringify(newStates));
  }
  BatchEdit.prototype.undo = function() {
    for (var i = 0; i < this.ids.length; i++) {
      var obj = ME.SceneGraph.getObjectById(ME.SceneGraph.getProject(), this.ids[i]);
      if (obj) Object.assign(obj, JSON.parse(JSON.stringify(this.oldStates[i])));
    }
  };
  BatchEdit.prototype.redo = function() {
    for (var i = 0; i < this.ids.length; i++) {
      var obj = ME.SceneGraph.getObjectById(ME.SceneGraph.getProject(), this.ids[i]);
      if (obj) Object.assign(obj, JSON.parse(JSON.stringify(this.newStates[i])));
    }
  };

  function PasteObjects(objects) {
    this.objectsData = JSON.parse(JSON.stringify(objects));
  }
  PasteObjects.prototype.undo = function() {
    for (var i = 0; i < this.objectsData.length; i++) {
      ME.SceneGraph.removeObject(ME.SceneGraph.getProject(), this.objectsData[i].id);
    }
  };
  PasteObjects.prototype.redo = function() {
    var project = ME.SceneGraph.getProject();
    var page = pageOf(this, project);
    if (!page) return;
    for (var i = 0; i < this.objectsData.length; i++) {
      var obj = JSON.parse(JSON.stringify(this.objectsData[i]));
      if (obj.type === 'panel') {
        if (!page.panels) page.panels = [];
        page.panels.push(obj);
      } else if (obj.type === 'image') {
        if (!page.images) page.images = [];
        page.images.push(obj);
      } else if (obj.type === 'balloon') {
        if (!page.balloons) page.balloons = [];
        page.balloons.push(obj);
      } else if (obj.type === 'text') {
        if (!page.texts) page.texts = [];
        page.texts.push(obj);
      } else if (obj.type === 'effect') {
        if (!page.effects) page.effects = [];
        page.effects.push(obj);
      } else if (obj.type === 'draft') {
        if (!page.drafts) page.drafts = [];
        page.drafts.push(obj);
      } else if (obj.type === 'memo') {
        if (!page.memos) page.memos = [];
        page.memos.push(obj);
      } else if (obj.type === 'string') {
        if (!page.strings) page.strings = [];
        page.strings.push(obj);
      }
    }
  };

  function EditPageBacking(oldSnap, newSnap) {
    this.oldSnap = JSON.parse(JSON.stringify(oldSnap));
    this.newSnap = JSON.parse(JSON.stringify(newSnap));
  }
  function applyPageBackingSnap(cmd, snap) {
    var project = ME.SceneGraph.getProject();
    var page = pageOf(cmd, project);
    if (!project || !page || !snap) return;
    if (Object.prototype.hasOwnProperty.call(snap, 'backgroundColor')) {
      page.backgroundColor = snap.backgroundColor;
    }
    if (Object.prototype.hasOwnProperty.call(snap, 'backingImage')) {
      page.backingImage = snap.backingImage
        ? JSON.parse(JSON.stringify(snap.backingImage))
        : null;
    }
  }
  EditPageBacking.prototype.undo = function() {
    applyPageBackingSnap(this, this.oldSnap);
  };
  EditPageBacking.prototype.redo = function() {
    applyPageBackingSnap(this, this.newSnap);
  };

  function AddDraft(draftData) {
    this.draftData = JSON.parse(JSON.stringify(draftData));
  }
  AddDraft.prototype.undo = function() {
    ME.SceneGraph.removeObject(ME.SceneGraph.getProject(), this.draftData.id);
  };
  AddDraft.prototype.redo = function() {
    var project = ME.SceneGraph.getProject();
    var page = pageOf(this, project);
    if (!page) return;
    if (!page.drafts) page.drafts = [];
    page.drafts.push(JSON.parse(JSON.stringify(this.draftData)));
    recalcZIndices(project, page);
  };

  function EditDraft(draftId, oldTransform, newTransform) {
    this.draftId = draftId;
    this.oldTransform = JSON.parse(JSON.stringify(oldTransform));
    this.newTransform = JSON.parse(JSON.stringify(newTransform));
  }
  EditDraft.prototype.undo = function() {
    var obj = ME.SceneGraph.getObjectById(ME.SceneGraph.getProject(), this.draftId);
    if (obj) Object.assign(obj.transform, this.oldTransform);
  };
  EditDraft.prototype.redo = function() {
    var obj = ME.SceneGraph.getObjectById(ME.SceneGraph.getProject(), this.draftId);
    if (obj) Object.assign(obj.transform, this.newTransform);
  };


  function AddMemo(memoData) {
    this.memoData = JSON.parse(JSON.stringify(memoData));
  }
  AddMemo.prototype.undo = function() {
    ME.SceneGraph.removeObject(ME.SceneGraph.getProject(), this.memoData.id);
  };
  AddMemo.prototype.redo = function() {
    var project = ME.SceneGraph.getProject();
    var page = pageOf(this, project);
    if (!page) return;
    if (!page.memos) page.memos = [];
    page.memos.push(JSON.parse(JSON.stringify(this.memoData)));
    recalcZIndices(project, page);
  };

  function EditMemo(memoId, oldTransform, newTransform) {
    this.memoId = memoId;
    this.oldTransform = JSON.parse(JSON.stringify(oldTransform));
    this.newTransform = JSON.parse(JSON.stringify(newTransform));
  }
  EditMemo.prototype.undo = function() {
    var obj = ME.SceneGraph.getObjectById(ME.SceneGraph.getProject(), this.memoId);
    if (obj) Object.assign(obj.transform, this.oldTransform);
  };
  EditMemo.prototype.redo = function() {
    var obj = ME.SceneGraph.getObjectById(ME.SceneGraph.getProject(), this.memoId);
    if (obj) Object.assign(obj.transform, this.newTransform);
  };

  function AddObject(obj) {
    this.objData = JSON.parse(JSON.stringify(obj));
    this.collectionName = getCollectionName(obj.type);
  }
  AddObject.prototype.undo = function() {
    ME.SceneGraph.removeObject(ME.SceneGraph.getProject(), this.objData.id);
  };
  AddObject.prototype.redo = function() {
    var project = ME.SceneGraph.getProject();
    var page = pageOf(this, project);
    if (!page || !this.collectionName) return;
    if (!page[this.collectionName]) page[this.collectionName] = [];
    page[this.collectionName].push(JSON.parse(JSON.stringify(this.objData)));
  };

  function getCollectionName(type) {
    var map = {
      panel: 'panels', image: 'images', balloon: 'balloons', text: 'texts',
      effect: 'effects', draft: 'drafts', memo: 'memos', string: 'strings'
    };
    return map[type] || null;
  }

  function recalcZIndices(project, page) {
    page = page || activePage(project);
    if (!page) return;
    var collections = ['panels', 'images', 'balloons', 'texts', 'effects', 'drafts', 'memos', 'strings'];
    var all = [];
    var c, i, items;
    for (c = 0; c < collections.length; c++) {
      items = page[collections[c]];
      if (!items) continue;
      for (i = 0; i < items.length; i++) {
        all.push({
          obj: items[i],
          z: (typeof items[i].zIndex === 'number') ? items[i].zIndex : 0,
          seq: all.length
        });
      }
    }
    all.sort(function(a, b) {
      if (a.z !== b.z) return a.z - b.z;
      return a.seq - b.seq;
    });
    for (i = 0; i < all.length; i++) {
      all[i].obj.zIndex = i;
    }
  }

  function AddPage(pageData, index, prevCurrentIndex) {
    this.pageData = pageData;
    this.index = index | 0;
    this.prevCurrentIndex = (typeof prevCurrentIndex === 'number') ? prevCurrentIndex : 0;
  }
  AddPage.prototype.undo = function() {
    var project = ME.SceneGraph.getProject();
    if (!project || !project.pages) return;
    if (this.index < 0 || this.index >= project.pages.length) return;
    if (project.pages.length <= 1) return;
    project.pages.splice(this.index, 1);
    if (ME.PageManager) {
      ME.PageManager.setCurrentIndex(project, this.prevCurrentIndex);
    } else {
      project.currentPageIndex = this.prevCurrentIndex;
    }
  };
  AddPage.prototype.redo = function() {
    var project = ME.SceneGraph.getProject();
    if (!project || !this.pageData) return;
    var page = JSON.parse(JSON.stringify(this.pageData));
    if (ME.PageManager && ME.PageManager.insertPageAt) {
      ME.PageManager.insertPageAt(project, page, this.index);
    } else {
      project.pages = project.pages || [];
      project.pages.splice(this.index, 0, page);
      project.currentPageIndex = this.index;
      project.page = page;
    }
  };

  function RemovePage(pageData, index, wasCurrentIndex) {
    this.pageData = pageData;
    this.index = index | 0;
    this.wasCurrentIndex = (typeof wasCurrentIndex === 'number') ? wasCurrentIndex : 0;
  }
  RemovePage.prototype.undo = function() {
    var project = ME.SceneGraph.getProject();
    if (!project || !this.pageData) return;
    var page = JSON.parse(JSON.stringify(this.pageData));
    if (ME.PageManager && ME.PageManager.insertPageAt) {
      ME.PageManager.insertPageAt(project, page, this.index);
      ME.PageManager.setCurrentIndex(project, this.wasCurrentIndex);
    } else {
      project.pages = project.pages || [];
      project.pages.splice(this.index, 0, page);
      project.currentPageIndex = this.wasCurrentIndex;
      project.page = project.pages[project.currentPageIndex];
    }
  };
  RemovePage.prototype.redo = function() {
    var project = ME.SceneGraph.getProject();
    if (!project || !project.pages) return;
    if (project.pages.length <= 1) return;
    if (this.index < 0 || this.index >= project.pages.length) return;
    project.pages.splice(this.index, 1);
    var next = this.wasCurrentIndex;
    if (next > this.index) next = next - 1;
    if (next >= project.pages.length) next = project.pages.length - 1;
    if (next < 0) next = 0;
    if (ME.PageManager) {
      ME.PageManager.setCurrentIndex(project, next);
    } else {
      project.currentPageIndex = next;
      project.page = project.pages[next];
    }
  };

  function ReorderPages(fromIndex, toIndex, oldCurrentIndex) {
    this.fromIndex = fromIndex | 0;
    this.toIndex = toIndex | 0;
    this.oldCurrentIndex = (typeof oldCurrentIndex === 'number') ? oldCurrentIndex : 0;
  }
  ReorderPages.prototype.undo = function() {
    var project = ME.SceneGraph.getProject();
    if (!project || !ME.PageManager) return;
    ME.PageManager.reorderPages(project, this.toIndex, this.fromIndex);
    ME.PageManager.setCurrentIndex(project, this.oldCurrentIndex);
  };
  ReorderPages.prototype.redo = function() {
    var project = ME.SceneGraph.getProject();
    if (!project || !ME.PageManager) return;
    ME.PageManager.reorderPages(project, this.fromIndex, this.toIndex);
  };

  function ClearPageDrafts(pageId, draftsSnap) {
    this.pageId = pageId;
    this.draftsSnap = draftsSnap || [];
  }
  ClearPageDrafts.prototype.undo = function() {
    var project = ME.SceneGraph.getProject();
    var page = resolvePage(project, this.pageId);
    if (!page) return;
    page.drafts = JSON.parse(JSON.stringify(this.draftsSnap));
  };
  ClearPageDrafts.prototype.redo = function() {
    var project = ME.SceneGraph.getProject();
    var page = resolvePage(project, this.pageId);
    if (!page) return;
    page.drafts = [];
  };

  function ClearAllDrafts(snaps) {
    this.snaps = snaps || [];
  }
  ClearAllDrafts.prototype.undo = function() {
    var project = ME.SceneGraph.getProject();
    if (!project || !project.pages) return;
    for (var s = 0; s < this.snaps.length; s++) {
      var snap = this.snaps[s];
      for (var i = 0; i < project.pages.length; i++) {
        if (project.pages[i].id === snap.pageId) {
          project.pages[i].drafts = JSON.parse(JSON.stringify(snap.drafts || []));
          break;
        }
      }
    }
  };
  ClearAllDrafts.prototype.redo = function() {
    var project = ME.SceneGraph.getProject();
    if (!project || !project.pages) return;
    for (var s = 0; s < this.snaps.length; s++) {
      var snap = this.snaps[s];
      for (var i = 0; i < project.pages.length; i++) {
        if (project.pages[i].id === snap.pageId) {
          project.pages[i].drafts = [];
          break;
        }
      }
    }
  };


  function ClearPageMemos(pageId, memosSnap) {
    this.pageId = pageId;
    this.memosSnap = memosSnap || [];
  }
  ClearPageMemos.prototype.undo = function() {
    var project = ME.SceneGraph.getProject();
    var page = resolvePage(project, this.pageId);
    if (!page) return;
    page.memos = JSON.parse(JSON.stringify(this.memosSnap));
  };
  ClearPageMemos.prototype.redo = function() {
    var project = ME.SceneGraph.getProject();
    var page = resolvePage(project, this.pageId);
    if (!page) return;
    page.memos = [];
  };

  function ClearAllMemos(snaps) {
    this.snaps = snaps || [];
  }
  ClearAllMemos.prototype.undo = function() {
    var project = ME.SceneGraph.getProject();
    if (!project || !project.pages) return;
    for (var s = 0; s < this.snaps.length; s++) {
      var snap = this.snaps[s];
      for (var i = 0; i < project.pages.length; i++) {
        if (project.pages[i].id === snap.pageId) {
          project.pages[i].memos = JSON.parse(JSON.stringify(snap.memos || []));
          break;
        }
      }
    }
  };
  ClearAllMemos.prototype.redo = function() {
    var project = ME.SceneGraph.getProject();
    if (!project || !project.pages) return;
    for (var s = 0; s < this.snaps.length; s++) {
      var snap = this.snaps[s];
      for (var i = 0; i < project.pages.length; i++) {
        if (project.pages[i].id === snap.pageId) {
          project.pages[i].memos = [];
          break;
        }
      }
    }
  };

  function EditPageSize(pageId, oldSize, newSize) {
    this.pageId = pageId;
    this.oldSize = JSON.parse(JSON.stringify(oldSize));
    this.newSize = JSON.parse(JSON.stringify(newSize));
  }
  EditPageSize.prototype.undo = function() {
    var page = pageOf(this, ME.SceneGraph.getProject());
    if (page) page.size = JSON.parse(JSON.stringify(this.oldSize));
  };
  EditPageSize.prototype.redo = function() {
    var page = pageOf(this, ME.SceneGraph.getProject());
    if (page) page.size = JSON.parse(JSON.stringify(this.newSize));
  };

  // main.js の offsetAllObjects と同じ移動ロジック（自己完結・main.js非依存）
  function offsetPageObjects(page, dx, dy) {
    if (!page) return;
    var arrs = ['panels', 'images', 'balloons', 'texts', 'effects', 'drafts', 'memos'];
    for (var a = 0; a < arrs.length; a++) {
      var arr = page[arrs[a]] || [];
      for (var i = 0; i < arr.length; i++) {
        var o = arr[i];
        if (o.type === 'panel') {
          if (o.vertices) {
            for (var v = 0; v < o.vertices.length; v++) { o.vertices[v].x += dx; o.vertices[v].y += dy; }
          }
        } else {
          if (o.transform) { o.transform.x = (o.transform.x || 0) + dx; o.transform.y = (o.transform.y || 0) + dy; }
          if (o.type === 'balloon' && o.tail) {
            var keys = ['basePoint', 'curvePoint', 'tipPoint'];
            for (var k = 0; k < keys.length; k++) {
              var pt = o.tail[keys[k]];
              if (pt && pt.x !== undefined) { pt.x += dx; pt.y += dy; }
            }
          }
          if (o.type === 'effect' && o.params && o.params.origin) {
            o.params.origin.x += dx; o.params.origin.y += dy;
          }
        }
      }
    }
  }

  function CropPage(pageId, oldSize, newSize, dx, dy) {
    this.pageId = pageId;
    this.oldSize = JSON.parse(JSON.stringify(oldSize));
    this.newSize = JSON.parse(JSON.stringify(newSize));
    this.dx = dx || 0;
    this.dy = dy || 0;
  }
  CropPage.prototype.undo = function() {
    var page = pageOf(this, ME.SceneGraph.getProject());
    if (!page) return;
    page.size = JSON.parse(JSON.stringify(this.oldSize));
    offsetPageObjects(page, -this.dx, -this.dy);
  };
  CropPage.prototype.redo = function() {
    var page = pageOf(this, ME.SceneGraph.getProject());
    if (!page) return;
    page.size = JSON.parse(JSON.stringify(this.newSize));
    offsetPageObjects(page, this.dx, this.dy);
  };

  window.ME.Commands = {
    MoveObject: MoveObject,
    ResizePanel: ResizePanel,
    AddPanel: AddPanel,
    AddObject: AddObject,
    DeleteObject: DeleteObject,
    DeleteObjects: DeleteObjects,
    EditVertex: EditVertex,
    ColorAdjust: ColorAdjust,
    BatchEdit: BatchEdit,
    PasteObjects: PasteObjects,
    AddDraft: AddDraft,
    EditDraft: EditDraft,
    EditPageBacking: EditPageBacking,
    AddPage: AddPage,
    RemovePage: RemovePage,
    ReorderPages: ReorderPages,
    ClearPageDrafts: ClearPageDrafts,
    ClearAllDrafts: ClearAllDrafts,
    AddMemo: AddMemo,
    EditMemo: EditMemo,
    ClearPageMemos: ClearPageMemos,
    ClearAllMemos: ClearAllMemos,
    EditPageSize: EditPageSize,
    CropPage: CropPage
  };

  window.ME.CommandStack = { create: create };
  window.ME.CommandStack.resolvePage = resolvePage;
})();
