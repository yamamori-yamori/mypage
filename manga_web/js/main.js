// main.js — 初期化・イベント配線
// ステップUI + Shift選択モード（選択維持）+ 断ち切り余白 + 表示倍率
// 座標系: 編集中は96dpiページ座標。PNG出力時にpage.size.dpiへ拡大（余白・ズームは出力されない）。
//
// 選択モードの維持仕様（r5）:
//   ・Shift押下で選択モードに入る。
//   ・何かを選択している間は、Shiftを離しても選択モードを維持（移動・拡縮・回転・プロパティ編集を継続）。
//   ・選択が空になり、かつShiftも押されていなければ、元のステップのツールへ自動復帰。
//   ・ステップボタンを手動クリックした場合は無条件で通常モードへ。
//
// 表示倍率（r5）:
//   ・#file-actions先頭のセレクト（25〜800%）で currentZoom を変更。
//   ・resizeCanvasToPage で canvas を (ページpx + 余白×2) × currentZoom にする。
//   ・ME.Render.Engine.setZoom(currentZoom) で描画/座標変換に反映。

(function() {
  'use strict';

  var MM_PER_INCH = 25.4;
  var SCREEN_DPI = 96;

  var project = null;
  var commandStack = null;
  var selection = null;
  var clipboardManager = null;
  var renderEngine = null;
  var tools = {};
  var activeToolName = null;
  var currentStep = 'paper';
  var currentEffectKind = 'concentration';
  var currentDraftKind = 'circle';
  // サムネ「ページを追加」時: blank | backing | copy（セッション内保持）
  var pageInsertMode = 'blank';

  // --- 選択モード維持 ---
  var selectModeActive = false; // 現在、選択モードに切り替わっているか
  var selectPrevTool = null;    // 復帰先のツール名
  var shiftHeld = false;        // Shiftキー押下中か

  var isMouseDown = false;

  // --- 表示倍率 ---
  var currentZoom = 1;

  // --- 表示のパン（Alt+ドラッグ） ---
  var isPanning = false;
  var panStartX = 0, panStartY = 0, panScrollLeft = 0, panScrollTop = 0;

  var STEP_TOOL = {
    paper: 'select',
    panel: 'panel',
    image: 'image',
    balloon: 'balloon',
    text: 'text',
    effect: 'effect',
    draft: 'draft',
    memo: 'memo'
  };

  function init() {
    project = ME.SceneGraph.createProject('無題の作品');
    commandStack = ME.CommandStack.create();
    selection = ME.Selection.create();
    clipboardManager = ME.Clipboard.create();
    ME.currentStep = currentStep;

    wrapSelectionForAutoUpdate();

    var canvas = document.getElementById('main-canvas');
    if (!canvas) return;

    if (ME.Render.Engine.setZoom) ME.Render.Engine.setZoom(currentZoom);
    resizeCanvasToPage(canvas);
    renderEngine = ME.Render.Engine.create(canvas, project);

    var stepNavEl = document.getElementById('step-nav');
    var fileActionsEl = document.getElementById('file-actions');
    if (stepNavEl) {
      ME.UI.Toolbar.create(stepNavEl, fileActionsEl);
      ME.UI.Toolbar.setOnStepChangeCallback(function(stepId) {
        onStepChange(stepId);
      });
      ME.UI.Toolbar.setOnActionCallback(function(actionId) {
        handleAction(actionId);
      });
      if (ME.UI.Toolbar.setOnZoomChangeCallback) {
        ME.UI.Toolbar.setOnZoomChangeCallback(function(zoomPercent) {
          onZoomChange(zoomPercent);
        });
      }
      // 横幅・全体フィットボタン
      if (ME.UI.Toolbar.setOnFitWidthCallback) {
        ME.UI.Toolbar.setOnFitWidthCallback(fitToWidth);
      }
      if (ME.UI.Toolbar.setOnFitAllCallback) {
        ME.UI.Toolbar.setOnFitAllCallback(fitToAll);
      }
    }

    setupPageNav();

    var stepPanelEl = document.getElementById('step-panel');
    if (stepPanelEl && ME.UI.StepPanel) {
      ME.UI.StepPanel.create(stepPanelEl);
    }

    var propPanel = document.getElementById('property-panel');
    if (propPanel) {
      ME.UI.PropertyPanel.create(propPanel);
      ME.UI.PropertyPanel.setOnPropertyChangeCallback(function(objId, prop, value) {
        handlePropertyChange(objId, prop, value);
      });
    }

    // セリフをEnterで確定したら select-tool へ寄せる（青枠・ハンドルは select の overlay のみ）。
    // selectModeActive なので選択を外すと evaluateSelectMode で「セリフ」ツールへ復帰し、続けて置ける。
    // 確定したセリフは選択状態を維持（右パネルで調整可能）。
    if (ME.Tools.Text && ME.Tools.Text.setOnCommitCallback) {
      ME.Tools.Text.setOnCommitCallback(function(objId) {
        enterSelectModeForObject(objId);
      });
    }

    // コマ（絵を置く前）をクリック → 「絵を入れる」ステップへ移る
    if (ME.Tools.Panel) {
      ME.Tools.Panel.onEmptyPanelClick = function(panelId) {
        switchStep('image');
      };
    }
    // 吹き出しの中を（選択済みの状態で）クリック → 「セリフ」ステップへ移り、その場で入力開始
    if (ME.Tools.Balloon) {
      ME.Tools.Balloon.onBalloonTextRequest = function(balloon) {
        switchStep('text');
        if (tools.text && tools.text.beginTextAt && balloon && balloon.transform) {
          tools.text.beginTextAt(balloon.transform.x, balloon.transform.y);
        }
      };
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('paste', onDocumentPaste);
    document.addEventListener('mousedown', function() { isMouseDown = true; }, true);
    // 注意: capture で isMouseDown=false にすると、document bubble の evaluateSelectMode が
    // ツールの window mouseup（ラバーバンド確定）より先に走り、select ツールが破棄される。
    // ツール処理の後にまとめて復帰判定する。
    document.addEventListener('mouseup', function() {
      setTimeout(function() {
        isMouseDown = false;
        evaluateSelectMode();
      }, 0);
    });

    setupCanvasNavigation(document.getElementById('canvas-container'));
    setupDragAndDrop(document.getElementById('canvas-container'));

    ME.UI.Toolbar.setActiveStep('paper');

    renderEngine.setDirty();
    centerView();
    // ローディング画面を消す
    var loadingEl = document.getElementById('me-loading');
    if (loadingEl) loadingEl.remove();
  }

  // ページサイズ(mm) + 断ち切り余白 + 表示倍率 でキャンバスサイズを決める
  function getCurrentPage() {
    if (!project) return null;
    if (ME.PageManager && typeof ME.PageManager.getCurrentPage === 'function') {
      return ME.PageManager.getCurrentPage(project);
    }
    if (ME.SceneGraph && typeof ME.SceneGraph.getActivePage === 'function') {
      return ME.SceneGraph.getActivePage(project);
    }
    return project.page || null;
  }

  function resizeCanvasToPage(canvas) {
    var bleed = (ME.Render.Engine && ME.Render.Engine.BLEED) || 0;
    var page = getCurrentPage();
    if (!page || !page.size) return;
    var pagePxW = Math.round(page.size.widthMm * SCREEN_DPI / MM_PER_INCH);
    var pagePxH = Math.round(page.size.heightMm * SCREEN_DPI / MM_PER_INCH);
    canvas.width = Math.round((pagePxW + bleed * 2) * currentZoom);
    canvas.height = Math.round((pagePxH + bleed * 2) * currentZoom);
  }

  // 用紙のページ座標pxサイズ
  function pagePxSize() {
    var page = getCurrentPage();
    return {
      w: Math.round(page.size.widthMm * SCREEN_DPI / MM_PER_INCH),
      h: Math.round(page.size.heightMm * SCREEN_DPI / MM_PER_INCH)
    };
  }

  // ページ切替（Task4）。選択クリア・ステップ/ツール維持・Undo は共有のまま
  function switchToPageIndex(index) {
    if (!project || !ME.PageManager) return;
    // 1. 未確定 UI（可能なら）
    try {
      if (tools.text && typeof tools.text.cancelEdit === 'function') tools.text.cancelEdit();
    } catch (e1) {}
    try {
      if (tools.draft && typeof tools.draft.hideInputDialog === 'function') tools.draft.hideInputDialog();
      else if (tools.draft && typeof tools.draft.cancelInput === 'function') tools.draft.cancelInput();
    } catch (e2) {}
    // 2. 選択クリア
    if (selection) selection.clear();
    // 3. インデックス
    ME.PageManager.setCurrentIndex(project, index);
    // 4. キャンバスサイズ
    var canvas = document.getElementById('main-canvas');
    if (canvas) resizeCanvasToPage(canvas);
    // 5. 描画
    if (renderEngine) renderEngine.setDirty();
    // 6. パネル
    try { updatePropertyPanel(); } catch (e3) {}
    try { renderStepPanel(); } catch (e4) {}
    // 7. page-nav は Task5 後
    if (ME.UI && ME.UI.PageNav && typeof ME.UI.PageNav.refresh === 'function') {
      ME.UI.PageNav.refresh();
    }
  }

  // デバッグ / 後続 UI 用
  ME.switchToPageIndex = switchToPageIndex;
  ME.getCurrentPage = getCurrentPage;

  function refreshPageChrome() {
    var canvas = document.getElementById('main-canvas');
    if (canvas) resizeCanvasToPage(canvas);
    if (renderEngine) renderEngine.setDirty();
    try { updatePropertyPanel(); } catch (e) {}
    try { renderStepPanel(); } catch (e2) {}
    if (ME.UI && ME.UI.PageNav && ME.UI.PageNav.refresh) ME.UI.PageNav.refresh();
    if (ME.UI && ME.UI.PageThumbnailPanel && ME.UI.PageThumbnailPanel.isOpen &&
        ME.UI.PageThumbnailPanel.isOpen() && ME.UI.PageThumbnailPanel.refresh) {
      ME.UI.PageThumbnailPanel.refresh();
    }
  }

  function addPageWithUndo(mode) {
    if (!project || !ME.PageManager) return;
    mode = mode || pageInsertMode || 'blank';
    if (mode !== 'blank' && mode !== 'backing' && mode !== 'copy') mode = 'blank';
    pageInsertMode = mode;
    var prev = ME.PageManager.getCurrentIndex(project);
    var page = ME.PageManager.addEmptyPage(project, {
      mode: mode,
      fromIndex: prev
    });
    if (!page) {
      alert('ページ数の上限（' + ME.PageManager.MAX_PAGES + '）に達しています');
      return;
    }
    var idx = ME.PageManager.getCurrentIndex(project);
    if (commandStack && ME.Commands.AddPage) {
      commandStack.push(new ME.Commands.AddPage(
        JSON.parse(JSON.stringify(page)),
        idx,
        prev
      ));
    }
    if (selection) selection.clear();
    refreshPageChrome();
  }

  function doRemovePageAt(idx) {
    if (!project || !ME.PageManager) return;
    var page = project.pages[idx];
    if (!page) return;
    var snap = JSON.parse(JSON.stringify(page));
    var wasCurrent = ME.PageManager.getCurrentIndex(project);
    var ok = ME.PageManager.removePageAt(project, idx);
    if (!ok) return;
    if (commandStack && ME.Commands.RemovePage) {
      commandStack.push(new ME.Commands.RemovePage(snap, idx, wasCurrent));
    }
    if (selection) selection.clear();
    refreshPageChrome();
  }

  function setupPageNav() {
    var el = document.getElementById('page-nav');
    if (!el || !ME.UI || !ME.UI.PageNav) return;
    ME.UI.PageNav.create(el, {
      getState: function() {
        if (!project || !ME.PageManager) return { index: 0, count: 1 };
        return {
          index: ME.PageManager.getCurrentIndex(project),
          count: ME.PageManager.pageCount(project)
        };
      },
      onPrev: function() {
        if (!project || !ME.PageManager) return;
        var i = ME.PageManager.getCurrentIndex(project);
        if (i > 0) switchToPageIndex(i - 1);
      },
      onNext: function() {
        if (!project || !ME.PageManager) return;
        var i = ME.PageManager.getCurrentIndex(project);
        var n = ME.PageManager.pageCount(project);
        if (i < n - 1) switchToPageIndex(i + 1);
      },
      onOpenThumbnails: function() {
        openPageThumbnailPanel();
      }
    });
  }

  function openPageThumbnailPanel() {
    if (!ME.UI || !ME.UI.PageThumbnailPanel) {
      alert('ページ一覧を読み込めませんでした');
      return;
    }
    ME.UI.PageThumbnailPanel.open({
      getState: function() {
        if (!project || !ME.PageManager) return { pages: [], currentIndex: 0, count: 0 };
        ME.PageManager.ensurePagesShape(project);
        var pages = [];
        for (var i = 0; i < project.pages.length; i++) {
          pages.push({ id: project.pages[i].id, label: 'P' + (i + 1) });
        }
        return {
          pages: pages,
          currentIndex: ME.PageManager.getCurrentIndex(project),
          count: pages.length
        };
      },
      onSelect: function(index) {
        switchToPageIndex(index);
      },
      getInsertMode: function() {
        return pageInsertMode || 'blank';
      },
      onInsertModeChange: function(mode) {
        if (mode === 'blank' || mode === 'backing' || mode === 'copy') {
          pageInsertMode = mode;
        }
      },
      onAdd: function(mode) {
        addPageWithUndo(mode);
        if (ME.UI.PageThumbnailPanel.refresh) ME.UI.PageThumbnailPanel.refresh();
      },
      onRemove: function(index) {
        if (!project || !ME.PageManager) return;
        if (ME.PageManager.pageCount(project) <= 1) return;
        var n = (index | 0) + 1;
        function go() {
          doRemovePageAt(index | 0);
          if (ME.UI.PageThumbnailPanel.refresh) ME.UI.PageThumbnailPanel.refresh();
          if (ME.PageManager.pageCount(project) <= 0) {
            if (ME.UI.PageThumbnailPanel.close) ME.UI.PageThumbnailPanel.close();
          }
        }
        if (ME.UI.ConfirmDialog) {
          ME.UI.ConfirmDialog.show({
            title: 'ページの削除',
            message: 'ページ ' + n + ' を削除しますか？',
            okLabel: '削除',
            cancelLabel: 'キャンセル',
            danger: true,
            onOK: go
          });
        } else {
          go();
        }
      },
      onReorder: function(from, to) {
        if (!project || !ME.PageManager) return;
        var oldCur = ME.PageManager.getCurrentIndex(project);
        ME.PageManager.reorderPages(project, from, to);
        if (commandStack && ME.Commands.ReorderPages) {
          commandStack.push(new ME.Commands.ReorderPages(from, to, oldCur));
        }
        refreshPageChrome();
      },
      onClearAllDrafts: function() {
        clearAllPagesDraftsWithConfirm();
      },
      onClearAllMemos: function() {
        clearAllPagesMemosWithConfirm();
      },
      renderThumb: function(canvas, index) {
        if (!project || !project.pages || !project.pages[index]) return;
        var page = project.pages[index];
        var ctx = canvas.getContext('2d');
        if (!ctx || !ME.Render || !ME.Render.PageDraw) return;
        var sz = ME.Render.PageDraw.pageSizePx(page);
        var scale = Math.min(canvas.width / sz.w, canvas.height / sz.h);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#888';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        var dw = sz.w * scale;
        var dh = sz.h * scale;
        var ox = (canvas.width - dw) / 2;
        var oy = (canvas.height - dh) / 2;
        ctx.save();
        ctx.translate(ox, oy);
        ctx.scale(scale, scale);
        ME.Render.PageDraw.draw(ctx, project, page, {
          showDrafts: true,
          showTrimGuides: false,
          scale: scale,
          offsetX: 0,
          offsetY: 0,
          pageW: sz.w,
          pageH: sz.h,
          assetLibrary: project.assets
        });
        ctx.restore();
      }
    });
  }

  function isTextInputFocused() {
    var ae = document.activeElement;
    if (!ae) return false;
    var tag = (ae.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (ae.isContentEditable) return true;
    return false;
  }

  function clampNum(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // 用紙を表示領域の中央に来るようスクロール
  function centerView() {
    var canvas = document.getElementById('main-canvas');
    var container = document.getElementById('canvas-container');
    if (!canvas || !container) return;
    var BLEED = (ME.Render.Engine && ME.Render.Engine.BLEED) || 0;
    var pg = pagePxSize();
    var rb = canvas.getBoundingClientRect();
    var cr = container.getBoundingClientRect();
    var pageCenterX = rb.left + (pg.w / 2 + BLEED) * currentZoom;
    var pageCenterY = rb.top + (pg.h / 2 + BLEED) * currentZoom;
    container.scrollLeft += (pageCenterX - (cr.left + cr.width / 2));
    container.scrollTop += (pageCenterY - (cr.top + cr.height / 2));
  }

  // 表示倍率変更（セレクト等）。カーソル指定が無い場合は表示領域の中央を原点にする。
  function onZoomChange(zoomPercent) {
    var container = document.getElementById('canvas-container');
    if (container) {
      var cr = container.getBoundingClientRect();
      applyZoomAtClient(zoomPercent, cr.left + cr.width / 2, cr.top + cr.height / 2);
    } else {
      applyZoomAtClient(zoomPercent);
    }
  }

  // 「横幅」ボタン：用紙の横幅が画面の表示幅に収まる倍率にする（ステップに丸め）
  function fitToWidth() {
    var container = document.getElementById('canvas-container');
    if (!container) return;
    var cr = container.getBoundingClientRect();
    var pg = pagePxSize();
    var rawZoom = cr.width / pg.w;
    var pct = snapZoom(rawZoom * 100);
    applyZoomAtClient(pct, cr.left + cr.width / 2, cr.top + cr.height / 2);
    // ズーム後に用紙を中央にスクロール調整（centerView がリアルタイム位置を読む）
    centerView();
  }

  // 「全体」ボタン：用紙全体が画面に収まる倍率にする（ステップに丸め）
  function fitToAll() {
    var container = document.getElementById('canvas-container');
    if (!container) return;
    var cr = container.getBoundingClientRect();
    var pg = pagePxSize();
    var rawZoom = Math.min(cr.width / pg.w, cr.height / pg.h);
    var pct = snapZoom(rawZoom * 100);
    applyZoomAtClient(pct, cr.left + cr.width / 2, cr.top + cr.height / 2);
    // ズーム後に用紙を中央にスクロール調整（centerView がリアルタイム位置を読む）
    centerView();
  }

  // 倍率(%)を最寄りのステップ値に丸める
  function snapZoom(pct) {
    var steps = (ME.UI.Toolbar.getZoomSteps && ME.UI.Toolbar.getZoomSteps()) || [];
    if (steps.length === 0) return Math.round(pct);
    var best = steps[0], dBest = Infinity;
    for (var i = 0; i < steps.length; i++) {
      var d = Math.abs(steps[i] - pct);
      if (d < dBest) { dBest = d; best = steps[i]; }
    }
    return best;
  }

  // 表示倍率を変更する。clientX/clientYを渡すと、その画面位置の「用紙上の点」を固定してズームする
  // （拡大縮小の原点をその位置に合わせる）。原点は必ず用紙内にクランプ（紙の外は原点にしない）。
  // キャンバス周囲には常にスクロール可能な余白があるため、用紙が画面に収まっても挙動は変わらない。
  function applyZoomAtClient(zoomPercent, clientX, clientY) {
    var canvas = document.getElementById('main-canvas');
    var container = document.getElementById('canvas-container');
    var BLEED = (ME.Render.Engine && ME.Render.Engine.BLEED) || 0;
    var pg = pagePxSize();

    var haveCursor = (clientX !== undefined && clientY !== undefined && canvas && container);
    var px = 0, py = 0, anchorX = 0, anchorY = 0;
    if (haveCursor) {
      var rb = canvas.getBoundingClientRect();
      px = (clientX - rb.left) / currentZoom - BLEED;
      py = (clientY - rb.top) / currentZoom - BLEED;
      // 紙の外を原点にしない：用紙の範囲にクランプ
      px = clampNum(px, 0, pg.w);
      py = clampNum(py, 0, pg.h);
      // クランプ後の点の「現在のスクリーン位置」を固定点にする
      anchorX = rb.left + (px + BLEED) * currentZoom;
      anchorY = rb.top + (py + BLEED) * currentZoom;
    }

    currentZoom = (zoomPercent || 100) / 100;
    if (ME.Render.Engine.setZoom) ME.Render.Engine.setZoom(currentZoom);
    if (canvas) resizeCanvasToPage(canvas);
    renderEngine.setDirty();
    if (ME.UI.Toolbar.setZoomValue) ME.UI.Toolbar.setZoomValue(Math.round(currentZoom * 100));

    // ツールの内部キャンバスも同期（draftプレビュー等）
    for (var tName in tools) {
      var tool = tools[tName];
      if (tool && typeof tool.resize === 'function') tool.resize();
    }

    // ズーム後: 固定点が同じスクリーン位置に来るようスクロール補正
    if (haveCursor) {
      var ra = canvas.getBoundingClientRect();
      var desiredLeft = anchorX - (px + BLEED) * currentZoom;
      var desiredTop = anchorY - (py + BLEED) * currentZoom;
      container.scrollLeft += (ra.left - desiredLeft);
      container.scrollTop += (ra.top - desiredTop);
    }
  }

  // Alt+ドラッグで用紙のスクロール（パン）、Alt+ホイールで表示倍率変更
  function setupCanvasNavigation(canvasContainer) {
    if (!canvasContainer) return;

    // Ctrl+ドラッグ: キャプチャ段階でツール操作より先に横取りする（Alt→Ctrl変更）
    canvasContainer.addEventListener('mousedown', function(e) {
      if (!e.ctrlKey || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panScrollLeft = canvasContainer.scrollLeft;
      panScrollTop = canvasContainer.scrollTop;
      canvasContainer.style.cursor = 'grabbing';
    }, true);

    document.addEventListener('mousemove', function(e) {
      if (!isPanning) return;
      canvasContainer.scrollLeft = panScrollLeft - (e.clientX - panStartX);
      canvasContainer.scrollTop = panScrollTop - (e.clientY - panStartY);
    });

    document.addEventListener('mouseup', function() {
      if (!isPanning) return;
      isPanning = false;
      canvasContainer.style.cursor = '';
    });

    // Ctrl+ホイール: 表示倍率をステップ単位で上げ下げ（Alt→Ctrl、ホイール逆回しで拡大に変更）
    canvasContainer.addEventListener('wheel', function(e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      var steps = (ME.UI.Toolbar.getZoomSteps && ME.UI.Toolbar.getZoomSteps()) || [];
      if (steps.length === 0) return;
      var curPct = Math.round(currentZoom * 100);
      var idx = 0, best = Infinity;
      for (var i = 0; i < steps.length; i++) {
        var d = Math.abs(steps[i] - curPct);
        if (d < best) { best = d; idx = i; }
      }
      if (e.deltaY < 0) idx = Math.min(steps.length - 1, idx + 1); // 上スクロール（ホイール手前）で拡大
      else idx = Math.max(0, idx - 1);
      var pct = steps[idx];
      applyZoomAtClient(pct, e.clientX, e.clientY);
    }, { passive: false });
  }

  function onStepChange(stepId) {
    currentStep = stepId;
    // select-tool / draft-tool が下書きステップ時の選択制限に参照
    ME.currentStep = stepId;
    // ステップ手動切替時は無条件で通常モードへ
    selectModeActive = false;
    selectPrevTool = null;
    if (ME.UI.Toolbar.setTempSelectMode) ME.UI.Toolbar.setTempSelectMode(false);
    // ステップ切替時: 現在のステップの種別以外の選択を解除（紙ステップは全種保持）
    var stepTypeMap = { panel: null, image: 'image', balloon: 'balloon', text: 'text', effect: 'effect', draft: 'draft', memo: 'memo' };
    (function() {
      var allowed = stepTypeMap[stepId]; // paper=null（本線全種・メモ除外）
      var sel = selection.getSelectedIds();
      var keep = [];
      for (var si = 0; si < sel.length; si++) {
        var so = ME.SceneGraph.getObjectById(project, sel[si]);
        if (!so) continue;
        if (stepId === 'memo') {
          if (so.type === 'memo') keep.push(sel[si]);
        } else if (so.type === 'memo') {
          // 他ステップではメモ選択を落とす
        } else if (!allowed || so.type === allowed) {
          keep.push(sel[si]);
        }
      }
      selection.clear();
      if (keep.length) selection.addRange(keep);
    })();
    setActiveTool(STEP_TOOL[stepId] || 'select');
    renderStepPanel();
    updatePropertyPanel();
  }

  function renderStepPanel() {
    if (!ME.UI.StepPanel) return;
    ME.UI.StepPanel.render(currentStep, {
      page: project.page,
      currentEffectKind: currentEffectKind,
      currentDraftKind: currentDraftKind,
      backing: {
        color: (project.page && project.page.backgroundColor) || '#FFFFFF',
        image: (project.page && project.page.backingImage) || null
      },
      onBackingChange: function(patch) {
        applyBackingChange(patch);
      },
      onBackingLoadImage: function(file) {
        loadBackingImageFile(file);
      },
      onBackingClearImage: function() {
        clearBackingImage();
      },
      grid: {
        enabled: !!ME.Tools.Panel.gridEnabled,
        size: ME.Tools.Panel.gridSize || 20,
        offsetX: ME.Tools.Panel.gridOffsetX || 0,
        offsetY: ME.Tools.Panel.gridOffsetY || 0,
        angle: ME.Tools.Panel.gridAngle || 0,
        shearX: ME.Tools.Panel.gridShearXDeg || 0,
        shearY: ME.Tools.Panel.gridShearYDeg || 0
      },
      onGridChange: function(g) {
        ME.Tools.Panel.gridEnabled = !!g.enabled;
        ME.Tools.Panel.gridSize = g.size;
        ME.Tools.Panel.gridOffsetX = (typeof g.offsetX === 'number') ? g.offsetX : 0;
        ME.Tools.Panel.gridOffsetY = (typeof g.offsetY === 'number') ? g.offsetY : 0;
        ME.Tools.Panel.gridAngle = (typeof g.angle === 'number') ? g.angle : 0;
        ME.Tools.Panel.gridShearXDeg = (typeof g.shearX === 'number') ? g.shearX : 0;
        ME.Tools.Panel.gridShearYDeg = (typeof g.shearY === 'number') ? g.shearY : 0;
        renderEngine.setDirty();
      },
      onPaperChange: function(size) {
        applyPaperSize(size);
      },
      onCropToContent: function() {
        cropPageToContent();
      },
      onEffectKindChange: function(kind) {
        currentEffectKind = kind;
        ME.Tools.Effect.defaultKind = kind;
        var ids = selection.getSelectedIds();
        for (var i = 0; i < ids.length; i++) {
          var obj = ME.SceneGraph.getObjectById(project, ids[i]);
          if (obj && obj.type === 'effect') {
            handlePropertyChange(obj.id, 'kind', kind);
          }
        }
      },
      onDeleteSelectedEffects: function() {
        deleteSelectedEffects();
      },
      onDraftKindChange: function(kind) {
        currentDraftKind = kind;
        ME.Tools.Draft.defaultKind = kind;
        if (tools.draft && tools.draft.setKind) {
          tools.draft.setKind(kind);
        }
      },
      onClearPageDrafts: function() {
        clearCurrentPageDraftsWithConfirm();
      },
      onClearPageMemos: function() {
        clearCurrentPageMemosWithConfirm();
      }
    });
  }

  function clearCurrentPageDraftsWithConfirm() {
    if (!project) return;
    var page = getCurrentPage();
    if (!page) return;
    var drafts = page.drafts || [];
    var n = drafts.length;
    if (n === 0) {
      alert('このページに下書きはありません');
      return;
    }
    function go() {
      var snap = JSON.parse(JSON.stringify(drafts));
      page.drafts = [];
      if (commandStack && ME.Commands.ClearPageDrafts) {
        commandStack.push(new ME.Commands.ClearPageDrafts(page.id, snap));
      }
      if (selection) selection.clear();
      refreshPageChrome();
    }
    if (ME.UI && ME.UI.ConfirmDialog) {
      ME.UI.ConfirmDialog.show({
        title: '下書きの削除',
        message: 'このページの下書き ' + n + ' 件を削除しますか？\n「元に戻す」で復元できます。',
        okLabel: '削除',
        cancelLabel: 'キャンセル',
        danger: true,
        onOK: go
      });
    } else {
      go();
    }
  }

  function clearAllPagesDraftsWithConfirm() {
    if (!project || !project.pages) return;
    var total = 0;
    var snaps = [];
    for (var i = 0; i < project.pages.length; i++) {
      var d = project.pages[i].drafts || [];
      total += d.length;
      snaps.push({ pageId: project.pages[i].id, drafts: JSON.parse(JSON.stringify(d)) });
    }
    if (total === 0) {
      alert('下書きはありません');
      return;
    }
    function go() {
      for (var j = 0; j < project.pages.length; j++) {
        project.pages[j].drafts = [];
      }
      if (commandStack && ME.Commands.ClearAllDrafts) {
        commandStack.push(new ME.Commands.ClearAllDrafts(snaps));
      }
      if (selection) selection.clear();
      refreshPageChrome();
    }
    if (ME.UI && ME.UI.ConfirmDialog) {
      ME.UI.ConfirmDialog.show({
        title: '全ページの下書き削除',
        message: project.pages.length + ' ページ中の下書き 合計 ' + total + ' 件を削除しますか？',
        okLabel: 'すべて削除',
        cancelLabel: 'キャンセル',
        danger: true,
        onOK: go
      });
    } else {
      go();
    }
  }

  function clearCurrentPageMemosWithConfirm() {
    if (!project) return;
    var page = getCurrentPage();
    if (!page) return;
    var memos = page.memos || [];
    var n = memos.length;
    if (n === 0) {
      alert('このページにメモはありません');
      return;
    }
    function go() {
      var snap = JSON.parse(JSON.stringify(memos));
      page.memos = [];
      if (commandStack && ME.Commands.ClearPageMemos) {
        commandStack.push(new ME.Commands.ClearPageMemos(page.id, snap));
      }
      if (selection) selection.clear();
      refreshPageChrome();
    }
    if (ME.UI && ME.UI.ConfirmDialog) {
      ME.UI.ConfirmDialog.show({
        title: 'メモの削除',
        message: 'このページのメモ ' + n + ' 件を削除しますか？\n「元に戻す」で復元できます。',
        okLabel: '削除',
        cancelLabel: 'キャンセル',
        danger: true,
        onOK: go
      });
    } else {
      go();
    }
  }

  function clearAllPagesMemosWithConfirm() {
    if (!project || !project.pages) return;
    var total = 0;
    var snaps = [];
    for (var i = 0; i < project.pages.length; i++) {
      var d = project.pages[i].memos || [];
      total += d.length;
      snaps.push({ pageId: project.pages[i].id, memos: JSON.parse(JSON.stringify(d)) });
    }
    if (total === 0) {
      alert('メモはありません');
      return;
    }
    function go() {
      for (var j = 0; j < project.pages.length; j++) {
        project.pages[j].memos = [];
      }
      if (commandStack && ME.Commands.ClearAllMemos) {
        commandStack.push(new ME.Commands.ClearAllMemos(snaps));
      }
      if (selection) selection.clear();
      refreshPageChrome();
    }
    if (ME.UI && ME.UI.ConfirmDialog) {
      ME.UI.ConfirmDialog.show({
        title: '全ページのメモ削除',
        message: project.pages.length + ' ページ中のメモ 合計 ' + total + ' 件を削除しますか？',
        okLabel: 'すべて削除',
        cancelLabel: 'キャンセル',
        danger: true,
        onOK: go
      });
    } else {
      go();
    }
  }

  function pageSizePx() {
    return {
      w: Math.round(project.page.size.widthMm * SCREEN_DPI / MM_PER_INCH),
      h: Math.round(project.page.size.heightMm * SCREEN_DPI / MM_PER_INCH)
    };
  }

  function snapBackingFull() {
    return {
      backgroundColor: project.page.backgroundColor || '#FFFFFF',
      backingImage: project.page.backingImage
        ? JSON.parse(JSON.stringify(project.page.backingImage))
        : null
    };
  }

  // スライダー操作中の Undo 基準スナップ
  var backingLiveOld = null;

  function mutateBacking(patch) {
    if (patch.backgroundColor !== undefined) {
      project.page.backgroundColor = patch.backgroundColor;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'backingImage')) {
      project.page.backingImage = patch.backingImage
        ? JSON.parse(JSON.stringify(patch.backingImage))
        : null;
    }

    if (patch.backingImagePatch && project.page.backingImage) {
      var bi = project.page.backingImage;
      var p = patch.backingImagePatch;
      if (p.transform) {
        if (!bi.transform) bi.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
        if (p.transform.x !== undefined) bi.transform.x = p.transform.x;
        if (p.transform.y !== undefined) bi.transform.y = p.transform.y;
        if (p.transform.rotation !== undefined) bi.transform.rotation = p.transform.rotation;
        if (p.transform.scaleX !== undefined) bi.transform.scaleX = p.transform.scaleX;
        if (p.transform.scaleY !== undefined) bi.transform.scaleY = p.transform.scaleY;
      }
      if (p.colorAdjust) {
        if (!bi.colorAdjust) {
          bi.colorAdjust = {
            brightness: 0, contrast: 0, saturation: 0, grayscale: 0, hue: 0, tone: 0, opacity: 100
          };
        }
        var keys = ['brightness', 'contrast', 'saturation', 'grayscale', 'hue', 'tone', 'opacity'];
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (p.colorAdjust[k] !== undefined) bi.colorAdjust[k] = p.colorAdjust[k];
        }
      }
      if (p.flipX !== undefined) bi.flipX = !!p.flipX;
      if (p.flipY !== undefined) bi.flipY = !!p.flipY;
      if (p.assetId !== undefined) bi.assetId = p.assetId;
      if (p.width !== undefined) bi.width = p.width;
      if (p.height !== undefined) bi.height = p.height;
    }
  }

  function applyBackingChange(patch) {
    if (!patch || !project || !project.page) return;

    // ライブプレビュー（スライダー input）: Undo は change 時に1回
    if (patch.commitUndo === false) {
      if (!backingLiveOld) backingLiveOld = snapBackingFull();
      mutateBacking(patch);
      renderEngine.setDirty();
      return;
    }

    var oldSnap = backingLiveOld || snapBackingFull();
    backingLiveOld = null;
    mutateBacking(patch);
    var newSnap = snapBackingFull();
    if (JSON.stringify(oldSnap) !== JSON.stringify(newSnap)) {
      commandStack.push(new ME.Commands.EditPageBacking(oldSnap, newSnap));
    }
    renderEngine.setDirty();
    if (Object.prototype.hasOwnProperty.call(patch, 'backingImage') ||
        (patch.backingImagePatch && (patch.backingImagePatch.assetId !== undefined))) {
      renderStepPanel();
    }
  }

  function createBackingImageData(assetId, nw, nh) {
    var sz = pageSizePx();
    var fit = Math.min(sz.w / nw, sz.h / nh);
    if (!(fit > 0) || !isFinite(fit)) fit = 1;
    return {
      assetId: assetId,
      width: nw,
      height: nh,
      flipX: false,
      flipY: false,
      transform: {
        x: sz.w / 2,
        y: sz.h / 2,
        rotation: 0,
        scaleX: fit,
        scaleY: fit
      },
      colorAdjust: {
        brightness: 0,
        contrast: 0,
        saturation: 0,
        grayscale: 0,
        hue: 0,
        tone: 0,
        opacity: 100
      }
    };
  }

  function loadBackingImageFile(file) {
    if (!file) return;
    loadImageFileToProject(file, function(assetId, nw, nh) {
      var oldSnap = snapBackingFull();
      var next = createBackingImageData(assetId, nw, nh);
      // 差し替え時は変形・調整を引き継ぐ
      if (project.page.backingImage) {
        var prev = project.page.backingImage;
        next.transform = JSON.parse(JSON.stringify(prev.transform || next.transform));
        next.colorAdjust = JSON.parse(JSON.stringify(prev.colorAdjust || next.colorAdjust));
        next.flipX = !!prev.flipX;
        next.flipY = !!prev.flipY;
        // サイズが変わったので中心は維持しつつスケールは前の scale を維持
      }
      project.page.backingImage = next;
      var newSnap = snapBackingFull();
      commandStack.push(new ME.Commands.EditPageBacking(oldSnap, newSnap));
      renderEngine.setDirty();
      renderStepPanel();
    });
  }

  function clearBackingImage() {
    if (!project.page.backingImage) return;
    var oldSnap = snapBackingFull();
    project.page.backingImage = null;
    var newSnap = snapBackingFull();
    commandStack.push(new ME.Commands.EditPageBacking(oldSnap, newSnap));
    renderEngine.setDirty();
    renderStepPanel();
  }

  function applyPaperSize(size) {
    var oldSize = JSON.parse(JSON.stringify(project.page.size));
    project.page.size.preset = size.preset;
    project.page.size.widthMm = size.widthMm;
    project.page.size.heightMm = size.heightMm;
    project.page.size.dpi = size.dpi;
    if (commandStack) {
      commandStack.push(new ME.Commands.EditPageSize(
        project.page.id,
        oldSize,
        JSON.parse(JSON.stringify(project.page.size))
      ));
    }

    var canvas = document.getElementById('main-canvas');
    resizeCanvasToPage(canvas);
    renderEngine.setDirty();
    centerView();
    renderStepPanel();
  }

  function setActiveTool(toolId) {
    if (activeToolName && tools[activeToolName]) {
      tools[activeToolName].disable();
    }
    activeToolName = toolId;

    var canvas = document.getElementById('main-canvas');
    // ツール切替後にオーバーレイを再描画（旧ツールの残像消し）
    renderEngine.setDirty();
    if (toolId === 'select') {
      tools.select = ME.Tools.Select.create(canvas, project, selection, commandStack, renderEngine);
    } else if (toolId === 'panel') {
      tools.panel = ME.Tools.Panel.create(canvas, project, selection, commandStack, renderEngine);
    } else if (toolId === 'image') {
      tools.image = ME.Tools.Image.create(canvas, project, selection, commandStack, renderEngine);
    } else if (toolId === 'balloon') {
      tools.balloon = ME.Tools.Balloon.create(canvas, project, selection, commandStack, renderEngine);
    } else if (toolId === 'text') {
      tools.text = ME.Tools.Text.create(canvas, project, selection, commandStack, renderEngine);
    } else if (toolId === 'effect') {
      ME.Tools.Effect.defaultKind = currentEffectKind;
      tools.effect = ME.Tools.Effect.create(canvas, project, selection, commandStack, renderEngine);
    } else if (toolId === 'draft') {
      ME.Tools.Draft.defaultKind = currentDraftKind;
      tools.draft = ME.Tools.Draft.create(canvas, project, selection, commandStack, renderEngine);
    } else if (toolId === 'memo') {
      tools.memo = ME.Tools.Memo.create(canvas, project, selection, commandStack, renderEngine);
    }
  }

  // Shift押下 → 選択モードへ切り替え
  function enterSelectMode() {
    if (selectModeActive) return;
    if (activeToolName === 'select') return; // 元から選択ツール（紙ステップ等）
    if (isMouseDown) return;
    selectPrevTool = activeToolName;
    selectModeActive = true;
    setActiveTool('select');
    if (ME.UI.Toolbar.setTempSelectMode) ME.UI.Toolbar.setTempSelectMode(true);
  }

  // 指定オブジェクトを選択状態にして選択モードへ（テキスト確定直後・効果クリックなど）
  // ツールからも呼べるよう ME に公開（effect-tool が回転ハンドル付き select へ寄せる）
  function enterSelectModeForObject(objId) {
    var obj = ME.SceneGraph.getObjectById(project, objId);
    if (!obj) return;
    if (activeToolName !== 'select') {
      selectPrevTool = activeToolName;
      selectModeActive = true;
      setActiveTool('select');
      if (ME.UI.Toolbar.setTempSelectMode) ME.UI.Toolbar.setTempSelectMode(true);
    }
    selection.selectOnly(objId);
    renderEngine.setDirty();
    updatePropertyPanel();
  }
  ME.enterSelectModeForObject = enterSelectModeForObject;

  // 選択モードを終えて元のツールへ復帰すべきか判定・実行
  //   ・Shift押下中は維持
  //   ・マウス操作中は保留（mouseup後に再判定）
  //   ・選択が残っていれば維持（選択維持仕様）
  //   ・上記いずれでもなければ復帰
  function evaluateSelectMode() {
    if (!selectModeActive) return;
    if (shiftHeld) return;
    if (isMouseDown) return;
    if (selection.getSelectedIds().length > 0) return;

    setActiveTool(selectPrevTool || (STEP_TOOL[currentStep] || 'select'));
    selectPrevTool = null;
    selectModeActive = false;
    if (ME.UI.Toolbar.setTempSelectMode) ME.UI.Toolbar.setTempSelectMode(false);
  }

  var propUpdateTimer = null;
  function wrapSelectionForAutoUpdate() {
    var methods = ['toggle', 'selectOnly', 'addRange', 'clear'];
    for (var i = 0; i < methods.length; i++) {
      (function(name) {
        var orig = selection[name];
        selection[name] = function() {
          var result = orig.apply(null, arguments);
          schedulePropUpdate();
          return result;
        };
      })(methods[i]);
    }
  }

  function schedulePropUpdate() {
    if (propUpdateTimer) return;
    propUpdateTimer = setTimeout(function() {
      propUpdateTimer = null;
      updatePropertyPanel();
      // 選択が空になった等の変化後に復帰判定（Delete解除などマウス外の解除に対応）
      evaluateSelectMode();

      // 選択があるのに select ツールでない場合（Shiftなしクリックなど）、青枠表示のために select へ移行
      // これにより「Shiftを押さないと青枠が出ない」問題を解消
      if (selection.getSelectedIds().length > 0 &&
          activeToolName !== 'select' &&
          currentStep !== 'paper' &&
          currentStep !== 'memo' &&
          currentStep !== 'text' &&
          currentStep !== 'panel') {
        selectPrevTool = activeToolName;
        selectModeActive = true;
        setActiveTool('select');
        if (ME.UI.Toolbar.setTempSelectMode) ME.UI.Toolbar.setTempSelectMode(true);
        renderEngine.setDirty();
      }
    }, 0);
  }

  function handleAction(actionId) {
    switch (actionId) {
      case 'new':
        if (confirm('新規作成します。現在のデータを破棄しますか？')) {
          location.reload();
        }
        break;

      case 'open':
        var fileInput = document.createElement('input');
        fileInput.type = 'file';
        // .manga.json 本線。末尾が .json なら読込可
        fileInput.accept = '.manga.json,.json,application/json,text/json';
        fileInput.onchange = function(e) {
          var file = e.target.files[0];
          if (!file) return;
          var reader = new FileReader();
          reader.onload = function(ev) {
            try {
              project = ME.IO.Serializer.fromJSON(ev.target.result);
              ME.SceneGraph.setProject(project);

              var canvas = document.getElementById('main-canvas');
              resizeCanvasToPage(canvas);

              // 旧プロジェクトのツールを後始末してから新エンジンを生成
              for (var tn in tools) {
                if (tools.hasOwnProperty(tn) && tools[tn] && typeof tools[tn].disable === 'function') {
                  try { tools[tn].disable(); } catch (te) {}
                }
              }
              tools = {};
              activeToolName = null;

              renderEngine = ME.Render.Engine.create(canvas, project);
              commandStack = ME.CommandStack.create();
              selection.clear();

              setActiveTool(STEP_TOOL[currentStep] || 'select');
              renderStepPanel();

              renderEngine.setDirty();
              updatePropertyPanel();
              if (ME.UI && ME.UI.PageNav && ME.UI.PageNav.refresh) ME.UI.PageNav.refresh();
            } catch (err) {
              alert('読み込みエラー: ' + err.message);
            }
          };
          reader.readAsText(file);
        };
        fileInput.click();
        break;

      case 'save':
        try {
          var jsonStr = ME.IO.Serializer.toJSON(project);
          var blob = new Blob([jsonStr], { type: 'application/json' });
          var fname = (project.meta.title || 'manga-page') + '.manga.json';
          // OSの保存ダイアログ（フォルダ選択）で保存。未対応環境はダウンロードにフォールバック。
          if (ME.IO && ME.IO.saveBlob) {
            ME.IO.saveBlob(blob, fname, 'application/json', 'マンガページ (.manga.json)', ['.manga.json', '.json']);
          } else {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = fname;
            a.click();
            URL.revokeObjectURL(url);
          }
        } catch (err) {
          alert('保存エラー: ' + err.message);
        }
        break;

      case 'export-png':
        ME.IO.Exporter.exportPNG(project);
        break;

      case 'print':
        if (ME.IO.Print && ME.IO.Print.printProject) {
          ME.IO.Print.printProject(project);
        } else {
          alert('印刷モジュールがありません');
        }
        break;

      case 'undo':
        if (commandStack.canUndo()) {
          commandStack.undo();
          if (ME.PageManager) ME.PageManager.syncPageAlias(project);
          if (selection) selection.clear();
          refreshPageChrome();
        }
        break;

      case 'redo':
        if (commandStack.canRedo()) {
          commandStack.redo();
          if (ME.PageManager) ME.PageManager.syncPageAlias(project);
          if (selection) selection.clear();
          refreshPageChrome();
        }
        break;

      case 'help':
        // 同フォルダの図解マニュアルを別タブで開く（file:// 直起動でも相対パス可）
        try {
          window.open('MANUAL.html', '_blank');
        } catch (errHelp) {
          alert('マニュアルを開けませんでした: ' + (errHelp && errHelp.message ? errHelp.message : errHelp));
        }
        break;
    }
  }

  function changeZOrder(obj, direction) {
    var collectionMap = { panel: 'panels', image: 'images', balloon: 'balloons', text: 'texts', effect: 'effects', draft: 'drafts', memo: 'memos', string: 'strings' };
    var arr = project.page[collectionMap[obj.type]];
    if (!arr || arr.length < 2) return;

    var oldZ = obj.zIndex || 0;
    var newZ;
    if (direction === 'front') {
      var maxZ = -Infinity;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].zIndex > maxZ) maxZ = arr[i].zIndex;
      }
      if (oldZ >= maxZ) return;
      newZ = maxZ + 1;
    } else {
      var minZ = Infinity;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].zIndex < minZ) minZ = arr[i].zIndex;
      }
      if (oldZ <= minZ) return;
      newZ = minZ - 1;
    }
    obj.zIndex = newZ;
    commandStack.push(new ME.Commands.BatchEdit([obj.id], [{ zIndex: oldZ }], [{ zIndex: newZ }]));
    renderEngine.setDirty();
  }

  // 融合: 対象IDすべてに同じfusionGroupを割り当てる（1コマンドでUndo可能）
  // 既に融合済みのメンバーはグループごと取り込む
  function fuseObjects(ids) {
    if (!ids || !ids.length) return;
    var expanded = ids;
    if (selection && selection.expandFusionIds) {
      expanded = selection.expandFusionIds(project, ids) || ids;
    }

    var targets = [];
    var seen = {};
    for (var i = 0; i < expanded.length; i++) {
      if (seen[expanded[i]]) continue;
      seen[expanded[i]] = true;
      var obj = ME.SceneGraph.getObjectById(project, expanded[i]);
      if (obj && (obj.type === 'panel' || obj.type === 'balloon' || obj.type === 'draft')) {
        targets.push(obj);
      }
    }
    if (targets.length < 2) return;

    for (var i = 1; i < targets.length; i++) {
      if (targets[i].type !== targets[0].type) {
        alert('同じ種類（コマ同士・吹き出し同士・下書き同士）だけ融合できます');
        return;
      }
    }

    var gid = ME.Core.ID.generate();
    var fids = [], olds = [], news = [];
    for (var i = 0; i < targets.length; i++) {
      fids.push(targets[i].id);
      olds.push({ fusionGroup: targets[i].fusionGroup || null });
      news.push({ fusionGroup: gid });
      targets[i].fusionGroup = gid;
    }
    commandStack.push(new ME.Commands.BatchEdit(fids, olds, news));
    if (selection) {
      selection.clear();
      selection.addRange(fids);
    }
    renderEngine.setDirty();
    updatePropertyPanel();
  }

  function unfuseObjects(ids) {
    if (!ids || !ids.length) return;
    var expanded = ids;
    if (selection && selection.expandFusionIds) {
      expanded = selection.expandFusionIds(project, ids) || ids;
    }
    var fids = [], olds = [], news = [];
    var seen = {};
    for (var i = 0; i < expanded.length; i++) {
      if (seen[expanded[i]]) continue;
      seen[expanded[i]] = true;
      var obj = ME.SceneGraph.getObjectById(project, expanded[i]);
      if (obj && obj.fusionGroup) {
        fids.push(obj.id);
        olds.push({ fusionGroup: obj.fusionGroup });
        news.push({ fusionGroup: null });
        obj.fusionGroup = null;
      }
    }
    if (fids.length === 0) return;
    commandStack.push(new ME.Commands.BatchEdit(fids, olds, news));
    renderEngine.setDirty();
    updatePropertyPanel();
  }

  // 吹き出し/下書きのコマ内クロップON/OFF（融合グループはまとめて適用）
  function setObjectPanelClip(obj, enabled) {
    if (!obj) return;
    var proj = project || (ME.SceneGraph && ME.SceneGraph.getProject && ME.SceneGraph.getProject());
    if (!proj) return;

    var memberIds = [obj.id];
    if (selection && selection.expandFusionIds) {
      var exp = selection.expandFusionIds(proj, [obj.id]);
      if (exp && exp.length) memberIds = exp;
    }

    var newPanelId = null;
    if (enabled) {
      var panel = null;
      if (ME.SceneGraph.findTopPanelForObject) {
        panel = ME.SceneGraph.findTopPanelForObject(proj, obj);
      }
      if (!panel && ME.SceneGraph.findTopPanelAt && obj.transform) {
        panel = ME.SceneGraph.findTopPanelAt(proj, obj.transform.x, obj.transform.y);
      }
      if (!panel) {
        var panels = proj.page.panels || [];
        for (var pi = 0; pi < panels.length; pi++) {
          if (panels[pi] && panels[pi].visible !== false) { panel = panels[pi]; break; }
        }
      }
      if (!panel) {
        var label = (obj.type === 'draft') ? '下書き' : '吹き出し';
        alert(label + 'をクロップするコマがありません。先にコマを作成してください。');
        updatePropertyPanel();
        return;
      }
      newPanelId = panel.id;
    }

    var fids = [], olds = [], news = [];
    for (var i = 0; i < memberIds.length; i++) {
      var mobj = ME.SceneGraph.getObjectById(proj, memberIds[i]);
      if (!mobj) continue;
      if (mobj.type !== 'balloon' && mobj.type !== 'draft') continue;
      fids.push(mobj.id);
      olds.push({ panelId: mobj.panelId || null });
      news.push({ panelId: newPanelId });
      mobj.panelId = newPanelId;
    }
    if (fids.length === 0) return;
    commandStack.push(new ME.Commands.BatchEdit(fids, olds, news));
    renderEngine.setDirty();
    updatePropertyPanel();
  }

  // ツールバー経由でステップを切り替える（ハイライト＋onStepChangeが走る）
  function switchStep(stepId) {
    if (ME.UI.Toolbar && ME.UI.Toolbar.setActiveStep) {
      ME.UI.Toolbar.setActiveStep(stepId);
    } else {
      onStepChange(stepId);
    }
  }

  // 選択中のエフェクトをすべて削除
  function deleteSelectedEffects() {
    var ids = selection.getSelectedIds();
    var beforeStates = [];
    for (var i = 0; i < ids.length; i++) {
      var o = ME.SceneGraph.getObjectById(project, ids[i]);
      if (o && o.type === 'effect') {
        beforeStates.push(JSON.parse(JSON.stringify(o)));
      }
    }
    if (beforeStates.length > 0) {
      for (var di = 0; di < beforeStates.length; di++) {
        ME.SceneGraph.removeObject(project, beforeStates[di].id);
      }
      commandStack.push(new ME.Commands.DeleteObjects(beforeStates));
      selection.clear();
      renderEngine.setDirty();
      updatePropertyPanel();
    } else {
      alert('削除する効果が選択されていません。効果をクリックで選んでから押してください。');
    }
  }

  // コマを、中の画像の大きさ（矩形）に合わせて切り抜く（頂点を画像の外接矩形へ）
  function cropPanelToImage(panel) {
    var img = null;
    var imgs = project.page.images || [];
    for (var i = 0; i < imgs.length; i++) {
      if (imgs[i].panelId === panel.id) { img = imgs[i]; break; }
    }
    if (!img) {
      alert('このコマには画像がありません。先に「絵を入れる」で画像を配置してください。');
      return;
    }
    var t = img.transform || {};
    var iw = (img.width || 100) * Math.abs(t.scaleX || 1);
    var ih = (img.height || 100) * Math.abs(t.scaleY || 1);
    var cx = t.x || 0, cy = t.y || 0;
    var oldV = JSON.parse(JSON.stringify(panel.vertices));
    var newV = [
      { x: cx - iw / 2, y: cy - ih / 2 },
      { x: cx + iw / 2, y: cy - ih / 2 },
      { x: cx + iw / 2, y: cy + ih / 2 },
      { x: cx - iw / 2, y: cy + ih / 2 }
    ];
    panel.vertices = newV;
    commandStack.push(new ME.Commands.BatchEdit([panel.id], [{ vertices: oldV }], [{ vertices: newV }]));
    renderEngine.setDirty();
    updatePropertyPanel();
  }

  // ===== 画像のドラッグ&ドロップ / 余白トリミング =====
  function panelBoundsOf(panel) {
    var v = panel.vertices || [];
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < v.length; i++) {
      if (v[i].x < minX) minX = v[i].x;
      if (v[i].y < minY) minY = v[i].y;
      if (v[i].x > maxX) maxX = v[i].x;
      if (v[i].y > maxY) maxY = v[i].y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function topmostPanelAt(px, py) {
    var panels = project.page.panels || [];
    var best = null;
    for (var i = 0; i < panels.length; i++) {
      var p = panels[i];
      if (p.visible === false || !p.vertices) continue;
      var b = panelBoundsOf(p);
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
        if (!best || (p.zIndex || 0) >= (best.zIndex || 0)) best = p;
      }
    }
    return best;
  }

  function loadImageFileToProject(file, cb) {
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
        cb(assetId, img.naturalWidth, img.naturalHeight);
      };
      img.src = base64;
    };
    reader.readAsDataURL(file);
  }

  // 既存コマへドロップ: コマに収まる倍率でフィット（既存画像があれば差し替え）
  function placeImageInPanel(panel, assetId, nw, nh) {
    var b = panelBoundsOf(panel);
    var fit = Math.min(b.w / nw, b.h / nh);
    if (!(fit > 0)) fit = 1;
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    var existing = null;
    var imgs = project.page.images || [];
    for (var i = 0; i < imgs.length; i++) {
      if (imgs[i].panelId === panel.id) { existing = imgs[i]; break; }
    }
    if (existing) {
      var oldState = {
        assetId: existing.assetId, width: existing.width, height: existing.height,
        transform: JSON.parse(JSON.stringify(existing.transform))
      };
      existing.assetId = assetId; existing.width = nw; existing.height = nh;
      existing.transform.scaleX = fit; existing.transform.scaleY = fit;
      commandStack.push(new ME.Commands.BatchEdit([existing.id], [oldState],
        [{ assetId: assetId, width: nw, height: nh, transform: JSON.parse(JSON.stringify(existing.transform)) }]));
      selection.selectOnly(existing.id);
    } else {
      var imgObj = ME.SceneGraph.addImageToPanel(project, panel.id, assetId, { x: cx, y: cy });
      imgObj.width = nw; imgObj.height = nh;
      imgObj.transform.scaleX = fit; imgObj.transform.scaleY = fit;
      commandStack.push(new ME.Commands.AddObject(imgObj));
      selection.selectOnly(imgObj.id);
    }
  }

  // コマの無い場所へドロップ: 画像サイズ・線幅0・透明のコマを作り、画像を100%で配置
  function createPanelWithImage(pt, assetId, nw, nh) {
    // バナー製作用: 紙サイズを画像に合わせ、線幅0・透明のコマを紙いっぱいに作り、画像を100%配置する
    var oldSize = JSON.parse(JSON.stringify(project.page.size));
    project.page.size.preset = 'custom';
    project.page.size.widthMm = nw * MM_PER_INCH / SCREEN_DPI;
    project.page.size.heightMm = nh * MM_PER_INCH / SCREEN_DPI;
    project.page.size.dpi = SCREEN_DPI;
    // ページサイズ変更を AddPanel 等の push より先に記録
    if (commandStack) {
      commandStack.push(new ME.Commands.EditPageSize(
        project.page.id,
        oldSize,
        JSON.parse(JSON.stringify(project.page.size))
      ));
    }

    var cx = nw / 2, cy = nh / 2;
    var verts = [
      { x: 0, y: 0 },
      { x: nw, y: 0 },
      { x: nw, y: nh },
      { x: 0, y: nh }
    ];
    var panel = ME.SceneGraph.addPanel(project, verts, {
      borderWidth: 0, borderAlpha: 0, fillColor: '#FFFFFF', fillAlpha: 0, clipPath: true
    });
    commandStack.push(new ME.Commands.AddPanel(panel));
    var imgObj = ME.SceneGraph.addImageToPanel(project, panel.id, assetId, { x: cx, y: cy });
    imgObj.width = nw; imgObj.height = nh;
    imgObj.transform.scaleX = 1; imgObj.transform.scaleY = 1;
    commandStack.push(new ME.Commands.AddObject(imgObj));
    selection.selectOnly(imgObj.id);

    var canvas = document.getElementById('main-canvas');
    resizeCanvasToPage(canvas);
    centerView();
    renderStepPanel();
  }

  function handleImageDrop(file, pt) {
    loadImageFileToProject(file, function(assetId, nw, nh) {
      var panel = topmostPanelAt(pt.x, pt.y);
      if (panel) placeImageInPanel(panel, assetId, nw, nh);
      else createPanelWithImage(pt, assetId, nw, nh);
      renderEngine.setDirty();
      updatePropertyPanel();
    });
  }

  function setupDragAndDrop(container) {
    if (!container) return;
    var canvas = document.getElementById('main-canvas');
    container.addEventListener('dragover', function(e) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      e.preventDefault();
    });
    container.addEventListener('drop', function(e) {
      e.preventDefault();
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      var file = null;
      for (var i = 0; i < files.length; i++) {
        if (/^image\//.test(files[i].type)) { file = files[i]; break; }
      }
      if (!file) return;
      var pt = ME.Render.Engine.getPagePoint(canvas, e);
      handleImageDrop(file, pt);
    });
  }

  // 全オブジェクトを (dx,dy) だけ移動
  function offsetAllObjects(dx, dy) {
    var p = project.page;
    var arrs = ['panels', 'images', 'balloons', 'texts', 'effects', 'drafts', 'memos'];
    for (var a = 0; a < arrs.length; a++) {
      var arr = p[arrs[a]] || [];
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

  // 紙サイズを全アイテムの外接矩形に合わせて切り詰める（余白削除）
  function cropPageToContent() {
    var objs = ME.SceneGraph.getAllObjects(project);
    if (!objs.length) { alert('ページに何もありません。'); return; }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < objs.length; i++) {
      var bb = selection.getBoundingBox(objs[i], project);
      if (!bb || bb.w <= 0 || bb.h <= 0) continue;
      if (bb.x < minX) minX = bb.x;
      if (bb.y < minY) minY = bb.y;
      if (bb.x + bb.w > maxX) maxX = bb.x + bb.w;
      if (bb.y + bb.h > maxY) maxY = bb.y + bb.h;
    }
    if (!isFinite(minX)) { alert('対象が見つかりません。'); return; }
    var cropOldSize = JSON.parse(JSON.stringify(project.page.size));
    var cropDx = -minX, cropDy = -minY;
    offsetAllObjects(cropDx, cropDy);
    var wPx = Math.max(1, Math.round(maxX - minX));
    var hPx = Math.max(1, Math.round(maxY - minY));
    project.page.size.preset = 'custom';
    project.page.size.widthMm = wPx * MM_PER_INCH / SCREEN_DPI;
    project.page.size.heightMm = hPx * MM_PER_INCH / SCREEN_DPI;
    // サイズ変更＋全オブジェクト移動を1コマンドで記録（実行はしない）
    if (commandStack) {
      commandStack.push(new ME.Commands.CropPage(
        project.page.id,
        cropOldSize,
        JSON.parse(JSON.stringify(project.page.size)),
        cropDx,
        cropDy
      ));
    }
    var canvas = document.getElementById('main-canvas');
    resizeCanvasToPage(canvas);
    renderEngine.setDirty();
    centerView();
    renderStepPanel();
    updatePropertyPanel();
  }

  function handlePropertyChange(objId, prop, value) {
    var obj = ME.SceneGraph.getObjectById(project, objId);
    if (!obj) return;

    if (prop === '__delete__') {
      var beforeState = JSON.parse(JSON.stringify(obj));
      ME.SceneGraph.removeObject(project, objId);
      selection.clear();
      commandStack.push(new ME.Commands.DeleteObject(objId, beforeState));
      renderEngine.setDirty();
      updatePropertyPanel();
      return;
    }

    if (prop === '__zorder__') {
      changeZOrder(obj, value);
      return;
    }

    if (prop === '__fuse__') {
      fuseObjects(value && value.ids ? value.ids : []);
      return;
    }

    if (prop === '__unfuse__') {
      unfuseObjects(value && value.ids ? value.ids : []);
      return;
    }

    if (prop === 'clipToPanel') {
      if (obj.type === 'balloon' || obj.type === 'draft') {
        // 融合グループは setObjectPanelClip 内で一括処理するため、
        // 既に同じ fusionGroup を処理済みならスキップ（複数選択 emit 対策）
        if (obj.fusionGroup) {
          if (!handlePropertyChange._clipDone) handlePropertyChange._clipDone = {};
          var key = obj.type + ':' + obj.fusionGroup + ':' + (!!value);
          if (handlePropertyChange._clipDone[key]) return;
          handlePropertyChange._clipDone[key] = true;
          setTimeout(function() { handlePropertyChange._clipDone = {}; }, 0);
        }
        setObjectPanelClip(obj, !!value);
      }
      return;
    }

    if (prop === '__replaceImage__') {
      notifyToolPropertyChange(objId, prop, value); // image-toolが差し替えダイアログを開く
      return;
    }

    if (prop === '__cropToImage__') {
      if (obj.type === 'panel') cropPanelToImage(obj);
      return;
    }

    if (prop === 'transform.x') {
      obj.transform.x = value;
    } else if (prop === 'transform.y') {
      obj.transform.y = value;
    } else if (prop === 'transform.rotation') {
      obj.transform.rotation = value;
    } else if (prop === 'transform.scale') {
      obj.transform.scaleX = (value || 100) / 100;
      obj.transform.scaleY = (value || 100) / 100;
    } else if (prop === 'borderWidth') {
      obj.borderWidth = value;
    } else if (prop === 'borderColor') {
      obj.borderColor = value;
    } else if (prop === 'borderAlpha') {
      obj.borderAlpha = value;
    } else if (prop === 'borderRoughness') {
      var br = Number(value);
      if (isNaN(br)) br = 0;
      if (br < 0) br = 0;
      if (br > 10) br = Math.round(br / 10);
      if (br > 10) br = 10;
      obj.borderRoughness = br;
    } else if (prop === 'fillColor') {
      obj.fillColor = value;
    } else if (prop === 'fillAlpha') {
      obj.fillAlpha = value;
    } else if (prop === 'clipPath') {
      obj.clipPath = value;
    } else if (prop === 'colorAdjust.brightness') {
      obj.colorAdjust.brightness = value;
    } else if (prop === 'colorAdjust.contrast') {
      obj.colorAdjust.contrast = value;
    } else if (prop === 'colorAdjust.saturation') {
      obj.colorAdjust.saturation = value;
    } else if (prop === 'colorAdjust.grayscale') {
      obj.colorAdjust.grayscale = value;
    } else if (prop === 'colorAdjust.hue') {
      obj.colorAdjust.hue = value;
    } else if (prop === 'colorAdjust.opacity') {
      obj.colorAdjust.opacity = value;
    } else if (prop === 'colorAdjust.tone') {
      obj.colorAdjust.tone = value;
    } else if (prop === 'flipX') {
      obj.flipX = value;
    } else if (prop === 'flipY') {
      obj.flipY = value;
    } else if (prop === 'shape') {
      obj.shape = value;
    } else if (prop === 'strokeColor') {
      obj.strokeColor = value;
    } else if (prop === 'strokeAlpha') {
      obj.strokeAlpha = value;
    } else if (prop === 'strokeWidth') {
      obj.strokeWidth = value;
    } else if (prop === 'strokeRoughness') {
      var sr = Number(value);
      if (isNaN(sr)) sr = 0;
      if (sr < 0) sr = 0;
      // 旧 0-100 → 0-10
      if (sr > 10) sr = Math.round(sr / 10);
      if (sr > 10) sr = 10;
      obj.strokeRoughness = sr;
    } else if (prop === 'doubleStroke') {
      obj.doubleStroke = value;
    } else if (prop === 'innerLine') {
      obj.innerLine = value;
    } else if (prop === 'dashed') {
      obj.dashed = value;
    } else if (prop === 'content') {
      obj.content = value;
    } else if (prop === 'writingMode') {
      obj.writingMode = value;
    } else if (prop === 'font.family') {
      // カンマ区切りスタックを壊さず整形（macOS/Win の別名差を許容）
      var famRaw = value == null ? '' : String(value).trim();
      if (!famRaw) {
        obj.font.family = 'sans-serif';
      } else {
        var parts = [];
        var cur = '';
        var inQ = false;
        var qch = '';
        var fi;
        for (fi = 0; fi < famRaw.length; fi++) {
          var ch = famRaw.charAt(fi);
          if (inQ) {
            cur += ch;
            if (ch === qch) inQ = false;
          } else if (ch === '"' || ch === "'") {
            inQ = true;
            qch = ch;
            cur += ch;
          } else if (ch === ',') {
            var one = cur.trim();
            if ((one.charAt(0) === '"' && one.charAt(one.length - 1) === '"') ||
                (one.charAt(0) === "'" && one.charAt(one.length - 1) === "'")) {
              one = one.slice(1, -1);
            }
            one = one.replace(/"/g, '').trim();
            if (one) {
              if (!/^(sans-serif|serif|monospace|cursive|fantasy|system-ui)$/i.test(one) &&
                  !/^[A-Za-z0-9_-]+$/.test(one)) {
                one = '"' + one + '"';
              }
              parts.push(one);
            }
            cur = '';
          } else {
            cur += ch;
          }
        }
        var last = cur.trim();
        if ((last.charAt(0) === '"' && last.charAt(last.length - 1) === '"') ||
            (last.charAt(0) === "'" && last.charAt(last.length - 1) === "'")) {
          last = last.slice(1, -1);
        }
        last = last.replace(/"/g, '').trim();
        if (last) {
          if (!/^(sans-serif|serif|monospace|cursive|fantasy|system-ui)$/i.test(last) &&
              !/^[A-Za-z0-9_-]+$/.test(last)) {
            last = '"' + last + '"';
          }
          parts.push(last);
        }
        obj.font.family = parts.length ? parts.join(', ') : 'sans-serif';
      }
    } else if (prop === 'font.size') {
      var fs = value;
      if (fs < 4) fs = 4;
      if (fs > 400) fs = 400;
      obj.font.size = fs;
    } else if (prop === 'font.color') {
      obj.font.color = value;
    } else if (prop === 'font.alpha') {
      obj.font.alpha = value;
    } else if (prop === 'font.bold') {
      obj.font.bold = value;
    } else if (prop === 'font.strikethrough') {
      obj.font.strikethrough = value;
    } else if (prop === 'font.ruby') {
      obj.font.ruby = value;
    } else if (prop === 'font.lineHeight') {
      obj.font.lineHeight = value;
    } else if (prop === 'font.letterSpacing') {
      obj.font.letterSpacing = value;
    } else if (prop === 'outline.enabled') {
      obj.outline.enabled = value;
    } else if (prop === 'outline.color') {
      obj.outline.color = value;
    } else if (prop === 'outline.alpha') {
      obj.outline.alpha = value;
    } else if (prop === 'outline.width') {
      var ow = value;
      if (ow < 1) ow = 1;
      if (ow > 10) ow = 10;
      obj.outline.width = ow;
    } else if (prop === 'outline.roughness') {
      var rr = value;
      if (rr > 10) rr = Math.round(rr / 10);
      if (rr < 0) rr = 0;
      if (rr > 10) rr = 10;
      obj.outline.roughness = rr;
    } else if (prop === 'outline.rounded') {
      obj.outline.roundness = value ? 6 : 0;
    } else if (prop === 'outline.roundness') {
      var rn = parseInt(value, 10);
      if (isNaN(rn)) rn = 0;
      if (rn > 10) rn = 10;
      if (rn < -10) rn = -10;
      obj.outline.roundness = rn;
    } else if (prop === 'outline.artisticEnabled') {
      obj.outline.artisticEnabled = !!value;
    } else if (prop === 'outline.trapezoidTop') {
      if (!obj.outline) obj.outline = {};
      var tt = parseFloat(value);
      if (isNaN(tt)) tt = 0;
      if (tt > 100) tt = 100;
      if (tt < -100) tt = -100;
      obj.outline.trapezoidTop = tt;
    } else if (prop === 'outline.trapezoidBottom') {
      if (!obj.outline) obj.outline = {};
      var tb = parseFloat(value);
      if (isNaN(tb)) tb = 0;
      if (tb > 100) tb = 100;
      if (tb < -100) tb = -100;
      obj.outline.trapezoidBottom = tb;
    } else if (prop === 'tail.enabled') {
      // 互換: 旧UIのチェックボックス。セレクト「なし」は tail.type=none
      if (value && obj.type === 'balloon') {
        var bw = (obj.size && obj.size.width) || 150;
        var bh = (obj.size && obj.size.height) || 80;
        obj.tail = {
          type: (obj.tail && obj.tail.type) || 'normal',
          basePoint: { x: obj.transform.x, y: obj.transform.y + bh / 2 },
          curvePoint: { x: obj.transform.x + 10, y: obj.transform.y + bh / 2 + 30 },
          tipPoint: { x: obj.transform.x + 20, y: obj.transform.y + bh / 2 + 60 },
          width: Math.max(Math.min(bw, bh) * 0.15, 8)
        };
      } else {
        obj.tail = null;
      }
    } else if (prop === 'tail.type') {
      // セレクト先頭「なし」= none。種類変更時に未作成ならしっぽを作る
      if (value === 'none' || value === '' || value == null) {
        obj.tail = null;
      } else if (obj.type === 'balloon') {
        if (!obj.tail) {
          var bw2 = (obj.size && obj.size.width) || 150;
          var bh2 = (obj.size && obj.size.height) || 80;
          obj.tail = {
            type: value,
            basePoint: { x: obj.transform.x, y: obj.transform.y + bh2 / 2 },
            curvePoint: { x: obj.transform.x + 10, y: obj.transform.y + bh2 / 2 + 30 },
            tipPoint: { x: obj.transform.x + 20, y: obj.transform.y + bh2 / 2 + 60 },
            width: Math.max(Math.min(bw2, bh2) * 0.15, 8)
          };
        } else {
          obj.tail.type = value;
        }
      }
    } else if (prop === 'kind') {
      obj.kind = value;
      applyDefaultParams(obj, value);
    } else if (prop === 'params' && typeof value === 'object') {
      if (!obj.params) obj.params = {};
      Object.assign(obj.params, value);
    }

    renderEngine.setDirty();

    // フィールド構成が変わるものだけパネルを再構築する。
    // writingModeは項目が増減しないため再構築しない（再構築するとセレクトが作り直され、
    // 「選ぶとセリフメニューが閉じる」ように見えてしまうため）。
    if (prop === 'kind' || prop === 'tail.enabled' || prop === 'shape' || prop === 'outline.enabled' || prop === 'outline.artisticEnabled') {
      updatePropertyPanel();
    }

    notifyToolPropertyChange(objId, prop, value);
  }

  function applyDefaultParams(effectObj, kind) {
    // draft kind defaults
    if (kind === 'circle') {
      effectObj.params = { width: 60, height: 40 };
      if (effectObj.strokeColor == null) effectObj.strokeColor = 'rgba(140,140,140,0.55)';
      if (effectObj.strokeWidth == null) effectObj.strokeWidth = 4.5;
    } else if (kind === 'rect') {
      effectObj.params = { width: 60, height: 40 };
      if (effectObj.strokeColor == null) effectObj.strokeColor = 'rgba(140,140,140,0.55)';
      if (effectObj.strokeWidth == null) effectObj.strokeWidth = 4.5;
    } else if (kind === 'line') {
      effectObj.params = { startX: -30, startY: 0, endX: 30, endY: 0 };
      if (effectObj.strokeColor == null) effectObj.strokeColor = 'rgba(140,140,140,0.55)';
      if (effectObj.strokeWidth == null) effectObj.strokeWidth = 4.5;
    } else if (kind === 'string') {
      effectObj.params = {};
      if (effectObj.content === undefined) effectObj.content = '';
      if (!effectObj.font) {
        effectObj.font = {
          family: 'sans-serif', size: 24, bold: true, color: '#a0a0a0',
          alpha: 100, letterSpacing: 0, lineHeight: 1.2
        };
      }
      effectObj.writingMode = 'horizontal';
    } else if (ME.Effects && typeof ME.Effects.defaultParams === 'function') {
      effectObj.params = ME.Effects.defaultParams(kind, effectObj.params || {});
    } else if (kind === 'concentration') {
      effectObj.params = {
        origin: { x: 0, y: 0 },
        originRelative: true,
        lineCount: 36,
        lengthRatio: 90,
        thickness: 100,
        color: '#000000',
        jitter: 30,
        lengthVariation: 50
      };
    } else if (kind === 'speedLines') {
      effectObj.params = {
        direction: 'horizontal', align: 'start',
        lineCount: 24, lengthRatio: 100, thickness: 100, color: '#000000',
        jitter: 30, lengthVariation: 50
      };
    } else {
      effectObj.params = effectObj.params || {};
    }
  }

  function notifyToolPropertyChange(objId, prop, value) {
    for (var toolName in tools) {
      var tool = tools[toolName];
      if (tool && typeof tool.onPropertyChange === 'function') {
        tool.onPropertyChange(objId, prop, value);
      }
    }
  }

  // クロスブラウザ貼り付け: 400ms 以内の二重適用を抑止
  var pasteLockUntil = 0;

  function selectPastedObjects(pasted) {
    if (!pasted || !pasted.length) return;
    selection.clear();
    for (var i = 0; i < pasted.length; i++) {
      selection.toggle(pasted[i].id);
    }
    renderEngine.setDirty();
    updatePropertyPanel();
  }

  // payload があればそれを適用。null なら OS/アプリ内バッファを非同期読取
  function runClipboardPaste(payload) {
    var now = Date.now();
    if (now < pasteLockUntil) return;

    if (payload) {
      var pastedSync = clipboardManager.applyPayload(payload, project, commandStack);
      if (pastedSync && pastedSync.length) {
        pasteLockUntil = now + 400;
        selectPastedObjects(pastedSync);
      }
      return;
    }

    clipboardManager.paste(project, commandStack, function(pasted) {
      if (!pasted || !pasted.length) return;
      if (Date.now() < pasteLockUntil) return;
      pasteLockUntil = Date.now() + 400;
      selectPastedObjects(pasted);
    });
  }

  // paste イベント経由で処理した時刻（keydown フォールバックと二重適用しない）
  var lastPasteEventAt = 0;

  function onDocumentPaste(e) {
    var target = e.target;
    if (target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    )) {
      return;
    }
    var text = null;
    try {
      if (e.clipboardData) text = e.clipboardData.getData('text/plain');
    } catch (err) {}
    var payload = null;
    if (text) {
      if (ME.Clipboard && typeof ME.Clipboard.parseText === 'function') {
        payload = ME.Clipboard.parseText(text);
      } else if (clipboardManager && clipboardManager.parseText) {
        payload = clipboardManager.parseText(text);
      }
    }
    // OS クリップボードがエディタ形式でなければアプリ内 buffer を使う
    // （navigator.clipboard.readText は権限ダイアログが出るので使わない）
    if (!payload) return;
    e.preventDefault();
    lastPasteEventAt = Date.now();
    runClipboardPaste(payload);
  }

  function onKeyDown(e) {
    var target = e.target;
    if (target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    )) {
      return;
    }

    // 文字キーは小文字に正規化する（CapsLock/Shift 時の大文字でもショートカットを効かせる）
    var k = (e.key || '').length === 1 ? e.key.toLowerCase() : e.key;

    if (e.key === 'Shift') {
      shiftHeld = true;
      ME.shiftHeld = true;
      enterSelectMode();
      return;
    }

    // ページ切替 [ ]
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '[' || e.key === ']')) {
      if (!project || !ME.PageManager) return;
      e.preventDefault();
      var pi = ME.PageManager.getCurrentIndex(project);
      var pc = ME.PageManager.pageCount(project);
      if (e.key === '[' && pi > 0) switchToPageIndex(pi - 1);
      if (e.key === ']' && pi < pc - 1) switchToPageIndex(pi + 1);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) {
      e.preventDefault();
      handleAction('undo');
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) {
      e.preventDefault();
      handleAction('redo');
      return;
    }

    // Ctrl/Cmd+A: 本線+下書きのみ（getAllObjects に memos は含まない）
    if ((e.ctrlKey || e.metaKey) && k === 'a' && !e.shiftKey) {
      e.preventDefault();
      if (!project || !selection) return;
      var allObjs = ME.SceneGraph.getAllObjects(project) || [];
      var allIds = [];
      for (var ai = 0; ai < allObjs.length; ai++) {
        if (allObjs[ai] && allObjs[ai].id) allIds.push(allObjs[ai].id);
      }
      if (allIds.length === 0) {
        selection.clear();
        renderEngine.setDirty();
        updatePropertyPanel();
        return;
      }
      // Ctrl+A全選択時は「コマを置く」モードへ + パネル/吹き出し/セリフ/下書きなどメモ以外全選択状態（要望）
      switchStep('panel');
      // Ctrl+A時は水色の包括青枠を表示するため、selectツールを明示的にアクティブ化
      setActiveTool('select');
      selectModeActive = true;
      if (ME.UI.Toolbar.setTempSelectMode) ME.UI.Toolbar.setTempSelectMode(true);
      selection.clear();
      selection.addRange(allIds);
      renderEngine.setDirty();
      // 即時レンダーで青枠（選択オーバーレイ）を確実に表示する
      if (typeof renderEngine.renderNow === 'function') {
        renderEngine.renderNow();
      }
      updatePropertyPanel();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && k === 'c' && !e.shiftKey) {
      e.preventDefault();
      var selectedIds = selection.getSelectedIds();
      if (selectedIds.length > 0) {
        var objs = [];
        for (var i = 0; i < selectedIds.length; i++) {
          var obj = ME.SceneGraph.getObjectById(project, selectedIds[i]);
          if (obj) objs.push(obj);
        }
        clipboardManager.copy({ objects: objs }, project);
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && k === 'v') {
      // preventDefault しない → ネイティブ paste が clipboardData を渡す（権限不要）
      // paste が来ない／非 MECLIP のときだけアプリ内 buffer を遅延適用
      var pasteKeyAt = Date.now();
      setTimeout(function() {
        if (Date.now() - lastPasteEventAt < 80) return;
        if (pasteKeyAt < lastPasteEventAt) return;
        runClipboardPaste(null);
      }, 0);
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      var selectedIds = selection.getSelectedIds();
      if (selectedIds.length > 0) {
        var beforeStates = [];
        for (var i = 0; i < selectedIds.length; i++) {
          var obj = ME.SceneGraph.getObjectById(project, selectedIds[i]);
          if (obj) beforeStates.push(JSON.parse(JSON.stringify(obj)));
        }
        for (var di = 0; di < beforeStates.length; di++) {
          ME.SceneGraph.removeObject(project, beforeStates[di].id);
        }
        if (beforeStates.length > 0) {
          commandStack.push(new ME.Commands.DeleteObjects(beforeStates));
        }
        selection.clear();
        renderEngine.setDirty();
        updatePropertyPanel();
        // 選択が空になったので、Shift非押下なら元のツールへ復帰
        evaluateSelectMode();
      }
      return;
    }

    // 矢印キー: 選択中のみ 1px 移動（未選択時はブラウザ既定のスクロール）
    if (!e.ctrlKey && !e.metaKey && !e.altKey &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
         e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
         e.keyCode === 37 || e.keyCode === 38 || e.keyCode === 39 || e.keyCode === 40)) {
      if (!project || !selection) return;
      var nudgeIds = selection.getSelectedIds();
      if (!nudgeIds || nudgeIds.length === 0) return; // スクロールを許可
      var ndx = 0;
      var ndy = 0;
      if (e.key === 'ArrowLeft' || e.keyCode === 37) ndx = -1;
      else if (e.key === 'ArrowRight' || e.keyCode === 39) ndx = 1;
      else if (e.key === 'ArrowUp' || e.keyCode === 38) ndy = -1;
      else if (e.key === 'ArrowDown' || e.keyCode === 40) ndy = 1;
      if (ndx === 0 && ndy === 0) return;
      e.preventDefault();
      nudgeSelectedBy(ndx, ndy);
    }
  }

  // 連続矢印キーは 1 つの Undo に合算（MAX_STACK=10 を食い潰さない）
  // 対象 ID 集合が同じ かつ スタック末尾が同じコマンド かつ 休止が短い間だけ合算
  var NUDGE_COALESCE_MS = 600;
  var openNudge = null; // { key, cmd, timer }
  function clearOpenNudgeTimer() {
    if (openNudge && openNudge.timer) {
      clearTimeout(openNudge.timer);
      openNudge.timer = null;
    }
  }
  function scheduleOpenNudgeClose() {
    if (!openNudge) return;
    clearOpenNudgeTimer();
    openNudge.timer = setTimeout(function() {
      openNudge = null;
    }, NUDGE_COALESCE_MS);
  }

  // 選択オブジェクトをページ座標で (dx,dy) 移動（融合・コマ付随の画像/効果も一体）
  function nudgeSelectedBy(dx, dy) {
    if (!project || !selection || (!dx && !dy)) return;
    var ids = selection.getSelectedIds() || [];
    if (ids.length === 0) return;
    if (selection.expandFusionIds) {
      ids = selection.expandFusionIds(project, ids) || ids;
    }

    function snapMove(obj) {
      if (obj.type === 'panel') {
        return { vertices: JSON.parse(JSON.stringify(obj.vertices || [])) };
      }
      var snap = { transform: JSON.parse(JSON.stringify(obj.transform || { x: 0, y: 0 })) };
      if (obj.type === 'balloon' && obj.tail) {
        snap.tail = JSON.parse(JSON.stringify(obj.tail));
      }
      // BatchEdit は Object.assign なので origin は params ごと載せる
      if (obj.type === 'effect' && obj.params && obj.params.origin && !obj.params.originRelative) {
        snap.params = JSON.parse(JSON.stringify(obj.params));
      }
      return snap;
    }

    function applyNudge(obj, dx0, dy0) {
      if (obj.type === 'panel' && obj.vertices) {
        for (var v = 0; v < obj.vertices.length; v++) {
          obj.vertices[v].x += dx0;
          obj.vertices[v].y += dy0;
        }
        return;
      }
      if (!obj.transform) obj.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
      obj.transform.x = (obj.transform.x || 0) + dx0;
      obj.transform.y = (obj.transform.y || 0) + dy0;
      if (obj.type === 'balloon' && obj.tail) {
        var tkeys = ['basePoint', 'curvePoint', 'tipPoint'];
        for (var tk = 0; tk < tkeys.length; tk++) {
          var pt = obj.tail[tkeys[tk]];
          if (pt && pt.x !== undefined) {
            pt.x += dx0;
            pt.y += dy0;
          }
        }
      }
      if (obj.type === 'effect' && obj.params && obj.params.origin && !obj.params.originRelative) {
        obj.params.origin.x += dx0;
        obj.params.origin.y += dy0;
      }
    }

    var targets = [];
    var added = {};
    var selectedPanelIds = {};
    var ti;
    for (ti = 0; ti < ids.length; ti++) {
      var o0 = ME.SceneGraph.getObjectById(project, ids[ti]);
      if (!o0 || o0.locked || added[ids[ti]]) continue;
      targets.push({ id: ids[ti], old: snapMove(o0) });
      added[ids[ti]] = true;
      if (o0.type === 'panel') selectedPanelIds[o0.id] = true;
    }
    var page = project.page;
    if (page) {
      var images = page.images || [];
      for (ti = 0; ti < images.length; ti++) {
        var im = images[ti];
        if (im.panelId && selectedPanelIds[im.panelId] && !added[im.id] && !im.locked) {
          targets.push({ id: im.id, old: snapMove(im) });
          added[im.id] = true;
        }
      }
      var effects = page.effects || [];
      for (ti = 0; ti < effects.length; ti++) {
        var ef = effects[ti];
        if (ef.panelId && selectedPanelIds[ef.panelId] && !added[ef.id] && !ef.locked) {
          targets.push({ id: ef.id, old: snapMove(ef) });
          added[ef.id] = true;
        }
      }
    }
    if (targets.length === 0) return;

    var editIds = [];
    var olds = [];
    var news = [];
    for (ti = 0; ti < targets.length; ti++) {
      var obj = ME.SceneGraph.getObjectById(project, targets[ti].id);
      if (!obj) continue;
      applyNudge(obj, dx, dy);
      editIds.push(targets[ti].id);
      olds.push(targets[ti].old);
      news.push(snapMove(obj));
    }
    if (editIds.length === 0) return;

    // 合算キー: 対象 ID の順序付き列（選択集合が変わったら別 Undo）
    var key = editIds.join('\0');
    var top = (commandStack && commandStack.peekUndo) ? commandStack.peekUndo() : null;
    var canCoalesce = openNudge &&
      openNudge.key === key &&
      openNudge.cmd &&
      top === openNudge.cmd &&
      openNudge.cmd.ids &&
      openNudge.cmd.ids.length === editIds.length;

    if (canCoalesce) {
      // oldStates は最初の位置のまま。newStates だけ最新へ更新
      openNudge.cmd.newStates = JSON.parse(JSON.stringify(news));
    } else {
      var cmd = new ME.Commands.BatchEdit(editIds, olds, news);
      cmd.isNudgeBatch = true;
      commandStack.push(cmd);
      clearOpenNudgeTimer();
      openNudge = { key: key, cmd: cmd, timer: null };
    }
    scheduleOpenNudgeClose();
    renderEngine.setDirty();
    updatePropertyPanel();
  }

  function onKeyUp(e) {
    if (e.key === 'Shift') {
      shiftHeld = false;
      ME.shiftHeld = false;
      // 選択が残っていれば維持、空なら復帰
      evaluateSelectMode();
    }
  }

  function updatePropertyPanel() {
    var propPanel = document.getElementById('property-panel');
    if (propPanel && ME.UI.PropertyPanel.update) {
      ME.UI.PropertyPanel.update(project, selection);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
