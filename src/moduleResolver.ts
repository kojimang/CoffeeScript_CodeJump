import * as vscode from "vscode";

const DEFAULT_EXTS = [".coffee", ".litcoffee", ".coffee.md", ".js"];

/**
 * require/import のモジュール指定子を実在ファイルの Uri に解決する。
 * 相対指定（`./` `../` `/`）のみ対象。bare 指定（node_modules）は対象外。
 */
export async function resolveModule(
  fromUri: vscode.Uri,
  spec: string
): Promise<vscode.Uri | undefined> {
  if (!isRelative(spec)) {
    return undefined;
  }
  const exts = vscode.workspace
    .getConfiguration("coffeescriptCodeJump")
    .get<string[]>("moduleFileExtensions", DEFAULT_EXTS);

  const baseDir = vscode.Uri.joinPath(fromUri, ".."); // fromUri のあるディレクトリ
  const target = vscode.Uri.joinPath(baseDir, spec); // `..` を正規化した Uri

  const candidates: vscode.Uri[] = [];
  candidates.push(target); // 拡張子込みで指定済みのケース
  for (const ext of exts) {
    candidates.push(target.with({ path: target.path + ext }));
  }
  for (const ext of exts) {
    candidates.push(vscode.Uri.joinPath(target, `index${ext}`));
  }

  for (const cand of candidates) {
    if (await isFile(cand)) {
      return cand;
    }
  }
  return undefined;
}

function isRelative(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/");
}

async function isFile(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.File) !== 0;
  } catch {
    return false;
  }
}
