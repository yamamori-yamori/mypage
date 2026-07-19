# 実装手順書: エフェクト線・心理系 Phase P0〜P2

| 項目 | 内容 |
|---|---|
| 対象アプリ | マンガページエディタ（Ver.4.4 / JSON 1.3） |
| スコープ | P0 土台 / P1 既存線強化 / P2 新 kind（線・心理） |
| 対象外 | トーン・ベタ面、画像スタンプ、トンボ、main.js 分割、JSON major バンプ |
| 依存方向 | `core → render → tools → io/ui → main` |
| 規約 | IIFE + `var` + `ME.*` / ES modules 禁止 / BatchEdit は部分スナップ |

本文書は実装時の **作業手順の正** とする。仕様の製品説明は `README.md` を更新して追随する。

---

## 0. ゴールと非ゴール

### 0.1 ゴール

- 絵（画像）の **上** に乗る **線・心理系** エフェクトを増やす
- 既存 `type:'effect' + kind` に乗せ、新 object type は作らない
- コマ内クリップを維持（ページ全体配置は今までどおり非注力）
- プリセットで「スタンプ的」なワンクリック配置の土台を P1 で用意する（P3 本UIは範囲外だが辞書は P1 で置く）

### 0.2 非ゴール

- `flatTone` / `screenTone` / `flatBand` / グラデ / ビネット等の **面トーン**
- 効果音画像・記号スタンプ（image 系統）
- EventBus 導入や `main.js` リファクタ
- 融合の type 跨ぎ
- 自動テストフレームワーク導入

### 0.3 成果物（P2 完了時）

| kind | UI名 | 備考 |
|---|---|---|
| `concentration` | 集中線 | 既存。params/プリセット強化 |
| `speedLines` | スピード線 | 既存。params/プリセット強化 |
| `horrorLines` | ホラー線 | **新** P2-1 |
| `uneaseLines` | ざわ線 | **新** P2-2 |
| `spikeAura` | 怒りギザ | **新** P2-3 |
| `dropLines` | ドロップ線 | **新** P2-4 |
| `shockBurst` | 小衝撃 | **新** P2-5 |
| `wavyLines` | 揺れ線 | **新** P2-6（優先低） |
| `crackLines` | ヒビ | **新** P2-7（優先低） |

**推奨リリース単位（本書の実装順）**

1. P0（最小共通化）
2. P2-1 ホラー線（先に1 kind を通す）
3. P2-2 ざわ線（共通化の検証）
4. P1 既存線 params + プリセット辞書
5. P2-3 怒りギザ
6. P2-4 / P2-5
7. （任意）P2-6 / P2-7
8. README / MANUAL 追記、`node --check`

P0 を厚くしすぎないこと。**ホラーを1本通してから**共通ヘルパを抽出する方が事故が少ない。P0 は「後で抜くフックを先に決める」程度に留めてよい。

---

## 1. 現状マップ（実装前に読む）

| 役割 | パス | 要点 |
|---|---|---|
| 生成 | `js/core/data-models.js` → `Effect.create` | kind ごとの既定 `params` |
| 配置 | `js/tools/effect-tool.js` | コマヒット → `addEffect` → `AddObject`。集中線は origin 相対 |
| 描画 | `js/render/effect-renderer.js` | `switch (kind)`。集中/スピードは rotate+clip |
| 選択 | `js/tools/select-tool.js` | 集中線の焦点ハンドル |
| ステップUI | `js/ui/step-panel.js` | 現状ボタン: 集中線 / スピード線のみ |
| プロパティ | `js/ui/property-panel.js` → `renderEffectProps` | kind セレクト + 線スライダー |
| 配線 | `js/main.js` | `currentEffectKind`, `applyDefaultParams`, `handlePropertyChange` |
| 描画順 | `js/render/render-engine.js` 等 | effect は画像の上・吹き出し前（既存維持） |
| 出力 | `exporter.js` / `page-draw.js` | engine と同順なら kind 追加だけで出る想定。差分確認は必須 |

