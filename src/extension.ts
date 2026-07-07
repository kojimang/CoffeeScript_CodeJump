import * as vscode from "vscode";
import { SymbolIndex } from "./symbolIndex";
import { SymbolResolver } from "./resolver";
import { CoffeeDefinitionProvider } from "./definitionProvider";
import { CoffeeDocumentSymbolProvider } from "./documentSymbolProvider";
import { CoffeeHoverProvider } from "./hoverProvider";
import { CoffeeReferenceProvider } from "./referenceProvider";
import { CoffeeDocumentHighlightProvider } from "./documentHighlightProvider";
import { CoffeeWorkspaceSymbolProvider } from "./workspaceSymbolProvider";

const SELECTOR: vscode.DocumentSelector = { language: "coffeescript" };

export function activate(context: vscode.ExtensionContext): void {
  const index = new SymbolIndex();
  const resolver = new SymbolResolver(index);
  context.subscriptions.push(index);

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      SELECTOR,
      new CoffeeDefinitionProvider(resolver)
    ),
    vscode.languages.registerDocumentSymbolProvider(
      SELECTOR,
      new CoffeeDocumentSymbolProvider(index)
    ),
    vscode.languages.registerHoverProvider(
      SELECTOR,
      new CoffeeHoverProvider(resolver, index)
    ),
    vscode.languages.registerReferenceProvider(
      SELECTOR,
      new CoffeeReferenceProvider(index)
    ),
    vscode.languages.registerDocumentHighlightProvider(
      SELECTOR,
      new CoffeeDocumentHighlightProvider(index)
    ),
    vscode.languages.registerWorkspaceSymbolProvider(
      new CoffeeWorkspaceSymbolProvider(index)
    )
  );

  // 開いているドキュメントを閉じたらキャッシュを解放
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => index.invalidate(doc.uri))
  );

  // ワークスペース索引はバックグラウンドで構築
  // （定義ジャンプのフォールバック・参照検索・Ctrl+T とファイル監視を担う）
  void index.buildWorkspaceIndex();
}

export function deactivate(): void {
  // subscriptions で破棄されるため特別な処理は不要
}
