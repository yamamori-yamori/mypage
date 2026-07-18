// ME.APP_VERSION / ME.APP_VERSION_LABEL / ME.JSON_VERSION
// ★ 手編集しない — ルート VERSION を正とし node scripts/sync-version.js で生成
// APP_VERSION: アプリ仕様（UI・README/MANUAL 現行）
// JSON_VERSION: プロジェクト JSON（serializer / createProject）

window.ME = window.ME || {};

(function() {
  'use strict';

  // BEGIN-SYNC-VERSION
  var APP_VERSION = '4.4';
  var JSON_VERSION = '1.3';
  // END-SYNC-VERSION

  window.ME.APP_VERSION = APP_VERSION;
  window.ME.APP_VERSION_LABEL = 'Ver.' + APP_VERSION;
  window.ME.JSON_VERSION = JSON_VERSION;
})();
