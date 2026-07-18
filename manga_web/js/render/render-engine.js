// ME.Render.Engine.create(canvas, project) — エンジン生成
// ME.Render.Engine.BLEED — 断ち切り余白(px)。キャンバスはページ+余白の大きさで、
//   ページ座標(0,0)は余白の内側から始まる。ツールのマウス座標はgetPagePoint()で変換する。
// ME.Render.Engine.getPagePoint(canvas, event) → {x, y} — ページ座標へのマウス変換（ズーム考慮）
// ME.Render.Engine.setZoom(z) / getZoom() — 表示倍率（静的。1.0=100%）
//   render()は ctx.setTransform(zoom,0,0,zoom,0,0) → translate(BLEED,BLEED) でページ座標系を作る。
//   融合レイヤー合成は等倍のため、drawFillUnion/drawBorderUnion/drawGroup へ opts.scale=zoom を渡す。
//
// 描画順:
//   余白(暗色) → ページ台紙色 → 台紙画像 → [コマ塗り] → 下書き(注釈含む) → [所属画像 → コマ効果 → 枠線] →
//   所属なし画像 → ページ効果 → 吹き出し → テキスト → 断ち切り線 → 選択オーバーレイ
// 下書きは「絵（画像）」の下。画像を入れると下書きは隠れる。
// 台紙画像 page.backingImage はコマの下（レイアウト基準用）。
// 融合クラスタ: fusionGroupが同じコマは1つの形として描画。画像のクリップも合併領域になる。

window.ME = window.ME || {};
window.ME.Render = window.ME.Render || {};
window.ME.Render.Engine = window.ME.Render.Engine || {};