### 1.1 既存の罠（必ず守る）

1. Undo: **先にモデル変更 → `commandStack.push`**（push は再実行しない）
2. `BatchEdit` にフルオブジェクトを載せない（`params` 部分のみ）
3. `applyDefaultParams` が **main と effect-tool に二重**にある → **両方**更新
4. 変数は `var`。新規に `let`/`const`/アロー/テンプレリテラルを増やさない
5. 1タスク1ファイルを基本。やむを得ず複数なら順序を本書どおり
6. `/Users/makoto/ai/manga` 外にファイルを作らない

---

## 2. データ設計

### 2.1 共通線 params（線・心理系）

新規・強化する線 kind は、可能な範囲で次を共有する（無いキーは描画側既定）。

```text
params: {
  lineCount: number,       // 本数
  lengthRatio: number,     // 長さ%（意味は kind ごとに解釈）
  thickness: number,       // 太さ% 既定 100
  color: string,           // '#000000'
  jitter: number,          // 揺らぎ% 既定 30 など kind 既定
  origin: { x, y },        // 必要な kind のみ
  originRelative: boolean  // コマ中心相対（集中・小衝撃・ヒビ）
}
```

kind 固有:

| kind | 追加 params | 意味 |
|---|---|---|
| `concentration` | （既存）+ 任意 `jitter` | 放射。length は中心クリア寄り |
| `speedLines` | `direction`, 任意 `align`, `jitter` | `horizontal`/`vertical`/`diagonal`。`align`: `start`/`center`/`end` |
| `horrorLines` | `edgePadding` | 縁からの内側オフセット比 |
| `uneaseLines` | `angle` | 短線の基準角（度） |
| `spikeAura` | `spikeSharpness` | トゲの鋭さ 0–100 |
| `dropLines` | `gap`, `drift` | 間隔・横ずれ |
| `shockBurst` | `spanDeg` | 扇の角度。360 で全周 |
| `wavyLines` | `amplitude`, `wavelength`, `direction` | 波 |
| `crackLines` | `branch` | 分岐回数/量 |

### 2.2 旧データ互換

- 未知 params が無い JSON は既定値で描画
- 旧 kind のみのファイルは現状どおり読める
- **JSON `version` は 1.3 のまま**（破壊的変更をしない）
- serializer に kind ホワイトリストが無いことを実装時に確認。あれば追加

### 2.3 プリセット辞書（P1）

保存データには preset 名を必須にしない。配置時に params へ展開する。

配置案（実装場所は P1 で決定、推奨は `effect-renderer.js` 隣ではなく **tools か main から参照できる薄い辞書**）:

```text
// 概念例（ES5）
ME.Effects = ME.Effects || {};
ME.Effects.PRESETS = [
  { id: 'conc-mid', label: '集中・中', kind: 'concentration', params: { ... } },
  { id: 'speed-h', label: 'スピ横', kind: 'speedLines', params: { direction: 'horizontal', ... } },
  { id: 'horror-std', label: 'ホラー', kind: 'horrorLines', params: { ... } }
];
```

P0〜P2 では **辞書 + 配置時適用**まで。スタンプ専用の大きな UI（P3）はボタン数個の簡易で可、作り込みは任意。

---

## 3. 描画仕様（kind 別）

すべて `panelBounds` で clip。色は `params.color`。乱数は既存 `seedFrom(effectObj)` + `makeRng` を再利用し、**フレームごとに模様が変わらない**こと。

### 3.1 `horrorLines`（ホラー線）

- コマ矩形の **4 辺**から内側へ向かう短線
- 線の始点は縁付近（`edgePadding`）、終点は内側に `lengthRatio` 相当
- 角度は法線方向 ± jitter
- 本数は辺に分配（合計 `lineCount`）
- 太さは `thickness`

### 3.2 `uneaseLines`（ざわ線）

- コマ内に **短い線分をランダム配置**（位置・長さに jitter）
- 長い放射や縁限定にしない（面に散る心理線）
- `angle` を基準に ±揺らぎ

