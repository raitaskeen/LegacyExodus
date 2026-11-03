import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { JavaScriptParser } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";

/** ADR-008 step 1: symbol keys name what defines a symbol, so edits elsewhere never change them. */

async function keysOf(path: string, source: string): Promise<string[]> {
  const language = path.endsWith(".ts") || path.endsWith(".tsx") ? "typescript" : "javascript";
  const ast = (await new JavaScriptParser().parse({ file: { id: path, path, language, size: source.length }, source })).result;
  return new JavaScriptSymbolExtractor().extract(ast).symbols.map((symbol) => symbol.key ?? "<missing>");
}

const ROOT = join(import.meta.dir, "../../../src");
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("symbol keys (ADR-008)", () => {
  test("name owners, kind and position-free ordinals", async () => {
    const keys = await keysOf("src/x.ts", [
      "export class Box { size = 1; open(a) { const x = 1; return () => x; } }",
      "function outer(p) { [1].map((v) => v); [2].map((w) => w); if (p) { const y = 2; } }",
      "const config = { key: 1 };",
      "namespace NS { export function inner() {} }",
      "",
    ].join("\n"));
    expect(keys).toEqual(expect.arrayContaining([
      "src/x.ts#Box:class/size:variable",
      "src/x.ts#Box:class/open:method/a:variable",
      "src/x.ts#Box:class/open:method/x:variable",
      "src/x.ts#outer:function/ArrowFunctionExpression@0/v:variable",
      "src/x.ts#outer:function/ArrowFunctionExpression@1/w:variable",
      "src/x.ts#outer:function/y:variable",
      "src/x.ts#config.key:variable",
      "src/x.ts#NS:namespace/inner:function",
    ]));
  });

  test("anonymous functions at module level are numbered across the whole module", async () => {
    const keys = await keysOf("src/t.js", "test('a', (v) => v);\ntest('b', (w) => w);\n");
    expect(keys).toEqual(expect.arrayContaining(["src/t.js#ArrowFunctionExpression@0/v:variable", "src/t.js#ArrowFunctionExpression@1/w:variable"]));
  });

  test("true duplicates are told apart in source order", async () => {
    const keys = await keysOf("src/d.js", "var a = 1;\nvar a = 2;\nfunction f() { { let b = 1; } { let b = 2; } }\n");
    expect(keys.filter((key) => key.startsWith("src/d.js#a:variable"))).toEqual(["src/d.js#a:variable~0", "src/d.js#a:variable~1"]);
    expect(keys.filter((key) => key.includes("/b:variable"))).toEqual(["src/d.js#f:function/b:variable~0", "src/d.js#f:function/b:variable~1"]);
  });

  test("over the engine's own source: unique per file, and unchanged by lines and declarations added above", async () => {
    const files = sourceFiles(ROOT);
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      const path = relative(join(ROOT, ".."), file).replaceAll("\\", "/");
      const source = readFileSync(file, "utf8");
      const keys = await keysOf(path, source);
      expect({ path, missing: keys.filter((key) => key === "<missing>").length, duplicates: keys.length - new Set(keys).size }).toEqual({ path, missing: 0, duplicates: 0 });
      const shifted = await keysOf(path, `// one line\n\n${source}`);
      expect({ path, shifted }).toEqual({ path, shifted: keys });
      const inserted = await keysOf(path, `function lxInsertedAbove(q) { return q; }\n${source}`);
      const others = inserted.filter((key) => !key.startsWith(`${path}#lxInsertedAbove:function`));
      expect({ path, others }).toEqual({ path, others: keys });
    }
  }, 120_000);
});
