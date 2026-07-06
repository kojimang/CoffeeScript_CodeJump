import * as vscode from "vscode";
import { SymbolIndex } from "./symbolIndex";
import { CoffeeDefinitionProvider } from "./definitionProvider";
import { CoffeeDocumentSymbolProvider } from "./documentSymbolProvider";

const SELECTOR: vscode.DocumentSelector = { language: "coffeescript" };

export function activate(context: vscode.ExtensionContext): void {
  const index = new SymbolIndex();
  context.subscriptions.push(index);

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      SELECTOR,
      new CoffeeDefinitionProvider(index)
    ),
    vscode.languages.registerDocumentSymbolProvider(
      SELECTOR,
      new CoffeeDocumentSymbolProvider(index)
    )
  );

  // 開いているドキュメントを閉じたらキャッシュを解放
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => index.invalidate(doc.uri))
  );

  // ワークスペース索引はバックグラウンドで構築（フォールバック候補＆ファイル監視）
  void index.buildWorkspaceIndex();
}

export function deactivate(): void {
  // subscriptions で破棄されるため特別な処理は不要
}
