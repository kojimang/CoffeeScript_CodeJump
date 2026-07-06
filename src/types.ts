// vscode に依存しない共有型。scanner.ts はこれらのみを使い、
// プロバイダ層で vscode.Range / vscode.Location へ変換する。

export interface Pos {
  /** 0-based の行 */
  line: number;
  /** 0-based の列（UTF-16 コードユニット単位） */
  character: number;
}

export interface Rng {
  start: Pos;
  end: Pos;
}

export type DefKind =
  | "class"
  | "function"
  | "method"
  | "variable"
  | "property"
  | "import"
  | "param";

export interface SymbolDef {
  name: string;
  kind: DefKind;
  /** 識別子そのものの範囲（ジャンプ先でカーソルを置く位置） */
  selectionRange: Rng;
  /** シンボル全体の範囲。class/function は本体を含む。それ以外は selectionRange と同じ。 */
  range: Rng;
  /** 囲みのクラス名など（アウトラインのネスト・メソッド解決用） */
  containerName?: string;
  /** この定義が属する変数スコープ ID */
  scopeId: number;
  /** kind === "import" のときのモジュール指定子（例: "./foo"） */
  moduleSpecifier?: string;
}

export interface ScanResult {
  symbols: SymbolDef[];
  /** scopeParent[id] = 親スコープ ID（ルートは -1） */
  scopeParent: number[];
  /** 0-based 行ごとの所属スコープ ID */
  lineScope: number[];
  /** lex に失敗して正規表現フォールバックを使った場合 true */
  degraded: boolean;
}
