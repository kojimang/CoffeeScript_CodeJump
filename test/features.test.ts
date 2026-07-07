// 結合テスト: Hover / References / DocumentHighlight / WorkspaceSymbol
// （setup.ts が require('vscode') を vscodeMock に差し替える。
//   モックの findFiles は test/fixtures の .coffee を返すため、
//   buildWorkspaceIndex で fixtures 全体が索引される）
import * as assert from "assert";
import {
  DocumentHighlightKind,
  Position,
  SymbolKind,
} from "./support/vscodeMock";
import { openDoc, lineOf, posIn } from "./support/helpers";
import { SymbolIndex } from "../src/symbolIndex";
import { SymbolResolver } from "../src/resolver";
import { CoffeeHoverProvider } from "../src/hoverProvider";
import { CoffeeReferenceProvider } from "../src/referenceProvider";
import { CoffeeDocumentHighlightProvider } from "../src/documentHighlightProvider";
import { CoffeeWorkspaceSymbolProvider } from "../src/workspaceSymbolProvider";

describe("CoffeeReferenceProvider", () => {
  const index = new SymbolIndex();
  const provider = new CoffeeReferenceProvider(index);
  const sample = openDoc("sample.coffee");

  before(async () => {
    await index.buildWorkspaceIndex();
  });

  async function refs(needle: string, word: string, includeDeclaration: boolean) {
    return provider.provideReferences(
      sample as never,
      posIn(sample, needle, word) as never,
      { includeDeclaration } as never
    );
  }

  it("add の参照が定義行と使用行の両方で見つかる（宣言含む）", async () => {
    const locs = await refs("result = add", "add", true);
    assert.strictEqual(locs.length, 2);
    const linesFound = locs.map((l) => l.range.start.line).sort((a, b) => a - b);
    assert.deepStrictEqual(linesFound, [
      lineOf(sample, "add = (a, b)"),
      lineOf(sample, "result = add"),
    ]);
  });

  it("includeDeclaration: false で定義行が除外される", async () => {
    const locs = await refs("result = add", "add", false);
    assert.strictEqual(locs.length, 1);
    assert.strictEqual(locs[0].range.start.line, lineOf(sample, "result = add"));
  });

  it("Helper の参照はファイルを跨いで見つかる", async () => {
    const locs = await refs("Helper = require", "Helper", true);
    const inSample = locs.filter((l) => l.uri.fsPath.endsWith("sample.coffee"));
    const inHelper = locs.filter((l) => l.uri.fsPath.endsWith("helper.coffee"));
    assert.strictEqual(inSample.length, 1, "sample 内の出現");
    assert.strictEqual(inHelper.length, 2, "helper 内の class 定義と module.exports");
  });
});

describe("CoffeeHoverProvider", () => {
  const index = new SymbolIndex();
  const provider = new CoffeeHoverProvider(new SymbolResolver(index), index);
  const sample = openDoc("sample.coffee");

  function hoverValue(hover: unknown): string {
    return (hover as { contents: { value: string } }).contents.value;
  }

  it("関数のホバーに定義スニペットと位置ラベルが出る", async () => {
    const hover = await provider.provideHover(
      sample as never,
      posIn(sample, "result = add", "add") as never
    );
    assert.ok(hover, "hover が返る");
    const value = hoverValue(hover);
    assert.ok(value.includes("```coffeescript"), "コードブロックがある");
    assert.ok(value.includes("add = (a, b) ->"), "定義行が含まれる");
    assert.ok(value.includes("sample.coffee"), "ファイル名ラベルが含まれる");
  });

  it("require 束縛のホバーは別ファイルの定義を表示する", async () => {
    const hover = await provider.provideHover(
      sample as never,
      posIn(sample, "Helper = require", "Helper") as never
    );
    assert.ok(hover);
    const value = hoverValue(hover);
    assert.ok(value.includes("class Helper"), "クラス定義スニペット");
    assert.ok(value.includes("helper.coffee"), "解決先ファイル名");
  });

  it("解決できない識別子はホバーなし", async () => {
    const hover = await provider.provideHover(
      sample as never,
      posIn(sample, "for item in items", "items") as never
    );
    assert.strictEqual(hover, undefined);
  });
});

describe("CoffeeDocumentHighlightProvider", () => {
  const index = new SymbolIndex();
  const provider = new CoffeeDocumentHighlightProvider(index);
  const sample = openDoc("sample.coffee");

  it("sum の定義が Write・参照が Read でハイライトされる", () => {
    const highlights = provider.provideDocumentHighlights(
      sample as never,
      posIn(sample, "sum = a + b", "sum") as never
    );
    assert.strictEqual(highlights.length, 2);
    const writes = highlights.filter(
      (h) => Number(h.kind) === Number(DocumentHighlightKind.Write)
    );
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].range.start.line, lineOf(sample, "sum = a + b"));
  });

  it("識別子以外の位置ではハイライトなし", () => {
    const highlights = provider.provideDocumentHighlights(
      sample as never,
      new Position(0, 0) as never // コメント行
    );
    // コメント行の語（サンプル）はコード上に出現しない → 空
    assert.strictEqual(highlights.length, 0);
  });
});

describe("CoffeeWorkspaceSymbolProvider", () => {
  const index = new SymbolIndex();
  const provider = new CoffeeWorkspaceSymbolProvider(index);

  before(async () => {
    await index.buildWorkspaceIndex();
  });

  it("'speak' で Animal/Dog のメソッド2件が出る", () => {
    const syms = provider.provideWorkspaceSymbols("speak");
    assert.strictEqual(syms.length, 2);
    const containers = syms.map((s) => s.containerName).sort();
    assert.deepStrictEqual(containers, ["Animal", "Dog"]);
  });

  it("サブシーケンス 'Hlp' で Helper がヒットする", () => {
    const syms = provider.provideWorkspaceSymbols("Hlp");
    const helpers = syms.filter((s) => s.name === "Helper");
    assert.ok(helpers.length >= 2, "class Helper と import Helper");
    assert.ok(
      helpers.some((s) => Number(s.kind) === Number(SymbolKind.Class)),
      "クラス定義を含む"
    );
  });

  it("param はワークスペースシンボルに出ない", () => {
    const syms = provider.provideWorkspaceSymbols("name");
    // formatName(function) はヒットしてよいが、param の name は出ない
    assert.ok(
      syms.every((s) => s.name !== "name"),
      "param name が含まれない"
    );
  });
});
