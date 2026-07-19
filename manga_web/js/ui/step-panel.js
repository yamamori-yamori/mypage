// ME.UI.StepPanel — ステップごとの操作ガイド＋設定フォーム
// ME.UI.StepPanel.create(containerEl) — 初期化
// ME.UI.StepPanel.render(stepId, opts) — ステップ内容を描画
//   opts: {
//     page,                       // 現在のPage（紙ステップの表示用）
//     currentEffectKind,          // 現在選択中のエフェクト種類
//     onPaperChange(size),        // 紙サイズ変更 {preset, widthMm, heightMm, dpi}
//     onEffectKindChange(kind)    // エフェクト種類変更
//   }

window.ME = window.ME || {};
window.ME.UI = window.ME.UI || {};

(function() {
  'use strict';

  var MM_PER_INCH = 25.4;
  var SCREEN_DPI = 96;

  // 紙プリセット（印刷向けはmm+350dpi、Web向けはpx指定=96dpi）
  var PAPER_PRESETS = [
    { id: 'A5',      label: 'A5縦',          desc: '小さめ同人誌サイズ (148×210mm)', wMm: 148, hMm: 210, dpi: 350, canRotate: true },
    { id: 'B5',      label: 'B5',            desc: '同人誌の定番 (182×257mm)',      wMm: 182, hMm: 257, dpi: 350, canRotate: true },
    { id: 'A4',      label: 'A4',            desc: '雑誌・投稿サイズ (210×297mm)',  wMm: 210, hMm: 297, dpi: 350, canRotate: true },
    { id: 'B4',      label: 'B4',            desc: '商業原稿用紙 (257×364mm)',      wMm: 257, hMm: 364, dpi: 350, canRotate: true },
    { id: 'square',  label: 'SNS正方形',     desc: 'X/Instagram向け (1080×1080px)', wPx: 1080, hPx: 1080, canRotate: false },
    { id: 'webtoon', label: '縦スクロール',  desc: 'Webtoon風 (800×2000px)',        wPx: 800,  hPx: 2000, canRotate: false },
    { id: 'fhd',       label: 'フルHD',        desc: '1920×1080px', wPx: 1920, hPx: 1080, canRotate: false },
    { id: 'wxga1600',  label: '1600×1200',     desc: '1600×1200px', wPx: 1600, hPx: 1200, canRotate: false },
    { id: 'hd',        label: 'HD',            desc: '1280×720px',  wPx: 1280, hPx: 720,  canRotate: false },
    { id: 'phoneP',    label: 'スマホ縦(FHD)',  desc: '1080×1920px', wPx: 1080, hPx: 1920, canRotate: false },
    { id: 'phone',     label: 'スマホ',         desc: '750×1334px',  wPx: 750,  hPx: 1334, canRotate: false },
    { id: 'bn512x128', label: 'バナー512×128',  desc: '512×128px',   wPx: 512,  hPx: 128,  canRotate: false },
    { id: 'bn512x256', label: 'バナー512×256',  desc: '512×256px',   wPx: 512,  hPx: 256,  canRotate: false },
    { id: 'bn512x512', label: 'バナー512×512',  desc: '512×512px',   wPx: 512,  hPx: 512,  canRotate: false },
    { id: 'sq1024',    label: '1024×1024',      desc: '1024×1024px', wPx: 1024, hPx: 1024, canRotate: false },
    { id: 'px1024x1536', label: '1024×1536',    desc: '1:1.5 (1024×1536px)', wPx: 1024, hPx: 1536, canRotate: false }
  ];

  // ステップごとの操作ヒント
  var HINTS = {
    paper:   { title: '1. 紙を決める',   text: 'まずページのサイズを選びましょう。あとから変更してもコマや絵はそのまま残ります。' },
    panel:   { title: '2. コマを置く',   text: 'キャンバス上をドラッグするとコマ（枠）が描けます。コマの角のオレンジの点をドラッグすると、斜めコマや変形コマも作れます。' },
    image:   { title: '3. 絵を入れる',   text: '空のコマをクリックすると、画像ファイル（PNG/JPG/WebP）を選べます。すでに絵の入ったコマをクリックした時は、その絵を選んで移動・拡縮できます（読み込み直しになりません）。差し替えたい時は右パネルの「画像を差し替える」を使います。ドラッグ・アンド・ドロップも可能です' },
    balloon: { title: '4. 吹き出し',     text: '空いている所をドラッグすると吹き出しができます。作った吹き出しはクリックで選択でき、そのままドラッグで移動できます。右のパネルで形や「しっぽ」のON/OFF・種類（通常／〇内心／ギザギザ）を変更。しっぽはオレンジの点をドラッグで調整。' },
    text:    { title: '5. セリフ',       text: '吹き出しの上（またはどこでも）をクリックすると、その場でセリフを入力できます。Enterで確定、Escで取消。縦書き・横書きは右のパネルで切り替えられます。' },
    effect:  { title: '6. エフェクト',   text: 'まず下から効果の種類を選び、コマの中をクリックして配置します。効果はクリックしたコマの中だけにかかります（コマの外には置けません）。配置済みの効果はクリックで選択でき、右のパネルで種類や本数・長さ・向きを変えたり、Deleteキーで削除できます。選択中の効果をもう一度クリックすると、その上に新しい効果を重ねられます。' },
    draft:   { title: '✎ 下書き',        text: '円・四角形・直線・文字列を下書きとして置きます。画像を入れると下書きは自然に隠れます。選択ツールで移動・拡縮・端点編集できます。' }
  };

  var EFFECT_KINDS = [
    { id: 'concentration', label: '集中線' },
    { id: 'speedLines',  label: 'スピード線' },
    { id: 'horrorLines', label: 'ホラー線' },
    { id: 'dropLines',   label: 'ドロップ線' },
    { id: 'wavyLines',   label: '揺れ線' },
    { id: 'crackLines',  label: 'ヒビ' }
  ];

  function getEffectKindList() {
    if (window.ME && ME.Effects && ME.Effects.STEP_KINDS && ME.Effects.STEP_KINDS.length) {
      return ME.Effects.STEP_KINDS;
    }
    return EFFECT_KINDS;
  }

  var containerEl = null;

  function create(el) {
    containerEl = el;
  }

  function render(stepId, opts) {
    if (!containerEl) return;
    opts = opts || {};
    containerEl.innerHTML = '';

    var hint = HINTS[stepId];
    if (hint) {
      var titleEl = document.createElement('div');
      titleEl.className = 'step-panel-title';
      titleEl.textContent = hint.title;
      containerEl.appendChild(titleEl);

      var textEl = document.createElement('div');
      textEl.className = 'step-panel-hint';
      textEl.textContent = hint.text;
      containerEl.appendChild(textEl);
    }

    if (stepId === 'paper') {
      renderPaperForm(containerEl, opts);
    } else if (stepId === 'panel') {
      renderPanelForm(containerEl, opts);
    } else if (stepId === 'effect') {
      renderEffectKinds(containerEl, opts);
    } else if (stepId === 'draft') {
      renderDraftKinds(containerEl, opts);
    } else if (stepId === 'memo') {
      renderMemoGuide(containerEl, opts);
    }
  }

  // --- コマ ステップ: 台紙設定 + グリッド吸着 ---
  function renderPanelForm(container, opts) {
    var grid = opts.grid || { enabled: false, size: 20, offsetX: 0, offsetY: 0, angle: 0, shearX: 0, shearY: 0 };
    var onGridChange = opts.onGridChange || function() {};
    var backing = opts.backing || { color: '#FFFFFF', image: null };
    var onBackingChange = opts.onBackingChange || function() {};
    var onBackingLoadImage = opts.onBackingLoadImage || function() {};
    var onBackingClearImage = opts.onBackingClearImage || function() {};

    // ===== 台紙設定 =====
    var bTitle = document.createElement('div');
    bTitle.className = 'paper-custom-title';
    bTitle.textContent = '台紙設定';
    container.appendChild(bTitle);

    var bHint = document.createElement('div');
    bHint.className = 'step-panel-hint';
    bHint.textContent = 'ページ色と台紙画像はコマの下に描画。レイアウトの基準に使えます。';
    container.appendChild(bHint);

    // 色
    var colorRow = document.createElement('div');
    colorRow.className = 'paper-custom-row';
    var colorLbl = document.createElement('span');
    colorLbl.textContent = '台紙色: ';
    var colorIn = document.createElement('input');
    colorIn.type = 'color';
    colorIn.value = normalizeHexColor(backing.color || '#FFFFFF');
    colorIn.addEventListener('change', function() {
      onBackingChange({ backgroundColor: colorIn.value, commitUndo: true });
    });
    colorIn.addEventListener('input', function() {
      onBackingChange({ backgroundColor: colorIn.value, commitUndo: false });
    });
    colorRow.appendChild(colorLbl);
    colorRow.appendChild(colorIn);
    container.appendChild(colorRow);

    // 画像ロード
    var imgRow = document.createElement('div');
    imgRow.className = 'paper-custom-row';
    imgRow.style.flexWrap = 'wrap';
    var fileIn = document.createElement('input');
    fileIn.type = 'file';
    fileIn.accept = 'image/*';
    fileIn.style.display = 'none';
    var loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'prop-zorder-btn';
    loadBtn.textContent = backing.image ? '🖼 台紙画像を差し替え' : '🖼 台紙画像を読み込む';
    loadBtn.addEventListener('click', function() { fileIn.click(); });
    fileIn.addEventListener('change', function() {
      if (fileIn.files && fileIn.files[0]) {
        onBackingLoadImage(fileIn.files[0]);
        fileIn.value = '';
      }
    });
    imgRow.appendChild(loadBtn);
    imgRow.appendChild(fileIn);

    if (backing.image && backing.image.assetId) {
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'prop-zorder-btn';
      delBtn.style.marginLeft = '6px';
      delBtn.textContent = '画像を削除';
      delBtn.addEventListener('click', function() { onBackingClearImage(); });
      imgRow.appendChild(delBtn);
    }
    container.appendChild(imgRow);

    if (backing.image && backing.image.assetId) {
      var bi = backing.image;
      var t = bi.transform || { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
      var ca = bi.colorAdjust || {};

      function emitImagePatch(patch, commit) {
        onBackingChange({ backingImagePatch: patch, commitUndo: !!commit });
      }

      var imgTitle = document.createElement('div');
      imgTitle.className = 'paper-custom-title';
      imgTitle.style.marginTop = '8px';
      imgTitle.textContent = '台紙画像の変形';
      container.appendChild(imgTitle);

      addBackingSlider(container, '拡大率(%)', Math.round((t.scaleX || 1) * 100), 5, 400, function(v, commit) {
        var s = v / 100;
        emitImagePatch({ transform: { scaleX: s, scaleY: s } }, commit);
      });
      addBackingSlider(container, '回転(°)', Math.round(t.rotation || 0), 0, 360, function(v, commit) {
        emitImagePatch({ transform: { rotation: v } }, commit);
      });
      addBackingSlider(container, '位置 X', Math.round(t.x || 0), -2000, 4000, function(v, commit) {
        emitImagePatch({ transform: { x: v } }, commit);
      });
      addBackingSlider(container, '位置 Y', Math.round(t.y || 0), -2000, 4000, function(v, commit) {
        emitImagePatch({ transform: { y: v } }, commit);
      });

      var adjTitle = document.createElement('div');
      adjTitle.className = 'paper-custom-title';
      adjTitle.style.marginTop = '8px';
      adjTitle.textContent = '台紙画像の調整';
      container.appendChild(adjTitle);

      addBackingSlider(container, '明るさ', ca.brightness || 0, -100, 100, function(v, commit) {
        emitImagePatch({ colorAdjust: { brightness: v } }, commit);
      });
      addBackingSlider(container, 'コントラスト', ca.contrast || 0, -100, 100, function(v, commit) {
        emitImagePatch({ colorAdjust: { contrast: v } }, commit);
      });
      addBackingSlider(container, '彩度', ca.saturation || 0, -100, 100, function(v, commit) {
        emitImagePatch({ colorAdjust: { saturation: v } }, commit);
      });
      addBackingSlider(container, '白黒', ca.grayscale || 0, 0, 100, function(v, commit) {
        emitImagePatch({ colorAdjust: { grayscale: v } }, commit);
      });
      addBackingSlider(container, '色相', ca.hue || 0, 0, 360, function(v, commit) {
        emitImagePatch({ colorAdjust: { hue: v } }, commit);
      });
      addBackingSlider(container, 'トーンカーブ', ca.tone || 0, -100, 100, function(v, commit) {
        emitImagePatch({ colorAdjust: { tone: v } }, commit);
      });
      addBackingSlider(container, '不透明度', ca.opacity !== undefined ? ca.opacity : 100, 0, 100, function(v, commit) {
        emitImagePatch({ colorAdjust: { opacity: v } }, commit);
      });

      var flipRow = document.createElement('div');
      flipRow.className = 'paper-custom-row';
      flipRow.style.flexWrap = 'wrap';
      addBackingCheck(flipRow, '左右反転', !!bi.flipX, function(v) {
        emitImagePatch({ flipX: v }, true);
      });
      addBackingCheck(flipRow, '上下反転', !!bi.flipY, function(v) {
        emitImagePatch({ flipY: v }, true);
      });
      container.appendChild(flipRow);
    }

    // ===== グリッド吸着 =====
    var title = document.createElement('div');
    title.className = 'paper-custom-title';
    title.style.marginTop = '14px';
    title.textContent = 'グリッド吸着';
    container.appendChild(title);

    var hint = document.createElement('div');
    hint.className = 'step-panel-hint';
    hint.textContent = 'コマをクリックで再選択 → オレンジ頂点をドラッグで自由移動。空き領域ドラッグで新規作成。';
    container.appendChild(hint);

    var row = document.createElement('div');
    row.className = 'paper-custom-row';
    var lbl = document.createElement('label');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!grid.enabled;
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(' グリッドに吸着する'));
    row.appendChild(lbl);
    container.appendChild(row);

    var row2 = document.createElement('div');
    row2.className = 'paper-custom-row';
    var sl = document.createElement('span');
    sl.textContent = '間隔(px): ';
    var si = document.createElement('input');
    si.type = 'number';
    si.min = 2;
    si.value = grid.size || 20;
    si.style.width = '70px';
    row2.appendChild(sl);
    row2.appendChild(si);
    container.appendChild(row2);

    var offsetX = (typeof grid.offsetX === 'number') ? grid.offsetX : 0;
    var offsetY = (typeof grid.offsetY === 'number') ? grid.offsetY : 0;
    var angle = (typeof grid.angle === 'number') ? grid.angle : 0;
    var shearX = (typeof grid.shearX === 'number') ? grid.shearX : 0;
    var shearY = (typeof grid.shearY === 'number') ? grid.shearY : 0;

    var oxLabel = document.createElement('span');
    var oyLabel = document.createElement('span');
    var angLabel = document.createElement('span');
    var sxLabel = document.createElement('span');
    var syLabel = document.createElement('span');

    function fire() {
      onGridChange({
        enabled: cb.checked,
        size: Math.max(2, parseInt(si.value, 10) || 20),
        offsetX: offsetX,
        offsetY: offsetY,
        angle: angle,
        shearX: shearX,
        shearY: shearY
      });
      oxLabel.textContent = String(offsetX);
      oyLabel.textContent = String(offsetY);
      angLabel.textContent = (Math.round(angle * 10) / 10) + '°';
      sxLabel.textContent = (Math.round(shearX * 10) / 10) + '°';
      syLabel.textContent = (Math.round(shearY * 10) / 10) + '°';
    }

    function bindHold(btn, stepFn) {
      var timer = null;
      var delayTimer = null;
      function clear() {
        if (timer) { clearInterval(timer); timer = null; }
        if (delayTimer) { clearTimeout(delayTimer); delayTimer = null; }
      }
      function start(e) {
        if (e) e.preventDefault();
        stepFn();
        clear();
        delayTimer = setTimeout(function() {
          timer = setInterval(stepFn, 50);
        }, 350);
      }
      btn.addEventListener('mousedown', start);
      btn.addEventListener('touchstart', start, { passive: false });
      btn.addEventListener('mouseup', clear);
      btn.addEventListener('mouseleave', clear);
      btn.addEventListener('touchend', clear);
      btn.addEventListener('touchcancel', clear);
    }

    function makeNudgeBtn(text) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'grid-nudge-btn';
      b.textContent = text;
      return b;
    }

    function clampDeg(a, lo, hi) {
      if (a > hi) a = hi;
      if (a < lo) a = lo;
      return Math.round(a * 2) / 2;
    }

    function clampAngle(a) {
      while (a > 180) a -= 360;
      while (a < -180) a += 360;
      return Math.round(a * 2) / 2;
    }

    // 位置オフセット（1px）
    var title2 = document.createElement('div');
    title2.className = 'paper-custom-title';
    title2.style.marginTop = '10px';
    title2.textContent = 'グリッド位置（1px）';
    container.appendChild(title2);

    var posRow = document.createElement('div');
    posRow.className = 'grid-nudge-block';

    var xRow = document.createElement('div');
    xRow.className = 'grid-nudge-row';
    xRow.appendChild(document.createTextNode('左右 X: '));
    var btnXm = makeNudgeBtn('−');
    var btnXp = makeNudgeBtn('＋');
    oxLabel.className = 'grid-nudge-val';
    oxLabel.textContent = String(offsetX);
    xRow.appendChild(btnXm);
    xRow.appendChild(oxLabel);
    xRow.appendChild(btnXp);
    posRow.appendChild(xRow);

    var yRow = document.createElement('div');
    yRow.className = 'grid-nudge-row';
    yRow.appendChild(document.createTextNode('上下 Y: '));
    var btnYm = makeNudgeBtn('−');
    var btnYp = makeNudgeBtn('＋');
    oyLabel.className = 'grid-nudge-val';
    oyLabel.textContent = String(offsetY);
    yRow.appendChild(btnYm);
    yRow.appendChild(oyLabel);
    yRow.appendChild(btnYp);
    posRow.appendChild(yRow);
    container.appendChild(posRow);

    bindHold(btnXm, function() { offsetX -= 1; fire(); });
    bindHold(btnXp, function() { offsetX += 1; fire(); });
    bindHold(btnYm, function() { offsetY -= 1; fire(); });
    bindHold(btnYp, function() { offsetY += 1; fire(); });

    // 角度（0.5°）
    var title3 = document.createElement('div');
    title3.className = 'paper-custom-title';
    title3.style.marginTop = '10px';
    title3.textContent = 'グリッド角度（0.5°）';
    container.appendChild(title3);

    var angRow = document.createElement('div');
    angRow.className = 'grid-nudge-row';
    var btnAm = makeNudgeBtn('−');
    var btnAp = makeNudgeBtn('＋');
    angLabel.className = 'grid-nudge-val';
    angLabel.style.minWidth = '52px';
    angLabel.textContent = (Math.round(angle * 10) / 10) + '°';
    var btnA0 = makeNudgeBtn('0');
    btnA0.title = '角度を0°にリセット';
    btnA0.className = 'grid-nudge-btn grid-preset-btn';
    angRow.appendChild(btnAm);
    angRow.appendChild(angLabel);
    angRow.appendChild(btnAp);
    angRow.appendChild(btnA0);
    container.appendChild(angRow);

    bindHold(btnAm, function() { angle = clampAngle(angle - 0.5); fire(); });
    bindHold(btnAp, function() { angle = clampAngle(angle + 0.5); fire(); });
    btnA0.addEventListener('click', function() { angle = 0; fire(); });

    // 平行四辺形シア
    var title4 = document.createElement('div');
    title4.className = 'paper-custom-title';
    title4.style.marginTop = '10px';
    title4.textContent = '平行四辺形（0.5°）';
    container.appendChild(title4);

    var shearHint = document.createElement('div');
    shearHint.className = 'step-panel-hint';
    shearHint.textContent = 'X軸水平＝縦辺だけ傾ける / Y軸垂直＝横辺だけ傾ける';
    container.appendChild(shearHint);

    // X軸を傾けない（Y方向シア）
    var syRow = document.createElement('div');
    syRow.className = 'grid-nudge-row';
    syRow.appendChild(document.createTextNode('X水平 Y傾き: '));
    var btnSYm = makeNudgeBtn('−');
    var btnSYp = makeNudgeBtn('＋');
    syLabel.className = 'grid-nudge-val';
    syLabel.style.minWidth = '52px';
    syLabel.textContent = (Math.round(shearY * 10) / 10) + '°';
    var btnSY0 = makeNudgeBtn('0');
    btnSY0.title = 'Y傾きを0°に';
    btnSY0.className = 'grid-nudge-btn grid-preset-btn';
    syRow.appendChild(btnSYm);
    syRow.appendChild(syLabel);
    syRow.appendChild(btnSYp);
    syRow.appendChild(btnSY0);
    container.appendChild(syRow);

    // Y軸を傾けない（X方向シア）
    var sxRow = document.createElement('div');
    sxRow.className = 'grid-nudge-row';
    sxRow.appendChild(document.createTextNode('Y垂直 X傾き: '));
    var btnSXm = makeNudgeBtn('−');
    var btnSXp = makeNudgeBtn('＋');
    sxLabel.className = 'grid-nudge-val';
    sxLabel.style.minWidth = '52px';
    sxLabel.textContent = (Math.round(shearX * 10) / 10) + '°';
    var btnSX0 = makeNudgeBtn('0');
    btnSX0.title = 'X傾きを0°に';
    btnSX0.className = 'grid-nudge-btn grid-preset-btn';
    sxRow.appendChild(btnSXm);
    sxRow.appendChild(sxLabel);
    sxRow.appendChild(btnSXp);
    sxRow.appendChild(btnSX0);
    container.appendChild(sxRow);

    bindHold(btnSYm, function() { shearY = clampDeg(shearY - 0.5, -80, 80); fire(); });
    bindHold(btnSYp, function() { shearY = clampDeg(shearY + 0.5, -80, 80); fire(); });
    btnSY0.addEventListener('click', function() { shearY = 0; fire(); });
    bindHold(btnSXm, function() { shearX = clampDeg(shearX - 0.5, -80, 80); fire(); });
    bindHold(btnSXp, function() { shearX = clampDeg(shearX + 0.5, -80, 80); fire(); });
    btnSX0.addEventListener('click', function() { shearX = 0; fire(); });

    var resetRow = document.createElement('div');
    resetRow.className = 'paper-custom-row';
    resetRow.style.marginTop = '6px';
    var resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'prop-zorder-btn';
    resetBtn.textContent = '全リセット';
    resetBtn.title = '位置・角度・平行四辺形をすべて0に';
    resetBtn.addEventListener('click', function() {
      offsetX = 0;
      offsetY = 0;
      angle = 0;
      shearX = 0;
      shearY = 0;
      fire();
    });
    resetRow.appendChild(resetBtn);
    container.appendChild(resetRow);

    cb.addEventListener('change', fire);
    si.addEventListener('input', fire);
  }

  // --- 紙ステップ: プリセット選択 + 向き + カスタムサイズ ---
  function renderPaperForm(container, opts) {
    var page = opts.page;
    var onChange = opts.onPaperChange || function() {};

    // 現在のサイズ表示
    var current = document.createElement('div');
    current.className = 'paper-current';
    if (page) {
      current.textContent = '現在: ' + formatSize(page.size);
    }
    container.appendChild(current);

    // プリセットカード
    var grid = document.createElement('div');
    grid.className = 'paper-grid';

    for (var i = 0; i < PAPER_PRESETS.length; i++) {
      (function(preset) {
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'paper-card';
        if (page && page.size.preset === preset.id) card.classList.add('active');

        var name = document.createElement('div');
        name.className = 'paper-card-name';
        name.textContent = preset.label;
        card.appendChild(name);

        var desc = document.createElement('div');
        desc.className = 'paper-card-desc';
        desc.textContent = preset.desc;
        card.appendChild(desc);

        card.addEventListener('click', function() {
          onChange(presetToSize(preset, false));
        });

        grid.appendChild(card);
      })(PAPER_PRESETS[i]);
    }
    container.appendChild(grid);

    // 向き切替（印刷プリセットのみ意味を持つが、常時表示でシンプルに）
    var orientRow = document.createElement('div');
    orientRow.className = 'paper-orient-row';
    var orientLabel = document.createElement('span');
    orientLabel.textContent = '向き: ';
    orientRow.appendChild(orientLabel);

    var portraitBtn = document.createElement('button');
    portraitBtn.type = 'button';
    portraitBtn.className = 'orient-btn';
    portraitBtn.textContent = '縦';
    var landscapeBtn = document.createElement('button');
    landscapeBtn.type = 'button';
    landscapeBtn.className = 'orient-btn';
    landscapeBtn.textContent = '横';

    if (page && page.size.widthMm <= page.size.heightMm) {
      portraitBtn.classList.add('active');
    } else {
      landscapeBtn.classList.add('active');
    }

    portraitBtn.addEventListener('click', function() {
      if (!page) return;
      var w = Math.min(page.size.widthMm, page.size.heightMm);
      var h = Math.max(page.size.widthMm, page.size.heightMm);
      onChange({ preset: page.size.preset, widthMm: w, heightMm: h, dpi: page.size.dpi });
    });
    landscapeBtn.addEventListener('click', function() {
      if (!page) return;
      var w = Math.max(page.size.widthMm, page.size.heightMm);
      var h = Math.min(page.size.widthMm, page.size.heightMm);
      onChange({ preset: page.size.preset, widthMm: w, heightMm: h, dpi: page.size.dpi });
    });

    orientRow.appendChild(portraitBtn);
    orientRow.appendChild(landscapeBtn);
    container.appendChild(orientRow);

    // カスタムサイズ
    var customTitle = document.createElement('div');
    customTitle.className = 'paper-custom-title';
    customTitle.textContent = 'カスタムサイズ';
    container.appendChild(customTitle);

    var customRow = document.createElement('div');
    customRow.className = 'paper-custom-row';

    var wInput = document.createElement('input');
    wInput.type = 'number';
    wInput.min = 1;
    wInput.placeholder = '幅';
    var xSpan = document.createElement('span');
    xSpan.textContent = '×';
    var hInput = document.createElement('input');
    hInput.type = 'number';
    hInput.min = 1;
    hInput.placeholder = '高さ';

    var unitSelect = document.createElement('select');
    var mmOpt = document.createElement('option');
    mmOpt.value = 'mm';
    mmOpt.textContent = 'mm（印刷向け 350dpi）';
    var pxOpt = document.createElement('option');
    pxOpt.value = 'px';
    pxOpt.textContent = 'px（Web向け）';
    // 既定の単位は現在の用紙に合わせる（96dpi = Web向け → px、それ以外 → mm）
    if (page && page.size && page.size.dpi === SCREEN_DPI) {
      pxOpt.selected = true;
    } else {
      mmOpt.selected = true;
    }
    unitSelect.appendChild(mmOpt);
    unitSelect.appendChild(pxOpt);

    // 現在の用紙サイズを選択中の単位に換算して入力欄に反映
    function fillInputs() {
      if (!page || !page.size) return;
      if (unitSelect.value === 'px') {
        wInput.value = Math.round(page.size.widthMm * SCREEN_DPI / MM_PER_INCH);
        hInput.value = Math.round(page.size.heightMm * SCREEN_DPI / MM_PER_INCH);
      } else {
        wInput.value = Math.round(page.size.widthMm);
        hInput.value = Math.round(page.size.heightMm);
      }
    }
    fillInputs();
    unitSelect.addEventListener('change', fillInputs);

    var applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'paper-apply-btn';
    applyBtn.textContent = 'このサイズにする';
    applyBtn.addEventListener('click', function() {
      var w = parseFloat(wInput.value);
      var h = parseFloat(hInput.value);
      if (!w || !h || w <= 0 || h <= 0) {
        alert('幅と高さを入力してください');
        return;
      }
      if (unitSelect.value === 'px') {
        onChange({
          preset: 'custom',
          widthMm: w * MM_PER_INCH / SCREEN_DPI,
          heightMm: h * MM_PER_INCH / SCREEN_DPI,
          dpi: SCREEN_DPI
        });
      } else {
        onChange({ preset: 'custom', widthMm: w, heightMm: h, dpi: 350 });
      }
    });

    customRow.appendChild(wInput);
    customRow.appendChild(xSpan);
    customRow.appendChild(hInput);
    container.appendChild(customRow);

    var customRow2 = document.createElement('div');
    customRow2.className = 'paper-custom-row';
    customRow2.appendChild(unitSelect);
    customRow2.appendChild(applyBtn);
    container.appendChild(customRow2);

    // アイテムに合わせて余白を削除（トリミング）
    var onCrop = opts.onCropToContent || function() {};
    var cropTitle = document.createElement('div');
    cropTitle.className = 'paper-custom-title';
    cropTitle.textContent = '余白の削除';
    container.appendChild(cropTitle);
    var cropBtn = document.createElement('button');
    cropBtn.type = 'button';
    cropBtn.className = 'paper-apply-btn';
    cropBtn.textContent = '🗺 アイテムに合わせて余白を削除';
    cropBtn.addEventListener('click', function() { onCrop(); });
    container.appendChild(cropBtn);

    // DnDガイド
    var dndHint = document.createElement('div');
    dndHint.className = 'step-panel-hint';
    dndHint.textContent = '初期状態で画像をドラッグ・アンド・ドロップすると、その画像のサイズになります。';
    container.appendChild(dndHint);
  }

  function presetToSize(preset, landscape) {
    if (preset.wPx) {
      // Webプリセット: 画面px = 出力px になるよう96dpi換算
      return {
        preset: preset.id,
        widthMm: preset.wPx * MM_PER_INCH / SCREEN_DPI,
        heightMm: preset.hPx * MM_PER_INCH / SCREEN_DPI,
        dpi: SCREEN_DPI
      };
    }
    var w = landscape ? preset.hMm : preset.wMm;
    var h = landscape ? preset.wMm : preset.hMm;
    return { preset: preset.id, widthMm: w, heightMm: h, dpi: preset.dpi };
  }

  function formatSize(size) {
    if (size.dpi === SCREEN_DPI) {
      // Web向け: px表示
      var wPx = Math.round(size.widthMm * SCREEN_DPI / MM_PER_INCH);
      var hPx = Math.round(size.heightMm * SCREEN_DPI / MM_PER_INCH);
      return wPx + '×' + hPx + 'px';
    }
    return Math.round(size.widthMm) + '×' + Math.round(size.heightMm) + 'mm（' + size.dpi + 'dpi）';
  }

  // --- エフェクトステップ: 種類選択 ---
  function renderEffectKinds(container, opts) {
    var currentKind = opts.currentEffectKind || 'concentration';
    var onChange = opts.onEffectKindChange || function() {};
    var onDelete = opts.onDeleteSelectedEffects || function() {};
    var kinds = getEffectKindList();

    var title = document.createElement('div');
    title.className = 'effect-kinds-title';
    title.textContent = '効果の種類（線・心理）';
    container.appendChild(title);

    var grid = document.createElement('div');
    grid.className = 'effect-kinds-grid';

    for (var i = 0; i < kinds.length; i++) {
      (function(kind) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'effect-kind-btn';
        if (kind.id === currentKind) btn.classList.add('active');
        btn.textContent = kind.label;
        btn.addEventListener('click', function() {
          onChange(kind.id);
          var siblings = grid.querySelectorAll('.effect-kind-btn');
          for (var j = 0; j < siblings.length; j++) siblings[j].classList.remove('active');
          btn.classList.add('active');
        });
        grid.appendChild(btn);
      })(kinds[i]);
    }
    container.appendChild(grid);

    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'effect-delete-btn';
    delBtn.textContent = '🗑 選択中のエフェクトを削除';
    delBtn.addEventListener('click', function() { onDelete(); });
    container.appendChild(delBtn);

    var delHint = document.createElement('div');
    delHint.className = 'step-panel-hint';
    delHint.textContent = '削除したい効果をクリックで選んでから押してください。';
    container.appendChild(delHint);
  }

  // --- メモステップ（校閲） ---
  function renderMemoGuide(container, opts) {
    var title = document.createElement('div');
    title.className = 'effect-kinds-title';
    title.textContent = 'メモ（校閲用）';
    container.appendChild(title);

    var hint = document.createElement('div');
    hint.className = 'step-panel-hint';
    hint.textContent = 'クリックで文字メモ、ドラッグで赤の自由曲線（白縁）。Shiftで選択。PNG・印刷には出ません。Ctrl+Aでは選ばれません。';
    container.appendChild(hint);

    var clearWrap = document.createElement('div');
    clearWrap.style.marginTop = '12px';
    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'step-action-btn';
    clearBtn.textContent = 'このページのメモをすべて削除';
    clearBtn.style.width = '100%';
    clearBtn.addEventListener('click', function() {
      if (opts.onClearPageMemos) opts.onClearPageMemos();
    });
    clearWrap.appendChild(clearBtn);
    container.appendChild(clearWrap);
  }

  // --- 下書きステップ: 形状選択 ---
  function renderDraftKinds(container, opts) {
    var currentKind = opts.currentDraftKind || 'circle';
    var onChange = opts.onDraftKindChange || function() {};

    var title = document.createElement('div');
    title.className = 'effect-kinds-title';
    title.textContent = '下書きの形状';
    container.appendChild(title);

    var grid = document.createElement('div');
    grid.className = 'effect-kinds-grid';

    var draftKinds = [
      { id: 'circle', label: '円',     icon: '○' },
      { id: 'rect',   label: '四角形', icon: '□' },
      { id: 'line',   label: '直線',   icon: '／' },
      { id: 'string', label: '文字列', icon: 'A' }
    ];

    for (var i = 0; i < draftKinds.length; i++) {
      (function(kind) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'effect-kind-btn draft-kind-btn';
        if (kind.id === currentKind) btn.classList.add('active');
        var iconSpan = document.createElement('span');
        iconSpan.className = 'draft-kind-icon';
        iconSpan.textContent = kind.icon;
        var labelSpan = document.createElement('span');
        labelSpan.className = 'draft-kind-label';
        labelSpan.textContent = kind.label;
        btn.appendChild(iconSpan);
        btn.appendChild(labelSpan);
        btn.addEventListener('click', function() {
          onChange(kind.id);
          var siblings = grid.querySelectorAll('.effect-kind-btn');
          for (var j = 0; j < siblings.length; j++) siblings[j].classList.remove('active');
          btn.classList.add('active');
        });
        grid.appendChild(btn);
      })(draftKinds[i]);
    }
    container.appendChild(grid);

    var hint = document.createElement('div');
    hint.className = 'step-panel-hint';
    hint.textContent = '形状を選んでからキャンバス上で操作します（図形はドラッグ、文字列はクリックで入力）。';
    container.appendChild(hint);

    var clearWrap = document.createElement('div');
    clearWrap.style.marginTop = '12px';
    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'step-action-btn';
    clearBtn.textContent = 'このページの下書きをすべて削除';
    clearBtn.style.width = '100%';
    clearBtn.addEventListener('click', function() {
      if (opts.onClearPageDrafts) opts.onClearPageDrafts();
    });
    clearWrap.appendChild(clearBtn);
    container.appendChild(clearWrap);
  }

  function normalizeHexColor(c) {
    if (!c || typeof c !== 'string') return '#FFFFFF';
    if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
    if (/^#[0-9a-fA-F]{3}$/.test(c)) {
      return '#' + c.charAt(1) + c.charAt(1) + c.charAt(2) + c.charAt(2) + c.charAt(3) + c.charAt(3);
    }
    return '#FFFFFF';
  }

  function addBackingSlider(container, label, value, min, max, onChange) {
    var row = document.createElement('div');
    row.className = 'paper-custom-row';
    row.style.flexWrap = 'wrap';
    var lbl = document.createElement('span');
    if (label === 'コントラスト' || label === 'トーンカーブ') {
      lbl.textContent = label + ' ';
    } else {
      lbl.textContent = label + ': ';
    }
    lbl.style.minWidth = '7em';
    var range = document.createElement('input');
    range.type = 'range';
    range.min = min;
    range.max = max;
    range.value = value;
    range.style.flex = '1';
    range.style.minWidth = '80px';
    var num = document.createElement('span');
    num.className = 'grid-nudge-val';
    num.textContent = String(value);
    function fire() {
      var v = parseFloat(range.value);
      if (isNaN(v)) v = value;
      num.textContent = String(Math.round(v * 10) / 10);
      onChange(v, false);
    }
    function commit() {
      var v = parseFloat(range.value);
      if (isNaN(v)) v = value;
      onChange(v, true);
    }
    range.addEventListener('input', fire);
    range.addEventListener('change', commit);
    row.appendChild(lbl);
    row.appendChild(range);
    row.appendChild(num);
    container.appendChild(row);
  }

  function addBackingCheck(container, label, checked, onChange) {
    var lbl = document.createElement('label');
    lbl.style.marginRight = '10px';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!checked;
    cb.addEventListener('change', function() { onChange(!!cb.checked); });
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(' ' + label));
    container.appendChild(lbl);
  }

  window.ME.UI.StepPanel = {
    create: create,
    render: render
  };
})();
