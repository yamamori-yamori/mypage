// ME.Core.ID.generate() — UUID v4風生成
// ME.Core.Color.toRgba(hex, alpha0to100) → 'rgba(r,g,b,a)' — α付き色変換
// ME.Core.Models.createTransform(opts?) — Transformデフォルト生成
// ME.Core.Models.Panel.create(...) — Panel生成（fusionGroup: 融合グループID | null）
// ME.Core.Models.Image.create(...) — ImageObject生成
// ME.Core.Models.Balloon.create(...) — Balloon生成（panelId: コマ内クロップ用 / fusionGroup）
// ME.Core.Models.Text.create(...) — TextObject生成（font.lineHeight / font.letterSpacing）
// ME.Core.Models.Effect.create(...) — EffectObject生成
// ME.Core.Models.Draft.create(kind, params, transform) — DraftObject生成（下書き: circle/rect/line/string）
// ME.Core.Models.Memo.create(kind, params, transform) — MemoObject（校閲メモ: freehand/string・白縁赤）
// ME.Core.Models.String.create(content, transform) — 後方互換（draft kind:string）

window.ME = window.ME || {};
window.ME.Core = window.ME.Core || {};

(function() {
  'use strict';

  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // '#RRGGBB' + α(0-100) → 'rgba(r,g,b,a)'
  function toRgba(hex, alpha) {
    var a = (alpha === undefined || alpha === null) ? 1 : Math.max(0, Math.min(100, alpha)) / 100;
    if (typeof hex !== 'string') return hex;
    var m = hex.match(/^#?([0-9a-fA-F]{6})$/);
    if (!m) {
      var m3 = hex.match(/^#?([0-9a-fA-F]{3})$/);
      if (!m3) return hex;
      var s = m3[1];
      m = [null, s[0] + s[0] + s[1] + s[1] + s[2] + s[2]];
    }
    var n = parseInt(m[1], 16);
    var r = (n >> 16) & 255;
    var g = (n >> 8) & 255;
    var b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function createTransform(opts) {
    opts = opts || {};
    return {
      x: opts.x || 0,
      y: opts.y || 0,
      rotation: opts.rotation !== undefined ? opts.rotation : 0,
      scaleX: opts.scaleX !== undefined ? opts.scaleX : 1,
      scaleY: opts.scaleY !== undefined ? opts.scaleY : 1
    };
  }

  function createEditableObject(type, transform) {
    return {
      id: generateId(),
      type: type,
      transform: transform || createTransform(),
      zIndex: 0,
      locked: false,
      visible: true
    };
  }

  // Panel生成
  var Panel = {};
  function createPanel(vertices, opts) {
    opts = opts || {};
    var obj = createEditableObject('panel', createTransform(opts.transform));
    obj.vertices = vertices || [
      { x: 50, y: 50 },
      { x: 300, y: 50 },
      { x: 300, y: 300 },
      { x: 50, y: 300 }
    ];
    obj.borderWidth = opts.borderWidth !== undefined ? opts.borderWidth : 2;
    obj.borderColor = opts.borderColor || '#000000';
    obj.borderAlpha = opts.borderAlpha !== undefined ? opts.borderAlpha : 100;
    // 枠線のガサつき 0-10（0=なめらか）。頂点座標は不変・描画レイヤーのみ
    obj.borderRoughness = opts.borderRoughness !== undefined ? opts.borderRoughness : 0;
    obj.fillColor = opts.fillColor !== undefined ? opts.fillColor : '#FFFFFF';
    obj.fillAlpha = opts.fillAlpha !== undefined ? opts.fillAlpha : 100;
    obj.clipPath = opts.clipPath !== false;
    obj.fusionGroup = opts.fusionGroup || null; // 同じIDのコマ同士は融合して1つの形として描画
    return obj;
  }
  Panel.create = createPanel;

  // ImageObject生成
  var Image = {};
  function createImage(panelId, assetId, transform) {
    var obj = createEditableObject('image', createTransform(transform));
    obj.panelId = panelId || '';
    obj.assetId = assetId || '';
    obj.flipX = false;
    obj.flipY = false;
    obj.width = 0;
    obj.height = 0;
    obj.colorAdjust = {
      brightness: 0,
      contrast: 0,
      saturation: 0,
      grayscale: 0,
      hue: 0,
      tone: 0,        // トーンカーブ（中間調ガンマ。-100〜100、白黒レベルは固定）
      opacity: 100
    };
    return obj;
  }
  Image.create = createImage;

  // Balloon生成
  var Balloon = {};
  function createBalloon(shape, size, transform) {
    shape = shape || 'ellipse';
    var obj = createEditableObject('balloon', createTransform(transform));
    obj.shape = shape;
    obj.size = size || { width: 150, height: 80 };
    obj.panelId = null;      // 設定するとコマ内にクロップされる
    obj.fusionGroup = null;  // 同じIDの吹き出し同士は融合して1つの形として描画
    obj.fillColor = '#FFFFFF';
    obj.fillAlpha = 100;
    obj.strokeColor = '#000000';
    obj.strokeAlpha = 100;
    obj.strokeWidth = 2;
    obj.strokeRoughness = 0; // 線のガサつき 0-10（0=なめらか。セリフ袋 outline.roughness と同系）
    obj.doubleStroke = false;
    obj.innerLine = false;
    obj.dashed = false;
    obj.opacity = 100;
    obj.tail = null;
    return obj;
  }
  Balloon.create = createBalloon;

  // TextObject生成
  var Text = {};
  function createText(content, transform) {
    var obj = createEditableObject('text', createTransform(transform));
    obj.content = content || '';
    obj.writingMode = 'vertical';
    obj.font = {
      family: 'sans-serif',
      size: 16,
      bold: false,
      strikethrough: false,  // 取り消し線
      ruby: false,          // 傍点（・）
      color: '#000000',
      alpha: 100,
      letterSpacing: 0,   // 文字間(px)
      lineHeight: 1.2     // 行間（フォントサイズ比）
    };
    obj.outline = {
      enabled: false,
      color: '#FFFFFF',
      alpha: 100,
      width: 2,
      roughness: 0,          // 袋のガサつき 0-10（0=なめらか。旧0-100は描画時に換算）
      roundness: 0,          // 角張り〜丸み
      artisticEnabled: false, // アウトライン化（レイアウト化）独立ON/OFF。袋文字とは無関係
      // 台形変形（アウトライン化ON時のみ・ベクター輪郭に適用・中央縦軸固定）。0=なし。−100=最大縮小 / ＋100=最大拡大
      trapezoidTop: 0,
      trapezoidBottom: 0
    };
    return obj;
  }
  Text.create = createText;

  // EffectObject生成
  var Effect = {};
  function createEffect(scope, kind, params, transform) {
    var obj = createEditableObject('effect', createTransform(transform));
    obj.scope = scope || 'page';
    obj.panelId = null;
    obj.kind = kind || 'flatTone';
    if (kind === 'screenTone') {
      obj.params = params || { pattern: 'dot', density: 50, angle: 0, scale: 1 };
    } else if (kind === 'concentration') {
      obj.params = params || { origin: { x: 0, y: 0 }, originRelative: true, lineCount: 36, lengthRatio: 90, color: '#000000' };
    } else if (kind === 'speedLines') {
      obj.params = params || { direction: 'horizontal', lineCount: 24, lengthRatio: 100, color: '#000000' };
    } else if (kind === 'flatTone') {
      obj.params = params || { color: '#000000' };
    } else if (kind === 'whiteFlash') {
      obj.params = params || {};
    } else if (kind === 'blackFlash') {
      obj.params = params || {};
    } else if (kind === 'frame') {
      obj.params = params || { width: 4, color: '#000000' };
    } else if (kind === 'flatBand') {
      obj.params = params || { height: 30, color: '#000000' };
    } else if (kind === 'whiteBorder') {
      obj.params = params || { width: 8 };
    } else {
      obj.params = params || {};
    }
    return obj;
  }
  Effect.create = createEffect;

  // DraftObject生成（下書き: 円/矩形/直線/文字列）
  // 図形のデフォルト線色は薄いグレー。文字列は旧下書き線相当のグレー
  var DRAFT_DEFAULT_STROKE = 'rgba(140,140,140,0.55)';
  var DRAFT_DEFAULT_WIDTH = 4.5;
  var DRAFT_STRING_COLOR = '#a0a0a0';
  var Draft = {};
  function createDraft(kind, params, transform) {
    kind = kind || 'circle';
    var obj = createEditableObject('draft', createTransform(transform));
    obj.kind = kind;
    obj.panelId = null; // 設定するとコマ枠でクロップ（吹き出しと同様）
    obj.fusionGroup = null; // 同じIDの下書き同士は融合して1つの形として描画
    params = params || {};
    if (kind === 'circle') {
      // 円も外接矩形 (width/height)。旧 radius のみのデータは描画側でフォールバック
      obj.params = {
        width: params.width != null ? params.width : (params.radius != null ? params.radius * 2 : 60),
        height: params.height != null ? params.height : (params.radius != null ? params.radius * 2 : 40)
      };
      obj.strokeColor = params.strokeColor || DRAFT_DEFAULT_STROKE;
      obj.strokeWidth = params.strokeWidth != null ? params.strokeWidth : DRAFT_DEFAULT_WIDTH;
    } else if (kind === 'rect') {
      obj.params = {
        width: params.width != null ? params.width : 60,
        height: params.height != null ? params.height : 40
      };
      obj.strokeColor = params.strokeColor || DRAFT_DEFAULT_STROKE;
      obj.strokeWidth = params.strokeWidth != null ? params.strokeWidth : DRAFT_DEFAULT_WIDTH;
    } else if (kind === 'line') {
      obj.params = {
        startX: params.startX != null ? params.startX : -30,
        startY: params.startY != null ? params.startY : 0,
        endX: params.endX != null ? params.endX : 30,
        endY: params.endY != null ? params.endY : 0
      };
      obj.strokeColor = params.strokeColor || DRAFT_DEFAULT_STROKE;
      obj.strokeWidth = params.strokeWidth != null ? params.strokeWidth : DRAFT_DEFAULT_WIDTH;
    } else if (kind === 'string') {
      // 文字列は下書きの一種（旧 type:'string' から統合）
      obj.params = {};
      obj.content = params.content || '';
      obj.font = params.font ? JSON.parse(JSON.stringify(params.font)) : {
        family: 'sans-serif',
        size: 24,
        bold: true,
        color: DRAFT_STRING_COLOR,
        alpha: 100,
        letterSpacing: 0,
        lineHeight: 1.2
      };
      obj.writingMode = 'horizontal';
    }
    return obj;
  }
  Draft.create = createDraft;

  // MemoObject（校閲用: freehand 曲線 / string。同一赤 + 白縁。融合・クロップなし）
  var MEMO_COLOR = '#cc2222';
  var MEMO_DEFAULT_WIDTH = 2.5;
  var MEMO_EDGE_COLOR = 'rgba(255,255,255,0.95)';
  var MEMO_EDGE_EXTRA = 2;
  var Memo = {};
  function createMemo(kind, params, transform) {
    kind = kind || 'freehand';
    var obj = createEditableObject('memo', createTransform(transform));
    obj.kind = kind;
    params = params || {};
    if (kind === 'freehand') {
      var pts = params.points;
      if (!pts || !pts.length) {
        pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
      }
      obj.params = { points: JSON.parse(JSON.stringify(pts)) };
      obj.strokeColor = params.strokeColor || MEMO_COLOR;
      obj.strokeWidth = params.strokeWidth != null ? params.strokeWidth : MEMO_DEFAULT_WIDTH;
    } else if (kind === 'string') {
      obj.params = {};
      obj.content = params.content || '';
      obj.font = params.font ? JSON.parse(JSON.stringify(params.font)) : {
        family: 'sans-serif',
        size: 24,
        bold: true,
        color: MEMO_COLOR,
        alpha: 100,
        letterSpacing: 0,
        lineHeight: 1.2
      };
      if (!obj.font.color) obj.font.color = MEMO_COLOR;
      obj.outline = params.outline ? JSON.parse(JSON.stringify(params.outline)) : {
        enabled: true,
        color: '#FFFFFF',
        alpha: 100,
        width: 3
      };
      obj.writingMode = 'horizontal';
    } else {
      obj.params = params;
      obj.strokeColor = MEMO_COLOR;
      obj.strokeWidth = MEMO_DEFAULT_WIDTH;
    }
    return obj;
  }
  Memo.create = createMemo;

  // StringObject生成（後方互換ラッパ: 実体は draft kind:'string'）
  var StringObj = {};
  function createString(content, transform) {
    return createDraft('string', { content: content || '' }, transform);
  }
  StringObj.create = createString;

  var LAYER_ORDER = ['background', 'panel', 'image', 'effect', 'balloon', 'text'];
  var BALLOON_SHAPES = ['ellipse', 'softEllipse', 'rect', 'roughRect', 'softBurst', 'jaggedRect', 'roundedRect', 'superEllipse', 'handDrawnSpiky', 'handDrawnPolygon', 'spikyExplosion', 'wobble', 'wobble2', 'roughPoly', 'heptagon', 'nonagon', 'jagged', 'thought', 'concaveCurve', 'concaveCurveShallow', 'verticalHexagon', 'irregularOctagon', 'shortConcLines', 'kebaKebaLines'];

  window.ME.Core.ID = { generate: generateId };
  window.ME.Core.Color = { toRgba: toRgba };
  window.ME.Core.Models = { Panel: Panel, Image: Image, Balloon: Balloon, Text: Text, Effect: Effect, Draft: Draft, Memo: Memo, String: StringObj, createTransform: createTransform };
  window.ME.Core.MemoDefaults = {
    COLOR: MEMO_COLOR,
    WIDTH: MEMO_DEFAULT_WIDTH,
    EDGE_COLOR: MEMO_EDGE_COLOR,
    EDGE_EXTRA: MEMO_EDGE_EXTRA
  };
  window.ME.Core.Constants = { LAYER_ORDER: LAYER_ORDER, BALLOON_SHAPES: BALLOON_SHAPES };
})();
