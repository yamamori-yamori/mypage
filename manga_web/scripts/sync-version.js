#!/usr/bin/env node
// VERSION (SSOT) → app-version.js / 本体表示 / MANUAL / README / AGENTS / serializer 文言 / git タグ
// Usage:
//   node scripts/sync-version.js           # 同期書き込み
//   node scripts/sync-version.js --check   # 食い違いで exit 1（書き込まない）
//   node scripts/sync-version.js --tag     # 同期後に annotated tag v{APP} を作成（既存ならスキップ）
//   node scripts/sync-version.js --tag --force-tag  # タグを付け直し

'use strict';

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var VERSION_PATH = path.join(ROOT, 'VERSION');
var APP_VERSION_JS = path.join(ROOT, 'js', 'core', 'app-version.js');

var args = process.argv.slice(2);
var CHECK = args.indexOf('--check') >= 0;
var DO_TAG = args.indexOf('--tag') >= 0;
var FORCE_TAG = args.indexOf('--force-tag') >= 0;

function readVersionFile() {
  var text = fs.readFileSync(VERSION_PATH, 'utf8');
  var app = null;
  var json = null;
  text.split(/\r?\n/).forEach(function(line) {
    line = line.replace(/#.*$/, '').trim();
    if (!line) return;
    var m = line.match(/^APP\s*=\s*([0-9]+(?:\.[0-9]+)*)$/);
    if (m) app = m[1];
    m = line.match(/^JSON\s*=\s*([0-9]+(?:\.[0-9]+)*)$/);
    if (m) json = m[1];
  });
  if (!app || !json) {
    throw new Error('VERSION must define APP=x.y and JSON=x.y');
  }
  return { app: app, json: json, label: 'Ver.' + app };
}

function readEmbeddedAppVersionJs() {
  if (!fs.existsSync(APP_VERSION_JS)) return null;
  var t = fs.readFileSync(APP_VERSION_JS, 'utf8');
  var am = t.match(/var APP_VERSION = '([^']+)'/);
  var jm = t.match(/var JSON_VERSION = '([^']+)'/);
  if (!am || !jm) return null;
  return { app: am[1], json: jm[1], label: 'Ver.' + am[1] };
}

function writeIfChanged(filePath, content, report) {
  var rel = path.relative(ROOT, filePath);
  var prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  if (prev === content) {
    report.ok.push(rel + ' (unchanged)');
    return false;
  }
  if (CHECK) {
    report.drift.push(rel);
    return true;
  }
  fs.writeFileSync(filePath, content, 'utf8');
  report.written.push(rel);
  return true;
}

function replaceAll(s, from, to) {
  if (from === to) return s;
  return s.split(from).join(to);
}

function buildAppVersionJs(v) {
  return [
    '// ME.APP_VERSION / ME.APP_VERSION_LABEL / ME.JSON_VERSION',
    '// ★ 手編集しない — ルート VERSION を正とし node scripts/sync-version.js で生成',
    '// APP_VERSION: アプリ仕様（UI・README/MANUAL 現行）',
    '// JSON_VERSION: プロジェクト JSON（serializer / createProject）',
    '',
    'window.ME = window.ME || {};',
    '',
    '(function() {',
    "  'use strict';",
    '',
    '  // BEGIN-SYNC-VERSION',
    "  var APP_VERSION = '" + v.app + "';",
    "  var JSON_VERSION = '" + v.json + "';",
    '  // END-SYNC-VERSION',
    '',
    '  window.ME.APP_VERSION = APP_VERSION;',
    "  window.ME.APP_VERSION_LABEL = 'Ver.' + APP_VERSION;",
    '  window.ME.JSON_VERSION = JSON_VERSION;',
    '})();',
    ''
  ].join('\n');
}

function patchCurrentMarkers(content, oldV, newV) {
  // 現行表示だけを差し替え（変更履歴の「Ver.4.x の主変更」などは旧→新の単純置換で壊れないよう
  // マーカー付き箇所と「現行」専用パターンのみ触る）
  var out = content;

  // HTML / MD markers
  out = out.replace(
    /<!--\s*APP_VER\s*-->[\s\S]*?<!--\s*\/APP_VER\s*-->/g,
    '<!--APP_VER-->' + newV.label + '<!--/APP_VER-->'
  );
  out = out.replace(
    /data-app-ver(?:="")?/g,
    'data-app-ver'
  );

  // 明示的な現行ラベル（old が分かっているときだけ置換）
  if (oldV) {
    var pairs = [
      ['開発仕様書 ' + oldV.label, '開発仕様書 ' + newV.label],
      ['アプリ仕様 ' + oldV.label, 'アプリ仕様 ' + newV.label],
      ['仕様書 | `README.md` ' + oldV.label, '仕様書 | `README.md` ' + newV.label],
      ['仕様書（現行） | **' + oldV.label + '**', '仕様書（現行） | **' + newV.label + '**'],
      ['本仕様（' + oldV.label + '）', '本仕様（' + newV.label + '）'],
      ['図解マニュアル（' + oldV.label + '）', '図解マニュアル（' + newV.label + '）'],
      ['現行アプリ仕様は **' + oldV.label + '**', '現行アプリ仕様は **' + newV.label + '**'],
      ['最終同期: 仕様 ' + oldV.label, '最終同期: 仕様 ' + newV.label],
      ['README.md`（**' + oldV.label + '**）', 'README.md`（**' + newV.label + '**）'],
      ['仕様 ' + oldV.label + ' · copyright', '仕様 ' + newV.label + ' · copyright'],
      ["version: \"" + oldV.json + "\"", "version: \"" + newV.json + "\""],
      ['プロジェクト JSON | **' + oldV.json + '**', 'プロジェクト JSON | **' + newV.json + '**'],
      ["version: '" + oldV.json + "'", "version: '" + newV.json + "'"],
      ["SUPPORTED_VERSION = '" + oldV.json + "'", "SUPPORTED_VERSION = '" + newV.json + "'"]
    ];
    pairs.forEach(function(p) {
      out = replaceAll(out, p[0], p[1]);
    });
  }

  return out;
}

