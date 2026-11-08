import { describe, expect, test } from "bun:test";

import type { FileArtifact } from "@contracts/discovery";
import { DeterministicDependencyGraphBuilder } from "@graph/dependency-graph-builder";
import { JavaScriptParser, type ASTResult } from "@parser/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/semantic-engine";
import { JavaScriptSymbolExtractor, type SymbolTable } from "@symbols/index";

async function analyze(sources: Readonly<Record<string, string>>) {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();
  const files: FileArtifact[] = [];
  const astResults: ASTResult[] = [];
  const symbolTables: SymbolTable[] = [];
  for (const [path, source] of Object.entries(sources)) {
    const file: FileArtifact = { id: `file:${path}`, path, language: "javascript", size: source.length };
    const ast = (await parser.parse({ file, source })).result;
    files.push(file);
    astResults.push(ast);
    symbolTables.push(extractor.extract(ast));
  }
  const dependencyGraph = new DeterministicDependencyGraphBuilder().build(symbolTables, files);
  const semantic = new DeterministicSemanticAnalysisEngine().analyze({ astResults, symbolTables, dependencyGraph });
  const symbols = symbolTables.flatMap((table) => table.symbols);
  const exports = (filePath: string) => symbols.filter((symbol) => symbol.kind === "export" && symbol.filePath === filePath);
  const calls = (filePath: string) => semantic.calls
    .filter((call) => call.sourceFilePath === filePath && !["require", "Object.defineProperty"].includes(call.calleeName))
    .map((call) => [call.location?.line, call.calleeName, call.targetSymbolId ?? call.resolutionState])
    .sort((left, right) => Number(left[0]) - Number(right[0]));
  return { semantic, symbols, exports, calls };
}

// Standard `tsc --module commonjs` output for `export function hello` and its importer.
const tscLib = "\"use strict\";\nObject.defineProperty(exports, \"__esModule\", { value: true });\nexports.hello = void 0;\nfunction hello() { return 1; }\nexports.hello = hello;\n";
const tscMain = "\"use strict\";\nconst lib_1 = require(\"./lib\");\n(0, lib_1.hello)();\nlib_1.hello();\n";

describe("BA-12 compiled CommonJS", () => {
  test("the `void 0` pre-declaration and the `__esModule` marker create no export", async () => {
    const { exports } = await analyze({ "lib.js": tscLib.replace("exports.hello = void 0", "exports.other = exports.hello = void 0") });
    expect(exports("lib.js").map((symbol) => [symbol.name, symbol.sourceSymbolName])).toEqual([["hello", "hello"]]);
  });

  test("calls through a required module resolve to its export, including tsc's `(0, f)()` form", async () => {
    const { calls, exports } = await analyze({ "lib.js": tscLib, "main.js": tscMain });
    const hello = exports("lib.js")[0]?.id ?? "missing";
    expect(calls("main.js")).toEqual([[3, "lib_1.hello", hello], [4, "lib_1.hello", hello]]);
  });

  test("an export used through a required module is not unused", async () => {
    const { semantic } = await analyze({ "lib.js": tscLib, "main.js": tscMain });
    expect(semantic.unusedExports.map((finding) => finding.name)).toEqual([]);
  });

  test("a module whose value is replaced does not resolve members through its exports object", async () => {
    const { calls } = await analyze({
      "lib.js": "function hello() {}\nexports.hello = hello;\nmodule.exports = function other() {};\n",
      "main.js": "const lib = require('./lib');\nlib.hello();\n",
    });
    expect(calls("main.js")).toEqual([[2, "lib.hello", "UNRESOLVED"]]);
  });

  test("an export assigned twice stays unresolved", async () => {
    const { calls } = await analyze({
      "lib.js": "function a() {}\nfunction b() {}\nexports.hello = a;\nexports.hello = b;\n",
      "main.js": "const lib = require('./lib');\nlib.hello();\n",
    });
    expect(calls("main.js")).toEqual([[2, "lib.hello", "UNRESOLVED"]]);
  });

  test("a rebound receiver or a written member stays unresolved", async () => {
    const lib = "function hello() {}\nexports.hello = hello;\n";
    const rebound = await analyze({ "lib.js": lib, "main.js": "let lib = require('./lib');\nlib = other;\nlib.hello();\n" });
    expect(rebound.calls("main.js")).toEqual([[3, "lib.hello", "UNRESOLVED"]]);
    const written = await analyze({ "lib.js": lib, "main.js": "const lib = require('./lib');\nlib.hello = other;\nlib.hello();\n" });
    expect(written.calls("main.js")).toEqual([[3, "lib.hello", "UNRESOLVED"]]);
  });

  test("an ES default import of a CommonJS module does not resolve members", async () => {
    const { calls } = await analyze({
      "lib.js": "function hello() {}\nexports.hello = hello;\n",
      "main.js": "import lib from './lib';\nlib.hello();\n",
    });
    expect(calls("main.js")).toEqual([[2, "lib.hello", "UNRESOLVED"]]);
  });
});
