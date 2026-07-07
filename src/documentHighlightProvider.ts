import * as vscode from "vscode";
import { SymbolIndex } from "./symbolIndex";
import { findOccurrences } from "./scanner";
import { startKey, toRange, wordAt } from "./providerUtil";

/**
 * カーソル下の識別子と同名の出現を同一ファイル内でハイライトする。
 * 定義位置は Write、それ以外は Read として区別する。
 */
export class CoffeeDocumentHighlightProvider
  implements vscode.DocumentHighlightProvider
{
  constructor(private readonly index: SymbolIndex) {}

  provideDocumentHighlights(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.DocumentHighlight[] {
    const w = wordAt(document, position);
    if (!w) {
      return [];
    }
    const scanRes = this.index.getForDocument(document);
    const defKeys = new Set(
      scanRes.symbols
        .filter((s) => s.name === w.word)
        .map((s) => startKey(s.selectionRange))
    );
    return findOccurrences(document.getText(), w.word).map(
      (r) =>
        new vscode.DocumentHighlight(
          toRange(r),
          defKeys.has(startKey(r))
            ? vscode.DocumentHighlightKind.Write
            : vscode.DocumentHighlightKind.Read
        )
    );
  }
}
