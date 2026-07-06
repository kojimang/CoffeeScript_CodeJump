// 結合テスト: 実際の Provider を vscode スタブ上で動かし、
// スコープ解決・ファイル間ジャンプ・メンバ参照ジャンプを検証する。
// （setup.ts が require('vscode') を差し替えるため、import 順に注意）
import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { Position, TextDocument, Uri } from "./support/vscodeMock";
import { SymbolIndex } from "../src/symbolIndex";
import { CoffeeDefinitionProvider } from "../src/definitionProvider";
import { CoffeeDocumentSymbolProvider } from "../src/documentSymbolProvider";

const FIXTURES = path.join(__dirname, "..", "..", "test", "fixtures");

function openDoc(name: string): TextDocument {
  const p = path.join(FIXTURES, name);
  return new TextDocument(Uri.file(p), fs.readFileSync(p, "utf8"));
}

/** 指定行のテキストから語の開始列を求める */
function col(doc: TextDocument, line: number, word: string): number {
  const text = (doc.getText() as string).split("\n")[line];
  const c = text.indexOf(word);
  assert.ok(c >= 0, `line ${line} に "${word}" が無い`);
  return c;
}

describe("CoffeeDefinitionProvider", () => {
  const index = new SymbolIndex();
  const provider = new CoffeeDefinitionProvider(index);
  const sample = openDoc("sample.coffee");
  const lines = (sample.getText() as string).split("\n");

  const lineOf = (needle: string): number => {
    const i = lines.findIndex((l) => l.includes(needle));
    assert.ok(i >= 0, `"${needle}" を含む行が無い`);
    return i;
  };

  async function def(line: number, word: string) {
    const pos = new Position(line, col(sample, line, word) + 1);
    // provider は vscode.TextDocument を要求するのでキャストして渡す
    return provider.provideDefinition(sample as never, pos as never);
  }

  it("関数本体のローカル変数(sum)の定義へ飛ぶ", async () => {
    const usage = lineOf("  sum"); // `  sum` 単独行（sum を返す行）
    const locs = await def(usage, "sum");
    assert.strictEqual(locs.length, 1);
    // 定義行は `  sum = a + b`
    assert.strictEqual(locs[0].range.start.line, lineOf("sum = a + b"));
  });

  it("パラメータ(a)の定義へ飛ぶ（関数本体スコープ）", async () => {
    const usage = lineOf("sum = a + b");
    const locs = await def(usage, "a");
    assert.strictEqual(locs.length, 1);
    assert.strictEqual(locs[0].range.start.line, lineOf("add = (a, b)"));
  });

  it("トップレベル関数(add)の定義へ飛ぶ", async () => {
    const usage = lineOf("result = add");
    const locs = await def(usage, "add");
    assert.strictEqual(locs.length, 1);
    assert.strictEqual(locs[0].range.start.line, lineOf("add = (a, b)"));
  });

  it("require 束縛(Helper)から別ファイルの定義へ飛ぶ（ファイル間ジャンプ）", async () => {
    const line = lineOf("Helper = require");
    const locs = await def(line, "Helper");
    assert.strictEqual(locs.length, 1);
    assert.ok(locs[0].uri.fsPath.endsWith("helper.coffee"), "helper.coffee へ飛ぶ");
    // helper.coffee の `class Helper` 行
    const helperLines = fs
      .readFileSync(path.join(FIXTURES, "helper.coffee"), "utf8")
      .split("\n");
    const classLine = helperLines.findIndex((l) => l.includes("class Helper"));
    assert.strictEqual(locs[0].range.start.line, classLine);
  });

  it("メンバ参照(dog.speak)はメソッド定義（同名2件）へ飛ぶ", async () => {
    const line = lineOf("dog.speak");
    const locs = await def(line, "speak");
    assert.strictEqual(locs.length, 2, "Animal と Dog の speak 2件");
    const defLines = locs.map((l) => l.range.start.line).sort((a, b) => a - b);
    const speakLines = lines
      .map((l, i) => (l.includes("speak: ->") ? i : -1))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    assert.deepStrictEqual(defLines, speakLines);
  });

  it("未知の識別子は定義なし（空配列）", async () => {
    const line = lineOf("for item in items");
    const locs = await def(line, "items");
    assert.strictEqual(locs.length, 0);
  });
});

describe("CoffeeDocumentSymbolProvider", () => {
  const index = new SymbolIndex();
  const provider = new CoffeeDocumentSymbolProvider(index);
  const sample = openDoc("sample.coffee");

  it("クラスがルートに出て、メソッドが子になる", () => {
    const syms = provider.provideDocumentSymbols(sample as never);
    const animal = syms.find((s) => s.name === "Animal");
    assert.ok(animal, "Animal がアウトラインに出る");
    const childNames = animal!.children.map((c) => c.name);
    assert.ok(childNames.includes("speak"), "speak が Animal の子");
    assert.ok(childNames.includes("constructor"), "constructor が Animal の子");
  });

  it("param と関数内ローカル変数はアウトラインに含めない", () => {
    const syms = provider.provideDocumentSymbols(sample as never);
    const flat: string[] = [];
    const walk = (list: typeof syms) => {
      for (const s of list) {
        flat.push(s.name);
        walk(s.children as typeof syms);
      }
    };
    walk(syms);
    assert.ok(!flat.includes("sum"), "ローカル変数 sum は出さない");
  });
});
