// ME.Effects — 線・心理系エフェクトの既定 params / 判定ヘルパ
// ME.Effects.defaultParams(kind, prevParams)
// ME.Effects.hasOriginHandle / isLinePsychKind / usesRotateClip
// ME.Effects.STEP_KINDS

window.ME = window.ME || {};
window.ME.Effects = window.ME.Effects || {};

(function() {
  'use strict';

  var STEP_KINDS = [
    { id: 'concentration', label: '集中線' },
    { id: 'speedLines', label: 'スピード線' },
    { id: 'horrorLines', label: 'ホラー線' },
    { id: 'dropLines', label: 'ドロップ線' },
    { id: 'wavyLines', label: '揺れ線' },
    { id: 'crackLines', label: 'ヒビ' }
  ];

  var ROTATE_CLIP = {
    concentration: true,
    speedLines: true,
    horrorLines: true,
    dropLines: true,
    wavyLines: true,
    crackLines: true
  };

  var ORIGIN_HANDLE = {
    concentration: true,
    crackLines: true
  };

  var LINE_PSYCH = {
    concentration: true,
    speedLines: true,
    horrorLines: true,
    dropLines: true,
    wavyLines: true,
    crackLines: true
  };

  function keepOrigin(prev) {
    prev = prev || {};
    return {
      origin: prev.origin ? { x: prev.origin.x || 0, y: prev.origin.y || 0 } : { x: 0, y: 0 },
      originRelative: (prev.originRelative !== undefined) ? prev.originRelative : true
    };
  }

  function keepSeed(prev) {
    prev = prev || {};
    return (prev.seed !== undefined && prev.seed !== null) ? prev.seed : 0;
  }

  function defaultParams(kind, prevParams) {
    var p = prevParams || {};
    var o;
    var seed = keepSeed(p);
    if (kind === 'screenTone') {
      return { pattern: 'dot', density: 50, angle: 0, scale: 1 };
    }
    if (kind === 'concentration') {
      o = keepOrigin(p);
      return {
        origin: o.origin,
        originRelative: o.originRelative,
        lineCount: 36,
        lengthRatio: 90,
        thickness: 100,
        color: p.color || '#000000',
        jitter: 30,
        lengthVariation: 50,
        seed: seed
      };
    }
    if (kind === 'speedLines') {
      return {
        direction: p.direction || 'horizontal',
        align: p.align || 'start',
        lineCount: 24,
        lengthRatio: 100,
        thickness: 100,
        color: p.color || '#000000',
        jitter: 30,
        lengthVariation: 50,
        seed: seed
      };
    }
    if (kind === 'horrorLines') {
      return {
        lineCount: 48,
        lengthRatio: 35,
        thickness: 100,
        color: p.color || '#000000',
        jitter: 40,
        edgePadding: 0,
        seed: seed
      };
    }
    if (kind === 'dropLines') {
      return {
        lineCount: 20,
        lengthRatio: 55,
        thickness: 100,
        color: p.color || '#000000',
        jitter: 35,
        drift: 0,
        bandWidth: 100,
        offsetX: 0,
        lengthVariation: 50,
        seed: seed
      };
    }
    if (kind === 'wavyLines') {
      return {
        lineCount: 14,
        lengthRatio: 100,
        thickness: 100,
        color: p.color || '#000000',
        jitter: 20,
        amplitude: 8,
        wavelength: 36,
        direction: p.direction || 'horizontal',
        lengthVariation: 50,
        seed: seed
      };
    }
    if (kind === 'crackLines') {
      o = keepOrigin(p);
      return {
        origin: o.origin,
        originRelative: o.originRelative,
        lineCount: 7,
        lengthRatio: 70,
        thickness: 100,
        color: p.color || '#000000',
        jitter: 40,
        branch: 2,
        seed: seed
      };
    }
    if (kind === 'flatTone') {
      return { color: p.color || '#000000' };
    }
    if (kind === 'whiteFlash' || kind === 'blackFlash') {
      return {};
    }
    if (kind === 'frame') {
      return { width: 4, color: p.color || '#000000' };
    }
    if (kind === 'flatBand') {
      return { height: 30, color: p.color || '#000000' };
    }
    if (kind === 'whiteBorder') {
      return { width: 8 };
    }
    return {};
  }

  window.ME.Effects.STEP_KINDS = STEP_KINDS;
  window.ME.Effects.defaultParams = defaultParams;
  window.ME.Effects.hasOriginHandle = function(kind) {
    return !!ORIGIN_HANDLE[kind];
  };
  window.ME.Effects.isLinePsychKind = function(kind) {
    return !!LINE_PSYCH[kind];
  };
  window.ME.Effects.usesRotateClip = function(kind) {
    return !!ROTATE_CLIP[kind];
  };
})();
