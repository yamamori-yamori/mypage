// ME.UI.PropertyPanel — プロパティパネル
// ・単一/複数（同一type）編集、α、袋文字、アウトライン化（手書き風ガサつき）、重なり順は従来どおり
// ・吹き出し: 「コマ内にクロップ」チェック（prop='clipToPanel'）
// ・吹き出し/コマ 複数選択時: 「融合」ボタン（prop='__fuse__', value={ids:[...]}）
//   融合済みがあれば「融合を解除」（prop='__unfuse__', value={ids:[...]}）
// ・セリフ: 行間（font.lineHeight）・文字間（font.letterSpacing）

window.ME = window.ME || {};
window.ME.UI = window.ME.UI || {};

(function() {
  'use strict';

  var onPropertyChange = null;

  // queryLocalFontsで取得したこのPCのフォント一覧（読み込み後にキャッシュ）
  var localFonts = [];
  var localFontsLoaded = false;

  // 標準で候補に出す代表的なフォント（日本語＋欧文）。
  // value は canvas/CSS 用のフォールバック列（macOS/Windows の別名差を吸収）。
  var BASE_FONTS = [
    { value: 'sans-serif', label: 'ゴシック体（sans-serif）' },
    { value: 'serif', label: '明朝体（serif）' },
    { value: 'monospace', label: '等幅（monospace）' },
    { value: '"Yu Gothic", YuGothic, "游ゴシック", "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif', label: '游ゴシック' },
    { value: '"Yu Mincho", YuMincho, "游明朝", "Hiragino Mincho ProN", "Hiragino Mincho Pro", "MS PMincho", serif', label: '游明朝' },
    { value: 'Meiryo, "メイリオ", "Hiragino Sans", sans-serif', label: 'メイリオ' },
    { value: '"MS PGothic", "MS Pゴシック", "ＭＳ Ｐゴシック", "Hiragino Sans", sans-serif', label: 'ＭＳ Ｐゴシック' },
    { value: '"MS Gothic", "MS ゴシック", "ＭＳ ゴシック", "Hiragino Sans", monospace', label: 'ＭＳ ゴシック' },
    { value: '"MS PMincho", "MS P明朝", "ＭＳ Ｐ明朝", "Hiragino Mincho ProN", serif', label: 'ＭＳ Ｐ明朝' },
    { value: '"MS Mincho", "MS 明朝", "ＭＳ 明朝", "Hiragino Mincho ProN", serif', label: 'ＭＳ 明朝' },
    { value: '"BIZ UDPGothic", "BIZ UDGothic", sans-serif', label: 'BIZ UDPゴシック' },
    { value: '"BIZ UDPMincho", "BIZ UDMincho", serif', label: 'BIZ UDP明朝' },
    { value: '"UD デジタル 教科書体 NP-R", "UD Digi Kyokasho NP-R", "Yu Gothic", sans-serif', label: 'UDデジタル教科書体' },
    { value: '"HGP創英角ポップ体", "HGP Soei Kakugothic UB", "HGP創英角ゴシックUB", sans-serif', label: 'HGP創英角ポップ体' },
    { value: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "ヒラギノ角ゴシック", sans-serif', label: 'ヒラギノ角ゴ' },
    { value: '"Hiragino Mincho ProN", "Hiragino Mincho Pro", "ヒラギノ明朝 ProN", serif', label: 'ヒラギノ明朝' },
    { value: '"Noto Sans JP", "NotoSansJP", sans-serif', label: 'Noto Sans JP' },
    { value: '"Noto Serif JP", "NotoSerifJP", serif', label: 'Noto Serif JP' },
    { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
    { value: '"Helvetica Neue", Helvetica, Arial, sans-serif', label: 'Helvetica Neue' },
    { value: '"Times New Roman", Times, serif', label: 'Times New Roman' },
    { value: 'Georgia, serif', label: 'Georgia' },
    { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
    { value: 'Tahoma, Geneva, sans-serif', label: 'Tahoma' },
    { value: '"Segoe UI", Tahoma, sans-serif', label: 'Segoe UI' },
    { value: '"Courier New", Courier, monospace', label: 'Courier New' },
    { value: '"Comic Sans MS", "Comic Sans", cursive', label: 'Comic Sans MS' },
    { value: 'Impact, Charcoal, sans-serif', label: 'Impact' }
  ];

  // 1ファミリー名を canvas/CSS 用に整形
  function formatOneFamily(name) {
    if (!name) return '';
    name = String(name).trim();
    if ((name.charAt(0) === '"' && name.charAt(name.length - 1) === '"') ||
        (name.charAt(0) === "'" && name.charAt(name.length - 1) === "'")) {
      name = name.slice(1, -1);
    }
    name = name.replace(/"/g, '').trim();
    if (!name) return '';
    if (/^(sans-serif|serif|monospace|cursive|fantasy|system-ui)$/i.test(name)) return name;
    if (/^[A-Za-z0-9_-]+$/.test(name)) return name;
    return '"' + name + '"';
  }

  // カンマ区切りスタック対応（"Yu Mincho", YuMincho, serif など）
  function toFontValue(name) {
    if (!name) return 'sans-serif';
    name = String(name).trim();
    var parts = [];
    var cur = '';
    var inQ = false;
    var qch = '';
    var i;
    for (i = 0; i < name.length; i++) {
      var ch = name.charAt(i);
      if (inQ) {
        cur += ch;
        if (ch === qch) inQ = false;
      } else if (ch === '"' || ch === "'") {
        inQ = true;
        qch = ch;
        cur += ch;
      } else if (ch === ',') {
        var p = formatOneFamily(cur);
        if (p) parts.push(p);
        cur = '';
      } else {
        cur += ch;
      }
    }
    var last = formatOneFamily(cur);
    if (last) parts.push(last);
    return parts.length ? parts.join(', ') : 'sans-serif';
  }

  // CSS の font-family 用（スタック可）
  function toCssFontFamily(name) {
    return toFontValue(name);
  }

  // 先頭ファミリーで同一視（スタック違いの選択一致用）
  function fontPrimaryKey(name) {
    var stack = toFontValue(name || '');
    var first = stack.split(',')[0] || '';
    first = first.replace(/^["']|["']$/g, '').trim().toLowerCase();
    return first;
  }

  // セレクトにフォント候補を流し込む（基本フォント＋読込済みのPCフォント）。currentValueを選択状態に。
  function populateFontOptions(selectEl, currentValue) {
    selectEl.innerHTML = '';
    var seen = {};
    var matched = false;
    var currentNorm = toFontValue(currentValue || 'sans-serif');
    var currentKey = fontPrimaryKey(currentNorm);

    function addOption(value, label) {
      var v = toFontValue(value);
      if (seen[v]) return;
      seen[v] = true;
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = label;
      opt.style.fontFamily = toCssFontFamily(v);
      if (v === currentNorm || fontPrimaryKey(v) === currentKey) {
        opt.selected = true;
        matched = true;
      }
      selectEl.appendChild(opt);
    }

    for (var i = 0; i < BASE_FONTS.length; i++) {
      addOption(BASE_FONTS[i].value, BASE_FONTS[i].label);
    }

    if (localFonts.length > 0) {
      var sep = document.createElement('option');
      sep.disabled = true;
      sep.textContent = '──── このPCのフォント ────';
      selectEl.appendChild(sep);
      for (var j = 0; j < localFonts.length; j++) {
        addOption(localFonts[j], localFonts[j]);
      }
    }

    // 現在値が候補に無い場合（過去に保存した独自フォント等）は先頭に追加して選択
    if (!matched && currentValue) {
      addOption(currentValue, fontPrimaryKey(currentValue) + '（現在）');
      selectEl.value = currentNorm;
    }
  }

  function create(panelEl) {
    panelEl.innerHTML = '';
    var placeholder = document.createElement('div');
    placeholder.className = 'prop-placeholder';
    placeholder.textContent = 'オブジェクトを選択してください';
    panelEl.appendChild(placeholder);
  }

  function update(project, selection) {
    if (!project || !selection) return;

    var selectedIds = selection.getSelectedIds();
    var panelEl = document.getElementById('property-panel');
    if (!panelEl) return;
    panelEl.innerHTML = '';

    if (selectedIds.length === 0) {
      var placeholder = document.createElement('div');
      placeholder.className = 'prop-placeholder';
      placeholder.textContent = 'オブジェクトを選択してください';
      panelEl.appendChild(placeholder);
      return;
    }

    var objs = [];
    for (var i = 0; i < selectedIds.length; i++) {
      var obj = ME.SceneGraph.getObjectById(project, selectedIds[i]);
      if (obj) objs.push(obj);
    }
    if (objs.length === 0) return;

    var sameType = objs.every(function(o) { return o.type === objs[0].type; });

    var emit = function(prop, value) {
      if (!onPropertyChange) return;
      for (var i = 0; i < objs.length; i++) {
        onPropertyChange(objs[i].id, prop, value);
      }
    };

    // 選択全体に対する1回だけのアクション（融合など）
    var emitOnce = function(prop, value) {
      if (!onPropertyChange) return;
      onPropertyChange(objs[0].id, prop, value);
    };

    var header = document.createElement('div');
    header.className = 'prop-header';
    if (objs.length === 1) {
      header.textContent = typeLabel(objs[0].type) + ' のプロパティ';
    } else if (sameType) {
      header.textContent = typeLabel(objs[0].type) + ' ×' + objs.length + '（一括編集）';
    } else {
      header.textContent = objs.length + ' オブジェクト（種類混在）';
    }
    panelEl.appendChild(header);

    var rep = objs[0];
    if (rep.type === 'panel') {
      // コマ: 位置は出さず、サイズは renderPanelProps 内で表示
    } else if (rep.type === 'image') {
      // 画像: 位置は出さず、元画像のサイズを表示（読み取り専用）
      var iSizeSection = createSection('サイズ');
      addReadonlyField(iSizeSection, '元画像', imageSizeText(rep));
      panelEl.appendChild(iSizeSection);
    } else if (rep.type === 'balloon') {
      // 吹き出し: クロップを一番上、座標は出さない（回転のみ）
      if (sameType) {
        renderDraftClipProps(panelEl, rep, emit);
        var rotSection = createSection(null);
        addNumberField(rotSection, '回転(°)', rep.transform.rotation || 0, function(v) { emit('transform.rotation', v); }, 0, 360);
        panelEl.appendChild(rotSection);
      }
    } else if (rep.type === 'text' || rep.type === 'effect') {
      // セリフ・エフェクト: 座標は出さない（回転のみ）
      if (sameType) {
        var rotSectionT = createSection(null);
        addNumberField(rotSectionT, '回転(°)', rep.transform.rotation || 0, function(v) { emit('transform.rotation', v); }, 0, 360);
        panelEl.appendChild(rotSectionT);
      }
    } else if (rep.type === 'draft') {
      // 下書き: クロップを一番上
      if (sameType) {
        renderDraftClipProps(panelEl, rep, emit);
      }
    } else if (rep.type === 'memo') {
      // メモ: クロップ・融合なし
    } else if (rep.type === 'string') {
      // 旧 type:'string'（移行前）
      var transformSection = createSection('位置');
      addNumberField(transformSection, 'X', rep.transform.x, function(v) { emit('transform.x', v); });
      addNumberField(transformSection, 'Y', rep.transform.y, function(v) { emit('transform.y', v); });
      panelEl.appendChild(transformSection);
    } else {
      var transformSection = createSection('位置');
      addNumberField(transformSection, 'X', rep.transform.x, function(v) { emit('transform.x', v); });
      addNumberField(transformSection, 'Y', rep.transform.y, function(v) { emit('transform.y', v); });
      if (sameType) {
        addNumberField(transformSection, '回転(°)', rep.transform.rotation || 0, function(v) { emit('transform.rotation', v); }, 0, 360);
      }
      panelEl.appendChild(transformSection);
    }

    if (sameType) {
      switch (rep.type) {
        case 'panel':   renderPanelProps(panelEl, rep, emit); break;
        case 'image':   renderImageProps(panelEl, rep, emit, objs.length === 1); break;
        case 'balloon': renderBalloonProps(panelEl, rep, emit); break;
        case 'text':    renderTextProps(panelEl, rep, emit); break;
        case 'effect':  renderEffectProps(panelEl, rep, emit); break;
        case 'string':  renderStringProps(panelEl, rep, emit); break;
        case 'draft':
          if (rep.kind === 'string') {
            renderStringProps(panelEl, rep, emit);
          } else {
            renderDraftShapeProps(panelEl, rep, emit);
          }
          break;
        case 'memo':
          if (rep.kind === 'string') {
            renderStringProps(panelEl, rep, emit);
          } else {
            renderDraftShapeProps(panelEl, rep, emit);
          }
          break;
      }

      // 融合（コマ/吹き出し/下書き）。メモは融合なし
      if (rep.type === 'panel' || rep.type === 'balloon' || rep.type === 'draft') {
        renderFusionSection(panelEl, objs, emitOnce);
      }
    }

    // 重なり順（下書き・メモ以外）
    if (rep.type !== 'draft' && rep.type !== 'memo') {
      var zSection = createSection('重なり順');
      var zRow = document.createElement('div');
      zRow.className = 'prop-zorder-row';
      var frontBtn = document.createElement('button');
      frontBtn.type = 'button';
      frontBtn.className = 'prop-zorder-btn';
      frontBtn.textContent = '⬆ 最前面へ';
      frontBtn.addEventListener('click', function() { emit('__zorder__', 'front'); });
      var backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.className = 'prop-zorder-btn';
      backBtn.textContent = '⬇ 最背面へ';
      backBtn.addEventListener('click', function() { emit('__zorder__', 'back'); });
      zRow.appendChild(frontBtn);
      zRow.appendChild(backBtn);
      zSection.appendChild(zRow);
      panelEl.appendChild(zSection);
    }

    // 削除
    var delBtn = document.createElement('button');
    delBtn.className = 'prop-delete-btn';
    delBtn.textContent = objs.length === 1 ? '✖ オブジェクトを削除' : '✖ 選択オブジェクトを削除 (' + objs.length + ')';
    delBtn.addEventListener('click', function() { emit('__delete__', true); });
    panelEl.appendChild(delBtn);
  }

  function typeLabel(type) {
    var map = { panel: 'コマ', image: '画像', balloon: '吹き出し', text: 'セリフ', effect: 'エフェクト', draft: '下書き', memo: 'メモ', string: '文字列' };
    return map[type] || type;
  }

  // --- 融合セクション（コマ・吹き出し共通） ---
  function renderFusionSection(container, objs, emitOnce) {
    var t0 = objs[0] && objs[0].type;
    var sectionTitle = t0 === 'balloon' ? '複数吹き出し融合'
      : t0 === 'draft' ? '複数下書き融合'
      : '複数コマ融合';
    var section = createSection(sectionTitle);
    var ids = [];
    var anyFused = false;
    for (var i = 0; i < objs.length; i++) {
      ids.push(objs[i].id);
      if (objs[i].fusionGroup) anyFused = true;
    }

    if (objs.length >= 2) {
      var fuseBtn = document.createElement('button');
      fuseBtn.type = 'button';
      fuseBtn.className = 'prop-zorder-btn';
      fuseBtn.textContent = '⚭ 選択した' + typeLabel(objs[0].type) + 'を融合';
      fuseBtn.addEventListener('click', function() {
        emitOnce('__fuse__', { ids: ids });
      });
      section.appendChild(fuseBtn);
    }

    if (anyFused) {
      var unfuseBtn = document.createElement('button');
      unfuseBtn.type = 'button';
      unfuseBtn.className = 'prop-zorder-btn';
      unfuseBtn.style.marginTop = '4px';
      unfuseBtn.textContent = '融合を解除';
      unfuseBtn.addEventListener('click', function() {
        emitOnce('__unfuse__', { ids: ids });
      });
      section.appendChild(unfuseBtn);
    }

    if (objs.length < 2 && !anyFused) {
      var note = document.createElement('div');
      note.className = 'prop-placeholder';
      note.style.padding = '4px 0';
      note.textContent = '2つ以上選択すると融合できます';
      section.appendChild(note);
    }

    container.appendChild(section);
  }

  // --- コマ ---
  function renderPanelProps(container, obj, emit) {
    addReadonlyField(container, 'コマの大きさ', panelSizeText(obj));

    addPlusMinusNumberField(container, {
      label: '線幅',
      value: obj.borderWidth !== undefined ? obj.borderWidth : 2,
      min: 0,
      max: 50,
      step: 1,
      fieldClass: 'prop-field prop-stepper-field prop-stroke-row',
      onChange: function(v) { emit('borderWidth', v); }
    });

    // 枠線のガサつき（頂点は動かさない。描画レイヤーのみ）
    addSliderField(
      container,
      'ガサつき',
      normalizeOutlineRoughness(obj.borderRoughness),
      0,
      10,
      function(v) { emit('borderRoughness', v); }
    );

    addColorField(container, '線の色', obj.borderColor || '#000000', function(v) { emit('borderColor', v); });
    addSliderField(container, '不透明度', obj.borderAlpha !== undefined ? obj.borderAlpha : 100, 0, 100, function(v) { emit('borderAlpha', v); });

    addColorField(container, '塗り色', obj.fillColor || '#FFFFFF', function(v) { emit('fillColor', v); });
    addSliderField(container, '不透明度', obj.fillAlpha !== undefined ? obj.fillAlpha : 100, 0, 100, function(v) { emit('fillAlpha', v); });

    addCheckboxField(container, '画像をコマからはみ出さない', obj.clipPath !== false, function(v) { emit('clipPath', v); });

    var cropBtn = document.createElement('button');
    cropBtn.type = 'button';
    cropBtn.className = 'prop-zorder-btn';
    cropBtn.style.marginTop = '4px';
    cropBtn.textContent = '🖼 中の絵に合わせてコマをリサイズ';
    cropBtn.addEventListener('click', function() { emit('__cropToImage__', true); });
    container.appendChild(cropBtn);
  }

  // --- 画像 ---
  function renderImageProps(container, obj, emit, canReplace) {
    if (canReplace) {
      var repSection = createSection('画像');
      var replaceBtn = document.createElement('button');
      replaceBtn.type = 'button';
      replaceBtn.className = 'prop-zorder-btn';
      replaceBtn.textContent = '🔄 画像を差し替える';
      replaceBtn.addEventListener('click', function() { emit('__replaceImage__', true); });
      repSection.appendChild(replaceBtn);
      container.appendChild(repSection);
    }

    var tf = createSection('変形');
    var scalePct = Math.round(((obj.transform && obj.transform.scaleX) || 1) * 100);
    addSliderField(tf, '拡大率(%)', scalePct, 10, 400, function(v) { emit('transform.scale', v); });
    addSliderField(tf, '回転(°)', Math.round((obj.transform && obj.transform.rotation) || 0), 0, 360, function(v) { emit('transform.rotation', v); });
    container.appendChild(tf);

    var section = createSection('画像調整');

    addSliderField(section, '明るさ', obj.colorAdjust.brightness || 0, -100, 100, function(v) { emit('colorAdjust.brightness', v); });
    addSliderField(section, 'コントラスト', obj.colorAdjust.contrast || 0, -100, 100, function(v) { emit('colorAdjust.contrast', v); });
    addSliderField(section, '彩度', obj.colorAdjust.saturation || 0, -100, 100, function(v) { emit('colorAdjust.saturation', v); });
    addSliderField(section, '白黒', obj.colorAdjust.grayscale || 0, 0, 100, function(v) { emit('colorAdjust.grayscale', v); });
    addSliderField(section, '色相', obj.colorAdjust.hue || 0, 0, 360, function(v) { emit('colorAdjust.hue', v); });
    addSliderField(section, 'トーンカーブ', obj.colorAdjust.tone || 0, -100, 100, function(v) { emit('colorAdjust.tone', v); });
    addSliderField(section, '不透明度', obj.colorAdjust.opacity !== undefined ? obj.colorAdjust.opacity : 100, 0, 100, function(v) { emit('colorAdjust.opacity', v); });

    addCheckboxField(section, '左右反転', obj.flipX || false, function(v) { emit('flipX', v); });
    addCheckboxField(section, '上下反転', obj.flipY || false, function(v) { emit('flipY', v); });

    container.appendChild(section);
  }

  // --- 吹き出し ---
  function renderBalloonProps(container, obj, emit) {
    var section = createSection(null);

    var shapeField = document.createElement('div');
    shapeField.className = 'prop-field';
    var shapeLabel = document.createElement('label');
    shapeLabel.textContent = '形状:';
    var shapeSelect = document.createElement('select');
    var shapes = [
      { id: 'ellipse', label: '楕円' },
      { id: 'softEllipse', label: '歪み楕円' },
      { id: 'superEllipse', label: 'スーパー楕円' },
      { id: 'wobble', label: '手描き風（ゆらゆら）' },
      { id: 'wobble2', label: '手描き風（ラフ）' },
      { id: 'rect', label: '四角' },
      { id: 'roughRect', label: 'ガタつき四角' },
      { id: 'roundedRect', label: '角丸四角' },
      { id: 'irregularOctagon', label: '角を直線で落とした四角形' },
      { id: 'handDrawnPolygon', label: '手書き風多角形' },
      { id: 'roughPoly', label: '手書き風多角形２' },
      { id: 'verticalHexagon', label: '縦六角形' },
      { id: 'heptagon', label: '七角形' },
      { id: 'nonagon', label: '九角形' },
      { id: 'concaveCurve', label: '凹曲面（叫び）' },
      { id: 'concaveCurveShallow', label: '凹曲面（浅）' },
      { id: 'jaggedRect', label: 'ギザ四角' },
      { id: 'jagged', label: 'ギザギザ' },
      { id: 'softBurst', label: 'やわらかトゲ' },
      { id: 'spikyExplosion', label: '爆発' },
      { id: 'shortConcLines', label: '短い集中線' },
      { id: 'kebaKebaLines', label: 'ケバケバ線' },
    ];
    for (var i = 0; i < shapes.length; i++) {
      var opt = document.createElement('option');
      opt.value = shapes[i].id;
      opt.textContent = shapes[i].label;
      if (obj.shape === shapes[i].id) opt.selected = true;
      shapeSelect.appendChild(opt);
    }
    shapeSelect.addEventListener('change', function() { emit('shape', this.value); });
    shapeLabel.appendChild(shapeSelect);
    shapeField.appendChild(shapeLabel);
    section.appendChild(shapeField);

    addColorField(section, '塗り色', obj.fillColor || '#FFFFFF', function(v) { emit('fillColor', v); });
    addSliderField(section, '不透明度', obj.fillAlpha !== undefined ? obj.fillAlpha : 100, 0, 100, function(v) { emit('fillAlpha', v); });

    addColorField(section, '線の色', obj.strokeColor || '#000000', function(v) { emit('strokeColor', v); });
    addSliderField(section, '不透明度', obj.strokeAlpha !== undefined ? obj.strokeAlpha : 100, 0, 100, function(v) { emit('strokeAlpha', v); });
    addStrokeWidthRow(
      section,
      obj.strokeWidth !== undefined ? obj.strokeWidth : 2,
      function(v) { emit('strokeWidth', v); }
    );
    addBalloonStrokeStyleCheckboxes(
      section,
      !!obj.doubleStroke,
      !!obj.innerLine,
      !!obj.dashed,
      function(v) { emit('doubleStroke', v); },
      function(v) { emit('innerLine', v); },
      function(v) { emit('dashed', v); }
    );
    // 線のガサつき（セリフ袋 outline.roughness と同系 0-10）
    addSliderField(
      section,
      'ガサつき',
      normalizeOutlineRoughness(obj.strokeRoughness),
      0,
      10,
      function(v) { emit('strokeRoughness', v); }
    );

    // しっぽ: チェックではなくセレクト先頭「なし」
    var tailField = document.createElement('div');
    tailField.className = 'prop-field';
    var tailLabel = document.createElement('label');
    tailLabel.textContent = 'しっぽ:';
    var tailSelect = document.createElement('select');
    var tailTypes = [
      { id: 'none',        label: 'なし' },
      { id: 'normal',      label: '通常（三角）' },
      { id: 'normalThick', label: '通常（太）' },
      { id: 'thought',     label: '〇しっぽ（内心）' },
      { id: 'thoughtFew',  label: '〇しっぽ（少ない）' },
      { id: 'jagged',      label: 'ギザギザ（叫び）' },
      { id: 'jaggedThick', label: 'ギザギザ（太）' },
      { id: 'lightning',   label: '稲妻（ボルト）' },
      { id: 'spiral',      label: 'クルクル（一ひねり）' }
    ];
    var curType = obj.tail ? (obj.tail.type || 'normal') : 'none';
    for (var ti = 0; ti < tailTypes.length; ti++) {
      var tOpt = document.createElement('option');
      tOpt.value = tailTypes[ti].id;
      tOpt.textContent = tailTypes[ti].label;
      if (curType === tailTypes[ti].id) tOpt.selected = true;
      tailSelect.appendChild(tOpt);
    }
    tailSelect.addEventListener('change', function() { emit('tail.type', this.value); });
    tailLabel.appendChild(tailSelect);
    tailField.appendChild(tailLabel);
    section.appendChild(tailField);
    // コマクロップはプロパティ最上段（renderDraftClipProps）へ移動済み

    container.appendChild(section);
  }

  // --- セリフ ---
  function renderTextProps(container, obj, emit) {
    var section = createSection(null);

    var contentField = document.createElement('div');
    contentField.className = 'prop-field';
    var contentLabel = document.createElement('label');
    contentLabel.textContent = '内容:';
    var contentArea = document.createElement('textarea');
    contentArea.rows = 3;
    contentArea.value = obj.content || '';
    contentArea.addEventListener('input', function() { emit('content', this.value); });
    contentLabel.appendChild(contentArea);
    contentField.appendChild(contentLabel);
    section.appendChild(contentField);

    var wmField = document.createElement('div');
    wmField.className = 'prop-field';
    var wmLabel = document.createElement('label');
    wmLabel.textContent = '文字方向:';
    var wmBtn = document.createElement('button');
    wmBtn.type = 'button';
    wmBtn.className = 'prop-toggle-btn';
    var wmState = (obj.writingMode === 'horizontal') ? 'horizontal' : 'vertical';
    function wmText(m) { return (m === 'vertical') ? '縦書き（押すと横書き）' : '横書き（押すと縦書き）'; }
    wmBtn.textContent = wmText(wmState);
    wmBtn.addEventListener('click', function() {
      wmState = (wmState === 'vertical') ? 'horizontal' : 'vertical';
      emit('writingMode', wmState);
      wmBtn.textContent = wmText(wmState);
      wmBtn.blur(); // フォーカスを外し、直後のEnterでボタンが再クリックされないようにする
    });
    // Enter / Space ではトグルしない（セリフ確定のEnter等での誤作動を防ぐ）
    wmBtn.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); }
    });
    wmLabel.appendChild(wmBtn);
    wmField.appendChild(wmLabel);
    section.appendChild(wmField);

    var ffField = document.createElement('div');
    ffField.className = 'prop-field';
    var ffLabel = document.createElement('label');
    ffLabel.textContent = 'フォント:';
    var ffSelect = document.createElement('select');
    populateFontOptions(ffSelect, obj.font.family);
    ffSelect.addEventListener('change', function() {
      emit('font.family', toFontValue(this.value));
    });
    ffLabel.appendChild(ffSelect);
    ffField.appendChild(ffLabel);
    section.appendChild(ffField);

    // 「PCのフォントをすべて読み込む」ボタン（対応ブラウザのみ）。
    // ローカルフォントアクセスAPI(queryLocalFonts)でこのPCで使えるフォントを列挙して一覧に追加する。
    if (typeof window.queryLocalFonts === 'function') {
      var loadFontsBtn = document.createElement('button');
      loadFontsBtn.type = 'button';
      loadFontsBtn.className = 'prop-zorder-btn';
      loadFontsBtn.style.marginTop = '4px';
      loadFontsBtn.textContent = localFontsLoaded
        ? '🖋 PCのフォント（' + localFonts.length + '件）読込済み'
        : '🖋 PCのフォントをすべて読み込む';
      loadFontsBtn.addEventListener('click', function() {
        loadFontsBtn.disabled = true;
        loadFontsBtn.textContent = '読み込み中…';
        window.queryLocalFonts().then(function(fonts) {
          var seen = {};
          var fams = [];
          for (var i = 0; i < fonts.length; i++) {
            var fam = fonts[i].family;
            if (fam && !seen[fam]) { seen[fam] = true; fams.push(fam); }
          }
          fams.sort(function(a, b) { return a.localeCompare(b, 'ja'); });
          localFonts = fams;
          localFontsLoaded = true;
          populateFontOptions(ffSelect, ffSelect.value);
          loadFontsBtn.disabled = false;
          loadFontsBtn.textContent = '🖋 PCのフォント（' + localFonts.length + '件）読込済み';
        }).catch(function(err) {
          loadFontsBtn.disabled = false;
          loadFontsBtn.textContent = '🖋 読み込めませんでした（クリックで再試行）';
        });
      });
      section.appendChild(loadFontsBtn);
    }

    addFontSizeField(section, obj.font.size || 16, function(v) { emit('font.size', v); });
    addColorField(section, '文字色', obj.font.color || '#000000', function(v) { emit('font.color', v); });
    addSliderField(section, '不透明度', obj.font.alpha !== undefined ? obj.font.alpha : 100, 0, 100, function(v) { emit('font.alpha', v); });
    addInlineCheckboxRow(section, [
      { label: '太字', checked: obj.font.bold || false, onChange: function(v) { emit('font.bold', v); } },
      { label: '取り消し', checked: !!obj.font.strikethrough, onChange: function(v) { emit('font.strikethrough', v); } },
      { label: '傍点', checked: !!obj.font.ruby, onChange: function(v) { emit('font.ruby', v); } }
    ]);

    // 行間・文字間
    addNumberFieldStep(section, '行間', obj.font.lineHeight !== undefined ? obj.font.lineHeight : 1.2, 0.5, 3, 0.1, function(v) { emit('font.lineHeight', v); });
    addNumberFieldStep(section, '文字間(px)', obj.font.letterSpacing !== undefined ? obj.font.letterSpacing : 0, -50, 50, 1, function(v) { emit('font.letterSpacing', v); });

    container.appendChild(section);

    // 袋文字（標準の白フチ・クリーン）
    var bagSection = createSection(null);
    addCheckboxField(bagSection, '袋文字', !!(obj.outline && obj.outline.enabled), function(v) { emit('outline.enabled', v); });
    if (obj.outline && obj.outline.enabled) {
      addColorField(bagSection, '色', obj.outline.color || '#FFFFFF', function(v) { emit('outline.color', v); });
      addSliderField(bagSection, '不透明度', obj.outline.alpha !== undefined ? obj.outline.alpha : 100, 0, 100, function(v) { emit('outline.alpha', v); });
      var ow0 = obj.outline.width !== undefined ? obj.outline.width : 2;
      if (ow0 > 10) ow0 = 10;
      if (ow0 < 1) ow0 = 1;
      addSliderField(bagSection, '太さ', ow0, 1, 10, function(v) { emit('outline.width', v); });
    }
    container.appendChild(bagSection);

    // アウトライン化（レイアウト化）— 台形変形もこの配下（ベクター輪郭に適用してぼやけ防止）
    // OFF時は内部パラメーターを非表示、ON時は即時表示（チェック直後にサブ項目が出るように動的制御）
    var roughSection = createSection(null);

    // チェックボックスを手動作成（emit + 即時サブ表示切替のため）
    var cbDiv = document.createElement('div');
    cbDiv.className = 'prop-field';
    var cbLbl = document.createElement('label');
    cbLbl.textContent = 'アウトライン化';
    var cbInput = document.createElement('input');
    cbInput.type = 'checkbox';
    cbInput.checked = !!(obj.outline && obj.outline.artisticEnabled);
    cbLbl.appendChild(cbInput);
    cbDiv.appendChild(cbLbl);
    roughSection.appendChild(cbDiv);

    // サブパラメーター用コンテナ（ON/OFFで表示切替）
    var subDiv = document.createElement('div');
    subDiv.style.display = cbInput.checked ? '' : 'none';

    var r0 = normalizeOutlineRoughness(obj.outline && obj.outline.roughness);
    addSliderField(subDiv, 'ガサつき', r0, 0, 10, function(v) { emit('outline.roughness', v); });
    var rn0 = readOutlineRoundness(obj.outline);
    addRoundnessSlider(subDiv, '角〜丸', rn0, function(v) { emit('outline.roundness', v); });

    // 台形変形（アウトライン化ON時のみ表示。中央縦軸固定・上辺/下辺を縮小〜拡大）
    var trapHeader = document.createElement('div');
    trapHeader.className = 'prop-field';
    var trapHeaderLbl = document.createElement('label');
    trapHeaderLbl.textContent = '台形変形';
    trapHeaderLbl.style.fontWeight = 'bold';
    trapHeaderLbl.style.minWidth = 'auto';
    trapHeaderLbl.style.textAlign = 'left';
    trapHeaderLbl.title = 'レイアウト化した輪郭に適用（中央縦軸固定）。ピクセル伸縮しないのでぼやけません';
    trapHeader.appendChild(trapHeaderLbl);
    subDiv.appendChild(trapHeader);

    var top0 = readTrapezoidEdge(obj.outline, 'top');
    var bot0 = readTrapezoidEdge(obj.outline, 'bottom');
    addTrapezoidEdgeSlider(subDiv, '上辺', top0, function(v) {
      emit('outline.trapezoidTop', v);
    });
    addTrapezoidEdgeSlider(subDiv, '下辺', bot0, function(v) {
      emit('outline.trapezoidBottom', v);
    });

    roughSection.appendChild(subDiv);

    // チェック変更で emit + 即時サブ表示切替
    cbInput.addEventListener('change', function() {
      emit('outline.artisticEnabled', this.checked);
      subDiv.style.display = this.checked ? '' : 'none';
    });

    container.appendChild(roughSection);
  }

  // --- エフェクト ---
  function isLinePsychEffect(kind) {
    if (ME.Effects && typeof ME.Effects.isLinePsychKind === 'function') {
      return ME.Effects.isLinePsychKind(kind);
    }
    return kind === 'concentration' || kind === 'speedLines' ||
      kind === 'horrorLines' || kind === 'dropLines' ||
      kind === 'wavyLines' || kind === 'crackLines';
  }

  function renderEffectProps(container, obj, emit) {
    var section = createSection('効果設定');

    var kindField = document.createElement('div');
    kindField.className = 'prop-field';
    var kindLabel = document.createElement('label');
    kindLabel.textContent = '種類:';
    var kindSelect = document.createElement('select');
    var KINDS = [
      { id: 'concentration', label: '集中線' },
      { id: 'speedLines', label: 'スピード線' },
      { id: 'horrorLines', label: 'ホラー線' },
      { id: 'dropLines', label: 'ドロップ線' },
      { id: 'wavyLines', label: '揺れ線' },
      { id: 'crackLines', label: 'ヒビ' },
      { id: 'whiteFlash', label: '白フラッシュ' },
      { id: 'blackFlash', label: '黒フラッシュ' },
      { id: 'frame', label: '枠線' },
      { id: 'whiteBorder', label: '白フチ' }
    ];
    if (ME.Effects && ME.Effects.STEP_KINDS) {
      KINDS = ME.Effects.STEP_KINDS.concat([
        { id: 'whiteFlash', label: '白フラッシュ' },
        { id: 'blackFlash', label: '黒フラッシュ' },
        { id: 'frame', label: '枠線' },
        { id: 'whiteBorder', label: '白フチ' }
      ]);
    }
    var kindFound = false;
    for (var i = 0; i < KINDS.length; i++) {
      var opt = document.createElement('option');
      opt.value = KINDS[i].id;
      opt.textContent = KINDS[i].label;
      if (obj.kind === KINDS[i].id) { opt.selected = true; kindFound = true; }
      kindSelect.appendChild(opt);
    }
    if (!kindFound && obj.kind) {
      var optU = document.createElement('option');
      optU.value = obj.kind;
      optU.textContent = obj.kind;
      optU.selected = true;
      kindSelect.appendChild(optU);
    }
    kindSelect.addEventListener('change', function() { emit('kind', this.value); });
    kindField.appendChild(kindLabel);
    kindField.appendChild(kindSelect);
    section.appendChild(kindField);

    var scopeField = document.createElement('div');
    scopeField.className = 'prop-field';
    var scopeLabel = document.createElement('label');
    scopeLabel.textContent = '適用範囲:';
    var scopeSpan = document.createElement('span');
    scopeSpan.textContent = obj.scope === 'panel' ? 'コマ内' : 'ページ全体';
    scopeField.appendChild(scopeLabel);
    scopeField.appendChild(scopeSpan);
    section.appendChild(scopeField);

    if (obj.params && typeof obj.params.color === 'string') {
      addColorField(section, '色', obj.params.color, function(v) { emit('params', { color: v }); });
    }

    if (isLinePsychEffect(obj.kind)) {
      if (obj.kind === 'speedLines' || obj.kind === 'wavyLines') {
        var dirField = document.createElement('div');
        dirField.className = 'prop-field';
        var dirLabel = document.createElement('label');
        dirLabel.textContent = '向き:';
        var dirSelect = document.createElement('select');
        var dirs = (obj.kind === 'wavyLines')
          ? [{ id: 'horizontal', label: '横' }, { id: 'vertical', label: '縦' }]
          : [
            { id: 'horizontal', label: '横' },
            { id: 'vertical', label: '縦' },
            { id: 'diagonal', label: '斜め' }
          ];
        var curDir = (obj.params && obj.params.direction) || 'horizontal';
        for (var di = 0; di < dirs.length; di++) {
          var dOpt = document.createElement('option');
          dOpt.value = dirs[di].id;
          dOpt.textContent = dirs[di].label;
          if (curDir === dirs[di].id) dOpt.selected = true;
          dirSelect.appendChild(dOpt);
        }
        dirSelect.addEventListener('change', function() { emit('params', { direction: this.value }); });
        dirLabel.appendChild(dirSelect);
        dirField.appendChild(dirLabel);
        section.appendChild(dirField);
      }
      if (obj.kind === 'speedLines') {
        var alField = document.createElement('div');
        alField.className = 'prop-field';
        var alLabel = document.createElement('label');
        alLabel.textContent = '寄せ:';
        var alSelect = document.createElement('select');
        var aligns = [
          { id: 'start', label: '始点側' },
          { id: 'center', label: '中央' },
          { id: 'end', label: '終点側' }
        ];
        var curAl = (obj.params && obj.params.align) || 'start';
        for (var ai = 0; ai < aligns.length; ai++) {
          var aOpt = document.createElement('option');
          aOpt.value = aligns[ai].id;
          aOpt.textContent = aligns[ai].label;
          if (curAl === aligns[ai].id) aOpt.selected = true;
          alSelect.appendChild(aOpt);
        }
        alSelect.addEventListener('change', function() { emit('params', { align: this.value }); });
        alLabel.appendChild(alSelect);
        alField.appendChild(alLabel);
        section.appendChild(alField);
      }

      var lc = (obj.params && obj.params.lineCount !== undefined) ? obj.params.lineCount : 24;
      var lcMax = (obj.kind === 'horrorLines') ? 120 : 80;
      addSliderField(section, '本数', lc, 4, lcMax, function(v) { emit('params', { lineCount: v }); });
      var lr = (obj.params && obj.params.lengthRatio !== undefined) ? obj.params.lengthRatio : 90;
      var lrMax = 100;
      if (obj.kind === 'speedLines') lrMax = 200;
      if (obj.kind === 'concentration') lrMax = 100;
      if (lr > lrMax) lr = lrMax;
      addSliderField(section, '長さ(%)', lr, 10, lrMax, function(v) { emit('params', { lengthRatio: v }); });
      var th = (obj.params && obj.params.thickness !== undefined) ? obj.params.thickness : 100;
      addSliderField(section, '太さ(%)', th, 10, 400, function(v) { emit('params', { thickness: v }); });
      var jit = (obj.params && obj.params.jitter !== undefined) ? obj.params.jitter : 30;
      addSliderField(section, '揺らぎ(%)', jit, 0, 100, function(v) { emit('params', { jitter: v }); });
      var seedVal = (obj.params && obj.params.seed !== undefined) ? obj.params.seed : 0;
      addSliderField(section, '乱数', seedVal, 0, 999, function(v) { emit('params', { seed: v }); });

      if (obj.kind === 'concentration' || obj.kind === 'speedLines' ||
          obj.kind === 'dropLines' || obj.kind === 'wavyLines') {
        var lv = (obj.params && obj.params.lengthVariation !== undefined) ? obj.params.lengthVariation : 50;
        addSliderField(section, '長さのばらつき(%)', lv, 0, 100, function(v) { emit('params', { lengthVariation: v }); });
      }
      if (obj.kind === 'horrorLines') {
        var ep = (obj.params && obj.params.edgePadding !== undefined) ? obj.params.edgePadding : 0;
        addSliderField(section, '縁余白(%)', ep, 0, 40, function(v) { emit('params', { edgePadding: v }); });
      }
      if (obj.kind === 'dropLines') {
        var bw = (obj.params && obj.params.bandWidth !== undefined) ? obj.params.bandWidth : 100;
        var ox = (obj.params && obj.params.offsetX !== undefined) ? obj.params.offsetX : 0;
        var dr = (obj.params && obj.params.drift !== undefined) ? obj.params.drift : 0;
        addSliderField(section, '幅(%)', bw, 10, 100, function(v) { emit('params', { bandWidth: v }); });
        addSliderField(section, '左右位置', ox, -50, 50, function(v) { emit('params', { offsetX: v }); });
        addSliderField(section, '横ずれ(%)', dr, 0, 100, function(v) { emit('params', { drift: v }); });
      }
      if (obj.kind === 'wavyLines') {
        var amp = (obj.params && obj.params.amplitude !== undefined) ? obj.params.amplitude : 8;
        var wl = (obj.params && obj.params.wavelength !== undefined) ? obj.params.wavelength : 36;
        addSliderField(section, '振幅', amp, 1, 40, function(v) { emit('params', { amplitude: v }); });
        addSliderField(section, '波長', wl, 8, 120, function(v) { emit('params', { wavelength: v }); });
      }
      if (obj.kind === 'crackLines') {
        var br = (obj.params && obj.params.branch !== undefined) ? obj.params.branch : 2;
        addSliderField(section, '分岐', br, 0, 4, function(v) { emit('params', { branch: v }); });
      }
    }

    container.appendChild(section);
  }

  // --- ヘルパ ---
  // コマのサイズ文字列（頂点のバウンディングボックスから px と mm）
  function panelSizeText(obj) {
    var verts = obj.vertices || [];
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < verts.length; i++) {
      var v = verts[i];
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }
    if (!isFinite(minX)) return '\u2014';
    var w = Math.round(maxX - minX), h = Math.round(maxY - minY);
    var wmm = Math.round((maxX - minX) * 25.4 / 96), hmm = Math.round((maxY - minY) * 25.4 / 96);
    return w + '\u00d7' + h + 'px\uff08' + wmm + '\u00d7' + hmm + 'mm\uff09';
  }
  // 元画像のサイズ文字列（読み込んだ画像の実ピクセル）
  function imageSizeText(obj) {
    var w = obj.width || 0, h = obj.height || 0;
    if (!w || !h) return '\u2014\uff08\u672a\u8aad\u8fbc\uff09';
    return w + '\u00d7' + h + 'px';
  }
  function addReadonlyField(section, label, text) {
    var field = document.createElement('div');
    field.className = 'prop-field';
    var lbl = document.createElement('label');
    lbl.textContent = label + ':';
    var span = document.createElement('span');
    span.className = 'prop-readonly-val';
    span.textContent = text;
    field.appendChild(lbl);
    field.appendChild(span);
    section.appendChild(field);
  }

  function createSection(title) {
    var section = document.createElement('div');
    section.className = 'prop-section';
    if (title) {
      var titleEl = document.createElement('h4');
      titleEl.textContent = title;
      section.appendChild(titleEl);
    }
    return section;
  }

  function addNumberField(section, label, value, onChange, min, max) {
    var field = document.createElement('div');
    field.className = 'prop-field';
    var lbl = document.createElement('label');
    lbl.textContent = label + ':';
    var input = document.createElement('input');
    input.type = 'number';
    input.value = value;
    if (min !== undefined) input.min = min;
    if (max !== undefined) input.max = max;
    input.addEventListener('input', function() {
      var v = parseFloat(this.value);
      if (!isNaN(v)) onChange(v);
    });
    field.appendChild(lbl);
    field.appendChild(input);
    section.appendChild(field);
  }

  // step指定つき数値フィールド（行間などの小数用）
  function addNumberFieldStep(section, label, value, min, max, step, onChange) {
    var field = document.createElement('div');
    field.className = 'prop-field';
    var lbl = document.createElement('label');
    lbl.textContent = label + ':';
    var input = document.createElement('input');
    input.type = 'number';
    input.value = value;
    input.min = min;
    input.max = max;
    input.step = step;
    input.addEventListener('input', function() {
      var v = parseFloat(this.value);
      if (!isNaN(v)) onChange(v);
    });
    field.appendChild(lbl);
    field.appendChild(input);
    section.appendChild(field);
  }

  // フォントサイズ: スライダー + −/＋微調整。4〜400。
  function addFontSizeField(section, value, onChange) {
    var min = 4;
    var max = 400;
    var field = document.createElement('div');
    field.className = 'prop-field prop-fontsize-field prop-fontsize-slider-row';
    var lbl = document.createElement('label');
    lbl.textContent = 'サイズ:';

    var v0 = value !== undefined ? value : 16;
    v0 = Math.round(v0);
    if (v0 < min) v0 = min;
    if (v0 > max) v0 = max;

    var valSpan = document.createElement('span');
    valSpan.className = 'slider-val';
    valSpan.textContent = v0;

    var range = document.createElement('input');
    range.type = 'range';
    range.min = min;
    range.max = max;
    range.step = 1;
    range.value = v0;
    range.title = 'フォントサイズ（4〜400）';

    var wrap = document.createElement('div');
    wrap.className = 'fontsize-wrap';
    var minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'fontsize-btn';
    minus.textContent = '−';
    var plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'fontsize-btn';
    plus.textContent = '＋';

    function clamp(v) {
      v = Math.round(v);
      if (v < min) v = min;
      if (v > max) v = max;
      return v;
    }
    function setVal(v, fromUi) {
      v = clamp(v);
      range.value = v;
      valSpan.textContent = v;
      if (!fromUi) {
        // no-op
      }
      onChange(v);
    }
    range.addEventListener('input', function() {
      setVal(parseInt(this.value, 10) || min, true);
    });
    function stepBy(d) {
      setVal((parseInt(range.value, 10) || min) + d, true);
    }
    function bindRepeat(btn, d) {
      var t = null;
      var iv = null;
      function stop() {
        if (t) { clearTimeout(t); t = null; }
        if (iv) { clearInterval(iv); iv = null; }
      }
      btn.addEventListener('mousedown', function(e) {
        e.preventDefault();
        stepBy(d);
        stop();
        t = setTimeout(function() {
          iv = setInterval(function() { stepBy(d); }, 50);
        }, 350);
      });
      btn.addEventListener('mouseup', stop);
      btn.addEventListener('mouseleave', stop);
      btn.addEventListener('blur', stop);
    }
    bindRepeat(minus, -1);
    bindRepeat(plus, 1);

    wrap.appendChild(minus);
    wrap.appendChild(plus);

    field.appendChild(lbl);
    field.appendChild(range);
    field.appendChild(valSpan);
    field.appendChild(wrap);
    section.appendChild(field);
  }

  // −/＋付き数値（押しっぱなしリピート）。線幅等で使用。
  // opts: { label, value, min, max, step, onChange, fieldClass, extrasEl? }
  // extrasEl があれば同じ行の右に並べる（二重線チェックなど）
  function addPlusMinusNumberField(section, opts) {
    var min = opts.min;
    var max = opts.max;
    var step = opts.step != null ? opts.step : 1;
    var field = document.createElement('div');
    field.className = opts.fieldClass || 'prop-field prop-stepper-field';
    var lbl = document.createElement('label');
    lbl.textContent = opts.label + ':';
    var wrap = document.createElement('div');
    wrap.className = 'fontsize-wrap';
    var minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'fontsize-btn';
    minus.textContent = '−';
    var input = document.createElement('input');
    input.type = 'number';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = opts.value;
    input.className = 'fontsize-input';
    var plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'fontsize-btn';
    plus.textContent = '＋';

    function clamp(v) {
      if (step >= 1) v = Math.round(v);
      else v = Math.round(v / step) * step;
      if (v < min) v = min;
      if (v > max) v = max;
      // 小数ステップの表示を短く
      if (step < 1) {
        var d = 0;
        var s = String(step);
        var dot = s.indexOf('.');
        if (dot >= 0) d = s.length - dot - 1;
        v = parseFloat(v.toFixed(d));
      }
      return v;
    }
    function setVal(v) {
      v = clamp(v);
      input.value = v;
      opts.onChange(v);
    }
    function stepBy(d) {
      setVal((parseFloat(input.value) || 0) + d);
    }
    function bindRepeat(btn, d) {
      var t = null;
      var iv = null;
      function stop() {
        if (t) { clearTimeout(t); t = null; }
        if (iv) { clearInterval(iv); iv = null; }
      }
      btn.addEventListener('mousedown', function(e) {
        e.preventDefault();
        stepBy(d);
        stop();
        t = setTimeout(function() {
          iv = setInterval(function() { stepBy(d); }, 70);
        }, 400);
      });
      btn.addEventListener('mouseup', stop);
      btn.addEventListener('mouseleave', stop);
      btn.addEventListener('blur', stop);
    }
    bindRepeat(minus, -step);
    bindRepeat(plus, step);
    input.addEventListener('input', function() {
      var v = parseFloat(this.value);
      if (!isNaN(v)) opts.onChange(clamp(v));
    });
    wrap.appendChild(minus);
    wrap.appendChild(input);
    wrap.appendChild(plus);
    lbl.appendChild(wrap);
    field.appendChild(lbl);
    if (opts.extrasEl) field.appendChild(opts.extrasEl);
    section.appendChild(field);
  }

  // 吹き出し: 線幅（−/＋）
  function addStrokeWidthRow(section, width, onWidth) {
    addPlusMinusNumberField(section, {
      label: '線幅',
      value: width,
      min: 0,
      max: 50,
      step: 1,
      fieldClass: 'prop-field prop-stepper-field prop-stroke-row',
      onChange: onWidth
    });
  }

  // 吹き出し線スタイル: 二重線 / 内側線(外側余白) / 破線 をチェックボックスで複数選択可
  function addBalloonStrokeStyleCheckboxes(section, doubleOn, innerOn, dashedOn, onDouble, onInner, onDashed) {
    var field = document.createElement('div');
    field.className = 'prop-field';
    field.style.flexWrap = 'nowrap';
    field.style.gap = '4px 8px';

    var styles = [
      { key: 'double', label: '二重', checked: !!doubleOn, onChange: onDouble },
      { key: 'inner', label: '内側', checked: !!innerOn, onChange: onInner },
      { key: 'dashed', label: '破線', checked: !!dashedOn, onChange: onDashed }
    ];
    for (var si = 0; si < styles.length; si++) {
      (function(st) {
        var cbLabel = document.createElement('label');
        cbLabel.style.marginRight = '6px';
        cbLabel.style.cursor = 'pointer';
        cbLabel.style.whiteSpace = 'nowrap';
        cbLabel.style.fontSize = '12px';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = st.checked;
        cb.addEventListener('change', function() { st.onChange(this.checked); });
        cbLabel.appendChild(cb);
        cbLabel.appendChild(document.createTextNode(' ' + st.label));
        field.appendChild(cbLabel);
      })(styles[si]);
    }
    section.appendChild(field);
  }

  function addSliderField(section, label, value, min, max, onChange) {
    var field = document.createElement('div');
    field.className = 'prop-field';
    if (
      label === '不透明度' ||
      label === 'ガサつき' ||
      label === '太さ' ||
      label === '太さ(%)' ||
      label === '拡大率(%)' ||
      label === '回転(°)' ||
      label === '明るさ' ||
      label === 'コントラスト' ||
      label === '彩度' ||
      label === '白黒' ||
      label === '色相' ||
      label === 'トーンカーブ' ||
      label === '本数' ||
      label === '長さ(%)' ||
      label === '揺らぎ(%)' ||
      label === '長さのばらつき(%)' ||
      label === '縁余白(%)' ||
      label === '角度(°)' ||
      label === '鋭さ(%)' ||
      label === '横ずれ(%)' ||
      label === '幅(%)' ||
      label === '左右位置' ||
      label === '乱数' ||
      label === '振幅' ||
      label === '波長' ||
      label === '分岐'
    ) {
      field.className += ' prop-short-slider';
    }
    var lbl = document.createElement('label');
    if (label === 'コントラスト' || label === 'トーンカーブ') {
      lbl.textContent = label;
    } else {
      lbl.textContent = label + ':';
    }
    var valSpan = document.createElement('span');
    valSpan.className = 'slider-val';
    valSpan.textContent = value;

    var input = document.createElement('input');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.value = value;

    input.addEventListener('input', function() {
      var v = parseInt(this.value, 10);
      onChange(v);
      valSpan.textContent = v;
    });
    field.appendChild(lbl);
    field.appendChild(input);
    field.appendChild(valSpan);
    section.appendChild(field);
  }

  // 台形変形エッジ: -100=縮小 … 0=中央 … +100=拡大
  function formatTrapezoidEdgeLabel(v) {
    if (v > 0) return '拡' + v;
    if (v < 0) return '縮' + (-v);
    return '中央';
  }

  function clampTrapezoidEdge(v) {
    v = parseInt(v, 10);
    if (isNaN(v)) return 0;
    if (v > 100) return 100;
    if (v < -100) return -100;
    return v;
  }

  // 旧 trapezoid 単一値 → 上辺/下辺（互換）
  function readTrapezoidEdge(outline, which) {
    if (!outline) return 0;
    if (which === 'top') {
      if (typeof outline.trapezoidTop === 'number') return clampTrapezoidEdge(outline.trapezoidTop);
      // 旧: ＋=上縮小 → 新の上辺は負
      if (typeof outline.trapezoid === 'number' && outline.trapezoid > 0) {
        return clampTrapezoidEdge(-outline.trapezoid);
      }
      return 0;
    }
    if (typeof outline.trapezoidBottom === 'number') return clampTrapezoidEdge(outline.trapezoidBottom);
    // 旧: −=下縮小 → 新の下辺も負
    if (typeof outline.trapezoid === 'number' && outline.trapezoid < 0) {
      return clampTrapezoidEdge(outline.trapezoid);
    }
    return 0;
  }

  function addTrapezoidEdgeSlider(section, edgeLabel, value, onChange) {
    var field = document.createElement('div');
    field.className = 'prop-field prop-short-slider';
    var lbl = document.createElement('label');
    lbl.textContent = edgeLabel + ':';
    lbl.title = edgeLabel + 'を縮小〜拡大（中央=変形なし）';
    var valSpan = document.createElement('span');
    valSpan.className = 'slider-val';
    valSpan.style.minWidth = '40px';
    valSpan.textContent = formatTrapezoidEdgeLabel(value);

    var input = document.createElement('input');
    input.type = 'range';
    input.min = -100;
    input.max = 100;
    input.step = 1;
    input.value = value;
    input.title = '左=縮小 / 中央=なし / 右=拡大';

    input.addEventListener('input', function() {
      var v = clampTrapezoidEdge(this.value);
      onChange(v);
      valSpan.textContent = formatTrapezoidEdgeLabel(v);
    });
    field.appendChild(lbl);
    field.appendChild(input);
    field.appendChild(valSpan);
    section.appendChild(field);
  }

  function readOutlineRoundness(outline) {
    if (!outline) return 0;
    if (typeof outline.roundness === 'number' && !isNaN(outline.roundness)) {
      var r = Math.round(outline.roundness);
      if (r > 10) r = 10;
      if (r < -10) r = -10;
      return r;
    }
    if (outline.rounded === true) return 6;
    return 0;
  }
  function formatRoundnessLabel(v) {
    if (v > 0) return '丸' + v;
    if (v < 0) return '角' + (-v);
    return '直線';
  }
  function addRoundnessSlider(section, label, value, onChange) {
    var field = document.createElement('div');
    field.className = 'prop-field prop-short-slider';
    var lbl = document.createElement('label');
    lbl.textContent = label + ':';
    var valSpan = document.createElement('span');
    valSpan.className = 'slider-val';
    valSpan.style.minWidth = '40px';
    valSpan.textContent = formatRoundnessLabel(value);
    var input = document.createElement('input');
    input.type = 'range';
    input.min = -10; input.max = 10; input.step = 1; input.value = value;
    input.addEventListener('input', function() {
      var v = parseInt(this.value, 10);
      if (isNaN(v)) v = 0;
      if (v > 10) v = 10;
      if (v < -10) v = -10;
      onChange(v);
      valSpan.textContent = formatRoundnessLabel(v);
    });
    field.appendChild(lbl); field.appendChild(input); field.appendChild(valSpan);
    section.appendChild(field);
  }

  function addColorField(section, label, value, onChange) {
    var field = document.createElement('div');
    field.className = 'prop-field';
    var lbl = document.createElement('label');
    lbl.textContent = label + ':';
    var input = document.createElement('input');
    input.type = 'color';
    input.value = value || '#000000';
    input.addEventListener('input', function() {
      onChange(this.value);
    });
    field.appendChild(lbl);
    field.appendChild(input);
    section.appendChild(field);
  }

  function addCheckboxField(section, label, checked, onChange) {
    var div = document.createElement('div');
    div.className = 'prop-field';
    var lbl = document.createElement('label');
    // チェックは「名前:」ではなくラベルのみ（見出しと二重にしない）
    lbl.textContent = label;
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', function() {
      onChange(this.checked);
    });
    lbl.appendChild(input);
    div.appendChild(lbl);
    section.appendChild(div);
  }

  // アウトライン化チェック + 右隣にガサつきスライダー（0=なめらか, 1-10）
  function normalizeOutlineRoughness(raw) { // アウトライン化のガサつき用（0-10）
    var r0 = raw !== undefined && raw !== null ? raw : 0;
    r0 = parseInt(r0, 10);
    if (isNaN(r0) || r0 < 0) r0 = 0;
    if (r0 > 10) r0 = Math.round(r0 / 10);
    if (r0 > 10) r0 = 10;
    return r0;
  }

  function addOutlineEnableRoughRow(section, enabled, roughness, onEnable, onRough) {
    var field = document.createElement('div');
    field.className = 'prop-field prop-outline-row';

    var chkLbl = document.createElement('label');
    chkLbl.className = 'prop-outline-check';
    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!enabled;
    chk.addEventListener('change', function() {
      onEnable(this.checked);
    });
    chkLbl.appendChild(chk);
    chkLbl.appendChild(document.createTextNode('有効'));
    field.appendChild(chkLbl);

    var roughLbl = document.createElement('span');
    roughLbl.className = 'outline-rough-label';
    roughLbl.textContent = 'ガサつき';
    field.appendChild(roughLbl);

    var valSpan = document.createElement('span');
    valSpan.className = 'slider-val';
    var r0 = normalizeOutlineRoughness(roughness);
    valSpan.textContent = r0;

    var range = document.createElement('input');
    range.type = 'range';
    range.min = 0;
    range.max = 10;
    range.step = 1;
    range.value = r0;
    range.title = 'アウトラインのガサつき（0=なめらか / 1〜10）';
    range.addEventListener('input', function() {
      var v = parseInt(this.value, 10);
      if (isNaN(v)) v = 0;
      valSpan.textContent = v;
      onRough(v);
    });
    field.appendChild(range);
    field.appendChild(valSpan);
    section.appendChild(field);
  }

  // --- 一列にチェックボックスを並べる（太字/取り消し/傍点用） ---
  function addInlineCheckboxRow(section, items) {
    // items = [{label, checked, onChange}, ...]
    var div = document.createElement('div');
    div.className = 'prop-field';
    div.style.display = 'flex';
    div.style.gap = '12px';
    for (var i = 0; i < items.length; i++) {
      (function(item) {
        var lbl = document.createElement('label');
        lbl.style.cursor = 'pointer';
        var input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = item.checked;
        input.addEventListener('change', function() {
          item.onChange(this.checked);
        });
        lbl.appendChild(input);
        lbl.appendChild(document.createTextNode(item.label));
        div.appendChild(lbl);
      })(items[i]);
    }
    section.appendChild(div);
  }

  // --- 吹き出し/下書き: コマクロップ（見出しなし・ラベルのみ） ---
  function renderDraftClipProps(container, obj, emit) {
    var section = createSection(null);
    addCheckboxField(section, 'コマ内にクロップ', !!obj.panelId, function(v) { emit('clipToPanel', v); });
    container.appendChild(section);
  }

  // --- 下書き図形（円/四角/直線）: 線色・線幅 ---
  function renderDraftShapeProps(container, obj, emit) {
    var section = createSection('線');
    var sc = obj.strokeColor || 'rgba(140,140,140,0.55)';
    // color input は #rrggbb のみなので hex に寄せる
    var colorForInput = (typeof sc === 'string' && sc.charAt(0) === '#') ? sc : '#8c8c8c';
    addColorField(section, '線の色', colorForInput, function(v) { emit('strokeColor', v); });
    addNumberField(section, '線の太さ', obj.strokeWidth != null ? obj.strokeWidth : 4.5, function(v) {
      emit('strokeWidth', Math.max(0.5, Number(v) || 1));
    }, 0.5, 40);
    container.appendChild(section);
  }

  // --- 下書き ---
  function renderDraftProps(container, obj, emit) {
    var section = createSection('下書き設定');

    var kindField = document.createElement('div');
    kindField.className = 'prop-field';
    var kindLabel = document.createElement('label');
    kindLabel.textContent = '形状:';
    var kindSelect = document.createElement('select');
    var kinds = [
      { id: 'circle', label: '円' },
      { id: 'rect', label: '四角形' },
      { id: 'line', label: '直線' },
      { id: 'string', label: '文字列' }
    ];
    for (var i = 0; i < kinds.length; i++) {
      var opt = document.createElement('option');
      opt.value = kinds[i].id;
      opt.textContent = kinds[i].label;
      if (obj.kind === kinds[i].id) opt.selected = true;
      kindSelect.appendChild(opt);
    }
    kindSelect.addEventListener('change', function() { emit('kind', this.value); });
    kindLabel.appendChild(kindSelect);
    kindField.appendChild(kindLabel);
    section.appendChild(kindField);

    // kindに応じたパラメータ表示（読み取り専用）
    if (obj.kind === 'circle') {
      var ew = obj.params && obj.params.width;
      var eh = obj.params && obj.params.height;
      addReadonlyField(section, '幅(px)', ew !== undefined ? Math.round(ew) : '-');
      addReadonlyField(section, '高さ(px)', eh !== undefined ? Math.round(eh) : '-');
    } else if (obj.kind === 'rect') {
      var rw = obj.params && obj.params.width;
      var rh = obj.params && obj.params.height;
      addReadonlyField(section, '幅(px)', rw !== undefined ? Math.round(rw) : '-');
      addReadonlyField(section, '高さ(px)', rh !== undefined ? Math.round(rh) : '-');
    } else if (obj.kind === 'line') {
      var sx = obj.params && obj.params.startX;
      var sy = obj.params && obj.params.startY;
      var ex = obj.params && obj.params.endX;
      var ey = obj.params && obj.params.endY;
      addReadonlyField(section, '始点', (sx !== undefined ? Math.round(sx) : '-') + ', ' + (sy !== undefined ? Math.round(sy) : '-'));
      addReadonlyField(section, '終点', (ex !== undefined ? Math.round(ex) : '-') + ', ' + (ey !== undefined ? Math.round(ey) : '-'));
    }

    container.appendChild(section);
  }

  // --- 文字列 ---
  function renderStringProps(container, obj, emit) {
    var section = createSection(null);

    var contentField = document.createElement('div');
    contentField.className = 'prop-field';
    var contentLabel = document.createElement('label');
    contentLabel.textContent = '内容:';
    var contentArea = document.createElement('textarea');
    contentArea.rows = 3;
    contentArea.value = obj.content || '';
    contentArea.addEventListener('input', function() { emit('content', this.value); });
    contentLabel.appendChild(contentArea);
    contentField.appendChild(contentLabel);
    section.appendChild(contentField);

    var ffField = document.createElement('div');
    ffField.className = 'prop-field';
    var ffLabel = document.createElement('label');
    ffLabel.textContent = 'フォント:';
    var ffSelect = document.createElement('select');
    populateFontOptions(ffSelect, obj.font.family);
    ffSelect.addEventListener('change', function() {
      emit('font.family', toFontValue(this.value));
    });
    ffLabel.appendChild(ffSelect);
    ffField.appendChild(ffLabel);
    section.appendChild(ffField);

    addFontSizeField(section, obj.font.size || 24, function(v) { emit('font.size', v); });
    addColorField(section, '文字色', obj.font.color || '#a0a0a0', function(v) { emit('font.color', v); });
    addSliderField(section, '不透明度', obj.font.alpha !== undefined ? obj.font.alpha : 100, 0, 100, function(v) { emit('font.alpha', v); });
    addCheckboxField(section, '太字', obj.font.bold || false, function(v) { emit('font.bold', v); });

    container.appendChild(section);
  }

  function setOnPropertyChangeCallback(callback) {
    onPropertyChange = callback;
  }

  window.ME.UI.PropertyPanel = {
    create: create,
    update: update,
    setOnPropertyChangeCallback: setOnPropertyChangeCallback
  };
})();
