# マンガページエディタ 開発仕様書 Ver.4.4.1
copyright 2026 やまもりやもり

ローカルAI向け開発仕様書。現行実装（プロジェクトJSON `version: "1.3"` / アプリ仕様 Ver.4.4.1）を基準とする。

### バージョン単一ソース（必読）

| ファイル / コマンド | 役割 |
|---|---|
| **`VERSION`** | **正本**。`APP=x.y`（UI・仕様書の現行）と `JSON=a.b`（プロジェクトファイル） |
| `js/core/app-version.js` | `ME.APP_VERSION` / `ME.APP_VERSION_LABEL` / `ME.JSON_VERSION`（**手編集禁止**・sync 生成） |
| `node scripts/sync-version.js` | 本体左ナビ・MANUAL・README/AGENTS の「現行」表記・serializer フォールバックを同期 |
| `node scripts/sync-version.js --check` | 食い違い検出（CI / コミット前） |
| `node scripts/sync-version.js --tag` | コミット後に annotated tag **`v{APP}`**（例: `v4.2`）を作成 |

手順: `VERSION` を編集 → `node scripts/sync-version.js` → 変更履歴・実装を README に書く → commit → `node scripts/sync-version.js --tag`。  
JSON フォーマット破壊時のみ `JSON=` を上げる（読込互換は serializer）。仕様だけの変更は `APP=` のみ。

Ver.4.4 の主変更: **安定性・信頼性の一斉修正（バグフィックスリリース、機能追加なし）**。JSON は **1.3 のまま**。主な修正: (1) Undo/Redo — 一括削除を1コマンド化（`DeleteObjects`）・履歴上限 10→50・`recalcZIndices` を重ね順保存の連番化・スナップショット書き戻しの deep copy 徹底・`RemovePage.redo` のページ index 計算修正・Ctrl+Shift+Z / CapsLock 時のショートカット不動作修正。(2) 描画 — 吹き出し短集中線/ケバケバ線をシード付き乱数化（描画のたびに変化しない）・スクリーントーン density のクランプ（0 でのクラッシュ防止）と `scale` の実効化・削除済みコマのクリップキャッシュ掃除・hue 単独指定の無視修正・PNG 出力側 colorAdjust の NaN 防止・編集/出力のクリップ判定統一。(3) ツール — `**` 演算子の ES5 化・回転ハンドルの角度ジャンプ修正（相対回転化）・微小ドラッグの位置ズレ復元・ウィンドウ外 mouseup の取りこぼし対策（全ツール）。(4) IO/UI — 印刷のポップアップブロック対策とページサイズ混在対応・保存ダイアログの `.manga.json` 拡張子問題修正・カスタム用紙サイズの単位/dpi 既定の適正化。(5) 低優先改善 — ペースト時の画像アセット重複排除と連続ペーストの累積オフセット・ページサイズ変更/余白削除の Undo 対応（`EditPageSize` / `CropPage`）・下書き/メモの重ね順変更対応・確認ダイアログの Enter フォーカス尊重・数値入力の入力途中 0 反映防止・no-op コマンドの Undo 履歴浪費抑止・ハンドル判定のズーム補正・画像ドロップのコマ判定改善（最前面優先 + 多角形判定）・テキスト輪郭キャッシュ LRU 化・画像キャッシュ上限/破棄 API・マウス座標の CSS スケール対応・`getNextZIndex` 防御・`sync-version.js` の MANUAL 欠落ガード。

Ver.4.3 の主変更: **線のガサつき** — セリフ袋 `outline.roughness`、吹き出し `strokeRoughness`（縁の粗い歪み）、コマ `borderRoughness`（**太さのみ**・頂点/中心線不変）、コマ線幅 −/＋ステッパー。JSON は **1.3 のまま**（任意フィールド）。

Ver.4.2 の主変更: **メモレイヤー（校閲）** — `page.memos`（freehand 曲線 / string）、同一赤+白縁、編集最上層、PNG/印刷非表示、Ctrl+A 対象外、融合・リサイズなし、一括削除。

Ver.4.1.1 の主変更: **ヘルプ（？→MANUAL.html）**、**しっぽ種類追加**（thoughtFew / lightning / spiral・セレクトに「なし」）、**線幅±と二重線同一行**、プロパティ冗長見出し整理、グリッド吸着デフォルトON、UIアイコン（セリフA・下書き形状）。  
Ver.4.1 の主変更: **ページ追加モード**（白紙 / 前ページと同じ台紙 / 前ページのコピー）、**Ctrl/Cmd+A 全選択**、**別ページへのペーストは位置そのまま**（同一ページは +20px）。  
Ver.4.0 の主変更（継承）: **複数ページ** — `Project.pages[]` + `currentPageIndex`、PageManager、上部ナビ / サムネ一覧、現在ページ PNG（複数時 `-n`）、全ページ印刷（下書きオフ）、下書き一括削除、Undo の pageId 対応。  
Ver.3.0 の主変更（継承）: **下書きレイヤー（draft）完成** — 円/矩形/直線/文字列、融合、コマクロップ、描画順（コマ塗り→下書き→画像）。

## 目次