### 3.3 `spikeAura`（怒りギザ）

- コマ縁（または inset 矩形）に沿った **外側or内側トゲ**の折れ線/三角
- 漫画の「怒りオーラ」を簡略化。中心 origin は不要

### 3.4 `dropLines`（ドロップ線）

- おおむね垂直の短線を横方向に並べる
- 上端揃え or 上寄り。`drift` でわずかに傾き/横ずれ

### 3.5 `shockBurst`（小衝撃）

- 集中線の縮小版: origin から短い楔 or 線
- `spanDeg < 360` なら扇（クリック方向に向けるのは任意。初期は全周 or 固定扇）
- origin 相対は集中線と同じく配置クリックで設定

### 3.6 `wavyLines` / `crackLines`

- 優先低。P2 後半。波は parallel な bezier/折線。ヒビは origin から分岐線分

### 3.7 回転

- 線系 kind は集中/スピード同様、コマ中心で `transform.rotation` を掛けてから模様描画
- rotate 対象 kind リストを配列で持ち、`indexOf` で判定（P0）

---

## 4. フェーズ別実装手順

作業単位は **1 PR / 1 論理ステップ**を推奨。各ステップ後に §6 の確認を行う。

---

### Phase P0 — 土台（最小）

目的: 新 kind 追加時の修正点を減らす。大きなリファクタはしない。

#### P0-A. 回転・clip 対象のリスト化

**ファイル:** `js/render/effect-renderer.js` のみ

1. ファイルを読み、集中/スピードの rotate+clip ブロックを特定
2. 次のような配列を追加（名称は既存スタイルに合わせる）:

```text
var LINE_EFFECT_KINDS = {
  concentration: true,
  speedLines: true
  // P2 で horrorLines 等を足す
};
```

3. `kind === 'concentration' || kind === 'speedLines'` を `LINE_EFFECT_KINDS[kind]` に置換
4. `node --check js/render/effect-renderer.js`
5. 手動: 集中線・スピード線を置き、回転が以前どおりか確認

**完了条件:** 挙動不変。新 kind はフラグ1行で回転対象に入れられる。

#### P0-B. （任意・薄く）線 params 読み取りヘルパ

**ファイル:** `js/render/effect-renderer.js`

```text
function lineParams(params) {
  params = params || {};
  return {
    lineCount: params.lineCount !== undefined ? params.lineCount : 24,
    lengthRatio: (params.lengthRatio !== undefined ? params.lengthRatio : 90) / 100,
    thickness: (params.thickness !== undefined ? params.thickness : 100) / 100,
    color: params.color || '#000000',
    jitter: (params.jitter !== undefined ? params.jitter : 30) / 100
  };
}
```

既存 `drawConcentration` / `drawSpeedLines` への適用は **無理に一気に書き換えない**。新 draw 関数から使うので十分。

#### P0-C. ドキュメントのみ

本ファイルのチェックリストを実装チェックに使う。コード変更なしでよい。

**P0 で触らない:** `main.js` 分割、preset UI 本実装、property 全面改修。

---

### Phase P1 — 既存線の強化

P2-1 を先にやる場合、P1 は P2-2 の後でもよい（§0.3 推奨順）。

#### P1-1. `concentration` / `speedLines` に `jitter`（と speed の `align`）

**順序:**

1. **`js/core/data-models.js`**  
   - concentration / speedLines の既定に `thickness: 100`, `jitter: 30`（数値は調整可）  
   - speedLines に `align: 'start'`（または `center`）。描画未使用なら既定だけ先でも可
2. **`js/render/effect-renderer.js`**  
   - 既存ループのランダム幅を `jitter` でスケール  
   - `align` は線分の始点・終点の寄せ
3. **`js/ui/property-panel.js`**  
   - 線 kind のとき「揺らぎ」スライダー  
   - スピードのとき「寄せ」セレクト（任意）
4. **`js/main.js` と `js/tools/effect-tool.js` の `applyDefaultParams`**  
   - 同じ既定を鏡写し
