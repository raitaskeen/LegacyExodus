import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { DeterministicDataFlowGraphBuilder } from "@flow/data-flow-builder";
import { JavaScriptParser } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";

/** ADR-008 step 3c: with the file's symbols, data-flow ids are digests of keys, so lines added above change none. */

async function flowIdsOf(path: string, source: string): Promise<string[]> {
  const ast = (await new JavaScriptParser().parse({ file: { id: path, path, language: "typescript", size: source.length }, source })).result;
  const graph = new DeterministicDataFlowGraphBuilder().buildContext(ast, undefined, new JavaScriptSymbolExtractor().extract(ast).symbols).graph;
  return [
    ...graph.definitions.map((definition) => `def ${definition.id}`),
    ...graph.uses.map((use) => `use ${use.id}>${use.definitionId ?? "-"}`),
    ...graph.taintFlows.map((flow) => `flow ${flow.sourceId}>${flow.sinkId} ${flow.state}`),
    ...graph.interproceduralFlows.map((flow) => `inter ${flow.id}`),
  ].sort();
}

const ROOT = join(import.meta.dir, "../../../src");
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("stable data-flow ids (ADR-008 step 3c)", () => {
  test("a taint flow's ids survive lines added above", async () => {
    const source = "export function run(req) { const cmd = req.body; child_process.exec(cmd); }\n";
    const ids = await flowIdsOf("src/t.js", source);
    expect(ids.some((id) => id.startsWith("flow "))).toBe(true);
    expect(await flowIdsOf("src/t.js", `// a\n// b\n${source}`)).toEqual(ids);
  });

  test("over the engine's own source: unchanged by lines added above", async () => {
    const files = sourceFiles(ROOT);
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      const path = relative(join(ROOT, ".."), file).replaceAll("\\", "/");
      const source = readFileSync(file, "utf8");
      expect({ path, shifted: await flowIdsOf(path, `// one line\n\n${source}`) }).toEqual({ path, shifted: await flowIdsOf(path, source) });
    }
  }, 300_000);
});
