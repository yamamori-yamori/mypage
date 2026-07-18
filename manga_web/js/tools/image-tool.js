// ME.Tools.Image.create(canvas, project, selection, commandStack, renderEngine) — 画像配置＋直接操作ツール
// 「絵を入れる」ステップで、Shift選択モードに入らずに画像を選択・移動・拡縮・回転できる。
//  1) クリック位置に画像がある（コマとの交差＝見える範囲が当たり判定）→ selectOnlyで選択しドラッグ移動。
//     4隅ハンドルで拡縮（transform.scaleX/scaleY）、上部の丸ハンドルで回転。確定時にBatchEditでUndo記録。
//  2) 画像が無くコマがある（コマの空き部分）→ ファイル選択ダイアログで配置/差し替え。
//  3) 何もない場所 → 選択解除。
// 画像を選択すると selection フック経由でプロパティパネルが自動更新される（右パネルが変わらないバグの修正）。
// 配置/差し替え直後は、その画像を選択状態にする。
// onPropertyChange('__replaceImage__') で、選択中の画像を別ファイルへ差し替えるダイアログを開く。
// マウス座標は ME.Render.Engine.getPagePoint() でページ座標へ変換（ズーム/断ち切り余白対応）。

window.ME = window.ME || {};
window.ME.Tools = window.ME.Tools || {};

