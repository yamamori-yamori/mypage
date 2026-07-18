// ME.Tools.Text.create(canvas, project, selection, commandStack, renderEngine) — テキスト入力ツール
// クリック → contenteditableオーバーレイでインライン編集
// Enterで確定（IME変換中は無視） / Shift+Enterで改行 / Escで取消
// マウス座標はME.Render.Engine.getPagePoint()で変換。
// ME.Tools.Text.setOnCommitCallback(fn(objId)) — 確定できたセリフのidを通知(mainが選択モードへ)
// 横書き: transform=左上 / 縦書き: transform=先頭列の上端
// 縦横切替などプロパティ操作中は blur で閉じない

window.ME = window.ME || {};
window.ME.Tools = window.ME.Tools || {};

(function() {
  'use strict';

  var EDITOR_ZINDEX = 1000;

  // セリフ確定時の通知（main.jsが選択モードへ切り替えるために登録）
  var onCommit = null;
  function setOnCommitCallback(cb) { onCommit = cb; }

  // 直前に入力したセリフのスタイル（フォント/文字方向/袋文字）を次のセリフに引き継ぐ
  var lastTextStyle = null;

  function create(canvas, project, selection, commandStack, renderEngine) {
    var pendingTextObj = null;
    var editorOverlay = null;
    // プロパティ操作中は blur→commit を抑止
    var suppressBlurCommit = false;
    // 既存セリフのドラッグ移動用
    var moveTextId = null, moveOld = null, moved = false, isMoving = false;
    var dragStartX = 0, dragStartY = 0;

    function currentZoom() {
      return (ME.Render.Engine && ME.Render.Engine.getZoom) ? ME.Render.Engine.getZoom() : 1;
    }

    function onMouseDown(e) {
      if (e.button !== 0) return;
      var m = ME.Render.Engine.getPagePoint(canvas, e);
      // 編集中ならクリックで解除（キャンセル）して入力モードも終了。新規入力はしない（要望）
      if (editorOverlay) {
        cancelEditor();
        return;
      }
      // クリック位置に既存のセリフがあれば、回転付セレクトへ移行（青枠＋回転ハンドルを表示）
      // 選択済み再クリック時は移動開始（select-tool側で処理）
      var hitText = textAt(m.x, m.y);
      if (hitText) {
        if (ME.enterSelectModeForObject) {
          ME.enterSelectModeForObject(hitText.id);
        } else {
          selection.clear();
          selection.toggle(hitText.id);
        }
        renderEngine.setDirty();
        return;
      }
      // セリフ以外（吹き出し／コマ／空白）をクリック → その場でセリフ入力（連続で置ける）
      startTextAt(m);
    }

    // クリック位置にある最前面のセリフを返す
    function textAt(mx, my) {
      var hits = selection.hitTest(mx, my, project);
      for (var i = 0; i < hits.length; i++) {
        var o = ME.SceneGraph.getObjectById(project, hits[i]);
        if (o && o.type === 'text') return o;
      }
      return null;
    }

    // 指定ページ座標でセリフ入力を開始（吹き出しクリックからの呼び出しにも使用）
    function startTextAt(pt) {
      if (editorOverlay) {
        commitEditor();
      }
      var textObj = ME.SceneGraph.addText(project, '', { x: pt.x, y: pt.y });
      // 直前に入力したセリフのプロパティ（フォント・文字方向・袋文字）を引き継ぐ
      if (lastTextStyle) {
        if (lastTextStyle.font) textObj.font = JSON.parse(JSON.stringify(lastTextStyle.font));
        if (lastTextStyle.writingMode) textObj.writingMode = lastTextStyle.writingMode;
        if (lastTextStyle.outline) textObj.outline = JSON.parse(JSON.stringify(lastTextStyle.outline));
      }
      selection.clear();
      selection.toggle(textObj.id);
      pendingTextObj = textObj;
      showEditorOverlay(canvas, textObj);
    }

    // 位置・サイズ・writingMode を既存オーバーレイに適用（破棄しない）
    function applyEditorLayout(textObj) {
      if (!editorOverlay || !textObj) return;
      var rect = canvas.getBoundingClientRect();
      var BLEED = ME.Render.Engine.BLEED || 0;
      var zoom = currentZoom();
      var baseFont = (textObj.font && textObj.font.size) || 16;
      var isVertical = (textObj.writingMode === 'vertical');
      var screenX = rect.left + (BLEED + textObj.transform.x) * zoom;
      var screenY = rect.top + (BLEED + textObj.transform.y) * zoom;

      if (isVertical) {
        var colW = Math.max(baseFont * zoom * 1.4, 20);
        editorOverlay.style.left = (screenX - colW / 2) + 'px';
        editorOverlay.style.top = screenY + 'px';
        editorOverlay.style.width = colW + 'px';
        editorOverlay.style.minHeight = '60px';
      } else {
        editorOverlay.style.left = screenX + 'px';
        editorOverlay.style.top = screenY + 'px';
        editorOverlay.style.width = '200px';
        editorOverlay.style.minHeight = '30px';
      }
      editorOverlay.style.fontSize = (baseFont * zoom) + 'px';
      editorOverlay.style.fontFamily = (textObj.font && textObj.font.family) || 'sans-serif';
      editorOverlay.style.fontWeight = (textObj.font && textObj.font.bold) ? 'bold' : 'normal';
      editorOverlay.style.writingMode = isVertical ? 'vertical-rl' : 'horizontal-tb';
    }

    function showEditorOverlay(canvas, textObj) {
      hideEditorOverlay();

      editorOverlay = document.createElement('div');
      editorOverlay.contentEditable = true;
      editorOverlay.style.position = 'absolute';
      editorOverlay.style.padding = '0';
      editorOverlay.style.margin = '0';
      editorOverlay.style.background = '#1e1e1e';
      editorOverlay.style.color = '#ffffff';
      editorOverlay.style.border = '2px solid #4A90D9';
      editorOverlay.style.borderRadius = '4px';
      editorOverlay.style.outline = 'none';
      editorOverlay.style.overflow = 'hidden';
      editorOverlay.style.whiteSpace = 'pre-wrap';
      editorOverlay.style.wordBreak = 'break-all';
      editorOverlay.style.boxSizing = 'border-box';
      editorOverlay.style.zIndex = EDITOR_ZINDEX;
      editorOverlay.style.textAlign = 'left';

      applyEditorLayout(textObj);

      // 入力のたびに内容を反映（innerTextで改行を保持）
      editorOverlay.addEventListener('input', function() {
        if (pendingTextObj) {
          pendingTextObj.content = getOverlayText();
          renderEngine.setDirty();
        }
      });

      // Enterで確定（IME変換中は無視）、Shift+Enterで改行、Escで取消
      editorOverlay.addEventListener('keydown', function(e) {
        // 日本語変換確定の Enter は isComposing / keyCode 229
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commitEditor();
        } else if (e.key === 'Escape') {
          cancelEditor();
        }
      });

      editorOverlay.addEventListener('blur', function() {
        // プロパティ操作などで一時的にフォーカスが外れただけなら閉じない
        setTimeout(function() {
          if (suppressBlurCommit) return;
          if (!pendingTextObj || !editorOverlay) return;
          if (!document.body.contains(editorOverlay)) return;
          var ae = document.activeElement;
          // 右パネル操作中
          if (ae && ae.closest && ae.closest('#property-panel, #step-panel, #side-panel')) {
            return;
          }
          // オーバーレイ自身へ戻った（縦横切替などで再focus）
          if (ae === editorOverlay || (editorOverlay.contains && editorOverlay.contains(ae))) {
            return;
          }
          commitEditor();
        }, 150);
      });

      document.body.appendChild(editorOverlay);

      setTimeout(function() {
        if (editorOverlay) editorOverlay.focus();
      }, 0);
    }

    // 改行を保持してテキスト取得（innerTextが使えない環境はtextContentにフォールバック）
    function getOverlayText() {
      if (!editorOverlay) return '';
      if (editorOverlay.innerText !== undefined) {
        // innerTextは末尾に余計な改行が付くことがあるため除去
        return editorOverlay.innerText.replace(/\n+$/, '');
      }
      return editorOverlay.textContent || '';
    }

    function hideEditorOverlay() {
      if (editorOverlay && editorOverlay.parentNode) {
        editorOverlay.parentNode.removeChild(editorOverlay);
      }
      editorOverlay = null;
    }

    function commitEditor() {
      if (!pendingTextObj || !editorOverlay) return;

      var content = getOverlayText().replace(/^\s+|\s+$/g, '');
      if (content === '') {
        ME.SceneGraph.removeObject(ME.SceneGraph.getProject(), pendingTextObj.id);
        selection.clear();
      } else {
        pendingTextObj.content = content;
        commandStack.push(new ME.Commands.AddObject(pendingTextObj));
        // このセリフのスタイルを記憶し、次に入力するセリフへ引き継ぐ
        lastTextStyle = {
          font: JSON.parse(JSON.stringify(pendingTextObj.font)),
          writingMode: pendingTextObj.writingMode,
          outline: JSON.parse(JSON.stringify(pendingTextObj.outline))
        };
      }
      renderEngine.setDirty();

      var committedId = (content === '') ? null : pendingTextObj.id;
      hideEditorOverlay();
      pendingTextObj = null;

      // 確定できたテキストは選択状態のままにする
      if (committedId && onCommit) onCommit(committedId);
    }

    function cancelEditor() {
      if (!pendingTextObj) return;

      ME.SceneGraph.removeObject(ME.SceneGraph.getProject(), pendingTextObj.id);
      selection.clear();
      renderEngine.setDirty();

      hideEditorOverlay();
      pendingTextObj = null;
    }

    function onPropertyChange(objId, prop, value) {
      if (!pendingTextObj || objId !== pendingTextObj.id) return;
      var zoom = currentZoom();
      // プロパティ操作中は blur で空確定しない
      suppressBlurCommit = true;
      setTimeout(function() { suppressBlurCommit = false; }, 300);

      if (prop === 'content') {
        pendingTextObj.content = value;
        renderEngine.setDirty();
      } else if (prop === 'writingMode') {
        pendingTextObj.writingMode = value;
        if (editorOverlay) {
          // 破棄せずレイアウトだけ更新（空テキストでも入力枠が消えない）
          applyEditorLayout(pendingTextObj);
          setTimeout(function() {
            if (editorOverlay) editorOverlay.focus();
          }, 0);
        }
        renderEngine.setDirty();
      } else if (prop === 'font.family') {
        var fv = value == null ? 'sans-serif' : String(value).trim();
        pendingTextObj.font.family = fv;
        if (editorOverlay) {
          // CSS もスタックのまま渡せる
          editorOverlay.style.fontFamily = fv;
        }
      } else if (prop === 'font.size') {
        pendingTextObj.font.size = parseInt(value, 10) || pendingTextObj.font.size;
        if (editorOverlay) {
          editorOverlay.style.fontSize = (pendingTextObj.font.size * zoom) + 'px';
          applyEditorLayout(pendingTextObj);
        }
      } else if (prop === 'font.bold') {
        pendingTextObj.font.bold = !!value;
        if (editorOverlay) editorOverlay.style.fontWeight = value ? 'bold' : 'normal';
      } else if (prop === 'font.strikethrough') {
        pendingTextObj.font.strikethrough = !!value;
        if (editorOverlay) editorOverlay.style.textDecoration = value ? 'line-through' : 'none';
      } else if (prop === 'font.ruby') {
        pendingTextObj.font.ruby = !!value;
        // 傍点はCSSでは再現困難なので、プレビューでは太字と同様に視覚フィードバックなし
      } else if (prop === 'font.color') {
        pendingTextObj.font.color = value;
        if (editorOverlay) editorOverlay.style.color = value;
      }
    }

    function onMouseMove(e) {
      if (!isMoving || !moveTextId) return;
      var m = ME.Render.Engine.getPagePoint(canvas, e);
      var dx = m.x - dragStartX, dy = m.y - dragStartY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
      var o = ME.SceneGraph.getObjectById(project, moveTextId);
      if (o) {
        o.transform.x = moveOld.transform.x + dx;
        o.transform.y = moveOld.transform.y + dy;
        renderEngine.setDirty();
      }
    }

    function onMouseUp(e) {
      if (isMoving && moveTextId) {
        var o = ME.SceneGraph.getObjectById(project, moveTextId);
        if (o && moved) {
          commandStack.push(new ME.Commands.BatchEdit(
            [moveTextId], [moveOld],
            [{ transform: JSON.parse(JSON.stringify(o.transform)) }]
          ));
        }
        moveTextId = null;
        moveOld = null;
        moved = false;
        isMoving = false;
        renderEngine.setDirty();
      }
    }

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return {
      disable: function() {
        canvas.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        // 未入力の pendingTextObj を削除（ツール切替時に空オブジェクトが残らないよう）
        if (pendingTextObj) {
          ME.SceneGraph.removeObject(ME.SceneGraph.getProject(), pendingTextObj.id);
          selection.clear();
          pendingTextObj = null;
        }
        hideEditorOverlay();
      },
      onPropertyChange: onPropertyChange,
      beginTextAt: function(x, y) { startTextAt({ x: x, y: y }); }
    };
  }

  window.ME.Tools.Text = { create: create, setOnCommitCallback: setOnCommitCallback };
})();
