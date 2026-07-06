import * as vscode from "vscode";
import { SymbolIndex } from "./symbolIndex";
import { resolveModule } from "./moduleResolver";
import { DefKind, ScanResult, SymbolDef } from "./types";
import { toRange, wordAt } from "./providerUtil";

/** クロスファイルでエクスポートされうる（トップレベル）定義の種類 */
const EXPORTABLE: DefKind[] = ["class", "function", "variable", "import"];

/**
 * CoffeeScript の Go-to-Definition。
 * 解決順:
 *   1. カーソル語がメンバ参照（`.name` / `@name`）→ メソッド/プロパティ定義を探す
 *   2. 語を囲むスコープ内→外の順に定義を探す（import 束縛ならクロスファイル解決）
 *   3. どこにも無ければワークスペース索引の同名定義（複数なら peek）
 */
export class CoffeeDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly index: SymbolIndex) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location[]> {
    const w = wordAt(document, position);
    if (!w) {
      return [];
    }
    const name = w.word;
    const scanRes = this.index.getForDocument(document);
    const access = memberAccess(document, w.range.start);

    // 1. メンバ参照（obj.name / @name）→ メソッド/プロパティ
    if (access !== "none") {
      const members = scanRes.symbols.filter(
        (s) => s.name === name && (s.kind === "method" || s.kind === "property")
      );
      if (members.length) {
        return members.map((s) => this.loc(document.uri, s));
      }
      // ファイル内に無ければワークスペースの同名メンバへ
      return this.workspaceFallback(name, ["method", "property"]);
    }

    // 2. スコープ内→外の順で解決
    const scoped = this.resolveInScopes(scanRes, name, position.line);
    if (scoped) {
      // import 束縛ならクロスファイルへ
      const imp = scoped.find((s) => s.kind === "import" && s.moduleSpecifier);
      if (imp) {
        const crossed = await this.resolveImport(document.uri, imp.moduleSpecifier!, name);
        if (crossed.length) {
          return crossed;
        }
      }
      return scoped.map((s) => this.loc(document.uri, s));
    }

    // 3. ワークスペース索引フォールバック
    return this.workspaceFallback(name, EXPORTABLE);
  }

  /** 語を囲む最も内側のスコープから順に、同名定義を探す */
  private resolveInScopes(
    scanRes: ScanResult,
    name: string,
    line: number
  ): SymbolDef[] | undefined {
    const chain = ancestorScopes(scanRes, line);
    for (const scopeId of chain) {
      const hits = scanRes.symbols.filter(
        (s) => s.name === name && s.scopeId === scopeId && s.kind !== "property"
      );
      if (hits.length) {
        return hits;
      }
    }
    return undefined;
  }

  /** import 束縛をモジュール解決し、対象ファイル内の同名定義（無ければ先頭）へ */
  private async resolveImport(
    fromUri: vscode.Uri,
    spec: string,
    name: string
  ): Promise<vscode.Location[]> {
    const target = await resolveModule(fromUri, spec);
    if (!target) {
      return [];
    }
    const scanRes = await this.index.getForUri(target);
    if (scanRes) {
      const matches = scanRes.symbols.filter(
        (s) => s.name === name && s.scopeId === 0 && EXPORTABLE.includes(s.kind)
      );
      if (matches.length) {
        return matches.map((s) => this.loc(target, s));
      }
    }
    // 名前が一致する定義が無い（module.exports = Other 等）→ ファイル先頭へ
    return [new vscode.Location(target, new vscode.Position(0, 0))];
  }

  private async workspaceFallback(
    name: string,
    kinds: DefKind[]
  ): Promise<vscode.Location[]> {
    const entries = this.index.lookupName(name).filter((e) => kinds.includes(e.def.kind));
    return entries.map((e) => this.loc(e.uri, e.def));
  }

  private loc(uri: vscode.Uri, def: SymbolDef): vscode.Location {
    return new vscode.Location(uri, toRange(def.selectionRange));
  }
}

/** カーソル語の直前が `.`（メンバ）か `@`（this プロパティ）か */
function memberAccess(
  document: vscode.TextDocument,
  start: vscode.Position
): "none" | "dot" | "at" {
  if (start.character === 0) {
    return "none";
  }
  const before = document.getText(
    new vscode.Range(start.line, start.character - 1, start.line, start.character)
  );
  if (before === ".") {
    return "dot";
  }
  if (before === "@") {
    return "at";
  }
  return "none";
}

/** line を含むスコープから親をたどったチェーン（最内→ルート） */
function ancestorScopes(scanRes: ScanResult, line: number): number[] {
  const chain: number[] = [];
  const seen = new Set<number>();
  let s = scanRes.lineScope[line] ?? 0;
  while (s >= 0 && !seen.has(s)) {
    seen.add(s);
    chain.push(s);
    s = scanRes.scopeParent[s] ?? -1;
  }
  return chain;
}
