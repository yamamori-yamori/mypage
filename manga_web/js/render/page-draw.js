// ME.Render.PageDraw.draw(ctx, project, page, opts) — 1ページ描画（PNG/サムネ/印刷共通）
// opts:
//   showDrafts: boolean (default true)
//   showTrimGuides: boolean (default false) — 編集用破線。印刷/PNG は false
//   scale: number — fusion レイヤー合成用（exportScale や zoom）
//   offsetX, offsetY: number — fusion 合成オフセット（編集 BLEED 用。export/print は 0）
//   pageW, pageH: number — ページ座標サイズ（省略時 size mm @ 96dpi）
//   imgMap: { assetId: HTMLImageElement } — 事前ロード画像（export）
//   assetLibrary: project.assets — imgMap が無いとき Image.draw 用
// 描画順: 台紙色 → 台紙画像 → コマ塗り → drafts → 画像/効果/枠 → 吹き出し → テキスト
// （選択 overlay / 画面余白 / memos は含まない。memos は編集キャンバス専用）

window.ME = window.ME || {};
window.ME.Render = window.ME.Render || {};
window.ME.Render.PageDraw = window.ME.Render.PageDraw || {};

(function() {
  'use strict';

  var SCREEN_DPI = 96;

  function pageSizePx(page) {
    var wMm = (page && page.size && page.size.widthMm) || 182;
    var hMm = (page && page.size && page.size.heightMm) || 257;
    return {
      w: Math.round(wMm * SCREEN_DPI / 25.4),
      h: Math.round(hMm * SCREEN_DPI / 25.4)
    };
  }

  function buildClusters(sortedPanels) {
    var clusters = [];
    var groupIndex = {};
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
      var verts = members[i].vertices || [];
      for (var j = 0; j < verts.length; j++) {
        if (verts[j].x < minX) minX = verts[j].x;
        if (verts[j].y < minY) minY = verts[j].y;
        if (verts[j].x > maxX) maxX = verts[j].x;
        if (verts[j].y > maxY) maxY = verts[j].y;
      }
    }
    if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function drawImageObj(ctx, imageObj, imgMap, clipFn, panelId, panels, assetLibrary) {
    if (!imageObj) return;

    // imgMap 優先、なければ Render.Image
    var img = imgMap ? imgMap[imageObj.assetId] : null;
    if (img && img.naturalWidth) {
      ctx.save();
      if (clipFn) clipFn(ctx);
      var t = imageObj.transform || {};
      ctx.translate(t.x, t.y);
      ctx.rotate((t.rotation || 0) * Math.PI / 180);
      ctx.scale(
        (imageObj.flipX ? -1 : 1) * (t.scaleX || 1),
        (imageObj.flipY ? -1 : 1) * (t.scaleY || 1)
      );
      var ca = imageObj.colorAdjust || {};
      var cab = ca.brightness || 0;
      var cac = ca.contrast || 0;
      var cas = ca.saturation || 0;
      var cag = ca.grayscale || 0;
      var cah = ca.hue || 0;
      var parts = [];
      if (cab !== 0) parts.push('brightness(' + Math.max(0, 100 + cab) + '%)');
      if (cac !== 0) parts.push('contrast(' + Math.max(0, 100 + cac) + '%)');
      if (cas !== 0) parts.push('saturate(' + Math.max(0, 100 + cas) + '%)');
      if (cag > 0) parts.push('grayscale(' + cag + '%)');
      if (cah !== 0) parts.push('hue-rotate(' + cah + 'deg)');
      var opacity = ca.opacity !== undefined ? ca.opacity / 100 : 1;
      ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
      if (parts.length > 0) ctx.filter = parts.join(' ');
      var drawW = (imageObj.width && imageObj.width > 0) ? imageObj.width : img.naturalWidth;
      var drawH = (imageObj.height && imageObj.height > 0) ? imageObj.height : img.naturalHeight;
      var toned = (ME.Render.Image && ME.Render.Image.applyTone)
        ? ME.Render.Image.applyTone(img, ca.tone) : img;
      ctx.drawImage(toned, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
      return;
    }

    if (ME.Render.Image && assetLibrary) {
      ctx.save();
      if (clipFn) clipFn(ctx);
      ME.Render.Image.draw(ctx, imageObj, assetLibrary);
      ctx.restore();
    }
  }

  function draw(ctx, project, page, opts) {
    if (!ctx || !page) return;
    opts = opts || {};
    var showDrafts = opts.showDrafts !== false;
    var scale = (opts.scale != null && opts.scale > 0) ? opts.scale : 1;
    var offsetX = opts.offsetX || 0;
    var offsetY = opts.offsetY || 0;
    var imgMap = opts.imgMap || null;
    var assetLibrary = opts.assetLibrary || (project && project.assets) || { images: {} };
    var sz = pageSizePx(page);
    var pageW = opts.pageW || sz.w;
    var pageH = opts.pageH || sz.h;
    var layerOpts = { scale: scale, offsetX: offsetX, offsetY: offsetY };

    // 1. 台紙色
    ctx.fillStyle = page.backgroundColor || '#FFFFFF';
    ctx.fillRect(0, 0, pageW, pageH);

    // 1b. 台紙画像
    if (page.backingImage && page.backingImage.assetId) {
      drawImageObj(ctx, page.backingImage, imgMap, null, null, [], assetLibrary);
    }

    // 2. コマクラスタ
    var panels = (page.panels || []).slice().sort(function(a, b) { return (a.zIndex || 0) - (b.zIndex || 0); });
    var panelIds = {};
    for (var i = 0; i < panels.length; i++) panelIds[panels[i].id] = true;

    var clusters = buildClusters(panels);
    var clusterOfPanel = {};
    for (var i = 0; i < clusters.length; i++) {
      for (var j = 0; j < clusters[i].members.length; j++) {
        clusterOfPanel[clusters[i].members[j].id] = clusters[i];
      }
    }

    // panel.clipPath が truthy の場合のみクリップ関数を返す（render-engine.js と同じ判定に統一）
    function clipFnFor(panelId) {
      var pnl = null;
      for (var k = 0; k < panels.length; k++) {
        if (panels[k].id === panelId) { pnl = panels[k]; break; }
      }
      if (!pnl || !pnl.clipPath) return null;
      var cluster = clusterOfPanel[panelId];
      return function(c) {
        if (cluster && cluster.members.length > 1) {
          ME.Render.Panel.createClipPathMulti(c, cluster.members);
        } else {
          ME.Render.Panel.createClipPath(c, pnl);
        }
      };
    }

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

    // 3. コマ塗り
    var visibleClusters = [];
    for (var ci = 0; ci < clusters.length; ci++) {
      var members = clusters[ci].members;
      var visibleMembers = [];
      for (var i = 0; i < members.length; i++) {
        if (members[i].visible !== false) visibleMembers.push(members[i]);
      }
      if (visibleMembers.length === 0) continue;
      visibleClusters.push(visibleMembers);
      if (ME.Render.Panel && ME.Render.Panel.drawFillUnion) {
        ME.Render.Panel.drawFillUnion(ctx, visibleMembers, layerOpts);
      }
    }

    // 4. 下書き
    if (showDrafts && ME.Render.Draft) {
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
          if (dgroup[0].panelId && panelIds[dgroup[0].panelId]) {
            dClip = clipFnFor(dgroup[0].panelId);
          }
          ME.Render.Draft.drawGroup(ctx, dgroup, {
            scale: scale, offsetX: offsetX, offsetY: offsetY, clipFn: dClip
          });
        } else {
          var sClip = null;
          if (dr.panelId && panelIds[dr.panelId]) {
            sClip = clipFnFor(dr.panelId);
          }
          ME.Render.Draft.draw(ctx, dr, { clipFn: sClip });
        }
      }
    }

    // 5. 画像・効果・枠
    for (var ci = 0; ci < visibleClusters.length; ci++) {
      var vis = visibleClusters[ci];
      for (var i = 0; i < vis.length; i++) {
        var pImages = imagesByPanel[vis[i].id] || [];
        for (var j = 0; j < pImages.length; j++) {
          drawImageObj(ctx, pImages[j], imgMap, clipFnFor(vis[i].id), pImages[j].panelId, panels, assetLibrary);
        }
      }
      var clusterB = clusterBounds(vis);
      for (var i = 0; i < vis.length; i++) {
        var em = vis[i];
        var pEffects = effectsByPanel[em.id] || [];
        if (pEffects.length === 0) continue;
        var eClip = clipFnFor(em.id); // clipPath が truthy のコマのみクリップ
        for (var j = 0; j < pEffects.length; j++) {
          ctx.save();
          if (eClip) eClip(ctx);
          if (ME.Render.Effect) ME.Render.Effect.draw(ctx, pEffects[j], clusterB);
          ctx.restore();
        }
      }
      if (ME.Render.Panel && ME.Render.Panel.drawBorderUnion) {
        ME.Render.Panel.drawBorderUnion(ctx, vis, layerOpts);
      }
    }

    for (var i = 0; i < orphanImages.length; i++) {
      drawImageObj(ctx, orphanImages[i], imgMap, null, null, panels, assetLibrary);
    }

    for (var i = 0; i < pageEffects.length; i++) {
      if (ME.Render.Effect) ME.Render.Effect.draw(ctx, pageEffects[i], null);
    }

    // 6. balloons
    var balloons = (page.balloons || []).slice().sort(function(a, b) { return (a.zIndex || 0) - (b.zIndex || 0); });
    var drawnGroups = {};
    for (var i = 0; i < balloons.length; i++) {
      var b = balloons[i];
      if (b.visible === false) continue;
      var group = [b];
      if (b.fusionGroup) {
        if (drawnGroups[b.fusionGroup]) continue;
        drawnGroups[b.fusionGroup] = true;
        group = [];
        for (var j = 0; j < balloons.length; j++) {
          if (balloons[j].fusionGroup === b.fusionGroup && balloons[j].visible !== false) {
            group.push(balloons[j]);
          }
        }
      }
      var clipFn = null;
      if (group[0].panelId && panelIds[group[0].panelId]) {
        clipFn = clipFnFor(group[0].panelId);
      }
      if (ME.Render.Balloon && ME.Render.Balloon.drawGroup) {
        ME.Render.Balloon.drawGroup(ctx, group, {
          scale: scale, offsetX: offsetX, offsetY: offsetY, clipFn: clipFn
        });
      }
    }

    // 7. texts
    var texts = (page.texts || []).slice().sort(function(a, b) { return (a.zIndex || 0) - (b.zIndex || 0); });
    for (var i = 0; i < texts.length; i++) {
      if (ME.Render.Text) ME.Render.Text.draw(ctx, texts[i]);
    }

    // 8. 旧 strings（互換）
    if (page.strings && page.strings.length && ME.Render.String) {
      for (var i = 0; i < page.strings.length; i++) {
        if (page.strings[i] && page.strings[i].visible !== false) {
          ME.Render.String.draw(ctx, page.strings[i]);
        }
      }
    }

    // showTrimGuides: 現状 no-op（編集エンジン側の破線に任せる）
    if (opts.showTrimGuides) {
      // reserved
    }
  }

  window.ME.Render.PageDraw.draw = draw;
  window.ME.Render.PageDraw.pageSizePx = pageSizePx;
  window.ME.Render.PageDraw.SCREEN_DPI = SCREEN_DPI;
})();
