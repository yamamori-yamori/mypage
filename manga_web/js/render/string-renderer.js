// ME.Render.String.draw(ctx, stringObj) — 文字列描画
//   横書き固定。transform = 左上（左端・上端）

window.ME = window.ME || {};
window.ME.Render = window.ME.Render || {};
window.ME.Render.String = window.ME.Render.String || {};

(function() {
  'use strict';

  function fillColorOf(font) {
    return ME.Core.Color.toRgba(font.color || '#000000', font.alpha !== undefined ? font.alpha : 100);
  }

  function outlineColorOf(outline) {
    return ME.Core.Color.toRgba(outline.color || '#FFFFFF', outline.alpha !== undefined ? outline.alpha : 100);
  }

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

  function formatFontFamily(fam) {
    if (!fam) return 'sans-serif';
    fam = String(fam).trim();
    var parts = [];
    var cur = '';
    var inQ = false;
    var qch = '';
    var i;
    for (i = 0; i < fam.length; i++) {
      var ch = fam.charAt(i);
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

  function getStringBBox(stringObj) {
    var font = stringObj.font || {};
    var fontSize = font.size || 24;
    var lineHeight = font.lineHeight || 1.2;
    var letterSpacing = font.letterSpacing !== undefined ? font.letterSpacing : 0;
    var content = stringObj.content || '';

    var lines = content.split('\n');
    var maxWidth = 0;
    for (var i = 0; i < lines.length; i++) {
      var charW = lines[i].length * (fontSize + letterSpacing);
      if (charW > maxWidth) maxWidth = charW;
    }
    return { w: maxWidth, h: lines.length * fontSize * lineHeight };
  }

  function draw(ctx, stringObj) {
    if (!stringObj) return;

    var t = stringObj.transform || {};
    ctx.save();

    // 回転の中心をオブジェクト中央にするため、bbox の半分だけオフセット
    var bbox = getStringBBox(stringObj);
    var cx = bbox.w / 2;
    var cy = bbox.h / 2;

    ctx.translate((t.x || 0) + cx, (t.y || 0) + cy);
    if (t.rotation) {
      ctx.rotate(t.rotation * Math.PI / 180);
    }
    var sx = t.scaleX || 1;
    var sy = t.scaleY || 1;
    // scale → translate(-cx,-cy) の順で、中心基準のスケール＋位置調整
    if (sx !== 1 || sy !== 1) {
      ctx.scale(sx, sy);
    }
    ctx.translate(-cx, -cy);

    var font = stringObj.font || {};
    var fam = formatFontFamily(font.family);
    ctx.font = (font.bold ? 'bold ' : '') + ((font.size || 24)) + 'px ' + fam;

    var content = stringObj.content || '';
    if (!content) {
      ctx.restore();
      return;
    }

    drawHorizontal(ctx, stringObj, content);

    ctx.restore();
  }

  function drawHorizontal(ctx, stringObj, content) {
    var font = stringObj.font || {};
    var outline = stringObj.outline || {};
    var fontSize = font.size || 24;
    var lineHeight = font.lineHeight || 1.2;
    var letterSpacing = font.letterSpacing !== undefined ? font.letterSpacing : 0;

    // 原点 = 左上
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    if (letterSpacing !== 0 && 'letterSpacing' in ctx) {
      ctx.letterSpacing = letterSpacing + 'px';
    }

    var lines = content.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var y = i * fontSize * lineHeight;

      if (outline.enabled) {
        ctx.strokeStyle = outlineColorOf(outline);
        ctx.lineWidth = outline.width !== undefined ? outline.width : 2;
        ctx.lineJoin = 'round';
        ctx.strokeText(lines[i], 0, y);
      }

      ctx.fillStyle = fillColorOf(font);
      ctx.fillText(lines[i], 0, y);
    }

    if (letterSpacing !== 0 && 'letterSpacing' in ctx) {
      ctx.letterSpacing = '0px';
    }
  }

  window.ME.Render.String.draw = draw;
})();
