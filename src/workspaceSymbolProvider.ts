import * as vscode from "vscode";
import { SymbolIndex } from "./symbolIndex";
import { isMajorSymbol, toRange, toSymbolKind } from "./providerUtil";

/** 一度に返す最大件数（巨大ワークスペースでの暴走防止） */
const MAX_RESULTS = 2000;

/**
 * ワークスペース全体のシンボル検索（Ctrl+T / Cmd+T）。
 * ワークスペース索引に対しサブシーケンス一致で絞り込む。
 */
export class CoffeeWorkspaceSymbolProvider
  implements vscode.WorkspaceSymbolProvider
{
  constructor(private readonly index: SymbolIndex) {}

  provideWorkspaceSymbols(query: string): vscode.SymbolInformation[] {
    return this.index
      .searchByName(query)
      .filter((e) => isMajorSymbol(e.def))
      .slice(0, MAX_RESULTS)
      .map(
        (e) =>
          new vscode.SymbolInformation(
            e.def.name,
            toSymbolKind(e.def.kind),
            e.def.containerName ?? "",
            new vscode.Location(e.uri, toRange(e.def.selectionRange))
          )
      );
  }
}
