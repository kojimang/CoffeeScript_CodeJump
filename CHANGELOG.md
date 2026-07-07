# Change Log

## 0.1.0

### 追加
- ホバーで定義プレビューを表示（HoverProvider）
- 参照検索 Find All References — Shift+Alt+F12（ReferenceProvider）
- ワークスペース全体のシンボル検索 Ctrl+T / Cmd+T（WorkspaceSymbolProvider）
- カーソル下の識別子の出現ハイライト（DocumentHighlightProvider）

### 内部改善
- 定義解決ロジックを `resolver.ts` に集約（Definition / Hover で共用）
- スキャナに識別子出現の列挙 API（`findOccurrences`）を追加
- アウトライン用フィルタを共通化し Ctrl+T 検索と共用

## 0.0.1

- 初版
- 定義ジャンプ（F12 / Cmd+Click）: 同一ファイル内のスコープ解決、`require`/`import` のファイル間ジャンプ、メンバ参照の解決
- アウトライン / パンくず / Ctrl+Shift+O（DocumentSymbolProvider）