5. `node --check` 対象すべて

#### P1-2. プリセット辞書

**推奨新規ファイル:** `js/core/effect-presets.js`  
（core に置く場合、models に依存しない **純粋データ**にすること。または `js/tools/effect-presets.js`）

1. IIFE で `ME.Effects.PRESETS` と `ME.Effects.getPreset(id)` を公開
2. `index.html` の script 順に追加（`data-models` の後、`effect-tool` の前が安全）
3. **`effect-tool.js`**: 配置前に `defaultPresetId` があれば params を上書きマージ
4. **`step-panel.js`**: 簡易ボタン（最初は 3〜6 個で可）
5. **`main.js`**: `currentEffectPreset` を保持し `renderStepPanel` に渡す（kind と同様）

プリセット選択時:

- `kind` も切り替わる → `currentEffectKind` と `ME.Tools.Effect.defaultKind` を同期
- 配置オブジェクトには **展開後 params のみ**保存

#### P1-3. 集中/スピード用プリセット中身（初期セット例）

| id | label | kind | 要点 |
|---|---|---|---|
| `conc-weak` | 集中・弱 | concentration | lineCount 少、length 短め |
| `conc-mid` | 集中・中 | concentration | 現行既定に近い |
| `conc-strong` | 集中・強 | concentration | 本数多・太め |
| `conc-open` | 集中・空き大 | concentration | lengthRatio 低め（中心広い） |
| `speed-h` | スピ・横 | speedLines | horizontal |
| `speed-v` | スピ・縦 | speedLines | vertical |
| `speed-d` | スピ・斜め | speedLines | diagonal |

**完了条件:** プリセット → コマクリックで期待に近い線が出る。保存 JSON に preset id が無くても再オープンで同見た目（params が保存されている）。

---

### Phase P2 — 新 kind

各 kind は **同じチェックリスト**（§5）を1周する。以下は kind 固有手順。

#### 共通: 1 kind 追加の標準順序（厳守）

```text
① data-models.js          既定 params
② effect-renderer.js      draw* + switch + LINE_EFFECT_KINDS
③ effect-tool.js          配置時 origin 等（必要な kind のみ）+ applyDefaultParams
④ main.js                 applyDefaultParams + handlePropertyChange の kind 分岐（あれば）
⑤ property-panel.js       スライダー / セレクト
⑥ step-panel.js           EFFECT_KINDS ボタン
⑦ select-tool.js          origin ハンドルが要る kind だけ concentration と同様に拡張
⑧ index.html              新規 JS が増えたときのみ
⑨ README.md               kind 一覧
⑩ node --check 各ファイル
⑪ ブラウザ手動確認（§6）
```

一度に複数 kind の描画を書かない。**①→⑪を kind ごとに完了**させてから次へ。

---

#### P2-1. `horrorLines`（最優先）

1. models 既定例:

```text
{
  lineCount: 48,
  lengthRatio: 35,
  thickness: 100,
  color: '#000000',
  jitter: 40,
  edgePadding: 0
}
```

2. `drawHorrorLines(ctx, params, drawBounds, seed)` を実装
3. switch に case 追加。`LINE_EFFECT_KINDS.horrorLines = true`
4. step ボタン「ホラー線」
5. property: 本数・長さ・太さ・揺らぎ・（任意）縁余白
6. origin ハンドル **不要**
7. tool の配置分岐は kind 設定だけで可（origin 強制不要）
8. 確認: 画像入りコマの上に縁からの線。PNG に出る。Undo 可

#### P2-2. `uneaseLines`

1. 既定: lineCount 多め、lengthRatio 小（短い）、angle:  -20 など
2. `drawUneaseLines` — 矩形内にランダム短線
3. 回転対象に含める
4. UI「ざわ線」
5. property に angle 追加可

#### P2-3. `spikeAura`

1. 縁に沿ったトゲ。`spikeSharpness` で先端の鋭さ
2. fill の三角でも stroke のギザでもよいが、**面トーンに見えない**よう線/細い三角に留める
3. UI「怒りギザ」

