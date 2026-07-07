// テスト共通ヘルパ: fixture の読み込みと位置検索
import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { Position, TextDocument, Uri } from "./vscodeMock";

// __dirname（実行時）= out-test/test/support → プロジェクトルートは 3 つ上
export const FIXTURES = path.join(__dirname, "..", "..", "..", "test", "fixtures");

export function openDoc(name: string): TextDocument {
  const p = path.join(FIXTURES, name);
  return new TextDocument(Uri.file(p), fs.readFileSync(p, "utf8"));
}

/** needle を含む最初の行番号（0-based） */
export function lineOf(doc: TextDocument, needle: string): number {
  const i = doc
    .getText()
    .split("\n")
    .findIndex((l) => l.includes(needle));
  assert.ok(i >= 0, `"${needle}" を含む行が無い`);
  return i;
}

/** 指定行内での word の開始列 */
export function colOf(doc: TextDocument, line: number, word: string): number {
  const text = doc.getText().split("\n")[line];
  const c = text.indexOf(word);
  assert.ok(c >= 0, `line ${line} に "${word}" が無い`);
  return c;
}

/** needle を含む行の word 上（先頭+1文字目）の Position */
export function posIn(doc: TextDocument, needle: string, word: string): Position {
  const line = lineOf(doc, needle);
  return new Position(line, colOf(doc, line, word) + 1);
}
