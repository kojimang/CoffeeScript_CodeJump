import * as vscode from "vscode";
import { SymbolIndex } from "./symbolIndex";
import { ResolvedTarget, SymbolResolver } from "./resolver";
import { wordAt } from "./providerUtil";

/** ホバーに載せる解決候補の最大数 */
const MAX_TARGETS = 3;
/** 1 候補あたりのスニペット最大行数 */
const MAX_LINES = 6;

/**
 * ホバーで定義のプレビュー（スニペット + 定義位置）を表示する。
 * 解決ロジックは DefinitionProvider と同じ SymbolResolver を共用。
 */
export class CoffeeHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly resolver: SymbolResolver,
    private readonly index: SymbolIndex
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    const w = wordAt(document, position);
    if (!w) {
      return undefined;
    }
    const resolved = await this.resolver.resolve(document, position);
    if (!resolved || resolved.targets.length === 0) {
      return undefined;
    }

    const md = new vscode.MarkdownString();
    const shown = resolved.targets.slice(0, MAX_TARGETS);
    for (const t of shown) {
      const rendered = await this.renderTarget(t);
      if (rendered) {
        md.appendCodeblock(rendered.code, "coffeescript");
        md.appendMarkdown(`*${rendered.label}*\n\n`);
      }
    }
    if (resolved.targets.length > shown.length) {
      md.appendMarkdown(`…ほか ${resolved.targets.length - shown.length} 件\n`);
    }
    if (!md.value) {
      return undefined;
    }
    return new vscode.Hover(md, w.range);
  }

  /** 解決先の定義スニペット（先頭数行・脱インデント済み）とラベルを作る */
  private async renderTarget(
    t: ResolvedTarget
  ): Promise<{ code: string; label: string } | undefined> {
    const text = await this.index.getTextForUri(t.uri);
    if (text === undefined) {
      return undefined;
    }
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const start = t.def?.range.start.line ?? 0;
    const endFull = t.def?.range.end.line ?? Math.min(lines.length - 1, MAX_LINES - 1);
    const end = Math.min(endFull, start + MAX_LINES - 1);
    const snippet = dedent(lines.slice(start, end + 1));
    if (end < endFull) {
      snippet.push("# …");
    }
    return {
      code: snippet.join("\n"),
      label: `${vscode.workspace.asRelativePath(t.uri)}:${start + 1}`,
    };
  }
}

/** 共通の先頭インデントを取り除く（メソッド等のスニペットを見やすく） */
function dedent(lines: string[]): string[] {
  let min = Infinity;
  for (const l of lines) {
    if (!l.trim()) {
      continue;
    }
    min = Math.min(min, l.length - l.trimStart().length);
  }
  if (!isFinite(min) || min === 0) {
    return lines;
  }
  return lines.map((l) => l.slice(min));
}