#### P2-4. `dropLines`

1. 垂直短線の列
2. UI「ドロップ線」
3. direction 固定でよい（回転で斜めにできる）

#### P2-5. `shockBurst`

1. 集中線に近いが短く、`spanDeg` あり
2. **配置クリックで origin 相対**（effect-tool で concentration と同様）
3. select-tool の焦点ハンドル対象に `shockBurst` を追加（`kind === 'concentration'` の条件を関数 `hasOriginHandle(kind)` に）

#### P2-6. `wavyLines`（任意）

1. 平行な波線。実装コスト中。スキップ可

#### P2-7. `crackLines`（任意）

1. origin 必須。ハンドル対象に含める
2. 分岐は深さ制限付き再帰 or 回数ループ（スタックと性能に注意）

---

### P2 と property / step の具体パッチ指針

#### `step-panel.js`

既存:

```text
{ id: 'concentration', label: '集中線' },
{ id: 'speedLines',  label: 'スピード線' },
```

へ追加していく。グリッドが溢れる場合は CSS を最小調整（`css/style.css` の `.effect-kinds-grid`）。**このフェーズでトーン系ボタンは出さない。**

#### `property-panel.js` の `KINDS` 配列

線・心理系を追加。面系を増やす必要はない（既存 flash 等は残してよいが、本フェーズの主対象外）。

線パラメータ UI 条件を拡大:

```text
// 概念
function isLinePsychEffect(kind) {
  return kind === 'concentration' || kind === 'speedLines'
    || kind === 'horrorLines' || kind === 'uneaseLines'
    || kind === 'spikeAura' || kind === 'dropLines'
    || kind === 'shockBurst' || kind === 'wavyLines'
    || kind === 'crackLines';
}
```

speed 専用 UI は `speedLines` のまま。origin 系の説明文が必要なら kind 名で分岐。

#### `main.js` `applyDefaultParams`

effect-tool 側と **同じテーブル**にする。差分があると kind 切替時だけ壊れる。

可能なら後続フェーズで辞書一本化してよいが、**P0–P2 の必須ではない**（二重更新をチェックリストで防ぐ）。

---

## 5. ファイル別チェックリスト（印刷用）

新 kind または P1 変更のたびにコピーして使う。

```text
[ ] js/core/data-models.js — Effect.create 既定
[ ] js/core/effect-presets.js — 使う場合のみ + index.html
[ ] js/render/effect-renderer.js — draw + switch + LINE_EFFECT_KINDS
[ ] js/tools/effect-tool.js — 配置 / applyDefaultParams / defaultKind
[ ] js/tools/select-tool.js — origin ハンドル対象（必要な kind）
[ ] js/ui/step-panel.js — ボタン
[ ] js/ui/property-panel.js — KINDS + スライダー
[ ] js/main.js — currentEffectKind 連携 / applyDefaultParams / property kind
[ ] js/io/exporter.js / page-draw.js — 描画が engine 経由か、独自 switch が無いか確認
[ ] README.md — エフェクト節・既知制限
[ ] MANUAL.html — 必要なら一文（任意）
[ ] node --check <触ったファイル>
[ ] 手動確認 §6
```

exporter / page-draw に kind の個別 switch がある場合は **renderer と同じ case を追加**。無ければ変更不要。

---

## 6. 手動確認手順

### 6.1 回帰（毎回）

1. 紙 → コマを1つ以上
2. 画像をコマに配置
3. エフェクトで集中線 → 回転・焦点・本数変更
4. スピード線 → 向き変更
5. Ctrl+Z / Ctrl+Shift+Z
6. JSON 保存 → 再読込で残る
7. PNG 書き出しにエフェクトが含まれる（メモは含まれないことと対比）

### 6.2 新 kind

1. ステップで kind 選択 → コマクリックで1発配置
2. 画像の **上** に線が見える
3. コマ外に大きくはみ出さない（clip）
4. 右パネルで params が即反映
5. Delete / 削除ボタン
6. 別ページに移って戻っても残る
7. プリセットがある場合、プリセット → 配置