(function() {
  'use strict';

  var HANDLE_SIZE = 6;
  var HANDLE_HIT = 8;
  var ROTATE_HANDLE_OFFSET = 25;

  function create(canvas, project, selection, commandStack, renderEngine) {
    var fileInput = document.getElementById('image-input');
    if (!fileInput) {
      fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.id = 'image-input';
      fileInput.accept = 'image/png,image/jpeg,image/webp';
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);
    }

    var pendingPanelId = null;

    // ドラッグ状態
    var isDragging = false;
    var dragStartX = 0, dragStartY = 0;

    var moveObjId = null, moveOld = null, moved = false;
    var resizeObjId = null, resizeHandleIdx = -1, resizeOld = null;

    var overlayCallback = function(ctx) { drawHandles(ctx); };

    // 選択画像のハンドル描画を登録（ツール切替時に上書きされる方式）
    renderEngine.setSelectionOverlayCallback(overlayCallback);

    function getMouse(e) {
      return ME.Render.Engine.getPagePoint(canvas, e);
    }

    // 選択中の画像オブジェクト（最初の1つ）を返す
    function selectedImage() {
      var ids = selection.getSelectedIds();
      for (var i = 0; i < ids.length; i++) {
        var o = ME.SceneGraph.getObjectById(project, ids[i]);
        if (o && o.type === 'image') return o;
      }
      return null;
    }

    // コマに属する画像（最初の1つ）を返す
    function imageForPanel(panelId) {
      var images = project.page.images || [];
      for (var i = 0; i < images.length; i++) {
        if (images[i].panelId === panelId) return images[i];
      }
      return null;
    }

    function cornersOf(bb) {
      return [
        { x: bb.x, y: bb.y },
        { x: bb.x + bb.w, y: bb.y },
        { x: bb.x, y: bb.y + bb.h },
        { x: bb.x + bb.w, y: bb.y + bb.h }
      ];
    }

    function findHandleAt(mx, my, obj) {
      var bb = selection.getBoundingBox(obj, project);
      if (!bb || bb.w <= 0) return -1;
      var corners = cornersOf(bb);
      for (var i = 0; i < corners.length; i++) {
        if (Math.abs(mx - corners[i].x) <= HANDLE_HIT && Math.abs(my - corners[i].y) <= HANDLE_HIT) {
          return i;
        }
      }
      return -1;
    }

    function isOnRotateHandle(mx, my, obj) {
      var bb = selection.getBoundingBox(obj, project);
      if (!bb || bb.w <= 0) return false;
      var rotX = bb.x + bb.w / 2;
      var rotY = bb.y - ROTATE_HANDLE_OFFSET;
      var dist = Math.sqrt((mx - rotX) * (mx - rotX) + (my - rotY) * (my - rotY));
      return dist <= HANDLE_HIT + 2;
    }

    function onMouseDown(e) {
      if (e.button !== 0) return;
      var m = getMouse(e);
      var mx = m.x, my = m.y;

      // 1) 選択中画像のハンドル判定を最優先
      var selImg = selectedImage();
      if (selImg && !selImg.locked) {
        var hi = findHandleAt(mx, my, selImg);
        if (hi >= 0) {
          resizeHandleIdx = hi;
          resizeObjId = selImg.id;
          resizeOld = JSON.parse(JSON.stringify(selImg));
          isDragging = true;
          dragStartX = mx; dragStartY = my;
          return;
        }
        if (isOnRotateHandle(mx, my, selImg)) {
          resizeHandleIdx = 4;
          resizeObjId = selImg.id;
          resizeOld = JSON.parse(JSON.stringify(selImg));
          isDragging = true;
          dragStartX = mx; dragStartY = my;
          return;
        }
      }

      // 2) クリック位置に画像がある → 選択して移動
      var hits = selection.hitTest(mx, my, project);
      var hitImgId = null;
      for (var i = 0; i < hits.length; i++) {
        var o = ME.SceneGraph.getObjectById(project, hits[i]);
        if (o && o.type === 'image') { hitImgId = hits[i]; break; }
      }
      if (hitImgId) {
        selection.selectOnly(hitImgId); // フック経由でプロパティパネル更新
        var obj = ME.SceneGraph.getObjectById(project, hitImgId);
        moveObjId = hitImgId;
        moveOld = { transform: JSON.parse(JSON.stringify(obj.transform)) };
        moved = false;
        isDragging = true;
        dragStartX = mx; dragStartY = my;
        renderEngine.setDirty();
        return;
      }

      // 3) コマ内をクリック → 既に絵があるコマなら「その絵を選択して移動」（再読込しない）、
      //    まだ絵が無いコマならファイル選択ダイアログ
      var panels = project.page.panels || [];
      for (var i = panels.length - 1; i >= 0; i--) {
        if (pointInPanel(mx, my, panels[i])) {
          var existing = imageForPanel(panels[i].id);
          if (existing && !existing.locked) {
            // すでに絵のあるコマの余白クリックでは、ファイルを再読込せず画像を選択して移動できるようにする
            selection.selectOnly(existing.id);
            moveObjId = existing.id;
            moveOld = { transform: JSON.parse(JSON.stringify(existing.transform)) };
            moved = false;
            isDragging = true;
            dragStartX = mx; dragStartY = my;
            renderEngine.setDirty();
            return;
          }
          if (!existing) {
            openFileDialog(panels[i].id);
          }
          return;
        }
      }

      // 4) 何もない場所 → 選択解除
      if (selection.getSelectedIds().length > 0) {
        selection.clear();
        renderEngine.setDirty();
      }
    }

    function onMouseMove(e) {
      if (!isDragging) return;
      // ウィンドウ外で mouseup された場合の取りこぼし対策
      if (typeof e.buttons === 'number' && (e.buttons & 1) === 0) {
        onMouseUp(e);
        return;
      }
      var m = getMouse(e);
      var mx = m.x, my = m.y;

      // 移動
      if (moveObjId) {
        var dx = mx - dragStartX;
        var dy = my - dragStartY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
        var obj = ME.SceneGraph.getObjectById(project, moveObjId);
        if (obj) {
          obj.transform.x = moveOld.transform.x + dx;
          obj.transform.y = moveOld.transform.y + dy;
          renderEngine.setDirty();
        }
        return;
      }

      // 拡縮・回転
      if (resizeObjId) {
        var rObj = ME.SceneGraph.getObjectById(project, resizeObjId);
        if (!rObj) return;

        if (resizeHandleIdx === 4) {
          var cx = rObj.transform.x;
          var cy = rObj.transform.y;
          var angle = Math.atan2(my - cy, mx - cx) * 180 / Math.PI + 90;
          rObj.transform.rotation = ((angle % 360) + 360) % 360;
        } else {
          // 端点ドラッグでも縦横比を保つ：中心からの距離比で倍率を決める
          var cx = rObj.transform.x;
          var cy = rObj.transform.y;
          var d0 = Math.sqrt((dragStartX - cx) * (dragStartX - cx) + (dragStartY - cy) * (dragStartY - cy)) || 1;
          var d1 = Math.sqrt((mx - cx) * (mx - cx) + (my - cy) * (my - cy));
          var ns = Math.max(0.1, (resizeOld.transform.scaleX || 1) * (d1 / d0));
          rObj.transform.scaleX = ns;
          rObj.transform.scaleY = ns;
        }
        renderEngine.setDirty();
        return;
      }
    }

    function onMouseUp(e) {
      if (isDragging && moveObjId) {
        if (moved) {
          var obj = ME.SceneGraph.getObjectById(project, moveObjId);
          if (obj) {
            var newState = { transform: JSON.parse(JSON.stringify(obj.transform)) };
            commandStack.push(new ME.Commands.BatchEdit([moveObjId], [moveOld], [newState]));
          }
        } else {
          // 閾値未満の微小ドラッグ: ドラッグ開始時の座標へ書き戻す（位置ズレを残さない）
          var objR = ME.SceneGraph.getObjectById(project, moveObjId);
          if (objR && moveOld && moveOld.transform) {
            objR.transform.x = moveOld.transform.x;
            objR.transform.y = moveOld.transform.y;
            renderEngine.setDirty();
          }
        }
        moveObjId = null;
        moveOld = null;
        moved = false;
      }

      if (isDragging && resizeObjId) {
        var rObj = ME.SceneGraph.getObjectById(project, resizeObjId);
        if (rObj) {
          var newFull = JSON.parse(JSON.stringify(rObj));
          if (JSON.stringify(resizeOld) !== JSON.stringify(newFull)) {
            commandStack.push(new ME.Commands.BatchEdit([resizeObjId], [resizeOld], [newFull]));
          }
        }
        resizeObjId = null;
        resizeHandleIdx = -1;
        resizeOld = null;
      }

      isDragging = false;
    }

    // 「絵を入れる」時に全コマの枠を点灯（ドロップ先が分かるように）
    function drawPanelTargets(ctx) {
      var panels = project.page.panels || [];
      if (panels.length === 0) return;
      var zoom = (ME.Render.Engine && ME.Render.Engine.getZoom) ? ME.Render.Engine.getZoom() : 1;
      if (!zoom || zoom <= 0) zoom = 1;
      ctx.save();
      ctx.strokeStyle = 'rgba(39, 174, 96, 0.9)';
      ctx.lineWidth = 2 / zoom;
      ctx.setLineDash([8 / zoom, 5 / zoom]);
      for (var i = 0; i < panels.length; i++) {
        var v = panels[i].vertices;
        if (!v || v.length < 4 || panels[i].visible === false) continue;
        ctx.beginPath();
        ctx.moveTo(v[0].x, v[0].y);
        for (var j = 1; j < v.length; j++) ctx.lineTo(v[j].x, v[j].y);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // 選択画像のハンドル描画（select-toolと同様の見た目）＋コマ枠の点灯
    function drawHandles(ctx) {
      drawPanelTargets(ctx);
      var obj = selectedImage();
      if (!obj || !obj.visible) return;

      var bb = selection.getBoundingBox(obj, project);
      if (!bb || bb.w <= 0) return;

      ctx.fillStyle = '#27AE60';
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1;

      var corners = cornersOf(bb);
      for (var j = 0; j < corners.length; j++) {
        var h = corners[j];
        ctx.fillRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        ctx.strokeRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      }

      // 回転ハンドル
      var rotX = bb.x + bb.w / 2;
      var rotY = bb.y - ROTATE_HANDLE_OFFSET;
      ctx.beginPath();
      ctx.moveTo(rotX, bb.y);
      ctx.lineTo(rotX, rotY);
      ctx.strokeStyle = '#27AE60';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rotX, rotY, HANDLE_SIZE / 2 + 1, 0, Math.PI * 2);
      ctx.fillStyle = '#27AE60';
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();

      // 破線の枠（緑：絵を入れるモードの選択枠）
      ctx.strokeStyle = '#27AE60';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(bb.x, bb.y, bb.w, bb.h);
      ctx.setLineDash([]);
    }

    // コマの空き部分クリック時: ファイル選択→配置/差し替え
    function openFileDialog(panelId) {
      pendingPanelId = panelId;

      var existingImg = null;
      for (var j = 0; j < project.page.images.length; j++) {
        if (project.page.images[j].panelId === pendingPanelId) {
          existingImg = project.page.images[j];
          break;
        }
      }

      fileInput.onchange = function() {
        if (!fileInput.files || !fileInput.files[0]) return;
        var file = fileInput.files[0];
        var reader = new FileReader();
        reader.onload = function(ev) {
          var base64 = ev.target.result;

          var img = new Image();
          img.onload = function() {
            var assetId = ME.Core.ID.generate();
            project.assets.images[assetId] = {
              mimeType: file.type || 'image/png',
              dataBase64: base64,
              width: img.naturalWidth,
              height: img.naturalHeight
            };

            if (existingImg) {
              var oldState = {
                assetId: existingImg.assetId,
                width: existingImg.width,
                height: existingImg.height,
                transform: JSON.parse(JSON.stringify(existingImg.transform))
              };
              // 差し替えもデフォルトでコマサイズに合わせる
              var fit = panelFitScale(existingImg.panelId, img.naturalWidth, img.naturalHeight);
              existingImg.assetId = assetId;
              existingImg.width = img.naturalWidth;
              existingImg.height = img.naturalHeight;
              existingImg.transform.scaleX = fit;
              existingImg.transform.scaleY = fit;
              var cmd = new ME.Commands.BatchEdit(
                [existingImg.id],
                [oldState],
                [{ assetId: assetId, width: img.naturalWidth, height: img.naturalHeight,
                   transform: JSON.parse(JSON.stringify(existingImg.transform)) }]
              );
              commandStack.push(cmd);
              selection.selectOnly(existingImg.id);
            } else {
              var panels = project.page.panels || [];
              var panel = null;
              for (var i = 0; i < panels.length; i++) {
                if (panels[i].id === pendingPanelId) { panel = panels[i]; break; }
              }
              if (panel) {
                var verts = panel.vertices;
                var cx = (verts[0].x + verts[2].x) / 2;
                var cy = (verts[0].y + verts[2].y) / 2;

                var imgObj = ME.SceneGraph.addImageToPanel(project, pendingPanelId, assetId, { x: cx, y: cy });
                imgObj.width = img.naturalWidth;
                imgObj.height = img.naturalHeight;
                // 拡大率のデフォルト＝読み込むコマのサイズに合わせる（コマ内に収まる倍率）
                var fitNew = panelFitScale(pendingPanelId, img.naturalWidth, img.naturalHeight);
                imgObj.transform.scaleX = fitNew;
                imgObj.transform.scaleY = fitNew;

                commandStack.push(new ME.Commands.AddObject(imgObj));
                selection.selectOnly(imgObj.id);
              }
            }

            renderEngine.setDirty();
          };
          img.src = base64;
        };
        reader.readAsDataURL(file);

        fileInput.value = '';
      };

      fileInput.click();
    }

    // 選択中の画像を別ファイルへ差し替える（コマサイズへ再フィット）
    function openReplaceDialog(imgId) {
      var target = ME.SceneGraph.getObjectById(project, imgId);
      if (!target || target.type !== 'image') return;

      fileInput.onchange = function() {
        if (!fileInput.files || !fileInput.files[0]) return;
        var file = fileInput.files[0];
        var reader = new FileReader();
        reader.onload = function(ev) {
          var base64 = ev.target.result;
          var image = new Image();
          image.onload = function() {
            var assetId = ME.Core.ID.generate();
            project.assets.images[assetId] = {
              mimeType: file.type || 'image/png',
              dataBase64: base64,
              width: image.naturalWidth,
              height: image.naturalHeight
            };
            var oldState = {
              assetId: target.assetId,
              width: target.width,
              height: target.height,
              transform: JSON.parse(JSON.stringify(target.transform))
            };
            var fit = panelFitScale(target.panelId, image.naturalWidth, image.naturalHeight);
            target.assetId = assetId;
            target.width = image.naturalWidth;
            target.height = image.naturalHeight;
            target.transform.scaleX = fit;
            target.transform.scaleY = fit;
            commandStack.push(new ME.Commands.BatchEdit(
              [target.id],
              [oldState],
              [{ assetId: assetId, width: image.naturalWidth, height: image.naturalHeight,
                 transform: JSON.parse(JSON.stringify(target.transform)) }]
            ));
            selection.selectOnly(target.id);
            renderEngine.setDirty();
          };
          image.src = base64;
        };
        reader.readAsDataURL(file);
        fileInput.value = '';
      };
      fileInput.click();
    }

    // property-panelの「画像を差し替える」ボタンからの通知
    function onPropertyChange(objId, prop, value) {
      if (prop === '__replaceImage__') {
        openReplaceDialog(objId);
      }
    }

    // コマにフィットする倍率（画像がコマ内に収まる最大倍率）を返す
    function panelFitScale(panelId, natW, natH) {
      if (!natW || !natH) return 1;
      var panels = project.page.panels || [];
      var panel = null;
      for (var i = 0; i < panels.length; i++) {
        if (panels[i].id === panelId) { panel = panels[i]; break; }
      }
      if (!panel) return 1;
      var verts = panel.vertices;
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var j = 0; j < verts.length; j++) {
        if (verts[j].x < minX) minX = verts[j].x;
        if (verts[j].y < minY) minY = verts[j].y;
        if (verts[j].x > maxX) maxX = verts[j].x;
        if (verts[j].y > maxY) maxY = verts[j].y;
      }
      var pw = maxX - minX;
      var ph = maxY - minY;
      if (pw <= 0 || ph <= 0) return 1;
      var scale = Math.min(pw / natW, ph / natH);
      return scale > 0 ? scale : 1;
    }

    function pointInPanel(px, py, panel) {
      // 簡易: まずAABB、厳密には ray-cast（panel-tool.js の pointInPoly と同アルゴリズム）
      var verts = panel.vertices;
      if (!verts || verts.length < 3) return false;
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (var i = 0; i < verts.length; i++) {
        if (verts[i].x < minX) minX = verts[i].x;
        if (verts[i].y < minY) minY = verts[i].y;
        if (verts[i].x > maxX) maxX = verts[i].x;
        if (verts[i].y > maxY) maxY = verts[i].y;
      }
      if (px < minX || px > maxX || py < minY || py > maxY) return false;
      var inside = false;
      for (var vi = 0, vj = verts.length - 1; vi < verts.length; vj = vi++) {
        var xi = verts[vi].x, yi = verts[vi].y;
        var xj = verts[vj].x, yj = verts[vj].y;
        var intersect = ((yi > py) !== (yj > py)) &&
          (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-9) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return {
      disable: function() {
        renderEngine.removeSelectionOverlayCallback(overlayCallback);
        canvas.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      },
      onPropertyChange: onPropertyChange
    };
  }

  window.ME.Tools.Image = { create: create };
})();
