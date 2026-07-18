// ME.UI.Toolbar — ステップナビゲーション + ファイル操作バー + 表示倍率
// マンガ制作の流れ（紙→コマ→絵→吹き出し→セリフ→エフェクト）に沿ったステップUI
// 「選択・移動」は専用モードを持たず、Shiftキー押下中に選択モードへ切り替わる（main.jsが制御）
// 左下バージョン表示は ME.APP_VERSION_LABEL（VERSION → scripts/sync-version.js → app-version.js）
// ME.UI.Toolbar.create(stepNavEl, fileActionsEl) — UI構築（#file-actions先頭に表示倍率セレクトを追加）
// ME.UI.Toolbar.setActiveStep(stepId) — ステップ切替（ハイライト+コールバック）
// ME.UI.Toolbar.getActiveStep() — 現在のステップID
// ME.UI.Toolbar.setTempSelectMode(on) — Shift/維持中の選択モードの表示切替
// ME.UI.Toolbar.setOnStepChangeCallback(cb) / setOnActionCallback(cb)
// ME.UI.Toolbar.setOnZoomChangeCallback(cb(zoomPercent)) — 表示倍率変更（20〜200は5刻み、210〜400は10刻み）
// ME.UI.Toolbar.getZoomSteps() → number[] — 選択可能な表示倍率(%)の一覧（Alt+ホイール用）
// ME.UI.Toolbar.setZoomValue(percent) — セレクトの表示値を外部から同期
// ME.UI.Toolbar.setOnFitWidthCallback(cb) / setOnFitAllCallback(cb) — 「横幅」「全体」ボタン

window.ME = window.ME || {};
window.ME.UI = window.ME.UI || {};