### 6.3 やってはいけない確認漏れ

- kind 切替（プロパティの種類セレクト）後の params 破綻
- effect-tool と main の既定不一致
- select に入ったあと回転ゼロ以外
- 高本数（80+）で UI フリーズしないか（ざわ・ホラー）

---

## 7. 実装チケット順（コピー用）

| # | ID | タスク | 主ファイル | 依存 |
|---|---|---|---|---|
| 1 | P0-A | LINE_EFFECT_KINDS 導入 | effect-renderer.js | — |
| 2 | P0-B | lineParams ヘルパ（任意） | effect-renderer.js | 1 |
| 3 | P2-1 | horrorLines 一式 | models→render→tool→ui→main | 1 |
| 4 | P2-2 | uneaseLines 一式 | 同上 | 3 |
| 5 | P1-1 | jitter/align + property | models, render, property, defaults | 3 |
| 6 | P1-2 | presets 辞書 + 簡易UI | effect-presets, tool, step, main | 5 |
| 7 | P2-3 | spikeAura | 一式 | 4 |
| 8 | P2-4 | dropLines | 一式 | 7 |
| 9 | P2-5 | shockBurst + origin ハンドル | 一式 + select-tool | 7 |
| 10 | P2-6 | wavyLines（任意） | 一式 | 9 |
| 11 | P2-7 | crackLines（任意） | 一式 + select-tool | 9 |
| 12 | DOC | README/MANUAL | README.md | 適宜 |

---

## 8. リスクと回避

| リスク | 回避 |
|---|---|
| applyDefaultParams 二重管理のズレ | チェックリストで main + effect-tool を必ずペア更新 |
| BatchEdit に params 丸ごと巨大化 | 変更フィールドだけ。origin ドラッグは既存パターン踏襲 |
| 毎フレーム模様がちらつく | seed を id から固定（既存 makeRng） |
| 本数過多で重い | property の max を抑える（例: 4–120）。ざわは点より短線 |
| 面塗りに見えるギザ | spike は線幅を抑え fill 面積を小さく |
| serializer が strip | 読込後 params が落ちないか1回保存ラウンドトリップ |
| script 順忘れ | 新規ファイルは index.html に追加し README の順も更新 |

---

## 9. 完了定義（P0–P2）

- [ ] P0-A 済み（挙動不変）
- [ ] `horrorLines` / `uneaseLines` がステップから置ける
- [ ] （推奨）`spikeAura` / `dropLines` / `shockBurst` が置ける
- [ ] 集中・スピードが以前より params/プリセットで使いやすい
- [ ] トーン系をステップの主UIに出していない
- [ ] 保存・読込・PNG・Undo が線エフェクトで成立
- [ ] README に kind と主な params が書かれている
- [ ] 任意: VERSION を上げる場合は `VERSION` の APP のみ手編集 → `node scripts/sync-version.js`（機能追加がユーザー向けに見えるなら 4.5 等。本手順の必須ではない）

---

## 10. 参考: 既存コード位置（探索の起点）

```text
js/core/data-models.js          createEffect
js/core/scene-graph.js          addEffect
js/core/command-stack.js        AddObject / getCollectionName effect
js/render/effect-renderer.js    drawConcentration, drawSpeedLines
js/tools/effect-tool.js         配置、defaultKind、applyDefaultParams
js/tools/select-tool.js         集中線 origin ハンドル
js/ui/step-panel.js             effect kinds grid
js/ui/property-panel.js         renderEffectProps
js/main.js                      currentEffectKind, applyDefaultParams, handlePropertyChange
index.html                      script 順
README.md                       § オブジェクト / 既知制限
```

---

## 11. 変更履歴（本書）

| 日付 | 内容 |
|---|---|
| 2026-05-11 | 初版。会話上の P0–P2 リストを実装手順書化 |

---

*関連: リポジトリルート `AGENTS.md` / 仕様 `README.md` Ver.4.4 / JSON 1.3*
