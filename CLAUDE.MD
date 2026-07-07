# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

CoffeeScript のコードジャンプ（Go to Definition / ホバー / 参照検索 / 出現ハイライト / アウトライン / Ctrl+T）を提供する VSCode 拡張機能。VSCode 標準では CoffeeScript の定義ジャンプが効かない（microsoft/vscode#106272）ことへの対策。配布はローカル `.vsix`（Marketplace 非公開前提、publisher はプレースホルダ）。

## コマンド

- `npm test` — 全テスト。`tsc -p tsconfig.test.json` で `out-test/` へコンパイル後、mocha 実行。**VSCode 不要**
- 単一テスト: `npm run compile-tests && npx mocha --grep "<テスト名の一部>"`
- `npm run check-types` — src の型チェック（`tsc --noEmit`）。esbuild は型検査しないため、ビルドが通っても型エラーはあり得る
- `npm run build` / `npm run watch` — esbuild バンドル（→ `dist/extension.js`）。watch 中に VSCode で F5（Run Extension）すると `test/fixtures` を開いた Extension Development Host が起動
- `npm run package` — vsce で `.vsix` 生成（prepublish で build が走る）

## アーキテクチャ

データフロー: **scanner（純粋関数）→ symbolIndex（キャッシュ・索引）→ resolver（解決）→ 各 Provider（vscode API への薄いアダプタ）**

- `src/scanner.ts` — **vscode 非依存の純粋モジュール（この性質を維持すること）**。coffee-lex でトークン化し、定義パターン（class / 関数代入 / メソッド / 変数 / require・import / 分割代入 / `@`プロパティ / 引数）を抽出。`scan()` が SymbolDef[] を返し、`findOccurrences()` が参照検索・ハイライト用の同名識別子出現を返す。lex 失敗時（編集中の構文エラー等）は正規表現フォールバック（`degraded: true`）
- スコープモデル: **関数境界のみ**が変数スコープを作る（インデント近似）。`scopeId` 0 = トップレベル、`scopeParent` で親を辿る。class はスコープを作らず、`containerName` としてメソッド/プロパティに付く
- `src/symbolIndex.ts` — ScanResult のキャッシュ（開いているドキュメントは version、ディスク上ファイルは mtime をキー）+ ワークスペース全体の名前→定義索引 + FileSystemWatcher
- `src/resolver.ts` — 解決順序の中核。①メンバ参照（`.name` / `@name`）→ method/property ②スコープ内→外の同名定義（import 束縛なら moduleResolver でクロスファイル解決）③ワークスペース索引フォールバック。DefinitionProvider と HoverProvider が共用
- Provider 群は resolver か index を使う薄い層。共有ヘルパは `src/providerUtil.ts`（toRange / toSymbolKind / wordAt / startKey / isMajorSymbol）

## テストの仕組み（重要）

- テストは VSCode を起動しない。`.mocharc.json` の require で `test/support/setup.js` が読み込まれ、`Module._load` をフックして `require('vscode')` を `test/support/vscodeMock.ts` に差し替える
- **src で新しい vscode API を使ったら vscodeMock にも追加**しないとテストが実行時に落ちる
- モックの `workspace.findFiles` は `test/fixtures/*.coffee` を返す → `buildWorkspaceIndex()` で fixtures 全体が索引される。**fixture の追加・変更は件数アサーションを壊し得る**（例: 'speak' 2件、Helper の参照数）。fixtures は F5 デバッグ時のサンプルワークスペースも兼ねる
- tsconfig は 2 系統: `tsconfig.json`（src のみ、Node16 → dist）と `tsconfig.test.json`（src+test、CommonJS → out-test）

## 制約・注意点

- coffee-lex は LF 前提。`scan()` / `findOccurrences()` の冒頭で CRLF→LF 正規化済み。返される位置は正規化後の値
- `@types/vscode` は `engines.vscode`（^1.85.0）に合わせて **1.85.0 に固定**。上げると `vsce package` がエラーになる。engines を上げるときだけ揃えて更新
- esbuild は coffee-lex を同梱し、vscode のみ external（`esbuild.js`）
- 定義解決・参照検索は名前ベースのヒューリスティック。リネーム（F2）は誤リネームのリスクがあるため意図的に非提供
- moduleResolver は相対パス（`./` `../`）のみ対応。bare import（node_modules）の解決は対象外
