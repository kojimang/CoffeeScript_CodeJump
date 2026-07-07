# CoffeeScript CodeJump

CoffeeScript ファイルのコードジャンプ（定義ジャンプ）とアウトラインを提供する VSCode 拡張機能です。

VSCode 標準では CoffeeScript の Go-to-Definition が効きません（[microsoft/vscode#106272](https://github.com/microsoft/vscode/issues/106272)）。本拡張は `.coffee` で **F12 / Cmd+Click による定義ジャンプ** と **アウトライン表示** を可能にします。

## 機能

- **定義ジャンプ（Go to Definition / Peek）** — F12・Cmd+Click（Windows/Linux は Ctrl+Click）
  - クラス / 関数 / メソッド / 変数 / パラメータ の定義へジャンプ
  - `require` / `import` の束縛名から**別ファイルの定義へジャンプ**
  - 関数スコープを解析し、ローカル変数・引数はその場の定義を優先
  - `obj.method` / `@method` などのメンバ参照はメソッド/プロパティ定義を検索
  - 候補が複数あるときは VSCode の Peek 一覧で提示
- **ホバーで定義プレビュー** — 識別子にマウスを乗せると定義のスニペットと位置を表示
- **参照検索（Find All References）** — Shift+Alt+F12（mac: Shift+Option+F12）
  - ワークスペース全体から同名識別子の出現を列挙（文字列・コメント内は除外）
- **出現ハイライト** — カーソル下の識別子と同名の出現を同一ファイル内で強調（定義は Write 扱い）
- **アウトライン / パンくず / シンボル検索（Ctrl+Shift+O）**
  - クラス配下にメソッド・プロパティをネスト表示
- **ワークスペースシンボル検索** — Ctrl+T / Cmd+T でワークスペース全体のクラス・関数などへジャンプ

CoffeeScript 1.x / 2.x の双方に対応し、編集中の構文エラーにも強い設計です（[coffee-lex](https://github.com/decaffeinate/coffee-lex) によるトークン化。lex 失敗時は正規表現へフォールバック）。

## 使い方

対応拡張子（`.coffee` / `.litcoffee` / `.coffee.md` / `.cake`）のファイルを開くと自動で有効になります。

- 定義へ飛ぶ: 識別子にカーソルを置いて **F12**、または **Cmd/Ctrl+Click**
- その場でプレビュー: **Alt+F12**（Peek Definition）、またはマウスホバー
- 参照を探す: **Shift+Alt+F12**（Find All References）
- ファイル内シンボル検索: **Ctrl+Shift+O**
- ワークスペース全体のシンボル検索: **Ctrl+T / Cmd+T**

## 設定

| 設定キー | 既定値 | 説明 |
| --- | --- | --- |
| `coffeescriptCodeJump.enableWorkspaceIndex` | `true` | ワークスペース全体の `.coffee` を索引し、定義ジャンプのフォールバック候補に使う |
| `coffeescriptCodeJump.moduleFileExtensions` | `[".coffee", ".litcoffee", ".coffee.md", ".js"]` | `require`/`import` 解決時に試す拡張子（先頭優先） |
| `coffeescriptCodeJump.exclude` | `["**/node_modules/**", "**/bower_components/**"]` | ワークスペース索引から除外する glob |

## 開発 / ビルド

```bash
npm install          # 依存インストール
npm run watch        # 開発ビルド（監視）。この状態で F5 → Extension Development Host が起動
npm test             # スキャナ + 解決ロジックのテスト（VSCode 不要）
npm run check-types  # 型チェック
npm run build        # 本番バンドル（dist/extension.js）
```

デバッグ実行は VSCode で本リポジトリを開き **F5**（`Run Extension`）。`test/fixtures` を開いたサンプルウィンドウが起動します。

## パッケージ化 / インストール（ローカル配布）

```bash
npm run package                 # coffeescript-codejump-x.y.z.vsix を生成
code --install-extension coffeescript-codejump-*.vsix
```

または VSCode の拡張ビュー右上「…」→「VSIX からインストール」で生成した `.vsix` を選択します。

## 仕組み（概要）

1. `src/scanner.ts` … coffee-lex でトークン化し、定義パターン（class / 関数代入 / メソッド / 変数 / require|import / for 変数 / 分割代入 / `@`プロパティ / 引数）を抽出。インデントで関数スコープを解析して各定義に `scopeId` を付与。参照検索用に識別子の出現列挙も担う。
2. `src/symbolIndex.ts` … ScanResult をキャッシュし、ワークスペース索引と `.coffee` の監視を担当。
3. `src/resolver.ts` … カーソル語を「メンバ参照 → スコープ内→外 → import のファイル間 → ワークスペース索引」の順に解決する共通ロジック。
4. `src/definitionProvider.ts` / `src/hoverProvider.ts` … resolver の結果をジャンプ先／ホバープレビューとして提示。
5. `src/referenceProvider.ts` / `src/documentHighlightProvider.ts` … 識別子の出現列挙を参照検索とハイライトに使用。
6. `src/documentSymbolProvider.ts` / `src/workspaceSymbolProvider.ts` … 抽出結果をアウトライン（範囲の包含関係でネスト）と Ctrl+T 検索に提供。

## 制限事項

- 動的言語のため定義解決はヒューリスティックです（同名衝突時は複数候補を提示）。
- 参照検索・出現ハイライトは**名前ベース**です。別スコープの同名識別子も同じ参照として列挙されます。
- `node_modules` などの bare モジュール指定（`require 'lodash'` 等）のファイル間ジャンプは対象外です。
- リテラル CoffeeScript（`.litcoffee` / `.coffee.md`）はベストエフォート対応です。
- リネーム（F2）は誤リネームのリスクを避けるため提供していません（参照検索で出現を確認しながらの手動変更を推奨）。

## ライセンス

MIT
