import * as vscode from "vscode";
import { DefKind, Rng, SymbolDef } from "./types";

/** プレーンな Rng を vscode.Range へ */
export function toRange(r: Rng): vscode.Range {
  return new vscode.Range(
    r.start.line,
    r.start.character,
    r.end.line,
    r.end.character
  );
}

/** DefKind を VSCode の SymbolKind へ */
export function toSymbolKind(kind: DefKind): vscode.SymbolKind {
  switch (kind) {
    case "class":
      return vscode.SymbolKind.Class;
    case "function":
      return vscode.SymbolKind.Function;
    case "method":
      return vscode.SymbolKind.Method;
    case "property":
      return vscode.SymbolKind.Property;
    case "import":
      return vscode.SymbolKind.Module;
    case "variable":
    case "param":
    default:
      return vscode.SymbolKind.Variable;
  }
}

/** Rng の開始位置キー（定義位置と出現位置の同一判定用） */
export function startKey(r: Rng): string {
  return `${r.start.line}:${r.start.character}`;
}

/**
 * アウトライン / ワークスペースシンボル検索に出す価値のあるシンボルか。
 * param と関数内ローカル変数はノイズになるため除外する。
 */
export function isMajorSymbol(def: SymbolDef): boolean {
  if (def.kind === "param") {
    return false;
  }
  if (def.kind === "variable" && def.scopeId !== 0) {
    return false;
  }
  return true;
}

/** カーソル位置の CoffeeScript 識別子（先頭 `@` は含めない） */
export function wordAt(
  document: vscode.TextDocument,
  position: vscode.Position
): { word: string; range: vscode.Range } | undefined {
  const range = document.getWordRangeAtPosition(
    position,
    /[$A-Za-z_][$A-Za-z0-9_]*/
  );
  if (!range) {
    return undefined;
  }
  return { word: document.getText(range), range };
}