function ensureManualRuntimeFill(html, v) {
  // 静的フォールバック文言 + ランタイムで ME から上書き
  var out = html;
  // top ver
  out = out.replace(
    /<span class="ver"[^>]*>[\s\S]*?<\/span>/,
    '<span class="ver" data-app-ver><!--APP_VER-->' + v.label + '<!--/APP_VER--></span>'
  );
  // footer
  out = out.replace(
    /(図解マニュアル · 仕様 )Ver\.[0-9]+(?:\.[0-9]+)*( · copyright)/,
    '$1' + v.label + '$2'
  );
  // ensure script once before </body>
  if (out.indexOf('js/core/app-version.js') < 0) {
    out = out.replace(
      /<\/body>/i,
      '  <script src="js/core/app-version.js"></script>\n' +
      '  <script>\n' +
      "  (function() {\n" +
      "    function apply() {\n" +
      "      var label = (window.ME && ME.APP_VERSION_LABEL) ? ME.APP_VERSION_LABEL : null;\n" +
      "      if (!label) return;\n" +
      "      var nodes = document.querySelectorAll('[data-app-ver]');\n" +
      "      for (var i = 0; i < nodes.length; i++) nodes[i].textContent = label;\n" +
      "      var foot = document.querySelector('footer');\n" +
      "      if (foot && /仕様 Ver\\./.test(foot.textContent)) {\n" +
      "        foot.textContent = foot.textContent.replace(/仕様 Ver\\.[0-9.]+/, '仕様 ' + label);\n" +
      "      }\n" +
      "    }\n" +
      "    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);\n" +
      "    else apply();\n" +
      "  })();\n" +
      "  </script>\n" +
      '</body>'
    );
  }
  return out;
}

function patchSerializer(content, v) {
  // Prefer ME.JSON_VERSION when present; keep fallback string in sync
  var out = content;
  if (/var SUPPORTED_VERSION = /.test(out)) {
    out = out.replace(
      /var SUPPORTED_VERSION = [^;]+;/,
      "var SUPPORTED_VERSION = (window.ME && ME.JSON_VERSION) ? ME.JSON_VERSION : '" + v.json + "';"
    );
  }
  return out;
}

function patchSceneGraph(content, v) {
  var out = content;
  // createProject version field
  out = out.replace(
    /version:\s*'[0-9.]+'/,
    "version: (window.ME && ME.JSON_VERSION) ? ME.JSON_VERSION : '" + v.json + "'"
  );
  // only first occurrence in createProject is intended; if multiple, both OK if same
  return out;
}

function patchToolbar(content) {
  // use ME label at runtime
  return content.replace(
    /verEl\.textContent = ['"]Ver\.[^'"]*['"];/,
    "verEl.textContent = (window.ME && ME.APP_VERSION_LABEL) ? ME.APP_VERSION_LABEL : 'Ver.?';"
  );
}

function patchIndexHtml(html) {
  if (html.indexOf('js/core/app-version.js') >= 0) return html;
  return html.replace(
    '<script src="js/core/data-models.js"></script>',
    '<script src="js/core/app-version.js"></script>\n' +
    '  <script src="js/core/data-models.js"></script>'
  );
}

