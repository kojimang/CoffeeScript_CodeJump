import * as vscode from "vscode";
import { SymbolResolver } from "./resolver";
import { toRange } from "./providerUtil";

/**
 * CoffeeScript の Go-to-Definition（F12 / Cmd+Click）。
 * 解決ロジックは SymbolResolver（HoverProvider と共用）に委譲する。
 */
export class CoffeeDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly resolver: SymbolResolver) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location[]> {
    const resolved = await this.resolver.resolve(document, position);
    if (!resolved) {
      return [];
    }
    return resolved.targets.map(
      (t) =>
        new vscode.Location(
          t.uri,
          t.def ? toRange(t.def.selectionRange) : new vscode.Range(0, 0, 0, 0)
        )
    );
  }
}
