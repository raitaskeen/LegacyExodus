import { describe, expect, test } from "bun:test";

import { JavaScriptParser, ParserManager, ParserRegistry } from "@parser/index";
import { collectLoadTimeModuleFacts, requireCycles, staleExportFiles, type LoadTimeModuleFacts } from "@semantic/require-cycles";

/** The specifiers a file loads while it loads, parsed as the file at `path`. */
async function loadsOf(path: string, source: string): Promise<readonly string[]> {
  const registry = new ParserRegistry();
  registry.register(new JavaScriptParser());
  const language = /\.(?:ts|tsx|mts|cts)$/.test(path) ? "typescript" : "javascript";
  const ast = await new ParserManager(registry).parse({ file: { id: `cycles:${path}`, path, language, size: source.length }, source });
  return collectLoadTimeModuleFacts(ast).loads.map((load) => load.specifier);
}

const at = (line: number): { readonly line: number; readonly column: number } => ({ line, column: 0 });
const file = (filePath: string, loads: readonly [string, number][], exportsReplacedAt: readonly number[] = []): LoadTimeModuleFacts => ({
  filePath,
  loads: loads.map(([specifier, line]) => ({ specifier, at: at(line) })),
  exportsReplacedAt: exportsReplacedAt.map(at),
});
// Specifiers are the target paths themselves in these tests.
const resolve = (_importer: string, specifier: string): string | undefined => specifier;

describe("require cycles (RT-M9)", () => {
  test("finds a three-file cycle and a file that loads itself, and nothing else", () => {
    const facts = [
      file("a.js", [["b.js", 1]]),
      file("b.js", [["c.js", 1]]),
      file("c.js", [["a.js", 1], ["d.js", 2]]),
      file("d.js", []),
      file("self.js", [["self.js", 1]]),
    ];
    const cycles = requireCycles(facts, resolve);

    expect([...(cycles.get("a.js") ?? [])].sort()).toEqual(["a.js", "b.js", "c.js"]);
    expect(cycles.get("b.js")).toBe(cycles.get("a.js"));
    expect(cycles.has("d.js")).toBe(false);
    expect([...(cycles.get("self.js") ?? [])]).toEqual(["self.js"]);
  });

  test("ignores loads that resolve to no analysed file", () => {
    const cycles = requireCycles([file("a.js", [["fs", 1], ["missing.js", 2]])], (_importer, specifier) => (specifier === "fs" ? undefined : specifier));

    expect(cycles.size).toBe(0);
  });

  test("marks a file stale only when it replaces module.exports after loading a file of its cycle", () => {
    const facts = [
      file("late.js", [["other.js", 1]], [3]),
      file("other.js", [["late.js", 1]]),
      file("early.js", [["peer.js", 5]], [2]),
      file("peer.js", [["early.js", 1]]),
      file("alone.js", [], [1]),
    ];
    const stale = staleExportFiles(facts, requireCycles(facts, resolve), resolve);

    expect([...stale].sort()).toEqual(["late.js"]);
  });

  test("an import that compiles away is no load; one used as a value, in JSX or for its side effects is", async () => {
    const source = [
      "import type { A } from './type-only';",
      "import { type B } from './type-specifier';",
      "import { C } from './used-as-type';",
      "import { D } from './used-as-value';",
      "import { E } from './used-in-jsx';",
      "import './side-effect';",
      "export type { F } from './type-reexport';",
      "export { G } from './value-reexport';",
      "import H = require('./import-equals');",
      "const f = (a: A, b: B, c: C): void => { D(); };",
      "const el = <E />;",
    ].join("\n");

    expect(await loadsOf("main.tsx", source)).toEqual(["./used-as-value", "./used-in-jsx", "./side-effect", "./value-reexport", "./import-equals"]);
  });

  test("a JavaScript file keeps every import but `import type`, and a decorated or declaration file is handled whole", async () => {
    expect(await loadsOf("main.js", "import { C } from './unused';\nimport type { T } from './flow-type';\n")).toEqual(["./unused"]);
    // Decorator metadata can keep an import used only as a type, so a decorated TypeScript file keeps them all.
    expect(await loadsOf("main.ts", "import { C } from './as-type';\n@d class K { m(c: C): void {} }\n")).toEqual(["./as-type"]);
    expect(await loadsOf("types.d.ts", "import { C } from './x';\nexport declare const c: C;\n")).toEqual([]);
  });
});