1. [全体アーキテクチャ](#1-全体アーキテクチャ)
2. [座標系](#2-座標系)
3. [データモデル](#3-データモデル)
4. [UI構成](#4-ui構成)
5. [モジュール公開API一覧](#5-モジュール公開api一覧)
6. [処理フロー](#6-処理フロー)
7. [ファイル構成](#7-ファイル構成)
8. [localAI開発ルール](#8-localai開発ルール)
9. [既知の制限・今後の課題](#9-既知の制限今後の課題)
10. [Ver.3.0〜Ver.4.4 変更サマリ](#10-ver30ver40ver41ver411ver42-変更サマリ)

---

## 1. 全体アーキテクチャ

```
┌─────────────────────────────────────────┐
│ UI Layer                                  │
│  ui/toolbar.js      … ステップナビ+ファイル操作+表示倍率 │
│  ui/step-panel.js   … ステップ別ガイド/設定（下書き種別含む）│
│  ui/property-panel.js … 選択オブジェクト編集              │
├─────────────────────────────────────────┤
│ main.js（EditorController相当）             │
│  ・ステップ⇄ツール / 選択モード維持            │
│  ・表示倍率・パン / プロパティ集約             │
│  ・融合・コマクロップ・下書き kind 状態         │
├─────────────────────────────────────────┤
│ tools/  … マウス操作→SceneGraph更新+Command   │
│  select / panel / image / balloon / text     │
│  effect / draft（+ string-tool 互換）        │
├─────────────────────────────────────────┤
│ core/   … SceneGraph / PageManager / CommandStack /
│           Selection / Clipboard / Models     │
├─────────────────────────────────────────────┤
│ render/ … Canvas 2D（融合/クリップ/ズーム）    │
│  描画順: コマ塗り → drafts → 画像/効果/枠     │
│          → balloons → texts → 断ち切り枠     │
│  PageDraw: PNG/サムネ/印刷の共有描画         │
├─────────────────────────────────────────────┤
│ io/     … serializer(JSON 1.3) / exporter / print │
└─────────────────────────────────────────────┘
```

- 全オブジェクトは共通基底 `EditableObject`（`id / type / transform / zIndex / locked / visible`）。
- 描画は「モデル更新 → `renderEngine.setDirty()` → rAF 再描画」の一方向。
  **`setDirty()` は内部で再描画をスケジュール**する。強制は `renderNow()`。
- 依存方向は `core → render → tools → io/ui → main`。**逆方向禁止**。
- 名前空間はすべて `window.ME`。ES modules 禁止（file:// 直起動）。
- **編集対象ページ**は常に `ME.PageManager.getCurrentPage(project)`（実行時互換で `project.page` エイリアスあり。JSON 保存時は `page` キーを出さない）。

### 1.1 描画順（重要・Ver.3.0+）

1. ページ白地（台紙色）  
2. **台紙画像** `page.backingImage`（任意）  
3. **コマの塗り**（融合は Union シルエット）  
4. **下書き `page.drafts`**（kind: circle/rect/line/string。融合 `drawGroup`。`panelId` でコマクロップ可）  
5. 旧 `page.strings`（移行前データ互換描画）  
6. コマごとの **画像 → エフェクト → 枠線**（融合クリップ）  
7. ページ直下の orphan 画像 / page スコープ効果  
8. **吹き出し**（融合 `drawGroup` / `panelId` クロップ）  
9. **セリフ text**  
10. 断ち切り枠（破線・編集画面）  
11. **メモ `page.memos`**（校閲用 freehand/string・白縁赤。編集のみ。PNG/印刷/サムネなし）  
12. 選択オーバーレイ  

→ 画像を入れると下書きは自然に隠れる（下描きレイヤー）。  
→ メモは本線の上に常に見えるが、出力には乗らない。Ctrl+A では選ばれない。  
→ PNG / 印刷 / サムネは `ME.Render.PageDraw.draw`（印刷は `showDrafts:false`。memos は常に非描画）。

---

## 2. 座標系

| 場面 | 解像度 | 説明 |
|---|---|---|
| 編集中（全オブジェクト座標） | **96dpi固定**（`SCREEN_DPI`）のページ座標 | オブジェクトは常にページ座標px。B5なら約688×971px |
| キャンバス（画面） | ページ＋断ち切り余白 × 表示倍率 | `canvas.width = (ページpx + BLEED×2) × zoom`（Math.round） |
| マウス→ページ座標 | — | `ME.Render.Engine.getPagePoint(canvas, e)` = `(clientX - rect.left) / zoom - BLEED` |
| JSON保存 | 96dpi座標のまま | mm値とdpiはメタ情報 |
| PNG出力 | `page.size.dpi`（印刷350 / Web96） | exporter が `ctx.scale(dpi/96)`。**余白・ズームは出力に含めない** |

- 断ち切り余白 `BLEED = 40`（ページ座標px）。ページ座標 (0,0) は余白の内側。
- 表示倍率 `zoom` は render-engine の静的変数。`render()` は `setTransform(zoom,…)` → `translate(BLEED,BLEED)`。
- オブジェクト座標は**常に96dpiページ座標**。ズーム/余白は描画とマウス変換に閉じる。

### 2.1 原点規約（Ver.3.0）

| 種類 | transform の意味 |
|---|---|
| image / balloon / draft circle・rect / effect | 概ね**中心** |
| draft line | transform = **始点**。params は相対 end |
| text / draft string（横書き） | **左上**（`textAlign=left` `textBaseline=top`） |
| text（縦書き） | 最初の列の上端。列は左へ進む |

リサイズは**固定辺基準**（対辺固定で中心を再計算）。`scale += dx/100` や `(sx*dx)/2` 中心更新は使わない。

---

## 3. データモデル

プロジェクト JSON: **`version: "1.3"`**（serializer は 1.3 を本線。**1.2 は読込時マイグレート**）。

### 3.1 Project / Page

```typescript
interface Project {
  version: "1.3";
  /** 任意。保存時に serializer が付与。無くても読込可 */
  appTag?: "manga page editor @yamamori_yamori";
  meta: { title: string; createdAt: string; updatedAt: string };
  pages: Page[];                 // 1件以上。空禁止。MAX 想定 64
  currentPageIndex: number;      // 0..pages.length-1（保存可。読込時 clamp）
  assets: { images: Record<string, { id: string; dataUrl: string; /* ... */ }> };
  // 実行時のみ: page エイリアス = pages[currentPageIndex]（toJSON では除去）
  // ファイル名: 保存は {title}.manga.json。読込は末尾 .json なら可（旧 .json 含む）
}

interface Page {
  id: string;
  size: { preset?: string; widthMm: number; heightMm: number; dpi: number };
  backgroundColor: string;          // 既定 "#FFFFFF"
  backingImage: null | {            // 台紙画像（コマの下）。選択不可
    assetId: string; transform: Transform; colorAdjust?: object;
    flipX?: boolean; flipY?: boolean; width?: number; height?: number;
  };
  trimMarks: { enabled: boolean; bleedMm: number; marginMm: number };
  layers: string[];                 // メタ。実描画順は render-engine / PageDraw 固定
  panels: Panel[];
  images: ImageObject[];
  balloons: Balloon[];
  texts: TextObject[];
  effects: EffectObject[];
  drafts: DraftObject[];            // Ver.3.0 本線
  memos: MemoObject[];              // Ver.4.2 校閲メモ（編集専用。PNG/印刷なし）
  strings: any[];                   // 互換用。読込時に drafts(kind:string) へ移行して空に
  // グリッド吸着: ME.Tools.Panel 上のセッション設定（Page JSON には未保存）
}
```

**1.2 互換:** `fromJSON` で `project.page` のみの旧形式を `pages: [page]` + `currentPageIndex: 0` + `version: "1.3"` に昇格。

紙プリセット例: B5/A4/B4、SNS正方形、縦スクロール、フルHD/1600x1200/HD、スマホ縦/スマホ、バナー系、1024x1024、カスタム(px/mm)。

### 3.2 Panel（コマ）

```typescript
interface Panel {
  id: string;
  type: "panel";
  vertices: { x: number; y: number }[];  // 多角形（既定4点）
  borderWidth: number;   // 既定 2
  borderColor: string;   // "#000000"
  borderAlpha: number;   // 0-100
  borderRoughness?: number; // 0-10 枠線の太さガサつき。中心線・頂点は不変（線幅のみ沿線で揺らす）
  fillColor: string;     // "#FFFFFF"
  fillAlpha: number;
  clipPath: boolean;     // 中身クリップ
  fusionGroup: string | null;
  transform: Transform;
  zIndex: number;
  locked: boolean;
  visible: boolean;
}
```

### 3.3 ImageObject（絵）

```typescript
interface ImageObject {
  id: string;
  type: "image";
  panelId: string | null;
  assetId: string;
  width: number; height: number;   // 生成時 natural サイズ
  flipX: boolean; flipY: boolean;
  transform: Transform;            // 中心基準
  colorAdjust: {
    brightness: number; contrast: number; saturation: number;
    grayscale: number; hue: number; tone: number; opacity: number;
  };
  zIndex: number; locked: boolean; visible: boolean;
}
```

- 配置/差し替え時 `panelFitScale` でコマ内フィット。
- DnD: コマなし → 画像サイズのコマ（線幅0）+ 紙サイズ変更可。コマ内 → フィット配置/差し替え。

### 3.4 Balloon（吹き出し）

```typescript
interface Balloon {
  id: string;
  type: "balloon";
  shape: string;                   // ellipse / softEllipse / rect / roughRect / softBurst / jaggedRect / 手描き系 / 多角形 等
  size: { width: number; height: number };
  panelId: string | null;          // コマクロップ。**既定 null（OFF）**
  fusionGroup: string | null;
  fillColor: string; fillAlpha: number;
  strokeColor: string; strokeAlpha: number; strokeWidth: number;
  strokeRoughness?: number;        // 0-10 線のガサつき。0=なめらか。セリフ袋 outline.roughness と同系
  doubleStroke?: boolean;          // 二重線（内側細線）
  innerLine?: boolean;             // 内側線（外側に余白を持たせたオフセット内線）
  dashed?: boolean;                // 破線（点線）
  opacity: number;
  tail: TailShape | null;          // type: normal | normalThick | thought | thoughtFew | jagged | jaggedThick | lightning | spiral
  transform: Transform;
  zIndex: number; locked: boolean; visible: boolean;
}
```

### 3.5 TextObject（セリフ）

```typescript
interface TextObject {
  id: string;
  type: "text";
  content: string;                 // \n 複数行
  writingMode: "vertical" | "horizontal";  // 既定 vertical
  font: {
    family: string; size: number; bold: boolean; color: string;
    alpha: number; letterSpacing: number; lineHeight: number;
  };
  outline: {
    enabled: boolean; color: string; alpha: number; width: number /* 1-10 */;
    roughness?: number; /* 0-10 袋のガサつき。0=なめらか。旧0-100は/10換算 */
    rounded?: boolean;
    artisticEnabled?: boolean; /* アウトライン化＝レイアウト化（手書き風）。台形は本ON時のみ */
    trapezoidTop?: number;    /* -100〜100 上辺。−=縮小 / 0=中央 / ＋=拡大。ベクター輪郭に適用（ぼやけない） */
    trapezoidBottom?: number; /* -100〜100 下辺。同上。中央縦軸固定。UIはアウトライン化配下 */
  };
  transform: Transform;            // 横: 左上 / 縦: 先頭列上端
  zIndex: number; locked: boolean; visible: boolean;
}
```

IME: 変換確定 Enter は `e.isComposing || e.keyCode===229` でコミットしない。

### 3.6 EffectObject（効果）

```typescript
interface EffectObject {
  id: string;
  type: "effect";
  kind: string;                    // concentration | speedLines | horrorLines |
                                   // dropLines | wavyLines | crackLines 等
  scope: string;                   // "panel" 等
  panelId: string | null;
  params: object;                  // lineCount, lengthRatio, direction, thickness, jitter, origin...
  transform: Transform;
  zIndex: number; locked: boolean; visible: boolean;
}
```

- 線・心理系が主（絵の上に線）。トーン面はステップ主UIには出さない。
- 集中線: 三角形（トンガリ）、焦点ハンドル、太さ(%)、揺らぎ、乱数シード固定。
- スピード線: 向き・寄せ・長さ乱数・太さ(%)。
- ホラー線 / ドロップ / 揺れ / ヒビ: `effect-renderer` + `ME.Effects` 既定。
- ドロップ線: `bandWidth`(幅%)・`offsetX`(左右)・横ずれ既定0・長さのばらつき。間隔パラメータなし。
- 揺れ線: 振幅・波長・長さのばらつき。
- 線・心理系共通: `params.seed`（UI「乱数」0–999）で模様のシードを変更。
- 焦点ハンドル: concentration / crackLines。
- 配置はコマ内のみ。

### 3.7 DraftObject（下書き）★ Ver.3.0

```typescript
interface DraftObject {
  id: string;
  type: "draft";
  kind: "circle" | "rect" | "line" | "string";
  params: object;                  // kind 依存
  panelId: string | null;          // コマクロップ。**既定 null（OFF）**
  fusionGroup: string | null;      // 下書き同士の融合（kind 混在可）
  strokeColor?: string;            // 図形。既定 "rgba(140,140,140,0.55)"
  strokeWidth?: number;            // 図形。既定 4.5
  // kind === "string" のみ:
  content?: string;
  font?: TextFont;                 // 既定 color "#a0a0a0", size 24, bold true, horizontal
  writingMode?: string;
  transform: Transform;
  zIndex: number; locked: boolean; visible: boolean;
}
```

| kind | params | 備考 |
|---|---|---|
| circle | `{ width, height }` | 外接矩形の楕円。旧 `radius` は描画側フォールバック |
| rect | `{ width, height }` | 中心原点で strokeRect |
| line | `{ startX, startY, endX, endY }` | transform 相対。選択は端点 ○ ハンドル |
| string | `{}` + content/font | **注釈文字列**。UI表示名は「文字列」。別 type ではない |

- `ME.Core.Models.String.create` / `addString` は **draft kind:string の互換ラッパ**。
- serializer: 旧 `page.strings` → drafts に移行して `strings=[]`。
- 図形プロパティ: 線の色 / 線の太さ。文字列: フォント系。先頭に「コマ内にクロップ」。

### 3.8 Transform

```typescript
interface Transform {
  x: number; y: number;
  rotation: number;   // 度
  scaleX: number; scaleY: number;
}
```

---

## 4. UI構成

### 4.1 DOM（index.html）

DOM + script 読み込み順のみ（ロジック禁止）。

| 要素 | 役割 |
|---|---|
| `#topbar` / `#app-title` / `#scroll-hint` / `#file-actions` | タイトル・操作ヒント・倍率/ファイル／**？→`MANUAL.html`（別タブ）** |
| `#step-nav` | 左ステップナビ |
| `#main-canvas` | 中央キャンバス |
| `#step-panel` / `#property-panel` | 右ガイド + プロパティ |
| `#image-input` | hidden ファイル入力 |

### 4.2 ステップとツール

| ステップID | ラベル | ツール | 補足 |
|---|---|---|---|
| `paper` | 1. 紙を決める | select | プリセット/向き/カスタム、グリッド吸着、余白削除 |
| `panel` | 2. コマを置く | panel | 台紙設定（色・画像）・空き領域ドラッグ作成・頂点編集・グリッド吸着 |
| `image` | 3. 絵を入れる | image | 選択/移動/拡縮/回転、DnD、差し替え |
| `balloon` | 4. 吹き出し | balloon | 形状/しっぽ/融合/クロップ、確定後リサイズ |
| `text` | 5. セリフ | text | 連続配置、プロパティ継承、IME 安全 |
| `effect` | 6. エフェクト | effect | コマ内。線・心理 kind |
| `draft` | ✎ 下書き | draft | 円/矩形/直線/文字列。**このステップでは draft のみ選択可** |

- **選択モード**: 専用ステップなし。Shift で select ツール。選択中は Shift 離しても維持。空かつ Shift 非押下で元ツール復帰。
- `evaluateSelectMode` はツール mouseup 後 **`setTimeout(0)`**（ラバーバンド途中破壊防止）。
- 下書き kind は `main.currentDraftKind` + `ME.Tools.Draft.defaultKind` で保持（ツール再生成でリセットしない）。
- 文字列入力 UI: fixed ダイアログ、キャレット左端、`clientX/Y` 配置、外クリックはジェスチャ後 defer。

### 4.3 融合 / コマクロップ（共通）

- **融合** (`fusionGroup`): 同 type 同士を一体選択・一体移動。下書きは kind 混在可。  
  `fuse` / `unfuse` / グループ移動は必ず `expandFusionIds` でメンバー展開。
- **コマクロップ** (`panelId`): 吹き出し・下書きは**既定 OFF**。プロパティ「コマ内にクロップ」で ON。  
  対象推定 `findTopPanelForObject`: 中心 → 原点 → 線端点 → 交差面積最大 → **最寄りコマ**。コマが無ければ失敗。  
  融合グループはメンバー一括で同じ `panelId`（`BatchEdit` 部分スナップ）。

---

## 5. モジュール公開API一覧

localAI に修正させるときは **対象ファイル + 下記シグネチャ** に限定。

### core/

```
ME.Core.ID.generate() → string
ME.Core.Color.toRgba(hex, alpha0to100) → "rgba(...)"
ME.Core.Models.createTransform(opts?) → Transform
ME.Core.Models.Panel.create(vertices?, opts?) → Panel
ME.Core.Models.Image.create(panelId, assetId, transform?) → ImageObject
ME.Core.Models.Balloon.create(shape?, size?, transform?) → Balloon
ME.Core.Models.Text.create(content?, transform?) → TextObject
ME.Core.Models.Effect.create(scope?, kind?, params?, transform?) → EffectObject
ME.Core.Models.Draft.create(kind, params?, transform?) → DraftObject
ME.Core.Models.String.create(content?, transform?) → DraftObject  // kind:string 互換

ME.SceneGraph.createProject(title?) → Project   // version "1.3", pages:[createPage()], currentPageIndex:0
ME.SceneGraph.createPage(sizeOpts?) → Page
ME.SceneGraph.getActivePage(project) → Page     // PageManager.getCurrentPage 経由
ME.SceneGraph.getProject() / setProject(project)  // set 時 ensurePagesShape
ME.SceneGraph.addPanel / addImageToPanel / addBalloon / addText / addEffect
ME.SceneGraph.addDraft(project, kind, params, transform) → DraftObject
ME.SceneGraph.addString(project, content, transform) → DraftObject  // addDraft('string')
ME.SceneGraph.findTopPanelAt(project, x, y)
ME.SceneGraph.findTopPanelForObject(project, obj) → Panel | null
ME.SceneGraph.removeObject / getObjectById / getAllObjects
  // getObjectById / removeObject は全 pages を検索（Undo が他ページ current でも効く）
ME.SceneGraph.updateTransform / setZIndex

ME.PageManager.getCurrentPage / getCurrentIndex / setCurrentIndex
ME.PageManager.pageCount / ensurePagesShape / syncPageAlias
ME.PageManager.addEmptyPage / insertPageAt / removePageAt / reorderPages / clonePageContent
  // addEmptyPage(project, { mode:'blank'|'backing'|'copy', fromIndex, atIndex })
  //   blank=白紙 / backing=台紙のみ複製 / copy=全オブジェクト複製（id・fusion・panelId リマップ）
  // 基準ページは fromIndex（省略時 current）。サムネ UI で選択
ME.PageManager.migrateProjectToMultiPage / MAX_PAGES(64)

ME.CommandStack.create() → { push, undo, redo, canUndo, canRedo }
  // push は実行しない。先にモデル変更してから push。リング 10 件
  // push 時オブジェクト系コマンドに pageId を刻印（構造系コマンドは除外）
ME.Commands.MoveObject / ResizePanel / AddPanel / AddObject / AddDraft / EditDraft
ME.Commands.DeleteObject / EditVertex / ColorAdjust / PasteObjects
ME.Commands.BatchEdit(ids, oldStates, newStates)
  // ★ 部分フィールドのみ（transform/params/size/panelId/fusionGroup 等）。
  //   フル JSON スナップショット禁止（融合が勝手に戻る）
ME.Commands.EditPageBacking / AddPage / RemovePage / ReorderPages
ME.Commands.ClearPageDrafts / ClearAllDrafts

ME.Selection.create() → {
  toggle, selectOnly, addRange, clear, isSelected, getSelectedIds,
  hitTest(x, y, project, opts?),          // opts.typeFilter: 'draft' 等
  hitTestRect(..., opts?),
  getBoundingBox(obj, project?),
  getFusionMemberIds(project, id) → string[],   // 最低 [id]
  expandFusionIds(project, ids) → string[]
}

ME.Clipboard.create() → { copy({objects}), paste(project, commandStack) }
```

### render/

```
ME.Render.Engine.create(canvas, project) → {
  setDirty(), renderNow(), render(),
  setSelectionOverlayCallback(fn), removeSelectionOverlayCallback(fn),
  getCanvas(), getContext()
}
ME.Render.Engine.BLEED / getPagePoint / setZoom / getZoom

ME.Render.Panel.draw* / drawFillUnion / drawBorderUnion / createClipPath*
ME.Render.Image.draw / setRedrawCallback / applyTone
ME.Render.Balloon.draw / drawGroup
ME.Render.Text.draw
ME.Render.Effect.draw
ME.Render.Draft.draw(ctx, draft, opts?) / drawGroup(ctx, drafts, opts?)
ME.Render.String.draw   // 旧 strings 互換（中身は string 描画）
```

### tools/

```
ME.Tools.X.create(canvas, project, selection, commandStack, renderEngine) → {
  disable(),   // リスナ解除 + overlay コールバック remove + setDirty 前提
  onPropertyChange?(objId, prop, value)
}
// 座標は必ず getPagePoint
// ツール切替: disable で overlay 除去。main の setActiveTool 後 setDirty
```

| ツール | 要点 |
|---|---|
| select | クリック/Shift 加算解除/ラバーバンド/複数移動/角リサイズ(固定辺)/回転。下書き line は端点 ○。`ME.currentStep==='draft'` 時 typeFilter draft。融合展開。BatchEdit は部分スナップ |
| panel | ドラッグ作成・グリッド吸着 |
| image | 選択操作・ファイル/DnD・フィット・差し替え |
| balloon | 作成/移動/しっぽ/リサイズ。panelId 既定 null |
| text | contentEditable。連続配置。IME Enter ガード。オーバーレイはマウス位置（中央オフセット無し） |
| effect | コマ内配置。defaultKind |
| draft | kind circle/rect/line/string。描画 or Shift で選択/融合ドラッグ。string は入力ダイアログ。AddDraft は **addDraft 戻り値のみ** push（二重 ID 禁止） |
| string-tool | 互換。本体は draft string |

### io/

```
ME.IO.Serializer.toJSON(project) / fromJSON(jsonString)
  // 本線 version "1.3"。1.2 は読込時 pages へ migrate。toJSON は page エイリアス除去
  // toJSON は appTag: "manga page editor @yamamori_yamori" を先頭キーで付与（fromJSON では必須にしない）
  // UI 保存拡張子: .manga.json（開くは .json 終端を受理）
ME.IO.Exporter.exportPNG(project)
  // 常に current page。1ページ: {title}.png / 複数: {title}-{n}.png（n は 1 始まり）
  // PageDraw.showDrafts:true。File System Access API（不可時はダウンロード）
ME.IO.Print.printProject(project)
  // 全 pages。showDrafts:false。新規ウィンドウ + window.print()
ME.Render.PageDraw.draw(ctx, project, page, opts)
  // opts: showDrafts, scale, pageW/H, imgMap, assetLibrary
```

### クリップボード（クロスブラウザ）

```
ME.Clipboard.create() → { copy(selectedData, project), paste(project, commandStack, onDone), applyPayload, parseText }
// Ctrl/Cmd+A: カレントページの全オブジェクトを選択（select モードへ）
// Ctrl/Cmd+C: 選択オブジェクトを text/plain (MECLIP:…JSON) で OS クリップボードへ
//   画像 asset の Base64 も同梱。sourcePageId を記録。別ブラウザの同等以上 version の index.html へ Ctrl/Cmd+V 可
// version 比較: 受け側 CLIPBOARD_VERSION >= ペイロード version のみ受理（現状 "1.2"）
// 貼り付け時: 新 ID / fusionGroup 再採番 / assetId 再マップ / Undo=PasteObjects
//   同一ページ: +20px オフセット（重なり回避）
//   別ページ（sourcePageId ≠ current）: 位置そのまま完全コピー。未同梱 panelId は null
// 貼り付け先は current page
```

### ui/ + main

```
ME.UI.Toolbar.create / setActiveStep / setTempSelectMode / setZoomValue
  setOnStepChangeCallback / setOnActionCallback / setOnZoomChangeCallback
  // ファイル: 新規/開く/保存/印刷/PNG / Undo/Redo
  getZoomSteps()

ME.UI.PageNav.create(container, { getState, onPrev, onNext, onOpenThumbnails })
  // 上部: ◀ n/N ▶ + サムネボタンのみ（追加/削除はサムネ一覧）
ME.UI.PageThumbnailPanel.open / close / refresh
  // 追加・削除・DnD 並べ替え・全ページ下書き削除
  // 追加時モード: blank / backing（台紙のみ）/ copy（前ページ複製）— getInsertMode / onInsertModeChange / onAdd(mode)
ME.UI.ConfirmDialog.show({ title, message, okLabel, cancelLabel, danger, onOK, onCancel })

ME.UI.StepPanel.create / render(stepId, {
  page, currentEffectKind, currentDraftKind,
  onPaperChange, onEffectKindChange, onDraftKindChange,
  onClearPageDrafts, ...
})

ME.UI.PropertyPanel.create / update / setOnPropertyChangeCallback
  // 主要 prop: transform.* / colorAdjust.* / stroke* / font.* / outline.*
  // clipToPanel / __fuse__ / __unfuse__ / __zorder__ / __delete__
  // draft: 先頭に clipToPanel。図形=線色・太さ。string=テキスト系

// main.js — 配線 + ME.switchToPageIndex / ME.getCurrentPage
// STEP_TOOL, currentDraftKind, fuseObjects/unfuseObjects,
// ページ切替: 選択クリア・ツール/ステップ維持・Undo スタック共有
// キー [ ] で前後ページ（入力フォーカス中は無効）
// setObjectPanelClip, handlePropertyChange, enterSelectMode/evaluateSelectMode(setTimeout0),
// Alt+ドラッグ パン / Alt+ホイール カーソル基準ズーム, File System Access
// ME.currentStep / ME.shiftHeld をツール共有
```

---

## 6. 処理フロー

### 6.1 Undo/Redo

1. **モデルを先に変更** → `commandStack.push(cmd)`（push は実行しない）。
2. ドラッグは mousemove でモデルのみ、**mouseup で1回** push。
3. 作成: Panel=`AddPanel`、Draft=`AddDraft`（**SceneGraph.add* の戻りオブジェクトのみ**。create+add 二重 ID 禁止）。
4. 融合/クロップ/z 順/複数移動/変形は `BatchEdit`（**部分スナップのみ**）。
5. 上限 10 件リング。

### 6.2 選択モード

```
Shift down → enterSelectMode（select へ）
操作中…
Shift up / 空選択 → evaluateSelectMode（setTimeout0 付き）
  選択あり → 維持
  選択空 && !Shift → 元ステップツール
ステップ手動クリック → 通常モード
```

下書きステップ: hitTest は `typeFilter:'draft'`。Shift ラバーバンドも draft のみ。融合は一体選択。

### 6.3 表示倍率

```
セレクト/Alt+ホイール → setZoom + resizeCanvasToPage + setDirty
render: setTransform(zoom) → translate(BLEED)
getPagePoint: client/zoom - BLEED
```

### 6.4 PNG 出力

```
offscreen(mm×dpi/25.4) → scale(dpi/96) → 編集と同順で描画（下書き含む）→ Blob
ズーム・BLEED は含めない
```

### 6.5 下書き作成（安全パス）

```
// OK
var obj = ME.SceneGraph.addDraft(project, kind, params, transform);
commandStack.push(new ME.Commands.AddDraft(obj));

// NG: create 後に add すると ID が二重生成され Undo が空振り
var tmp = ME.Core.Models.Draft.create(...);
ME.SceneGraph.addDraft(...); // 別 ID
push(new AddDraft(tmp));     // 消えない
```

---

## 7. ファイル構成

行数は現行おおよそ（合計 JS 約 10k 行）。

```
manga/
├ VERSION                            ★ APP= / JSON= 単一ソース
├ scripts/sync-version.js            VERSION → UI/README/MANUAL/git tag
├ index.html                         DOM+script順（先頭で app-version.js）
├ icon.svg                           ファビコン（グレージ地＋吹き出し）
├ css/style.css
├ README.md                          本仕様（Ver.4.4.1）
├ MANUAL.html                        図解マニュアル（Ver.4.4.1）
├ AGENTS.md                          Hermes 向け作業ルール
├ docs/
│  ├ requirements-multi-page.md      複数ページ要件
│  └ plan-multi-page-implementation.md
└ js/
   ├ core/
   │  ├ app-version.js               ME.APP_* / ME.JSON_VERSION（sync 生成）
   │  ├ data-models.js
   │  ├ scene-graph.js               createPage / getActivePage / 全ページ getObjectById
   │  ├ page-manager.js              ★ Ver.4.0
   │  ├ command-stack.js             pageId 刻印 / AddPage / ClearDrafts 等
   │  ├ selection-manager.js
   │  └ clipboard-manager.js         copy/paste（権限ダイアログ回避・イベント方式）
   ├ render/
   │  ├ render-engine.js             memos は最上層（編集のみ）
   │  ├ page-draw.js                 ★ 共有描画 PNG/サムネ/印刷（memos 非描画）
   │  ├ panel/image/balloon/text/effect/draft/memo/string-renderer.js
   ├ tools/ …                        memo-tool 含む
   ├ io/
   │  ├ serializer.js                version 1.3 / 1.2 migrate
   │  ├ exporter.js                  PageDraw + 複数時 -n
   │  └ print.js                     ★ 全ページ印刷
   ├ ui/
   │  ├ toolbar.js                   印刷ボタン / メモステップ
   │  ├ page-nav.js                  ★ 上部 n/N
   │  ├ page-thumbnail-panel.js      ★ 一覧 DnD
   │  ├ confirm-dialog.js
   │  ├ step-panel.js                下書き・メモ一括削除
   │  └ property-panel.js
   └ main.js                         switchToPageIndex / ページ配線
```

読み込み順（index.html）:

`data-models` → `effect-presets` → `scene-graph` → `page-manager` → `command-stack` → selection → clipboard →  
`render/*` → `page-draw` → tools → `serializer` → `exporter` → `print` →  
`toolbar` → `page-nav` → `confirm-dialog` → `page-thumbnail-panel` → step/property → `main`

---

## 8. localAI開発ルール

1. **1依頼1ファイル**を基本。入力は対象本体 + 5章 API 抜粋。
2. `<script type="module">` / `import/export` **禁止**。IIFE + `window.ME`。
3. `'use strict'`。**変数は `var`**。ES5 基本（テンプレ/アロー/let・const は使わない方針）。
4. ファイル先頭コメントに公開 API を記載・更新。
5. 依存方向 `core → render → tools → io/ui → main` を破らない。
6. 座標は **96dpi ページ座標**。ズーム/BLEED は render-engine に閉じる。
7. モデル変更後 `setDirty()`。Undo は 6.1。
8. UI テキスト日本語。prop はドット記法。
9. 確認: `node --check <file>` → ブラウザで index.html 手動確認。
10. **新規 object type 追加時チェックリスト**  
    data-models / scene-graph 全コレクション / command-stack / selection hitTest+bbox / renderer / tool / index.html / toolbar step / property-panel / exporter 描画順 / serializer 互換。
11. ツール `disable()`: イベント remove + overlay remove。state リネーム後は disable 内の未定義参照に注意（strict ReferenceError で setActiveTool が死ぬ）。
12. BatchEdit は**部分スナップのみ**。融合・panelId を巻き込まない。

---

## 9. 既知の制限・今後の課題

- [ ] TextObject の `parentBalloonId`（吹き出し内テキスト追従）未実装
- [ ] しっぽ extraVertices（多節）未実装
- [x] 画像の拡大率/回転スライダー + ハンドル操作 + 読込フィット
- [ ] 融合は **同 type 内**（コマ同士 / 吹き出し同士 / 下書き同士）。type 跨ぎ不可
- [x] 吹き出し・下書きのコマクロップは panelId（既定 OFF）。推定は最寄りまで緩和
- [x] 集中線/スピード線: 本数・長さ・向き・太さ(%)・回転・揺らぎ
- [x] 線・心理エフェクト: ホラー/ドロップ/揺れ/ヒビ（`effect_add`）
- [ ] エフェクトのページ全体配置は非対応（コマ限定が主）
- [x] **複数ページ** `Project.pages` + PageManager + ナビ/サムネ/印刷/PNG `-n`（Ver.4.0）
- [x] ページ追加モード: 白紙 / 前ページと同じ台紙 / 前ページのコピー（サムネ UI・Ver.4.1）
- [x] Ctrl/Cmd+A 全選択 + 別ページ Ctrl/Cmd+V は位置そのまま（同一ページは +20px・Ver.4.1）
- [ ] トンボ本実装（断ち切り破線・trimMarks 枠のみ）
- [ ] 高倍率×大判はキャンバス実ピクセル方式のため負荷注意
- [x] Undo 上限 50 件（`command-stack` `MAX_STACK`・Ver.4.4）
- [x] 下書きレイヤー（円/矩形/直線/文字列・融合・クロップ・画像下描画）
- [x] Undo pageId（他ページ current でもオブジェクト操作が正しい page を向く）
- [x] **メモレイヤー** `page.memos`（freehand/string・編集最上層・PNG/印刷なし・Ctrl+A 対象外・Ver.4.2）
- [x] クリップボード権限ダイアログ回避（document copy/paste + アプリ内 buffer）
- [x] **線ガサつき**（セリフ袋 / 吹き出し縁 / コマ枠は太さのみ・Ver.4.3）

---

## 10. Ver.3.0 / Ver.4.0 / Ver.4.1 / Ver.4.1.1 / Ver.4.2 / Ver.4.3 / Ver.4.4 変更サマリ

### 10.1 アプリ仕様バージョン

| 項目 | 値 |
|---|---|
| 仕様書（現行） | **Ver.4.4.1** |
| プロジェクト JSON | **1.3**（1.2 読込可） |
| 正本 | ルート `VERSION`（`APP` / `JSON`）→ `scripts/sync-version.js` |
| git tag | **`v{APP}`**（例: `v4.2`）。`sync-version.js --tag` |
| 実装世代メモ | … + Ver.4.2 校閲メモ + Ver.4.3 線ガサつき + **Ver.4.4 バグフィックス** |

### 10.2 Ver.4.4 の修正内容（機能追加なし）

Undo/Redo の信頼性（一括削除 `DeleteObjects` / 履歴上限 50 / `recalcZIndices` 重ね順保存 / deep copy 徹底 / `RemovePage.redo` index 修正 / Ctrl+Shift+Z・CapsLock 対応）、描画の決定論と安定性（吹き出し短集中線のシード乱数化 / トーン density クランプ / トーン scale 実効化 / 削除コマのクリップキャッシュ掃除 / hue 単独調整 / 出力側 colorAdjust の NaN 防止 / クリップ判定の編集・出力統一）、ツール操作（`**` の ES5 化 / 回転ハンドル相対回転化 / 微小ドラッグ復元 / ウィンドウ外 mouseup 対策）、IO/UI（印刷ポップアップ対策・サイズ混在対応 / 保存ダイアログ拡張子修正 / カスタム用紙サイズの単位・dpi 既定適正化）。加えて低優先の使い勝手・性能改善 15 件（アセット重複排除 / ページサイズ Undo / ハンドルズーム補正 / キャッシュ LRU・上限 / ほか）も収録。データ構造・JSON フォーマットの変更なし。

### 10.3 Ver.4.3 で確定した仕様

1. **セリフ袋** — `outline.roughness` 0–10（袋縁の粗い歪み。太さ 1–10）  
2. **吹き出し** — `strokeRoughness` 0–10（線レイヤー縁歪み。最大強度は控えめ）  
3. **コマ枠** — `borderRoughness` 0–10。**頂点・中心線は不変**、辺上で **線幅だけ** 揺らす  
4. **コマ線幅 UI** — 吹き出しと同様の −/＋ステッパー（0–50）  
5. **JSON** — 任意フィールド追加のみ。**version は 1.3 のまま**  

### 10.4 Ver.4.2 で確定した仕様（継承）

1. **メモ object type `memo`** — `page.memos[]`。kind: `freehand` | `string`  
2. **見た目** — 同一スタイル（赤 `#cc2222` + 白縁）。融合・リサイズなし  
3. **描画** — 編集画面のみ最上層。`PageDraw` / PNG / 印刷 / サムネは **非描画**  
4. **選択** — Ctrl/Cmd+A は本線+下書きのみ（memos 除外）。メモステップは typeFilter `memo`  
5. **一括削除** — このページ / 全ページ + Confirm + Undo（下書きと同様）  
6. **UI** — 左ナビ「メモ」ステップ（赤系）、MANUAL / README は仕様 Ver.4.2  

### 10.5 Ver.4.1.1 で確定した仕様（継承）

1. **ヘルプ** — topbar `？` → 同フォルダ `MANUAL.html` を別タブ  
2. **しっぽ type** — `normal` | `normalThick` | `thought` | `thoughtFew` | `jagged` | `jaggedThick` | `lightning` | `spiral`。`*Thick` は根元半幅×2。UI セレクト先頭 **なし**（`none`→tail null）。チェックボックス廃止  
3. **線幅 UI** — −/＋ステッパー、**二重線**と同一行  
4. **グリッド吸着** — `ME.Tools.Panel.gridEnabled` デフォルト **true**  
5. **プロパティ見出し** — 冗長セクション名削減（コマ/回転/袋文字/吹き出し設定/テキスト設定など）  
6. **UI アイコン** — セリフ `A`、下書き形状 ○□／A  

### 10.6 Ver.4.1 で確定した仕様（継承）

1. **ページ追加モード** — `addEmptyPage({ mode: 'blank'|'backing'|'copy', fromIndex })`。サムネで選択、セッション保持  
2. **backing** — オブジェクトなし。`backgroundColor` / `backingImage` / `trimMarks` のみ基準ページから  
3. **copy** — 全オブジェクト deep clone。page id・各 object id・fusionGroup・panelId リマップ。assetId は共有  
4. **Ctrl/Cmd+A** — カレントページ全選択（select モードへ）。**Ver.4.2 以降 memos は除外**  
5. **クリップボード** — `sourcePageId` 記録。別ページ貼り付けは位置オフセット 0。同一ページは +20px。未同梱 panelId は別ページ時 null  

### 10.7 Ver.4.0 で確定した仕様（継承）

1. **`pages[]` + `currentPageIndex`** — 単一 `page` キーは保存しない  
2. **PageManager** — 追加/削除/並べ替え/MAX 64。最後の1枚は削除不可  
3. **UI** — 上部 ◀ n/N ▶・サムネ一覧（追加/削除/DnD）。topbar に追加削除ボタンなし  
4. **PNG** — current のみ。複数時 `{title}-{n}.png`  
5. **印刷** — 全ページ・下書きなし・`window.print()`  
6. **下書き一括削除** — このページ / 全ページ + Confirm + Undo  
7. **PageDraw** — export / thumb / print 共有  
8. **Command pageId** — push 時刻印。getObjectById は全ページ検索  
9. **切替** — 選択クリア、ツール/ステップ維持、Undo スタック共有。キー `[` `]`  

### 10.8 Ver.3.0 で確定した仕様（継承）

1. **下書き object type `draft`** — `page.drafts[]`  
2. **kind**: `circle` | `rect` | `line` | `string`（UI「文字列」）  
3. **描画順**: 台紙 → コマ塗り → drafts → 画像…  
4. **図形線**: `strokeColor` / `strokeWidth`  
5. **融合 / コマクロップ既定 OFF / typeFilter draft**  
6. **BatchEdit 部分スナップ / evaluateSelectMode setTimeout / IME ガード**  

### 10.9 開発時の必読ピットフォール（短縮）

- overlay コールバックは disable で remove + setDirty  
- draft kind は main 側で永続化  
- 編集の正は `pages[]`。`project.page` は runtime エイリアスのみ  
- オブジェクト Undo は pageId 依存。構造 Undo（AddPage）と混同しない  
- 見える判定は `visible === false`（`!visible` は使わない）  
- memos は export/PageDraw に載せない。Ctrl+A に混ぜない  
- クリップボードは `navigator.clipboard.readText/writeText` を使わない（権限ダイアログ）  

---

*本ドキュメントは実装（`js/`）を正とする。現行アプリ仕様は **Ver.4.4.1**。差異があればコードを優先し、本 README を更新すること。*
