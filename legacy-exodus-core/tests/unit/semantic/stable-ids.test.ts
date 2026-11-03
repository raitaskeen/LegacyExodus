import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { DeterministicDependencyGraphBuilder } from "@graph/dependency-graph-builder";
import { JavaScriptParser } from "@parser/index";
import { DeterministicCallGraphBuilder } from "@semantic/call-graph-builder";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";

/** ADR-008 step 3: ids are digests of keys, so an edit elsewhere in a file changes no other fact's id. */

async function idsOf(path: string, source: string): Promise<{ readonly symbols: string[]; readonly calls: string[]; readonly references: string[] }> {
  const ast = (await new JavaScriptParser().parse({ file: { id: path, path, language: "typescript", size: source.length }, source })).result;
  const table = new JavaScriptSymbolExtractor().extract(ast);
  const result = new DeterministicCallGraphBuilder().build([ast], [table], new DeterministicDependencyGraphBuilder().build([table], new Set([path])));
  // Only facts outside the inserted function are compared.
  const outside = <T extends { readonly key?: string }>(facts: readonly T[]): readonly T[] => facts.filter((fact) => !fact.key?.includes("#lxInsertedAbove:function"));
  return {
    symbols: outside(table.symbols).map((symbol) => symbol.id).sort(),
    calls: outside(result.calls).map((call) => `${call.id}>${call.targetSymbolId ?? "-"}`).sort(),
    references: outside(result.references).map((reference) => `${reference.id}>${reference.resolvedSymbolId ?? "-"}`).sort(),
  };
}

const ROOT = join(import.meta.dir, "../../../src");
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("stable ids (ADR-008 step 3)", () => {
  test("over the engine's own source: symbol, call and reference ids (and what they point to) survive edits above them", async () => {
    const files = sourceFiles(ROOT);
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      const path = relative(join(ROOT, ".."), file).replaceAll("\\", "/");
      const source = readFileSync(file, "utf8");
      const ids = await idsOf(path, source);
      expect({ path, shifted: await idsOf(path, `// one line\n\n${source}`) }).toEqual({ path, shifted: ids });
      expect({ path, inserted: await idsOf(path, `function lxInsertedAbove(q) { return q; }\n${source}`) }).toEqual({ path, inserted: ids });
    }
  }, 300_000);
});
