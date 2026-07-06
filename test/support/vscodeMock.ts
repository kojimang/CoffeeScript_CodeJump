// 結合テスト用の最小 vscode API スタブ。
// Provider 群（definitionProvider / documentSymbolProvider / symbolIndex /
// moduleResolver）を実際に動かすために必要な範囲だけを実装する。
// ファイルアクセスは実 fs を使い、fixtures をそのまま読む。

import * as fs from "fs";
import * as nodePath from "path";

export class Position {
  constructor(public line: number, public character: number) {}
}

export class Range {
  start: Position;
  end: Position;
  constructor(a: number | Position, b: number | Position, c?: number, d?: number) {
    if (typeof a === "number") {
      this.start = new Position(a, b as number);
      this.end = new Position(c as number, d as number);
    } else {
      this.start = a;
      this.end = b as Position;
    }
  }
  contains(other: Range | Position): boolean {
    const p = other instanceof Position ? other : other.start;
    const q = other instanceof Position ? other : other.end;
    const geStart =
      this.start.line < p.line ||
      (this.start.line === p.line && this.start.character <= p.character);
    const leEnd =
      q.line < this.end.line ||
      (q.line === this.end.line && q.character <= this.end.character);
    return geStart && leEnd;
  }
}

export class Location {
  constructor(public uri: Uri, public range: Range) {}
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export enum SymbolKind {
  File = 0,
  Module = 1,
  Namespace = 2,
  Package = 3,
  Class = 4,
  Method = 5,
  Property = 6,
  Field = 7,
  Constructor = 8,
  Enum = 9,
  Interface = 10,
  Function = 11,
  Variable = 12,
  Constant = 13,
}

export class DocumentSymbol {
  children: DocumentSymbol[] = [];
  constructor(
    public name: string,
    public detail: string,
    public kind: SymbolKind,
    public range: Range,
    public selectionRange: Range
  ) {}
}

export class Disposable {
  dispose(): void {
    /* no-op */
  }
}

export class Uri {
  private constructor(public readonly fsPath: string) {}
  get path(): string {
    return this.fsPath;
  }
  static file(p: string): Uri {
    return new Uri(p);
  }
  static joinPath(base: Uri, ...segs: string[]): Uri {
    return new Uri(nodePath.normalize(nodePath.join(base.fsPath, ...segs)));
  }
  with(change: { path?: string }): Uri {
    return new Uri(change.path ?? this.fsPath);
  }
  toString(): string {
    return "file://" + this.fsPath;
  }
}

export class TextDocument {
  version = 1;
  private lines: string[];
  constructor(public uri: Uri, private content: string) {
    this.lines = content.split("\n");
  }
  getText(range?: Range): string {
    if (!range) {
      return this.content;
    }
    if (range.start.line === range.end.line) {
      return (this.lines[range.start.line] ?? "").slice(
        range.start.character,
        range.end.character
      );
    }
    return "";
  }
  getWordRangeAtPosition(pos: Position, re: RegExp): Range | undefined {
    const line = this.lines[pos.line] ?? "";
    const g = new RegExp(re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(line)) !== null) {
      const s = m.index;
      const e = s + m[0].length;
      if (pos.character >= s && pos.character <= e) {
        return new Range(pos.line, s, pos.line, e);
      }
    }
    return undefined;
  }
}

const configStub = {
  get<T>(_key: string, def: T): T {
    return def;
  },
};

export const workspace = {
  textDocuments: [] as TextDocument[],
  getConfiguration(_section: string) {
    return configStub;
  },
  fs: {
    async stat(uri: Uri) {
      const s = fs.statSync(uri.fsPath);
      return {
        type: s.isDirectory() ? FileType.Directory : FileType.File,
        mtime: Math.floor(s.mtimeMs),
        ctime: Math.floor(s.ctimeMs),
        size: s.size,
      };
    },
    async readFile(uri: Uri): Promise<Uint8Array> {
      return new Uint8Array(fs.readFileSync(uri.fsPath));
    },
  },
  async findFiles(): Promise<Uri[]> {
    return [];
  },
  createFileSystemWatcher() {
    return {
      onDidCreate() {
        return new Disposable();
      },
      onDidChange() {
        return new Disposable();
      },
      onDidDelete() {
        return new Disposable();
      },
      dispose() {
        /* no-op */
      },
    };
  },
  onDidCloseTextDocument() {
    return new Disposable();
  },
};

export const languages = {
  registerDefinitionProvider() {
    return new Disposable();
  },
  registerDocumentSymbolProvider() {
    return new Disposable();
  },
};

/** provider 群の `require('vscode')` に返す集約オブジェクト */
export const vscodeStub = {
  Position,
  Range,
  Location,
  FileType,
  SymbolKind,
  DocumentSymbol,
  Disposable,
  Uri,
  workspace,
  languages,
};
