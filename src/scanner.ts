// CoffeeScript ソースからシンボル定義を抽出する純粋モジュール（vscode 非依存）。
//
// 方式: coffee-lex でトークン化し、文字列・コメント・補間の内側を除外しつつ
// 定義パターン（class / 関数代入 / メソッド / 変数 / require|import / for 変数 /
// 分割代入 / @プロパティ / 関数パラメータ）を検出する。あわせてインデントによる
// 関数スコープ解析を行い、各定義の scopeId を付与する。lex に失敗した場合は
// 行ベースの正規表現スキャナへフォールバックする。

import lex, { SourceToken, SourceType } from "coffee-lex";
import { DefKind, Pos, Rng, ScanResult, SymbolDef } from "./types";

const IDENT_RE = /^[$A-Za-z_][$A-Za-z0-9_]*$/;

/** 定義登録コールバックのオプション */
interface PushOpts {
  container?: string;
  moduleSpecifier?: string;
  scopeId?: number;
  range?: Rng;
}

/** 定義登録コールバック */
type PushFn = (nameTok: SourceToken, kind: DefKind, opts?: PushOpts) => void;

/** 行頭からの空白量（tab は 1 文字として数える）。CoffeeScript は同一ブロック内での混在を禁じるため単純計数で十分。 */
function indentWidth(line: string): number {
  let i = 0;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) {
    i++;
  }
  return i;
}

/** コメントのみ・空行かどうか（スコープ計算では空行扱いにする） */
function isBlankOrComment(line: string): boolean {
  const t = line.trim();
  return t.length === 0 || t.startsWith("#");
}

/** 各行の開始オフセット表を作る（offset → Pos 変換用） */
function computeLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToPos(offset: number, lineStarts: number[]): Pos {
  // lineStarts[line] <= offset を満たす最大の line を二分探索
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { line: lo, character: offset - lineStarts[lo] };
}

function rangeOf(tok: SourceToken, lineStarts: number[]): Rng {
  return {
    start: offsetToPos(tok.start, lineStarts),
    end: offsetToPos(tok.end, lineStarts),
  };
}

/** useCS2 を切り替えつつ lex を試みる。全滅なら null（→ フォールバック）。 */
function safeLex(source: string): SourceToken[] | null {
  for (const useCS2 of [true, false]) {
    try {
      return lex(source, { useCS2 }).toArray();
    } catch {
      // 次の設定を試す
    }
  }
  return null;
}

/**
 * openerLine（0-based）で開かれるインデントブロックの最終行を返す。
 * openerIndent より深いインデントを持つ連続行（空行/コメントは無視）の最後。
 */
function blockEndLine(
  lines: string[],
  openerLine: number,
  openerIndent: number
): number {
  let end = openerLine;
  for (let i = openerLine + 1; i < lines.length; i++) {
    if (isBlankOrComment(lines[i])) {
      continue;
    }
    if (indentWidth(lines[i]) > openerIndent) {
      end = i;
    } else {
      break;
    }
  }
  return end;
}

export function scan(source: string): ScanResult {
  // coffee-lex は LF 前提。CRLF / CR を正規化する。
  const normalized = source.replace(/\r\n?/g, "\n");
  const tokens = safeLex(normalized);
  if (!tokens) {
    return regexScan(normalized);
  }
  try {
    return tokenScan(normalized, tokens);
  } catch {
    // 想定外の解析エラーでも機能を落とさない
    return regexScan(normalized);
  }
}

// ---------------------------------------------------------------------------
// トークンベースの本体解析
// ---------------------------------------------------------------------------