(function() {
  'use strict';

  // 制作の流れに沿ったステップ定義
  var STEPS = [
    { id: 'paper',   label: '紙を決める',   icon: '📄' },
    { id: 'panel',   label: 'コマを置く',   icon: '▦' },
    { id: 'image',   label: '絵を入れる',   icon: '🖼' },
    { id: 'balloon', label: '吹き出し',     icon: '💬' },
    { id: 'text',    label: 'セリフ',       icon: 'A' },
    { id: 'effect',  label: 'エフェクト',   icon: '✨' },
    { id: 'draft',   label: '下書き',       icon: '✎' },
    // メモ: 絵文字ではなく赤い自由曲線SVG（校閲メモの見た目に合わせる）
    { id: 'memo',    label: 'メモ',         icon: null, iconSvg: true }
  ];

  var FILE_ACTIONS = [
    { id: 'new',        label: '新規' },
    { id: 'open',       label: '開く' },
    { id: 'save',       label: '保存' },
    { id: 'print',      label: '印刷' },
    { id: 'export-png', label: 'PNG出力' },
    { id: 'sep1',       label: '' },
    { id: 'undo',       label: '↩ 元に戻す' },
    { id: 'redo',       label: '↪ やり直す' },
    { id: 'sep2',       label: '' },
    { id: 'help',       label: '？', title: '使い方マニュアル（別タブ）' }
  ];

  // 表示倍率のステップ: 20〜200は5刻み、210超〜400は10刻み
  function computeZoomSteps() {
    var a = [], p;
    for (p = 20; p <= 200; p += 5) a.push(p);
    for (p = 210; p <= 400; p += 10) a.push(p);
    return a;
  }
  var ZOOM_STEPS = computeZoomSteps();

  var activeStep = null;
  var onStepChange = null;
  var onAction = null;
  var onZoomChange = null;
  var shiftNoteEl = null;
  var zoomSelectEl = null;

  function create(stepNavEl, fileActionsEl) {
    // --- ステップナビ ---
    stepNavEl.innerHTML = '';

    var navTitle = document.createElement('div');
    navTitle.className = 'step-nav-title';
    navTitle.textContent = 'つくる手順';
    stepNavEl.appendChild(navTitle);

    for (var i = 0; i < STEPS.length; i++) {
      stepNavEl.appendChild(buildStepButton(STEPS[i]));
    }

    var sep = document.createElement('div');
    sep.className = 'step-nav-separator';
    stepNavEl.appendChild(sep);

    // Shift選択の案内（ボタンではなく常時表示のヒント）
    shiftNoteEl = document.createElement('div');
    shiftNoteEl.className = 'step-nav-note';
    shiftNoteEl.textContent = '⇧ Shiftを押している間は「選択・移動」モード（Shift+クリックで複数選択、Shift+エリアドラッグで一括選択）';
    stepNavEl.appendChild(shiftNoteEl);

    // 左メニュー最下部: アプリ仕様バージョン（グレー表示）
    var verEl = document.createElement('div');
    verEl.className = 'step-nav-version';
    verEl.textContent = (window.ME && ME.APP_VERSION_LABEL) ? ME.APP_VERSION_LABEL : 'Ver.?';
    stepNavEl.appendChild(verEl);

    // --- ファイル操作バー ---
    if (fileActionsEl) {
      fileActionsEl.innerHTML = '';

      // 先頭に表示倍率セレクトを配置
      fileActionsEl.appendChild(buildZoomControl());

      // 「ファイル:」ラベル（ズームコントロールとファイルボタンの間）
      var labelSpan = document.createElement('span');
      labelSpan.className = 'topbar-label';
      labelSpan.textContent = 'ファイル:';
      fileActionsEl.appendChild(labelSpan);

      for (var i = 0; i < FILE_ACTIONS.length; i++) {
        var fa = FILE_ACTIONS[i];
        if (fa.id.indexOf('sep') === 0) {
          var sep = document.createElement('span');
          sep.className = 'file-sep';
          fileActionsEl.appendChild(sep);
          continue;
        }
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'file-btn';
        btn.dataset.actionId = fa.id;
        btn.textContent = fa.label;
        if (fa.title) btn.title = fa.title;
        if (fa.id === 'help') btn.setAttribute('aria-label', '使い方マニュアル');
        btn.addEventListener('click', function() {
          if (onAction) onAction(this.dataset.actionId);
        });
        fileActionsEl.appendChild(btn);
      }
    }
  }

  var onFitWidth = null;
  var onFitAll = null;

  // 表示倍率コントロール（20〜200%は5刻み、210〜400%は10刻み、初期100%）
  function buildZoomControl() {
    var wrap = document.createElement('div');
    wrap.className = 'zoom-control';

    var label = document.createElement('span');
    label.className = 'zoom-label';
    label.textContent = '表示:';
    wrap.appendChild(label);

    var select = document.createElement('select');
    select.className = 'zoom-select';
    for (var si = 0; si < ZOOM_STEPS.length; si++) {
      var pct = ZOOM_STEPS[si];
      var opt = document.createElement('option');
      opt.value = String(pct);
      opt.textContent = pct + '%';
      if (pct === 100) opt.selected = true;
      select.appendChild(opt);
    }
    select.value = '100';
    select.addEventListener('change', function() {
      var v = parseInt(this.value, 10) || 100;
      if (onZoomChange) onZoomChange(v);
    });
    zoomSelectEl = select;
    wrap.appendChild(select);

    // 「横幅」ボタン
    var fitWBtn = document.createElement('button');
    fitWBtn.type = 'button';
    fitWBtn.className = 'zoom-fit-btn';
    fitWBtn.textContent = '横幅';
    fitWBtn.addEventListener('click', function() {
      if (onFitWidth) onFitWidth();
    });
    wrap.appendChild(fitWBtn);

    // 「全体」ボタン
    var fitABtn = document.createElement('button');
    fitABtn.type = 'button';
    fitABtn.className = 'zoom-fit-btn';
    fitABtn.textContent = '全体';
    fitABtn.addEventListener('click', function() {
      if (onFitAll) onFitAll();
    });
    wrap.appendChild(fitABtn);

    return wrap;
  }

  // メモ用: 自由曲線っぽい赤い線（MEMO_COLOR #cc2222 に近い）
  var MEMO_ICON_SVG =
    '<svg class="step-icon-svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
    '<path d="M3.5 15.5 C6 7.5, 8.5 18, 12 11.5 S17.5 5.5, 20.5 12" ' +
    'fill="none" stroke="#cc2222" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  function buildStepButton(step) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'step-btn';
    btn.dataset.stepId = step.id;
    if (step.id === 'memo') {
      btn.className += ' step-btn-memo';
    } else if (step.id === 'draft') {
      btn.className += ' step-btn-draft';
    }

    var iconSpan = document.createElement('span');
    iconSpan.className = 'step-icon';
    if (step.iconSvg) {
      iconSpan.innerHTML = MEMO_ICON_SVG;
    } else {
      iconSpan.textContent = step.icon;
    }
    btn.appendChild(iconSpan);

    var labelSpan = document.createElement('span');
    labelSpan.className = 'step-label';
    labelSpan.textContent = step.label;
    btn.appendChild(labelSpan);

    btn.addEventListener('click', function() {
      setActiveStep(this.dataset.stepId);
    });

    return btn;
  }

  function setActiveStep(stepId) {
    activeStep = stepId;

    var btns = document.querySelectorAll('.step-btn');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].dataset.stepId === stepId) {
        btns[i].classList.add('active');
      } else {
        btns[i].classList.remove('active');
      }
    }

    if (onStepChange) onStepChange(stepId);
  }

  function getActiveStep() {
    return activeStep;
  }

  function setZoomValue(percent) {
    if (zoomSelectEl) zoomSelectEl.value = String(percent);
  }

  // Shift/維持中の選択モードの表示（案内を強調）
  function setTempSelectMode(on) {
    if (!shiftNoteEl) return;
    if (on) {
      shiftNoteEl.classList.add('active');
      shiftNoteEl.textContent = '⇧ 選択・移動モード中。ctrl-C/Vでコピペも可能（選択中はShiftを離しても操作を続けられます）';
    } else {
      shiftNoteEl.classList.remove('active');
      shiftNoteEl.textContent = '⇧ Shiftを押している間は「選択・移動」モード（Shift+クリックで複数選択、Shift+エリアドラッグで一括選択）';
    }
  }

  window.ME.UI.Toolbar = {
    create: create,
    setActiveStep: setActiveStep,
    getActiveStep: getActiveStep,
    setTempSelectMode: setTempSelectMode,
    setZoomValue: setZoomValue,
    getZoomSteps: function() { return ZOOM_STEPS.slice(); },
    setOnStepChangeCallback: function(cb) { onStepChange = cb; },
    setOnActionCallback: function(cb) { onAction = cb; },
    setOnZoomChangeCallback: function(cb) { onZoomChange = cb; },
    setOnFitWidthCallback: function(cb) { onFitWidth = cb; },
    setOnFitAllCallback: function(cb) { onFitAll = cb; },
    // 互換エイリアス（旧API名）
    setActiveTool: setActiveStep,
    getActiveTool: getActiveStep,
    setOnToolChangeCallback: function(cb) { onStepChange = cb; }
  };
})();
