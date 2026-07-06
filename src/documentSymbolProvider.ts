import * as vscode from "vscode";
import { SymbolIndex } from "./symbolIndex";
import { SymbolDef, Rng } from "./types";
import { toRange, toSymbolKind } from "./providerUtil";

/**
 * アウトライン / パンくず / Ctrl+Shift+O 用のシンボルツリーを提供する。
 * 定義を範囲の包含関係でネストする（メソッドはクラス配下、ネスト関数は親関数配下）。
 */
export class CoffeeDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  constructor(private readonly index: SymbolIndex) {}

  provideDocumentSymbols(
    document: vscode.TextDocument
  ): vscode.DocumentSymbol[] {
    const { symbols } = this.index.getForDocument(document);
    return buildTree(symbols);
  }
}

/** アウトラインに出すシンボルか（param と関数内ローカル変数は除外してノイズを抑える） */
function isOutlineSymbol(def: SymbolDef): boolean {
  if (def.kind === "param") {
    return false;
  }
  if (def.kind === "variable" && def.scopeId !== 0) {
    return false;
  }
  return true;
}

/** inner が outer の範囲に完全に含まれるか（行・列で比較） */
function contains(outer: Rng, inner: Rng): boolean {
  const startsAfter =
    outer.start.line < inner.start.line ||
    (outer.start.line === inner.start.line &&
      outer.start.character <= inner.start.character);
  const endsBefore =
    inner.end.line < outer.end.line ||
    (inner.end.line === outer.end.line &&
      inner.end.character <= outer.end.character);
  return startsAfter && endsBefore;
}

function buildTree(symbols: SymbolDef[]): vscode.DocumentSymbol[] {
  const defs = symbols.filter(isOutlineSymbol);

  // range の開始が早い順・広い範囲が先。区間スタックで親子を決める。
  defs.sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) {
      return a.range.start.line - b.range.start.line;
    }
    if (a.range.start.character !== b.range.start.character) {
      return a.range.start.character - b.range.start.character;
    }
    // 同一開始位置なら広い方（終端が後）を先に
    return b.range.end.line - a.range.end.line;
  });

  const roots: vscode.DocumentSymbol[] = [];
  const stack: Array<{ def: SymbolDef; node: vscode.DocumentSymbol }> = [];

  for (const def of defs) {
    const node = makeSymbol(def);
    while (stack.length && !contains(stack[stack.length - 1].def.range, def.range)) {
      stack.pop();
    }
    if (stack.length) {
      stack[stack.length - 1].node.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push({ def, node });
  }

  return roots;
}

function makeSymbol(def: SymbolDef): vscode.DocumentSymbol {
  const detail =
    def.kind === "import" && def.moduleSpecifier ? def.moduleSpecifier : "";
  const range = toRange(def.range);
  let selectionRange = toRange(def.selectionRange);
  // vscode は selectionRange ⊆ range を要求する。念のため補正。
  if (!range.contains(selectionRange)) {
    selectionRange = range;
  }
  return new vscode.DocumentSymbol(
    def.name,
    detail,
    toSymbolKind(def.kind),
    range,
    selectionRange
  );
}
