import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { DeterministicDependencyGraphBuilder } from "@graph/dependency-graph-builder";
import { JavaScriptParser } from "@parser/index";
import { DeterministicCallGraphBuilder } from "@semantic/call-graph-builder";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";

/** ADR-008 step 2: calls and references are keyed by owner, subject and ordinal, never by position. */

async function factKeysOf(path: string, source: string): Promise<{ readonly calls: string[]; readonly references: string[] }> {
  const language = path.endsWith(".ts") || path.endsWith(".tsx") ? "typescript" : "javascript";
  const ast = (await new JavaScriptParser().parse({ file: { id: path, path, language, size: source.length }, source })).result;
  const table = new JavaScriptSymbolExtractor().extract(ast);
  const graph = new DeterministicDependencyGraphBuilder().build([table], new Set([path]));
  const result = new DeterministicCallGraphBuilder().build([ast], [table], graph);
  return {
    calls: result.calls.map((call) => call.key ?? "<missing>"),
    references: result.references.map((reference) => `${reference.kind}|${reference.key ?? "<missing>"}`),
  };
}

const ROOT = join(import.meta.dir, "../../../src");
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("call and reference keys (ADR-008 step 2)", () => {
  test("name the enclosing owners, the subject and its ordinal there", async () => {
    const keys = await factKeysOf("src/x.js", "export class Box { open(a) { log(a); log(a); return () => log(a); } }\nfunction run() { new Box().open(1); }\nrun();\n");
    expect(keys.calls).toEqual(expect.arrayContaining([
      "src/x.js#Box:class/open:method/call:log@0",
      "src/x.js#Box:class/open:method/call:log@1",
      "src/x.js#Box:class/open:method/ArrowFunctionExpression@0/call:log@0",
      "src/x.js#call:run@0",
    ]));
    expect(keys.references).toEqual(expect.arrayContaining(["identifier|src/x.js#Box:class/open:method/ref:a@1"]));
  });

  test("over the engine's own source: unique, and unchanged by lines and declarations added above", async () => {
    const files = sourceFiles(ROOT);
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      const path = relative(join(ROOT, ".."), file).replaceAll("\\", "/");
      const source = readFileSync(file, "utf8");
      const keys = await factKeysOf(path, source);
      const problems = (values: string[]): { missing: number; duplicates: number } => ({ missing: values.filter((key) => key.includes("<missing>")).length, duplicates: values.length - new Set(values).size });
      expect({ path, calls: problems(keys.calls), references: problems(keys.references) }).toEqual({ path, calls: { missing: 0, duplicates: 0 }, references: { missing: 0, duplicates: 0 } });
      expect({ path, shifted: await factKeysOf(path, `// one line\n\n${source}`) }).toEqual({ path, shifted: keys });
      const inserted = await factKeysOf(path, `function lxInsertedAbove(q) { return q; }\n${source}`);
      const others = (values: string[]): string[] => values.filter((key) => !key.includes("#lxInsertedAbove:function/"));
      expect({ path, calls: others(inserted.calls), references: others(inserted.references) }).toEqual({ path, calls: keys.calls, references: keys.references });
    }
  }, 180_000);
});
