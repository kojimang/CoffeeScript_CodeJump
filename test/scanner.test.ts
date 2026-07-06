import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { scan } from "../src/scanner";
import { DefKind, SymbolDef } from "../src/types";

function load(name: string): string {
  return fs.readFileSync(path.join(__dirname, "..", "..", "test", "fixtures", name), "utf8");
}

function find(symbols: SymbolDef[], name: string, kind?: DefKind): SymbolDef[] {
  return symbols.filter((s) => s.name === name && (kind === undefined || s.kind === kind));
}

describe("scan (sample.coffee)", () => {
  const result = scan(load("sample.coffee"));
  const syms = result.symbols;

  it("lex に成功している（degraded でない）", () => {
    assert.strictEqual(result.degraded, false);
  });

  it("require の束縛を import として拾い、指定子を持つ", () => {
    const underscore = find(syms, "_", "import");
    assert.strictEqual(underscore.length, 1);
    assert.strictEqual(underscore[0].moduleSpecifier, "underscore");

    const helper = find(syms, "Helper", "import");
    assert.strictEqual(helper.length, 1);
    assert.strictEqual(helper[0].moduleSpecifier, "./helper");
  });

  it("分割代入の require を各束縛名の import として拾う", () => {
    const readFile = find(syms, "readFile", "import");
    const writeFile = find(syms, "writeFile", "import");
    assert.strictEqual(readFile.length, 1);
    assert.strictEqual(writeFile.length, 1);
    assert.strictEqual(readFile[0].moduleSpecifier, "fs");
    assert.strictEqual(writeFile[0].moduleSpecifier, "fs");
  });

  it("関数代入を function として拾う", () => {
    for (const fn of ["square", "add", "main"]) {
      assert.strictEqual(find(syms, fn, "function").length, 1, `${fn} が function として見つからない`);
    }
  });

  it("クラスを class として拾う", () => {
    assert.strictEqual(find(syms, "Animal", "class").length, 1);
    assert.strictEqual(find(syms, "Dog", "class").length, 1);
  });

  it("メソッドを container 付きで拾う（同名は別 container で複数）", () => {
    const speak = find(syms, "speak", "method");
    assert.strictEqual(speak.length, 2);
    const containers = speak.map((s) => s.containerName).sort();
    assert.deepStrictEqual(containers, ["Animal", "Dog"]);

    const ctor = find(syms, "constructor", "method");
    assert.strictEqual(ctor.length, 1);
    assert.strictEqual(ctor[0].containerName, "Animal");
  });

  it("@create: -> を静的メソッドとして拾う", () => {
    const create = find(syms, "create", "method");
    assert.strictEqual(create.length, 1);
    assert.strictEqual(create[0].containerName, "Animal");
  });

  it("@age = age を property として拾う", () => {
    const age = find(syms, "age", "property");
    assert.strictEqual(age.length, 1);
    assert.strictEqual(age[0].containerName, "Animal");
  });

  it("変数を variable として拾う", () => {
    assert.strictEqual(find(syms, "GREETING", "variable").length, 1);
    assert.strictEqual(find(syms, "config", "variable").length, 1);
    assert.strictEqual(find(syms, "sum", "variable").length, 1);
    assert.strictEqual(find(syms, "noise", "variable").length, 1);
    assert.strictEqual(find(syms, "result", "variable").length, 1);
  });

  it("パラメータを param として拾う", () => {
    assert.ok(find(syms, "x", "param").length >= 1);
    assert.ok(find(syms, "a", "param").length >= 1);
    assert.ok(find(syms, "b", "param").length >= 1);
  });

  it("for のループ変数を variable として拾う", () => {
    assert.strictEqual(find(syms, "item", "variable").length, 1);
  });

  it("文字列補間の中の識別子は変数として拾わない", () => {
    // "hello #{name}" の name は定義ではない
    assert.strictEqual(find(syms, "name", "variable").length, 0);
    assert.strictEqual(find(syms, "name", "function").length, 0);
  });

  it("非関数のオブジェクトプロパティ(config.key)は定義に含めない", () => {
    // クラス外のオブジェクトリテラルのキーはノイズになるため拾わない
    assert.strictEqual(find(syms, "key").length, 0);
  });

  it("関数本体のローカル変数は子スコープに属する", () => {
    const sum = find(syms, "sum", "variable")[0];
    assert.notStrictEqual(sum.scopeId, 0, "sum はトップレベルではない");
    assert.strictEqual(result.scopeParent[sum.scopeId], 0, "add の本体スコープの親はトップ");

    // add のパラメータ a は sum と同じ（add 本体）スコープ
    const a = find(syms, "a", "param")[0];
    assert.strictEqual(a.scopeId, sum.scopeId, "パラメータ a は関数本体スコープに属する");
  });

  it("selectionRange が識別子の位置を正しく指す", () => {
    const animal = find(syms, "Animal", "class")[0];
    const src = load("sample.coffee").split("\n");
    const lineText = src[animal.selectionRange.start.line];
    const sliced = lineText.slice(
      animal.selectionRange.start.character,
      animal.selectionRange.end.character
    );
    assert.strictEqual(sliced, "Animal");
  });
});
