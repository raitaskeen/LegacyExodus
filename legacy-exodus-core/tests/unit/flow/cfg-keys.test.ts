import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { DeterministicControlFlowGraphBuilder } from "@flow/index";
import { JavaScriptParser } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";

/** ADR-008 step 2b: graphs, blocks and nodes are keyed by owner and structure, never by position. */

async function cfgKeysOf(path: string, source: string): Promise<{ readonly graphs: string[]; readonly blocks: string[]; readonly nodes: string[] }> {
  const language = path.endsWith(".ts") || path.endsWith(".tsx") ? "typescript" : "javascript";
  const ast = (await new JavaScriptParser().parse({ file: { id: path, path, language, size: source.length }, source })).result;
  const owners = new JavaScriptSymbolExtractor().extract(ast).symbols.filter((symbol) => symbol.kind === "function" || symbol.kind === "method" || symbol.kind === "class");
  const graphs = new DeterministicControlFlowGraphBuilder().buildAllWithNodes(ast, owners).graphs;
  const sorted = (values: string[]): string[] => [...values].sort();
  return {
    graphs: sorted(graphs.map((graph) => graph.key ?? "<missing>")),
    blocks: sorted(graphs.flatMap((graph) => graph.blocks.map((block) => block.key ?? "<missing>"))),
    nodes: sorted(graphs.flatMap((graph) => graph.blocks.flatMap((block) => block.statements.map((node) => node.key ?? "<missing>")))),
  };
}

const ROOT = join(import.meta.dir, "../../../src");
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("CFG keys (ADR-008 step 2b)", () => {
  test("a finally copy reuses its statement's key with the copy context", async () => {
    const keys = await cfgKeysOf("src/f.js", "function f(a) { try { if (a) return 1; g(); } finally { cleanup(); } }\n");
    const cleanup = keys.nodes.filter((key) => key.startsWith("src/f.js#f:function/stmt:ExpressionStatement@1"));
    expect(cleanup.length).toBeGreaterThan(1);
    expect(cleanup.filter((key) => !key.includes("/copy:"))).toHaveLength(1);
  });

  test("over the engine's own source: unique, and unchanged by lines and declarations added above", async () => {
    const files = sourceFiles(ROOT);
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      const path = relative(join(ROOT, ".."), file).replaceAll("\\", "/");
      const source = readFileSync(file, "utf8");
      const keys = await cfgKeysOf(path, source);
      const problems = (values: string[]) => ({ missing: values.filter((key) => key === "<missing>").length, duplicates: values.length - new Set(values).size });
      expect({ path, graphs: problems(keys.graphs), blocks: problems(keys.blocks), nodes: problems(keys.nodes) })
        .toEqual({ path, graphs: { missing: 0, duplicates: 0 }, blocks: { missing: 0, duplicates: 0 }, nodes: { missing: 0, duplicates: 0 } });
      expect({ path, shifted: await cfgKeysOf(path, `// one line\n\n${source}`) }).toEqual({ path, shifted: keys });
      const inserted = await cfgKeysOf(path, `function lxInsertedAbove(q) { return q; }\n${source}`);
      const others = (values: string[]): string[] => values.filter((key) => !key.includes("#lxInsertedAbove:function/"));
      // The module graph gains the inserted declaration as one statement; nothing else may change.
      const moduleStatement = `${path}#stmt:FunctionDeclaration@`;
      const withoutInserted = (values: string[]): string[] => {
        const declarations = values.filter((key) => key.startsWith(moduleStatement));
        return others(values).filter((key) => !key.startsWith(moduleStatement)).concat(declarations.slice(0, declarations.length - 1).map((_, index) => `${moduleStatement}${index}`));
      };
      expect({ path, graphs: others(inserted.graphs), blocks: others(inserted.blocks) }).toEqual({ path, graphs: keys.graphs, blocks: keys.blocks });
      expect({ path, nodes: withoutInserted(inserted.nodes).sort() }).toEqual({ path, nodes: keys.nodes });
    }
  }, 240_000);
});
