// mocha が各テストより前に読み込むフック。
// provider 群の `require('vscode')` を vscodeStub にすり替える。
import Module = require("module");
import { vscodeStub } from "./vscodeMock";

const anyModule = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const original = anyModule._load;
anyModule._load = function (request: string, parent: unknown, isMain: boolean): unknown {
  if (request === "vscode") {
    return vscodeStub;
  }
  return original.apply(this, [request, parent, isMain] as never);
};
