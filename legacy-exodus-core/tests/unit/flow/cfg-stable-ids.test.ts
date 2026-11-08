import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { DeterministicControlFlowGraphBuilder } from "@flow/index";
import { JavaScriptParser } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";

/** ADR-008 step 3b: CFG ids are digests of keys, so lines added above change no graph, block, node or edge id. */

async function cfgIdsOf(path: string, source: string): Promise<string[]> {
  const ast = (await new JavaScriptParser().parse({ file: { id: path, path, language: "typescript", size: source.length }, source })).result;
  const owners = new JavaScriptSymbolExtractor().extract(ast).symbols.filter((symbol) => symbol.kind === "function" || symbol.kind === "method" || symbol.kind === "class");
  return new DeterministicControlFlowGraphBuilder().buildAllWithNodes(ast, owners).graphs.flatMap((graph) => [
    `graph ${graph.id}`,
    ...graph.blocks.map((block) => `block ${block.id}`),
    ...graph.blocks.flatMap((block) => block.statements.map((node) => `node ${node.id}`)),
    ...graph.edges.map((edge) => `edge ${edge.id} ${edge.fromBlockId}>${edge.toBlockId}`),
  ]).sort();
}

const ROOT = join(import.meta.dir, "../../../src");
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("stable CFG ids (ADR-008 step 3b)", () => {
  test("over the engine's own source: unchanged by lines added above, and unique", async () => {
    const files = sourceFiles(ROOT);
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      const path = relative(join(ROOT, ".."), file).replaceAll("\\", "/");
      const source = readFileSync(file, "utf8");
      const ids = await cfgIdsOf(path, source);
      expect({ path, unique: new Set(ids).size === ids.length }).toEqual({ path, unique: true });
      expect({ path, shifted: await cfgIdsOf(path, `// one line\n\n${source}`) }).toEqual({ path, shifted: ids });
    }
  }, 300_000);
});
