import * as vscode from "vscode";
import { scan } from "./scanner";
import { ScanResult, SymbolDef } from "./types";

interface DocEntry {
  version: number;
  result: ScanResult;
}

interface FileEntry {
  mtime: number;
  result: ScanResult;
}

/**
 * ScanResult のキャッシュとワークスペース索引を提供する。
 * - 開いているドキュメントは version をキーにキャッシュ
 * - ディスク上のファイルは mtime をキーにキャッシュ（クロスファイル解決用）
 * - 任意で、ワークスペース全体の定義名 → 定義 の索引を構築（フォールバック候補用）
 */
export class SymbolIndex implements vscode.Disposable {
  private docCache = new Map<string, DocEntry>();
  private fileCache = new Map<string, FileEntry>();
  /** 定義名 → その名前を持つ定義（uri とともに） */
  private nameIndex = new Map<string, Array<{ uri: vscode.Uri; def: SymbolDef }>>();
  private indexedFiles = new Set<string>();
  private watcher: vscode.FileSystemWatcher | undefined;
  private indexBuilt = false;

  /** 開いているドキュメントの ScanResult（version でキャッシュ） */
  getForDocument(document: vscode.TextDocument): ScanResult {
    const key = document.uri.toString();
    const cached = this.docCache.get(key);
    if (cached && cached.version === document.version) {
      return cached.result;
    }
    const result = scan(document.getText());
    this.docCache.set(key, { version: document.version, result });
    return result;
  }

  /** URI（開いていればドキュメント、なければディスク）から ScanResult を得る */
  async getForUri(uri: vscode.Uri): Promise<ScanResult | undefined> {
    const open = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === uri.toString()
    );
    if (open) {
      return this.getForDocument(open);
    }
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      const key = uri.toString();
      const cached = this.fileCache.get(key);
      if (cached && cached.mtime === stat.mtime) {
        return cached.result;
      }
      const bytes = await vscode.workspace.fs.readFile(uri);
      const result = scan(Buffer.from(bytes).toString("utf8"));
      this.fileCache.set(key, { mtime: stat.mtime, result });
      return result;
    } catch {
      return undefined;
    }
  }

  /** ワークスペース索引から同名の定義を引く（未構築なら空配列） */
  lookupName(name: string): Array<{ uri: vscode.Uri; def: SymbolDef }> {
    return this.nameIndex.get(name) ?? [];
  }

  /** 設定に応じてワークスペース索引を構築し、ファイル監視を開始する */
  async buildWorkspaceIndex(): Promise<void> {
    if (this.indexBuilt) {
      return;
    }
    this.indexBuilt = true;
    const config = vscode.workspace.getConfiguration("coffeescriptCodeJump");
    if (!config.get<boolean>("enableWorkspaceIndex", true)) {
      return;
    }
    const excludes = config.get<string[]>("exclude", ["**/node_modules/**"]);
    const excludeGlob = excludes.length ? `{${excludes.join(",")}}` : undefined;
    const files = await vscode.workspace.findFiles("**/*.{coffee,litcoffee,coffee.md}", excludeGlob);
    await Promise.all(files.map((uri) => this.indexFile(uri)));
    this.setupWatcher();
  }

  private setupWatcher(): void {
    if (this.watcher) {
      return;
    }
    this.watcher = vscode.workspace.createFileSystemWatcher(
      "**/*.{coffee,litcoffee,coffee.md}"
    );
    this.watcher.onDidCreate((uri) => this.indexFile(uri));
    this.watcher.onDidChange((uri) => {
      this.invalidate(uri);
      this.indexFile(uri);
    });
    this.watcher.onDidDelete((uri) => this.removeFromIndex(uri));
  }

  private async indexFile(uri: vscode.Uri): Promise<void> {
    const result = await this.getForUri(uri);
    if (!result) {
      return;
    }
    this.removeFromIndex(uri);
    for (const def of result.symbols) {
      const list = this.nameIndex.get(def.name);
      if (list) {
        list.push({ uri, def });
      } else {
        this.nameIndex.set(def.name, [{ uri, def }]);
      }
    }
    this.indexedFiles.add(uri.toString());
  }

  private removeFromIndex(uri: vscode.Uri): void {
    const key = uri.toString();
    if (!this.indexedFiles.has(key)) {
      return;
    }
    for (const [name, list] of this.nameIndex) {
      const filtered = list.filter((e) => e.uri.toString() !== key);
      if (filtered.length) {
        this.nameIndex.set(name, filtered);
      } else {
        this.nameIndex.delete(name);
      }
    }
    this.indexedFiles.delete(key);
  }

  /** ドキュメント/ファイルのキャッシュを無効化 */
  invalidate(uri: vscode.Uri): void {
    const key = uri.toString();
    this.docCache.delete(key);
    this.fileCache.delete(key);
  }

  dispose(): void {
    this.watcher?.dispose();
    this.docCache.clear();
    this.fileCache.clear();
    this.nameIndex.clear();
    this.indexedFiles.clear();
  }
}
