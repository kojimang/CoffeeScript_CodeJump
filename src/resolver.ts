import * as vscode from "vscode";
import { SymbolIndex } from "./symbolIndex";
import { resolveModule } from "./moduleResolver";
import { DefKind, ScanResult, SymbolDef } from "./types";
import { wordAt } from "./providerUtil";

/** クロスファイルでエクスポートされうる（トップレベル）定義の種類 */
export const EXPORTABLE: DefKind[] = ["class", "function", "variable", "import"];

/** 解決結果 1 件。def が無い場合は「モジュールファイルそのもの」への解決（先頭へ） */
export interface ResolvedTarget {
  uri: vscode.Uri;
  def?: SymbolDef;
}

export interface Resolution {
  name: string;
  targets: ResolvedTarget[];
}

/**
 * カーソル位置の識別子を定義へ解決する共通ロジック。
 * DefinitionProvider と HoverProvider が共用する。
 * 解決順:
 *   1. メンバ参照（`.name` / `@name`）→ メソッド/プロパティ定義
 *   2. 語を囲むスコープ内→外の同名定義（import 束縛ならクロスファイルへ）
 *   3. ワークスペース索引の同名定義（複数候補あり得る）
 */
export class SymbolResolver {
  constructor(private readonly index: SymbolIndex) {}

  async resolve(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<Resolution | undefined> {
    const w = wordAt(document, position);
    if (!w) {
      return undefined;
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
        return { name, targets: members.map((def) => ({ uri: document.uri, def })) };
      }
      return { name, targets: this.workspaceLookup(name, ["method", "property"]) };
    }

    // 2. スコープ内→外の順で解決
    const scoped = this.resolveInScopes(scanRes, name, position.line);
    if (scoped) {
      const imp = scoped.find((s) => s.kind === "import" && s.moduleSpecifier);
      if (imp) {
        const crossed = await this.resolveImport(
          document.uri,
          imp.moduleSpecifier!,
          name
        );
        if (crossed.length) {
          return { name, targets: crossed };
        }
      }
      return { name, targets: scoped.map((def) => ({ uri: document.uri, def })) };
    }

    // 3. ワークスペース索引フォールバック
    return { name, targets: this.workspaceLookup(name, EXPORTABLE) };
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

  /** import 束縛をモジュール解決し、対象ファイル内の同名定義（無ければファイル先頭）へ */
  private async resolveImport(
    fromUri: vscode.Uri,
    spec: string,
    name: string
  ): Promise<ResolvedTarget[]> {
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
        return matches.map((def) => ({ uri: target, def }));
      }
    }
    // 名前が一致する定義が無い（module.exports = Other 等）→ ファイル先頭へ
    return [{ uri: target }];
  }

  private workspaceLookup(name: string, kinds: DefKind[]): ResolvedTarget[] {
    return this.index
      .lookupName(name)
      .filter((e) => kinds.includes(e.def.kind))
      .map((e) => ({ uri: e.uri, def: e.def }));
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