(function() {
  'use strict';

  var BLEED = 40; // 断ち切り余白（画面px、ページ座標単位）
  var zoom = 1;   // 表示倍率（静的。getPagePointが静的なため）

  function setZoom(z) {
    zoom = z && z > 0 ? z : 1;
  }

  function getZoom() {
    return zoom;
  }

  // マウス座標 → ページ座標（ズームと断ち切り余白を逆変換）
  function getPagePoint(canvas, e) {
    var rect = canvas.getBoundingClientRect();
    // CSSスケール/devicePixelRatio対応: キャンバスのピクセルサイズとCSS表示サイズの比を補正
    // （両者が一致している場合は sx=sy=1 で従来どおり）
    var sx = rect.width > 0 ? canvas.width / rect.width : 1;
    var sy = rect.height > 0 ? canvas.height / rect.height : 1;
    return {
      x: (e.clientX - rect.left) * sx / zoom - BLEED,
      y: (e.clientY - rect.top) * sy / zoom - BLEED
    };
  }

  function create(canvas, project) {
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');

    var dirty = false;
    var animFrameId = null;
    var pageScale = 1;
    var assetLibrary = project ? project.assets : { images: {} };

    if (!assetLibrary._panelClipCache) {
      assetLibrary._panelClipCache = {};
    }

    function setDirty() {
      dirty = true;
      scheduleRender();
    }

    function render() {
      if (!dirty && !forceRender) return;
      dirty = false;
      forceRender = false;

      // ページサイズ（ページ座標px）= キャンバスpx ÷ zoom − 余白×2
      var pageW = canvas.width / zoom - BLEED * 2;
      var pageH = canvas.height / zoom - BLEED * 2;

      // 1. 全体クリア + 余白（断ち切りエリア）を暗く（デバイスピクセルで）
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#4a4a52';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 以降はページ座標系（原点=ページ左上）。zoomを掛けてから余白分だけ平行移動。
      ctx.save();
      ctx.setTransform(zoom, 0, 0, zoom, 0, 0);
      ctx.translate(BLEED, BLEED);

      // 2. ページ白地（台紙色）
      var page = null;
      if (project) {
        if (ME.PageManager && typeof ME.PageManager.getCurrentPage === 'function') {
          page = ME.PageManager.getCurrentPage(project);
        } else if (ME.SceneGraph && typeof ME.SceneGraph.getActivePage === 'function') {
          page = ME.SceneGraph.getActivePage(project);
        } else {
          page = project.page;
        }
      }
      ctx.fillStyle = (page && page.backgroundColor) || '#FFFFFF';
      ctx.fillRect(0, 0, pageW, pageH);

      if (!project || !page) {
        ctx.restore();
        return;
      }

      // 2b. 台紙画像（ページ色の上・コマ塗りの下）
      if (page.backingImage && page.backingImage.assetId && ME.Render.Image) {
        ME.Render.Image.draw(ctx, page.backingImage, assetLibrary);
      }

      // 3. コマの融合クラスタを構築（fusionGroupが同じコマ同士）
      var panels = (page.panels || []).slice().sort(function(a, b) { return (a.zIndex || 0) - (b.zIndex || 0); });
      var panelIds = {};
      for (var i = 0; i < panels.length; i++) panelIds[panels[i].id] = true;

      var clusters = buildClusters(panels); // [{members: [panel...]}] zIndex順
      var clusterOfPanel = {};
      for (var i = 0; i < clusters.length; i++) {
        for (var j = 0; j < clusters[i].members.length; j++) {
          clusterOfPanel[clusters[i].members[j].id] = clusters[i];
        }
      }

      // クリップキャッシュ更新（融合コマは合併領域でクリップ）
      for (var i = 0; i < panels.length; i++) {
        var pnl = panels[i];
        if (pnl.clipPath) {
          assetLibrary._panelClipCache[pnl.id] = (function(cluster, panel) {
            return function(context) {
              if (cluster && cluster.members.length > 1) {
                ME.Render.Panel.createClipPathMulti(context, cluster.members);
              } else {
                ME.Render.Panel.createClipPath(context, panel);
              }
            };
          })(clusterOfPanel[pnl.id], pnl);
        } else {
          delete assetLibrary._panelClipCache[pnl.id];
        }
      }

      // 現在のページに存在しないコマIDのstaleエントリを掃除
      var cacheKeys = assetLibrary._panelClipCache;
      for (var ck in cacheKeys) {
        if (cacheKeys.hasOwnProperty(ck) && !panelIds[ck]) delete cacheKeys[ck];
      }

      // 4. images / effects をグルーピング
      var images = (page.images || []).slice().sort(function(a, b) { return (a.zIndex || 0) - (b.zIndex || 0); });
      var imagesByPanel = {};
      var orphanImages = [];
      for (var i = 0; i < images.length; i++) {
        var img = images[i];
        if (img.panelId && panelIds[img.panelId]) {
          if (!imagesByPanel[img.panelId]) imagesByPanel[img.panelId] = [];
          imagesByPanel[img.panelId].push(img);
        } else {
          orphanImages.push(img);
        }
      }

      var effects = (page.effects || []).slice().sort(function(a, b) { return (a.zIndex || 0) - (b.zIndex || 0); });
      var effectsByPanel = {};
      var pageEffects = [];
      for (var i = 0; i < effects.length; i++) {
        var ef = effects[i];
        if (ef.scope === 'panel' && ef.panelId && panelIds[ef.panelId]) {
          if (!effectsByPanel[ef.panelId]) effectsByPanel[ef.panelId] = [];
          effectsByPanel[ef.panelId].push(ef);
        } else {
          pageEffects.push(ef);
        }
      }

      // 5. クラスタ単位のグループ描画（融合レイヤーは等倍合成のためscale=zoom, offset=BLEED）
      //    下書きを「絵の下」にするため: 全コマ塗り → 下書き → 画像/効果/枠
      var layerOpts = { scale: zoom, offsetX: BLEED, offsetY: BLEED };
      var visibleClusters = [];
      for (var ci = 0; ci < clusters.length; ci++) {
        var members = clusters[ci].members;
        var visibleMembers = [];
        for (var i = 0; i < members.length; i++) {
          if (members[i].visible !== false) visibleMembers.push(members[i]);
        }
        if (visibleMembers.length === 0) continue;
        visibleClusters.push(visibleMembers);

        // 5-1. 塗り（融合時は合併シルエット）
        ME.Render.Panel.drawFillUnion(ctx, visibleMembers, layerOpts);
      }

      // 5-1b. 下書きレイヤー（注釈文字列含む）— コマ塗りの上・画像の下
      // 融合グループ単位で描画（吹き出しと同様）。panelId があればコマ枠でクロップ
      var drafts = (page.drafts || []).slice().sort(function(a, b) { return (a.zIndex || 0) - (b.zIndex || 0); });
      var drawnDraftGroups = {};
      for (var i = 0; i < drafts.length; i++) {
        var dr = drafts[i];
        if (!dr || dr.visible === false) continue;
        if (dr.fusionGroup) {
          if (drawnDraftGroups[dr.fusionGroup]) continue;
          drawnDraftGroups[dr.fusionGroup] = true;
          var dgroup = [];
          for (var j = 0; j < drafts.length; j++) {
            if (drafts[j].fusionGroup === dr.fusionGroup && drafts[j].visible !== false) {
              dgroup.push(drafts[j]);
            }
          }
          var dClip = null;
          if (dgroup[0].panelId && assetLibrary._panelClipCache[dgroup[0].panelId]) {
            dClip = assetLibrary._panelClipCache[dgroup[0].panelId];
          }
          ME.Render.Draft.drawGroup(ctx, dgroup, { scale: zoom, offsetX: BLEED, offsetY: BLEED, clipFn: dClip });
        } else {
          var sClip = null;
          if (dr.panelId && assetLibrary._panelClipCache[dr.panelId]) {
            sClip = assetLibrary._panelClipCache[dr.panelId];
          }
          ME.Render.Draft.draw(ctx, dr, { clipFn: sClip });
        }
      }
      // 旧 strings（移行前データ用）も同じ優先度
      var strings = (page.strings || []).slice().sort(function(a, b) { return (a.zIndex || 0) - (b.zIndex || 0); });
      for (var i = 0; i < strings.length; i++) {
        ME.Render.String.draw(ctx, strings[i]);
      }

      for (var ci = 0; ci < visibleClusters.length; ci++) {
        var visibleMembers = visibleClusters[ci];

        // 5-2. メンバー全コマの所属画像
        for (var i = 0; i < visibleMembers.length; i++) {
          var pImages = imagesByPanel[visibleMembers[i].id] || [];
          for (var j = 0; j < pImages.length; j++) {
            ME.Render.Image.draw(ctx, pImages[j], assetLibrary);
          }
        }

        // 5-3. コマ効果（コマの形にクリップ。変形コマでも外接矩形でなく多角形に沿う）
        var clusterB = clusterBounds(visibleMembers);
        for (var i = 0; i < visibleMembers.length; i++) {
          var em = visibleMembers[i];
          var pEffects = effectsByPanel[em.id] || [];
          if (pEffects.length === 0) continue;
          var eClip = assetLibrary._panelClipCache[em.id]; // clipPath=falseのコマはキャッシュ無し→クリップしない
          for (var j = 0; j < pEffects.length; j++) {
            ctx.save();
            if (eClip) eClip(ctx);
            ME.Render.Effect.draw(ctx, pEffects[j], clusterB);
            ctx.restore();
          }
        }

        // 5-4. 枠線（融合時は外周のみ）
        ME.Render.Panel.drawBorderUnion(ctx, visibleMembers, layerOpts);
      }

      // 6. 所属コマのない画像
      for (var i = 0; i < orphanImages.length; i++) {
        ME.Render.Image.draw(ctx, orphanImages[i], assetLibrary);
      }

      // 7. ページ効果
      for (var i = 0; i < pageEffects.length; i++) {
        ME.Render.Effect.draw(ctx, pageEffects[i], null);
      }

      // 8. balloons（融合グループ単位で描画）
      var balloons = (page.balloons || []).slice().sort(function(a, b) { return (a.zIndex || 0) - (b.zIndex || 0); });
      var drawnGroups = {};
      for (var i = 0; i < balloons.length; i++) {
        var b = balloons[i];
        if (b.visible === false) continue;

        var group = [b];
        if (b.fusionGroup) {
          if (drawnGroups[b.fusionGroup]) continue; // 既に描画済み
          drawnGroups[b.fusionGroup] = true;
          group = [];
          for (var j = 0; j < balloons.length; j++) {
            if (balloons[j].fusionGroup === b.fusionGroup && balloons[j].visible !== false) {
              group.push(balloons[j]);
            }
          }
        }

        // コマ内クロップ（先頭メンバーのpanelIdを使用）
        var clipFn = null;
        if (group[0].panelId && assetLibrary._panelClipCache[group[0].panelId]) {
          clipFn = assetLibrary._panelClipCache[group[0].panelId];
        }

        ME.Render.Balloon.drawGroup(ctx, group, { scale: zoom, offsetX: BLEED, offsetY: BLEED, clipFn: clipFn });
      }

      // 9. texts
      var texts = (page.texts || []).slice().sort(function(a, b) { return (a.zIndex || 0) - (b.zIndex || 0); });
      for (var i = 0; i < texts.length; i++) {
        ME.Render.Text.draw(ctx, texts[i]);
      }

      // 10. 断ち切り線（ページの仕上がり枠）
      ctx.strokeStyle = 'rgba(74, 144, 217, 0.9)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(0, 0, pageW, pageH);
      ctx.setLineDash([]);

      // 10b. 校閲メモ（編集専用・最上層。PNG/印刷は PageDraw で描かない）
      if (ME.Render.Memo && ME.Render.Memo.draw) {
        var memos = (page.memos || []).slice().sort(function(a, b) { return (a.zIndex || 0) - (b.zIndex || 0); });
        for (var mi = 0; mi < memos.length; mi++) {
          if (memos[mi] && memos[mi].visible !== false) {
            ME.Render.Memo.draw(ctx, memos[mi]);
          }
        }
      }

      // 11. 選択オーバーレイ（ページ座標系のまま。zoom変換下なのでハンドルも追従する）
      invokeSelectionOverlays(ctx);

      ctx.restore();
    }

    // fusionGroupで融合クラスタを構築（zIndex順を維持: クラスタ位置は最初のメンバー位置）
    function buildClusters(sortedPanels) {
      var clusters = [];
      var groupIndex = {}; // fusionGroup → cluster
      for (var i = 0; i < sortedPanels.length; i++) {
        var p = sortedPanels[i];
        if (p.fusionGroup) {
          if (groupIndex[p.fusionGroup]) {
            groupIndex[p.fusionGroup].members.push(p);
          } else {
            var cl = { members: [p] };
            groupIndex[p.fusionGroup] = cl;
            clusters.push(cl);
          }
        } else {
          clusters.push({ members: [p] });
        }
      }
      return clusters;
    }

    function clusterBounds(members) {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var i = 0; i < members.length; i++) {
        var verts = members[i].vertices;
        for (var j = 0; j < verts.length; j++) {
          if (verts[j].x < minX) minX = verts[j].x;
          if (verts[j].y < minY) minY = verts[j].y;
          if (verts[j].x > maxX) maxX = verts[j].x;
          if (verts[j].y > maxY) maxY = verts[j].y;
        }
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    function setPageScale(scale) {
      pageScale = scale || 1;
    }

    var drawSelectionOverlay = null;

    var overlayCallbackId = 0; // unique id for each registered callback

    function setSelectionOverlayCallback(callback) {
      var id = ++overlayCallbackId;
      if (drawSelectionOverlay === null) {
        drawSelectionOverlay = { id: id, fn: callback };
      } else if (Array.isArray(drawSelectionOverlay)) {
        drawSelectionOverlay.push({ id: id, fn: callback });
      } else {
        drawSelectionOverlay = [drawSelectionOverlay, { id: id, fn: callback }];
      }
      return id; // return the id so caller can remove it later
    }

    function removeSelectionOverlayCallback(callback) {
      if (!drawSelectionOverlay) return;
      if (typeof drawSelectionOverlay === 'function') {
        if (drawSelectionOverlay === callback) drawSelectionOverlay = null;
        return;
      }
      if (Array.isArray(drawSelectionOverlay)) {
        for (var i = 0; i < drawSelectionOverlay.length; i++) {
          if (drawSelectionOverlay[i] === callback || drawSelectionOverlay[i].fn === callback) {
            drawSelectionOverlay.splice(i, 1);
            break;
          }
        }
        if (drawSelectionOverlay.length === 0) drawSelectionOverlay = null;
        else if (drawSelectionOverlay.length === 1) drawSelectionOverlay = drawSelectionOverlay[0];
        return;
      }
      // 単一 { id, fn }
      if (drawSelectionOverlay.fn === callback || drawSelectionOverlay === callback) {
        drawSelectionOverlay = null;
      }
    }

    function invokeSelectionOverlays(ctx) {
      if (!drawSelectionOverlay) return;
      if (typeof drawSelectionOverlay === 'function') {
        drawSelectionOverlay(ctx);
        return;
      }
      if (Array.isArray(drawSelectionOverlay)) {
        for (var i = 0; i < drawSelectionOverlay.length; i++) {
          var entry = drawSelectionOverlay[i];
          if (!entry) continue;
          if (typeof entry === 'function') entry(ctx);
          else if (entry.fn) entry.fn(ctx);
        }
        return;
      }
      // 単一 { id, fn } — length が無いので配列扱いしてはいけない
      if (drawSelectionOverlay.fn) {
        drawSelectionOverlay.fn(ctx);
      }
    }

    var forceRender = false;
    function renderNow() {
      forceRender = true;
      dirty = true;
      scheduleRender();
    }

    function scheduleRender() {
      if (animFrameId) return;
      animFrameId = requestAnimationFrame(function() {
        animFrameId = null;
        render();
      });
    }

    if (ME.Render.Image && ME.Render.Image.setRedrawCallback) {
      ME.Render.Image.setRedrawCallback(setDirty);
    }

    dirty = true;
    scheduleRender();

    return {
      setDirty: setDirty,
      render: render,
      setPageScale: setPageScale,
      renderNow: renderNow,
      setSelectionOverlayCallback: setSelectionOverlayCallback,
      removeSelectionOverlayCallback: removeSelectionOverlayCallback,
      getCanvas: function() { return canvas; },
      getContext: function() { return ctx; }
    };
  }

  window.ME.Render.Engine.create = create;
  window.ME.Render.Engine.BLEED = BLEED;
  window.ME.Render.Engine.getPagePoint = getPagePoint;
  window.ME.Render.Engine.setZoom = setZoom;
  window.ME.Render.Engine.getZoom = getZoom;
})();