function tokenScan(source: string, tokens: SourceToken[]): ScanResult {
  const lineStarts = computeLineStarts(source);
  const lines = source.split("\n");
  const text = (t: SourceToken) => source.slice(t.start, t.end);
  const lineOf = (t: SourceToken) => offsetToPos(t.start, lineStarts).line;

  // --- 前処理: 行ごとのトークン情報 -----------------------------------------
  const lineHasFunction: boolean[] = new Array(lines.length).fill(false);
  const lineFirstSig: Array<SourceToken | undefined> = new Array(lines.length);
  for (const tok of tokens) {
    if (tok.type === SourceType.SPACE || tok.type === SourceType.NEWLINE) {
      continue;
    }
    const ln = lineOf(tok);
    if (tok.type === SourceType.FUNCTION) {
      lineHasFunction[ln] = true;
    }
    if (lineFirstSig[ln] === undefined && !isCommentType(tok.type)) {
      lineFirstSig[ln] = tok;
    }
  }

  // --- 次の非空行のインデントを引くヘルパ -----------------------------------
  const nextCodeIndent = (line: number): number | null => {
    for (let i = line + 1; i < lines.length; i++) {
      if (!isBlankOrComment(lines[i])) {
        return indentWidth(lines[i]);
      }
    }
    return null;
  };
  const isFunctionOpener = (line: number): boolean => {
    if (!lineHasFunction[line]) {
      return false;
    }
    const ni = nextCodeIndent(line);
    return ni !== null && ni > indentWidth(lines[line]);
  };

  // --- スコープ割り当て（関数境界のみが変数スコープを作る） -----------------
  const scopeParent: number[] = [-1];
  const lineScope: number[] = new Array(lines.length).fill(0);
  const childScopeOfOpenerLine = new Map<number, number>();
  {
    type Frame = { scopeId: number; openerIndent: number };
    const stack: Frame[] = [{ scopeId: 0, openerIndent: -1 }];
    let nextScopeId = 1;
    for (let i = 0; i < lines.length; i++) {
      if (isBlankOrComment(lines[i])) {
        lineScope[i] = stack[stack.length - 1].scopeId;
        continue;
      }
      const ind = indentWidth(lines[i]);
      while (stack.length > 1 && ind <= stack[stack.length - 1].openerIndent) {
        stack.pop();
      }
      lineScope[i] = stack[stack.length - 1].scopeId;
      if (isFunctionOpener(i)) {
        const childId = nextScopeId++;
        scopeParent[childId] = stack[stack.length - 1].scopeId;
        stack.push({ scopeId: childId, openerIndent: ind });
        childScopeOfOpenerLine.set(i, childId);
      }
    }
  }

  // --- クラス所属（containerName 用） ---------------------------------------
  const classNameOfLine: Array<string | undefined> = new Array(lines.length);
  {
    type CFrame = { name: string; indent: number };
    const stack: CFrame[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (isBlankOrComment(lines[i])) {
        classNameOfLine[i] = stack.length ? stack[stack.length - 1].name : undefined;
        continue;
      }
      const ind = indentWidth(lines[i]);
      while (stack.length && ind <= stack[stack.length - 1].indent) {
        stack.pop();
      }
      classNameOfLine[i] = stack.length ? stack[stack.length - 1].name : undefined;
      const first = lineFirstSig[i];
      if (first && first.type === SourceType.CLASS) {
        const name = classNameOnLine(tokens, i, lineOf, text);
        if (name) {
          stack.push({ name, indent: ind });
        }
      }
    }
  }

  // --- 定義検出（有意トークンのみを走査） -----------------------------------
  const sig: SourceToken[] = tokens.filter(
    (t) => t.type !== SourceType.SPACE && !isCommentType(t.type)
  );
  const symbols: SymbolDef[] = [];
  const seen = new Set<string>(); // 同一位置の重複防止

  const push: PushFn = (nameTok, kind, opts = {}) => {
    const name = text(nameTok);
    if (!IDENT_RE.test(name)) {
      return;
    }
    const sel = rangeOf(nameTok, lineStarts);
    const key = `${name}:${sel.start.line}:${sel.start.character}:${kind}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const ln = sel.start.line;
    symbols.push({
      name,
      kind,
      selectionRange: sel,
      range: opts.range ?? sel,
      containerName: opts.container,
      moduleSpecifier: opts.moduleSpecifier,
      scopeId: opts.scopeId ?? lineScope[ln],
    });
  };

  const isStmtStart = (k: number): boolean =>
    k === 0 ||
    sig[k - 1].type === SourceType.NEWLINE ||
    sig[k - 1].type === SourceType.SEMICOLON;

  /** sig[idx] が代入の `=` 演算子か（`==` などは除外） */
  const isEq = (idx: number): boolean => {
    const e = sig[idx];
    return !!e && e.type === SourceType.OPERATOR && text(e) === "=";
  };

  for (let k = 0; k < sig.length; k++) {
    const t = sig[k];
    const line = lineOf(t);
    const indent = indentWidth(lines[line] ?? "");

    // class Foo / class Foo extends Bar
    if (t.type === SourceType.CLASS) {
      const nameIdx = nextIdentIndex(sig, k + 1);
      if (nameIdx >= 0 && lineOf(sig[nameIdx]) === line) {
        const range = spanRange(lines, line, indent);
        push(sig[nameIdx], "class", { container: classNameOfLine[line], range });
      }
      continue;
    }

    // import ... from '...'  /  import '...'
    if (t.type === SourceType.IMPORT && isStmtStart(k)) {
      handleImport(sig, k, line, lineOf, text, push);
      continue;
    }

    // for x, y in/of ...
    if (t.type === SourceType.FOR) {
      let j = k + 1;
      let expectIdent = true;
      while (j < sig.length && lineOf(sig[j]) === line) {
        const tj = sig[j];
        if (expectIdent && tj.type === SourceType.IDENTIFIER) {
          push(tj, "variable");
          expectIdent = false;
        } else if (tj.type === SourceType.COMMA) {
          expectIdent = true;
        } else {
          break;
        }
        j++;
      }
      continue;
    }

    // 文頭の代入・宣言系
    if (isStmtStart(k)) {
      // @name = ...  → プロパティ（this 代入） / @name: -> → 静的メソッド
      if (t.type === SourceType.AT) {
        const nx = sig[k + 1];
        if (nx && nx.type === SourceType.IDENTIFIER) {
          const after = sig[k + 2];
          if (isEq(k + 2)) {
            push(nx, "property", { container: classNameOfLine[line] });
          } else if (after && after.type === SourceType.COLON) {
            if (rhsIsFunction(sig, k + 3)) {
              const range = spanRange(lines, line, indent);
              push(nx, "method", { container: classNameOfLine[line], range });
              collectParams(sig, k + 3, childScopeOfOpenerLine.get(line), push);
            } else if (classNameOfLine[line]) {
              push(nx, "property", { container: classNameOfLine[line] });
            }
          }
        }
        continue;
      }

      // { a, b } = ...  /  [ a, b ] = ...  （分割代入。require ならば import）
      if (t.type === SourceType.LBRACE || t.type === SourceType.LBRACKET) {
        const closeType =
          t.type === SourceType.LBRACE ? SourceType.RBRACE : SourceType.RBRACKET;
        const closeIdx = matchClose(sig, k, t.type, closeType);
        if (closeIdx >= 0 && isEq(closeIdx + 1)) {
          const spec = requireSpecAfter(sig, closeIdx + 2, source);
          for (let j = k + 1; j < closeIdx; j++) {
            if (sig[j].type === SourceType.IDENTIFIER && isDestructureName(sig, j)) {
              if (spec !== null) {
                push(sig[j], "import", { moduleSpecifier: spec });
              } else {
                push(sig[j], "variable");
              }
            }
          }
        }
        continue;
      }

      // IDENT = ...
      if (t.type === SourceType.IDENTIFIER) {
        const eq = sig[k + 1];
        const isColon = eq && eq.type === SourceType.COLON;
        const isEquals =
          eq && eq.type === SourceType.OPERATOR && text(eq) === "=";

        if (isEquals) {
          const spec = requireSpecAfter(sig, k + 2, source);
          if (spec !== null) {
            push(t, "import", { moduleSpecifier: spec });
          } else if (rhsIsFunction(sig, k + 2)) {
            const range = spanRange(lines, line, indent);
            push(t, "function", { container: classNameOfLine[line], range });
            collectParams(sig, k + 2, childScopeOfOpenerLine.get(line), push);
          } else {
            push(t, "variable");
          }
          continue;
        }

        // IDENT: ...  → クラス内メソッド/プロパティ or オブジェクトのメソッド
        if (isColon) {
          if (rhsIsFunction(sig, k + 2)) {
            const range = spanRange(lines, line, indent);
            push(t, "method", { container: classNameOfLine[line], range });
            collectParams(sig, k + 2, childScopeOfOpenerLine.get(line), push);
          } else if (classNameOfLine[line]) {
            // クラス本体内の非関数プロパティ（フィールド）のみ採用
            push(t, "property", { container: classNameOfLine[line] });
          }
          continue;
        }
      }
    }
  }

  return { symbols, scopeParent, lineScope, degraded: false };
}

// ---------------------------------------------------------------------------
// トークン走査の補助関数
// ---------------------------------------------------------------------------

function isCommentType(type: SourceType): boolean {
  return (
    type === SourceType.COMMENT ||
    type === SourceType.HERECOMMENT ||
    type === SourceType.HEREGEXP_COMMENT
  );
}

/** sig[from] 以降で最初の IDENTIFIER の添字 */
function nextIdentIndex(sig: SourceToken[], from: number): number {
  for (let j = from; j < sig.length; j++) {
    if (sig[j].type === SourceType.IDENTIFIER) {
      return j;
    }
    if (sig[j].type === SourceType.NEWLINE) {
      return -1;
    }
  }
  return -1;
}

/** class 行のクラス名（単純識別子）を取り出す。`class Foo` / `class Foo extends Bar` */
function classNameOnLine(
  tokens: SourceToken[],
  line: number,
  lineOf: (t: SourceToken) => number,
  text: (t: SourceToken) => string
): string | undefined {
  let sawClass = false;
  for (const tok of tokens) {
    if (lineOf(tok) !== line) {
      if (sawClass) {
        break;
      }
      continue;
    }
    if (tok.type === SourceType.CLASS) {
      sawClass = true;
      continue;
    }
    if (sawClass && tok.type === SourceType.IDENTIFIER) {
      const name = text(tok);
      return IDENT_RE.test(name) ? name : undefined;
    }
  }
  return undefined;
}

/** LBRACE/LBRACKET から対応する閉じ括弧の添字（同種ネストを考慮） */
function matchClose(
  sig: SourceToken[],
  openIdx: number,
  openType: SourceType,
  closeType: SourceType
): number {
  let depth = 0;
  for (let j = openIdx; j < sig.length; j++) {
    if (sig[j].type === openType) {
      depth++;
    } else if (sig[j].type === closeType) {
      depth--;
      if (depth === 0) {
        return j;
      }
    } else if (sig[j].type === SourceType.NEWLINE && depth === 0) {
      return -1;
    }
  }
  return -1;
}

/** 分割代入内で、その IDENTIFIER が束縛名の位置か（`key: value` の value 側やネストは概ね束縛） */
function isDestructureName(sig: SourceToken[], j: number): boolean {
  // `{ a: b }` の場合、b が束縛名。a はキー。COLON の直前の IDENT はキーなので除外。
  const next = sig[j + 1];
  if (next && next.type === SourceType.COLON) {
    return false;
  }
  return true;
}

/** sig[from] から始まる RHS が関数（`->`/`=>`、または `(...) ->`）か */
function rhsIsFunction(sig: SourceToken[], from: number): boolean {
  const t = sig[from];
  if (!t) {
    return false;
  }
  if (t.type === SourceType.FUNCTION) {
    return true;
  }
  if (t.type === SourceType.LPAREN) {
    const close = matchClose(sig, from, SourceType.LPAREN, SourceType.RPAREN);
    if (close >= 0) {
      const after = sig[close + 1];
      return !!after && after.type === SourceType.FUNCTION;
    }
  }
  return false;
}

/** `(a, b) ->` のパラメータを関数本体スコープの param として登録 */
function collectParams(
  sig: SourceToken[],
  from: number,
  childScopeId: number | undefined,
  push: PushFn
): void {
  if (sig[from]?.type !== SourceType.LPAREN) {
    return;
  }
  const close = matchClose(sig, from, SourceType.LPAREN, SourceType.RPAREN);
  if (close < 0) {
    return;
  }
  const scopeId = childScopeId; // undefined ならデフォルト（行スコープ）に委ねる
  for (let j = from + 1; j < close; j++) {
    const tok = sig[j];
    if (tok.type !== SourceType.IDENTIFIER) {
      continue;
    }
    const prev = sig[j - 1];
    const isParamPos =
      prev &&
      (prev.type === SourceType.LPAREN ||
        prev.type === SourceType.COMMA ||
        prev.type === SourceType.AT); // @foo は this へ束縛するパラメータ
    if (isParamPos) {
      push(tok, "param", scopeId !== undefined ? { scopeId } : {});
    }
  }
}

/**
 * require 呼び出しならモジュール指定子（文字列内容）を返す。require でなければ null。
 * `require './x'` / `require('./x')` の双方に対応。
 */
function requireSpecAfter(sig: SourceToken[], from: number, source: string): string | null {
  const t = sig[from];
  if (!t || t.type !== SourceType.IDENTIFIER) {
    return null;
  }
  if (source.slice(t.start, t.end) !== "require") {
    return null;
  }
  return stringContentAfter(sig, from + 1, source);
}

/** sig[from] 以降、同一文中で最初の文字列リテラルの内容を返す */
function stringContentAfter(sig: SourceToken[], from: number, source: string): string | null {
  for (let j = from; j < sig.length; j++) {
    const tok = sig[j];
    if (tok.type === SourceType.STRING_CONTENT) {
      return source.slice(tok.start, tok.end);
    }
    if (
      tok.type === SourceType.SSTRING_END ||
      tok.type === SourceType.DSTRING_END
    ) {
      // 空文字列（内容トークンなし）
      return "";
    }
    if (tok.type === SourceType.NEWLINE || tok.type === SourceType.SEMICOLON) {
      return null;
    }
  }
  return null;
}

/** ES import 文の束縛名を登録 */
function handleImport(
  sig: SourceToken[],
  k: number,
  line: number,
  lineOf: (t: SourceToken) => number,
  text: (t: SourceToken) => string,
  push: PushFn
): void {
  // import 行の文字列指定子（末尾側）を先に確定
  let spec: string | null = null;
  const bindings: SourceToken[] = [];
  for (let j = k + 1; j < sig.length; j++) {
    const tok = sig[j];
    if (lineOf(tok) !== line || tok.type === SourceType.NEWLINE) {
      break;
    }
    if (tok.type === SourceType.STRING_CONTENT) {
      spec = text(tok);
      continue;
    }
    if (tok.type === SourceType.IDENTIFIER) {
      const w = text(tok);
      if (w === "from" || w === "as") {
        continue;
      }
      bindings.push(tok);
    }
  }
  if (spec === null) {
    return;
  }
  for (const b of bindings) {
    push(b, "import", { moduleSpecifier: spec, scopeId: 0 });
  }
}

/** opener 行から本体末尾までを覆う範囲 */
function spanRange(
  lines: string[],
  openerLine: number,
  openerIndent: number
): Rng {
  const endLine = blockEndLine(lines, openerLine, openerIndent);
  const startChar = indentWidth(lines[openerLine] ?? "");
  const endChar = (lines[endLine] ?? "").length;
  return {
    start: { line: openerLine, character: startChar },
    end: { line: endLine, character: endChar },
  };
}

// ---------------------------------------------------------------------------
// フォールバック: 行ベースの正規表現スキャナ（lex 失敗時のみ）
// ---------------------------------------------------------------------------

function regexScan(source: string): ScanResult {
  const lines = source.split("\n");
  const symbols: SymbolDef[] = [];
  const add = (name: string, kind: DefKind, line: number, col: number, spec?: string) => {
    if (!IDENT_RE.test(name)) {
      return;
    }
    const sel: Rng = {
      start: { line, character: col },
      end: { line, character: col + name.length },
    };
    symbols.push({ name, kind, selectionRange: sel, range: sel, scopeId: 0, moduleSpecifier: spec });
  };

  const patterns: Array<{ re: RegExp; kind: DefKind; spec?: boolean }> = [
    { re: /^(\s*)class\s+([$A-Za-z_][$A-Za-z0-9_]*)/, kind: "class" },
    { re: /^(\s*)([$A-Za-z_][$A-Za-z0-9_]*)\s*=\s*require\b/, kind: "import", spec: true },
    { re: /^(\s*)([$A-Za-z_][$A-Za-z0-9_]*)\s*=\s*(?:\([^)]*\))?\s*[-=]>/, kind: "function" },
    { re: /^(\s*)([$A-Za-z_][$A-Za-z0-9_]*)\s*:\s*(?:\([^)]*\))?\s*[-=]>/, kind: "method" },
    { re: /^(\s*)([$A-Za-z_][$A-Za-z0-9_]*)\s*=(?!=)/, kind: "variable" },
  ];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (isBlankOrComment(raw)) {
      continue;
    }
    for (const p of patterns) {
      const m = p.re.exec(raw);
      if (m) {
        const col = m[1].length;
        let spec: string | undefined;
        if (p.spec) {
          const sm = /require\s*\(?\s*['"]([^'"]+)['"]/.exec(raw);
          spec = sm ? sm[1] : undefined;
        }
        add(m[2], p.kind, i, col, spec);
        break; // 1 行 1 定義
      }
    }
  }

  return {
    symbols,
    scopeParent: [-1],
    lineScope: new Array(lines.length).fill(0),
    degraded: true,
  };
}

// ---------------------------------------------------------------------------
// 参照検索・出現ハイライト用: 識別子の出現位置
// ---------------------------------------------------------------------------

/**
 * `name` と一致する識別子トークンの出現位置をすべて返す
 * （文字列・コメント・正規表現の内側は含まない）。
 * lex に失敗した場合は単語境界の正規表現で近似する。
 */
export function findOccurrences(source: string, name: string): Rng[] {
  const normalized = source.replace(/\r\n?/g, "\n");
  const out: Rng[] = [];
  const tokens = safeLex(normalized);
  if (tokens) {
    const lineStarts = computeLineStarts(normalized);
    for (const tok of tokens) {
      if (
        tok.type === SourceType.IDENTIFIER &&
        normalized.slice(tok.start, tok.end) === name
      ) {
        out.push(rangeOf(tok, lineStarts));
      }
    }
    return out;
  }
  // フォールバック: 単語境界の正規表現（文字列内の誤マッチは許容）
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![$A-Za-z0-9_])${escaped}(?![$A-Za-z0-9_])`, "g");
  const lines = normalized.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(lines[i])) !== null) {
      out.push({
        start: { line: i, character: m.index },
        end: { line: i, character: m.index + name.length },
      });
    }
  }
  return out;
}
