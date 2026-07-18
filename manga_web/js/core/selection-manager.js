// ME.Selection.create() — インスタンス生成
// インスタンスメソッド: toggle, selectOnly, addRange, clear, isSelected, getSelectedIds,
//                       hitTest(x, y, project), hitTestRect(x1,y1,x2,y2, project),
//                       getBoundingBox(obj, project?) — projectを渡すと「見える範囲」で判定
// 見えない部分が選択に引っかからないよう、
//   image: コマ（clipPath）とバウンディングボックスの交差部分のみを当たり判定にする
//   effect: scope=panelなら対象コマ範囲、scope=pageなら中心付近の小さな範囲のみ

window.ME = window.ME || {};
window.ME.Selection = window.ME.Selection || {};

(function() {
  'use strict';

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
    var selectedIds = new Set();

    function toggle(id) {
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
      } else {
        selectedIds.add(id);
      }
    }

    function selectOnly(id) {
      selectedIds.clear();
      selectedIds.add(id);
    }

    function addRange(ids) {
      for (var i = 0; i < ids.length; i++) {
        selectedIds.add(ids[i]);
      }
    }

    function clear() {
      selectedIds.clear();
    }

    function isSelected(id) {
      return selectedIds.has(id);
    }

    function getSelectedIds() {
      var arr = [];
      selectedIds.forEach(function(id) { arr.push(id); });
      return arr;
    }

    // type → page コレクション名
    function collectionNameForType(type) {
      if (type === 'panel') return 'panels';
      if (type === 'image') return 'images';
      if (type === 'balloon') return 'balloons';
      if (type === 'text') return 'texts';
      if (type === 'effect') return 'effects';
      if (type === 'draft') return 'drafts';
      if (type === 'memo') return 'memos';
      if (type === 'string') return 'strings';
      return null;
    }

    // project 内を直接検索（SceneGraph 未ロード時でも壊れない）
    function findObjectById(project, id) {
      if (!project || !activePage(project) || id == null) return null;
      var collections = ['panels', 'images', 'balloons', 'texts', 'effects', 'drafts', 'memos', 'strings'];
      for (var c = 0; c < collections.length; c++) {
        var arr = activePage(project)[collections[c]];
        if (!arr) continue;
        for (var i = 0; i < arr.length; i++) {
          if (arr[i] && arr[i].id === id) return arr[i];
        }
      }
      return null;
    }

    // fusionGroup が同じ同種オブジェクトの ID 一覧（融合なしなら [id]）
    // 下書き（円/四角/直線/注釈）を「一体」として扱うために使用
    function getFusionMemberIds(project, idOrObj) {
      var obj = typeof idOrObj === 'string' ? findObjectById(project, idOrObj) : idOrObj;
      if (!obj || !obj.id) {
        // 解決できない場合でも呼び出し元の id を落とさない
        if (typeof idOrObj === 'string' && idOrObj) return [idOrObj];
        return [];
      }
      if (!obj.fusionGroup || !project || !activePage(project)) return [obj.id];

      var col = collectionNameForType(obj.type);
      if (!col) return [obj.id];
      var arr = activePage(project)[col] || [];
      var ids = [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && arr[i].fusionGroup === obj.fusionGroup) {
          ids.push(arr[i].id);
        }
      }
      return ids.length > 0 ? ids : [obj.id];
    }

    // ヒット結果を融合単位に展開（重複除去・順序維持）
    function expandFusionIds(project, ids) {
      var out = [];
      var seen = {};
      if (!ids || !ids.length) return out;
      for (var i = 0; i < ids.length; i++) {
        var members = getFusionMemberIds(project, ids[i]);
        for (var j = 0; j < members.length; j++) {
          if (!seen[members[j]]) {
            seen[members[j]] = true;
            out.push(members[j]);
          }
        }
      }
      return out;
    }

    // typeFilter が指定されていればその type のみ（下書きステップ用）
    function filterIdsByType(project, ids, typeFilter) {
      if (!typeFilter) return ids || [];
      var out = [];
      for (var i = 0; i < (ids || []).length; i++) {
        var o = ME.SceneGraph.getObjectById(project, ids[i]);
        if (o && o.type === typeFilter) out.push(ids[i]);
      }
      return out;
    }

    // (x,y)に重なっているオブジェクトIDを返す（見える範囲ベースの判定）
    // opts.typeFilter: 'draft' 等を指定するとその type のみ
    function hitTest(x, y, project, opts) {
      var results = [];
      if (!project || !activePage(project)) return results;
      var typeFilter = opts && opts.typeFilter ? opts.typeFilter : null;

      // memo は typeFilter==='memo' のときだけ（Ctrl+A/他stepと非干渉）
      var collections;
      if (typeFilter === 'memo') {
        collections = ['memos'];
      } else {
        collections = ['images', 'panels', 'balloons', 'texts', 'effects', 'drafts', 'strings'];
      }
      for (var c = 0; c < collections.length; c++) {
        var arr = activePage(project)[collections[c]];
        if (!arr) continue;
        for (var i = 0; i < arr.length; i++) {
          var obj = arr[i];
          if (obj.visible === false || obj.locked) continue;
          if (typeFilter && obj.type !== typeFilter) continue;
          if (pointInBounds(x, y, obj, project)) {
            results.push(obj.id);
          }
        }
      }
      // 上のレイヤー（texts→balloons→effects→panels→images）を優先して返す
      results.reverse();
      return results;
    }

    // ラバーバンド矩形とオブジェクトのバウンディングボックスが交差するか判定
    // opts.typeFilter: 'draft' | 'memo' 等
    function hitTestRect(rx1, ry1, rx2, ry2, project, opts) {
      var results = [];
      if (!project || !activePage(project)) return results;
      var typeFilter = opts && opts.typeFilter ? opts.typeFilter : null;

      var collections;
      if (typeFilter === 'memo') {
        collections = ['memos'];
      } else {
        collections = ['images', 'panels', 'balloons', 'texts', 'effects', 'drafts', 'strings'];
      }
      for (var c = 0; c < collections.length; c++) {
        var arr = activePage(project)[collections[c]];
        if (!arr) continue;
        for (var i = 0; i < arr.length; i++) {
          var obj = arr[i];
          if (obj.visible === false || obj.locked) continue;
          if (typeFilter && obj.type !== typeFilter) continue;
          var bb = getBoundingBox(obj, project);
          if (rectsIntersect(rx1, ry1, rx2 - rx1, ry2 - ry1, bb.x, bb.y, bb.w, bb.h)) {
            results.push(obj.id);
          }
        }
      }
      return results;
    }

    // オブジェクトのバウンディングボックス計算
    // projectを渡すと image/effect は「見える範囲」に絞り込む
    function getBoundingBox(obj, project) {
      if (obj.type === 'panel') {
        return panelBBox(obj);
      }

      var t = obj.transform || {};

      if (obj.type === 'image') {
        var iw = (obj.width && obj.width > 0 ? obj.width : 100) * Math.abs(t.scaleX || 1);
        var ih = (obj.height && obj.height > 0 ? obj.height : 100) * Math.abs(t.scaleY || 1);
        var bb = { x: t.x - iw / 2, y: t.y - ih / 2, w: iw, h: ih };
        // コマにクリップされている場合、見える範囲＝コマとの交差部分
        if (project && obj.panelId) {
          var panel = findPanel(project, obj.panelId);
          if (panel && panel.clipPath !== false) {
            var pb = panelBBox(panel);
            var clipped = intersectRect(bb, pb);
            if (clipped) return clipped;
            // 完全にコマ外 → 選択不可能な極小ボックス
            return { x: t.x, y: t.y, w: 0, h: 0 };
          }
        }
        return bb;
      }

      if (obj.type === 'balloon') {
        var s = obj.size || { width: 150, height: 80 };
        return { x: t.x - s.width / 2, y: t.y - s.height / 2, w: s.width, h: s.height };
      }

      if (obj.type === 'text') {
        var fs = (obj.font && obj.font.size) || 16;
        var content = obj.content || '';
        var lines = content.split('\n');
        var maxLen = 1;
        for (var li = 0; li < lines.length; li++) {
          if (lines[li].length > maxLen) maxLen = lines[li].length;
        }
        var tw, th;
        var lh = (obj.font && obj.font.lineHeight) || 1.2;
        var ls = (obj.font && obj.font.letterSpacing !== undefined) ? obj.font.letterSpacing : 0;
        if (obj.writingMode === 'vertical') {
          // 原点=先頭列上端。列は右→左。各文字は textAlign=center で列中心
          // 右端 = +fs/2、左端 = -(n-1)*colW - fs/2
          var colW = fs * lh;
          var span = Math.max(0, lines.length - 1) * colW;
          th = Math.max(maxLen * (fs + ls), fs);
          return { x: t.x - span - fs / 2, y: t.y, w: span + fs, h: th };
        } else {
          // 原点=左上
          tw = Math.max(maxLen * (fs + ls), fs);
          th = Math.max(fs * lh * lines.length, fs);
          return { x: t.x, y: t.y, w: tw, h: th };
        }
      }

      // effect: 巨大な見えない当たり判定を避ける
      if (obj.type === 'effect') {
        if (project && obj.scope === 'panel' && obj.panelId) {
          var epanel = findPanel(project, obj.panelId);
          if (epanel) return panelBBox(epanel);
        }
        // ページ効果は配置点まわりの小さな範囲のみ
        return { x: t.x - 20, y: t.y - 20, w: 40, h: 40 };
      }

      // draft / memo: kindに応じたバウンディングボックス
      if (obj.type === 'draft' || obj.type === 'memo') {
        var s = Math.abs(t.scaleX || 1);
        var sy = Math.abs(t.scaleY || 1);
        if (obj.type === 'memo' && obj.kind === 'freehand') {
          var pts = (obj.params && obj.params.points) || [];
          if (!pts.length) return { x: t.x, y: t.y, w: 1, h: 1 };
          var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (var pi = 0; pi < pts.length; pi++) {
            var px = (pts[pi].x || 0) * s;
            var py = (pts[pi].y || 0) * sy;
            if (px < minX) minX = px;
            if (py < minY) minY = py;
            if (px > maxX) maxX = px;
            if (py > maxY) maxY = py;
          }
          var pad = ((obj.strokeWidth != null ? obj.strokeWidth : 2.5) + 4);
          return { x: t.x + minX - pad, y: t.y + minY - pad, w: Math.max(maxX - minX, 1) + pad * 2, h: Math.max(maxY - minY, 1) + pad * 2 };
        }
        if (obj.kind === 'circle') {
          var ew = (obj.params && obj.params.width) || 60;
          var eh = (obj.params && obj.params.height) || 40;
          return { x: t.x - Math.abs(ew) / 2 * s, y: t.y - Math.abs(eh) / 2 * sy, w: Math.abs(ew) * s, h: Math.abs(eh) * sy };
        }
        if (obj.kind === 'rect') {
          var rw = (obj.params && obj.params.width) || 60;
          var rh = (obj.params && obj.params.height) || 40;
          return { x: t.x - rw / 2 * s, y: t.y - rh / 2 * sy, w: rw * s, h: rh * sy };
        }
        if (obj.kind === 'line') {
          var sx = (obj.params && obj.params.startX) || 0;
          var sy2 = (obj.params && obj.params.startY) || 0;
          var ex = (obj.params && obj.params.endX) || 0;
          var ey = (obj.params && obj.params.endY) || 0;
          // scale を反映（resize 時のハンドル位置と一致させる）
          sx *= s;
          sy2 *= sy;
          ex *= s;
          ey *= sy;
          var lx = Math.min(sx, ex);
          var ly = Math.min(sy2, ey);
          var lw = Math.abs(ex - sx);
          var lh = Math.abs(ey - sy2);
          return { x: t.x + lx, y: t.y + ly, w: Math.max(lw, 1), h: Math.max(lh, 1) };
        }
        if (obj.kind === 'string') {
          // 文字列（draft）: 横書き固定・原点=左上
          var fs = (obj.font && obj.font.size) || 24;
          var content = obj.content || '';
          var lines = content.split('\n');
          var maxLen = 1;
          for (var li = 0; li < lines.length; li++) {
            if (lines[li].length > maxLen) maxLen = lines[li].length;
          }
          var tw = Math.max(fs * maxLen, fs) * s;
          var th = Math.max(fs * 1.2 * lines.length, fs) * sy;
          return { x: t.x, y: t.y, w: tw, h: th };
        }
      }

      // string: 旧 type（移行前データ）— 横書き固定・原点=左上
      if (obj.type === 'string') {
        var fs = (obj.font && obj.font.size) || 24;
        var content = obj.content || '';
        var lines = content.split('\n');
        var maxLen = 1;
        for (var li = 0; li < lines.length; li++) {
          if (lines[li].length > maxLen) maxLen = lines[li].length;
        }
        var tw = Math.max(fs * maxLen, fs);
        var th = Math.max(fs * 1.2 * lines.length, fs);
        return { x: t.x, y: t.y, w: tw, h: th };
      }

      return { x: t.x - 50, y: t.y - 50, w: 100, h: 100 };
    }

    function panelBBox(panel) {
      var verts = panel.vertices || [];
      if (verts.length < 4) return { x: 0, y: 0, w: 1, h: 1 };
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var i = 0; i < verts.length; i++) {
        if (verts[i].x < minX) minX = verts[i].x;
        if (verts[i].y < minY) minY = verts[i].y;
        if (verts[i].x > maxX) maxX = verts[i].x;
        if (verts[i].y > maxY) maxY = verts[i].y;
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    function findPanel(project, panelId) {
      var panels = activePage(project).panels || [];
      for (var i = 0; i < panels.length; i++) {
        if (panels[i].id === panelId) return panels[i];
      }
      return null;
    }

    // 2矩形の交差部分（交差しなければnull）
    function intersectRect(a, b) {
      var x1 = Math.max(a.x, b.x);
      var y1 = Math.max(a.y, b.y);
      var x2 = Math.min(a.x + a.w, b.x + b.w);
      var y2 = Math.min(a.y + a.h, b.y + b.h);
      if (x2 <= x1 || y2 <= y1) return null;
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }

    function pointInBounds(px, py, obj, project) {
      var bb = getBoundingBox(obj, project);
      if (bb.w <= 0 || bb.h <= 0) return false;
      return px >= bb.x && px <= bb.x + bb.w && py >= bb.y && py <= bb.y + bb.h;
    }

    function rectsIntersect(rx1, ry1, rw, rh, bx, by, bw, bh) {
      return !(rx1 > bx + bw || rx1 + rw < bx || ry1 > by + bh || ry1 + rh < by);
    }

    return {
      toggle: toggle,
      selectOnly: selectOnly,
      addRange: addRange,
      clear: clear,
      isSelected: isSelected,
      getSelectedIds: getSelectedIds,
      hitTest: hitTest,
      hitTestRect: hitTestRect,
      getBoundingBox: getBoundingBox,
      getFusionMemberIds: getFusionMemberIds,
      expandFusionIds: expandFusionIds,
      filterIdsByType: filterIdsByType
    };
  }

  window.ME.Selection = { create: create };
})();