function gitTagExists(tag) {
  try {
    childProcess.execSync('git rev-parse -q --verify "refs/tags/' + tag + '"', {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    return true;
  } catch (e) {
    return false;
  }
}

function main() {
  var v = readVersionFile();
  var old = readEmbeddedAppVersionJs() || v;
  var report = { written: [], ok: [], drift: [], notes: [] };

  // 1) app-version.js
  writeIfChanged(APP_VERSION_JS, buildAppVersionJs(v), report);

  // 2) index.html script
  var indexPath = path.join(ROOT, 'index.html');
  var indexHtml = fs.readFileSync(indexPath, 'utf8');
  writeIfChanged(indexPath, patchIndexHtml(indexHtml), report);

  // 3) toolbar
  var toolbarPath = path.join(ROOT, 'js', 'ui', 'toolbar.js');
  writeIfChanged(toolbarPath, patchToolbar(fs.readFileSync(toolbarPath, 'utf8')), report);

  // 4) serializer / scene-graph
  var serPath = path.join(ROOT, 'js', 'io', 'serializer.js');
  writeIfChanged(serPath, patchSerializer(fs.readFileSync(serPath, 'utf8'), v), report);
  var sgPath = path.join(ROOT, 'js', 'core', 'scene-graph.js');
  writeIfChanged(sgPath, patchSceneGraph(fs.readFileSync(sgPath, 'utf8'), v), report);

  // 5) MANUAL
  var manPath = path.join(ROOT, 'MANUAL.html');
  if (fs.existsSync(manPath)) {
    var man = ensureManualRuntimeFill(fs.readFileSync(manPath, 'utf8'), v);
    man = patchCurrentMarkers(man, old, v);
    writeIfChanged(manPath, man, report);
  } else {
    console.log('MANUAL.html not found; skipped');
  }

  // 6) README / AGENTS — current markers only
  ['README.md', 'AGENTS.md'].forEach(function(name) {
    var p = path.join(ROOT, name);
    if (!fs.existsSync(p)) return;
    var t = fs.readFileSync(p, 'utf8');
    var n = patchCurrentMarkers(t, old, v);
    // タイトル行が VERSION と食い違う場合の強制（README）
    if (name === 'README.md') {
      n = n.replace(
        /^# マンガページエディタ 開発仕様書 Ver\.[0-9.]+/m,
        '# マンガページエディタ 開発仕様書 ' + v.label
      );
      n = n.replace(
        /アプリ仕様 Ver\.[0-9.]+/g,
        'アプリ仕様 ' + v.label
      );
      n = n.replace(
        /\| 仕様書（現行） \| \*\*Ver\.[0-9.]+\*\* \|/,
        '| 仕様書（現行） | **' + v.label + '** |'
      );
      n = n.replace(
        /\| プロジェクト JSON \| \*\*[0-9.]+\*\*/,
        '| プロジェクト JSON | **' + v.json + '**'
      );
      n = n.replace(
        /現行アプリ仕様は \*\*Ver\.[0-9.]+\*\*/,
        '現行アプリ仕様は **' + v.label + '**'
      );
      n = n.replace(
        /本仕様（Ver\.[0-9.]+）/,
        '本仕様（' + v.label + '）'
      );
      n = n.replace(
        /図解マニュアル（Ver\.[0-9.]+）/,
        '図解マニュアル（' + v.label + '）'
      );
    }
    if (name === 'AGENTS.md') {
      n = n.replace(
        /`README\.md`（\*\*Ver\.[0-9.]+\*\*）/,
        '`README.md`（**' + v.label + '**）'
      );
      n = n.replace(
        /\| 仕様書 \| `README\.md` Ver\.[0-9.]+ \|/,
        '| 仕様書 | `README.md` ' + v.label + ' |'
      );
      n = n.replace(
        /\*最終同期: 仕様 Ver\.[0-9.]+/,
        '*最終同期: 仕様 ' + v.label
      );
    }
    writeIfChanged(p, n, report);
  });

  // 7) git tag info
  var tag = 'v' + v.app;
  var tagOk = gitTagExists(tag);
  if (CHECK) {
    if (!tagOk) report.notes.push('git tag missing: ' + tag + ' (run: node scripts/sync-version.js --tag)');
  }

  if (CHECK) {
    // also verify embedded == VERSION
    var emb = readEmbeddedAppVersionJs();
    if (!emb || emb.app !== v.app || emb.json !== v.json) {
      report.drift.push('js/core/app-version.js vs VERSION');
    }
    if (report.drift.length) {
      console.error('VERSION drift detected:');
      report.drift.forEach(function(d) { console.error('  - ' + d); });
      process.exit(1);
    }
    console.log('OK VERSION APP=' + v.app + ' JSON=' + v.json +
      (tagOk ? ' tag=' + tag : ' (no tag ' + tag + ')'));
    report.notes.forEach(function(n) { console.log('note: ' + n); });
    return;
  }

  report.written.forEach(function(f) { console.log('updated: ' + f); });
  report.ok.forEach(function(f) { console.log('ok: ' + f); });
  console.log('VERSION APP=' + v.app + ' JSON=' + v.json + ' label=' + v.label);

  if (DO_TAG) {
    if (tagOk && !FORCE_TAG) {
      console.log('tag exists: ' + tag + ' (use --force-tag to move)');
    } else {
      if (tagOk && FORCE_TAG) {
        childProcess.execSync('git tag -d "' + tag + '"', { cwd: ROOT, stdio: 'inherit' });
      }
      var msg = 'App ' + v.label + ' / project JSON ' + v.json;
      childProcess.execSync('git tag -a "' + tag + '" -m "' + msg.replace(/"/g, '\\"') + '"', {
        cwd: ROOT,
        stdio: 'inherit'
      });
      console.log('created tag: ' + tag);
    }
  } else if (!tagOk) {
    console.log('hint: git tag not found for ' + tag + ' — after commit: node scripts/sync-version.js --tag');
  }
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
