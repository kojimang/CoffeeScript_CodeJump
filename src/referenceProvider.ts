import * as vscode from "vscode";
import { SymbolIndex } from "./symbolIndex";
import { findOccurrences } from "./scanner";
import { ScanResult } from "./types";
import { startKey, toRange, wordAt } from "./providerUtil";

/**
 * Find All References（Shift+Alt+F12）。
 * 名前ベースのヒューリスティック: 現在のドキュメント + ワークスペース索引済みの
 * .coffee ファイルから、同名の識別子トークンの出現をすべて列挙する
 * （文字列・コメント内は coffee-lex により除外される）。
 */
export class CoffeeReferenceProvider implements vscode.ReferenceProvider {
  constructor(private readonly index: SymbolIndex) {}

  async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext
  ): Promise<vscode.Location[]> {
    const w = wordAt(document, position);
    if (!w) {
      return [];
    }
    const name = w.word;
    const out: vscode.Location[] = [];

    const collect = async (
      uri: vscode.Uri,
      text: string,
      getScan: () => ScanResult | Promise<ScanResult | undefined>
    ) => {
      const occurrences = findOccurrences(text, name);
      if (occurrences.length === 0) {
        return;
      }
      // includeDeclaration が false のときは定義位置そのものを除外する
      let defKeys: Set<string> | undefined;
      if (!context.includeDeclaration) {
        const res = await getScan();
        defKeys = new Set(
          (res?.symbols ?? [])
            .filter((s) => s.name === name)
            .map((s) => startKey(s.selectionRange))
        );
      }
      for (const r of occurrences) {
        if (defKeys?.has(startKey(r))) {
          continue;
        }
        out.push(new vscode.Location(uri, toRange(r)));
      }
    };

    // 現在のドキュメント（未保存の編集内容を反映）
    await collect(document.uri, document.getText(), () =>
      this.index.getForDocument(document)
    );

    // ワークスペース索引済みのその他のファイル
    const currentKey = document.uri.toString();
    for (const uri of this.index.getIndexedUris()) {
      if (uri.toString() === currentKey) {
        continue;
      }
      const text = await this.index.getTextForUri(uri);
      if (text === undefined) {
        continue;
      }
      await collect(uri, text, () => this.index.getForUri(uri));
    }
    return out;
  }
}
