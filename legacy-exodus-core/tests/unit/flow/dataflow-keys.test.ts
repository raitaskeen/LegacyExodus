import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { DeterministicDataFlowGraphBuilder } from "@flow/data-flow-builder";
import { JavaScriptParser } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";

/** ADR-008 step 2c: definitions, uses and taint flows are keyed by owner, subject and ordinal, never by position. */

async function flowKeysOf(path: string, source: string): Promise<{ readonly definitions: string[]; readonly uses: string[]; readonly flows: string[] }> {
  const language = path.endsWith(".ts") || path.endsWith(".tsx") ? "typescript" : "javascript";
  const ast = (await new JavaScriptParser().parse({ file: { id: path, path, language, size: source.length }, source })).result;
  const graph = new DeterministicDataFlowGraphBuilder().buildContext(ast, undefined, new JavaScriptSymbolExtractor().extract(ast).symbols).graph;
  const sorted = (values: string[]): string[] => [...values].sort();
  // One key per fact id: the same use can be recorded twice under one id, and then it shares that id's key.
  const byId = <T extends { readonly id: string; readonly key?: string }>(facts: readonly T[]): string[] => [...new Map(facts.map((fact) => [fact.id, fact.key ?? "<missing>"])).values()];
  return {
    definitions: sorted(byId(graph.definitions)),
    uses: sorted(byId(graph.uses)),
    flows: sorted(graph.taintFlows.map((flow) => flow.key ?? "<missing>")),
  };
}

const ROOT = join(import.meta.dir, "../../../src");
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("data-flow keys (ADR-008 step 2c)", () => {
  test("a taint flow is keyed by its source and its sink", async () => {
    const keys = await flowKeysOf("src/t.js", "export function run(req) { const cmd = req.body; child_process.exec(cmd); }\n");
    expect(keys.flows).toEqual(["src/t.js#run:function/source:req.body@0 > src/t.js#run:function/sink:child_process.exec@0"]);
    expect(keys.definitions).toEqual(expect.arrayContaining(["src/t.js#run:function/def:cmd:declaration@0"]));
  });

  test("over the engine's own source: unique, and unchanged by lines and declarations added above", async () => {
    const files = sourceFiles(ROOT);
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      const path = relative(join(ROOT, ".."), file).replaceAll("\\", "/");
      const source = readFileSync(file, "utf8");
      const keys = await flowKeysOf(path, source);
      const problems = (values: string[]) => ({ missing: values.filter((key) => key === "<missing>").length, duplicates: values.length - new Set(values).size });
      expect({ path, definitions: problems(keys.definitions), uses: problems(keys.uses) }).toEqual({ path, definitions: { missing: 0, duplicates: 0 }, uses: { missing: 0, duplicates: 0 } });
      expect({ path, shifted: await flowKeysOf(path, `// one line\n\n${source}`) }).toEqual({ path, shifted: keys });
      const inserted = await flowKeysOf(path, `function lxInsertedAbove(q) { return q; }\n${source}`);
      const others = (values: string[]): string[] => values.filter((key) => !key.includes("#lxInsertedAbove:function/"));
      expect({ path, definitions: others(inserted.definitions), uses: others(inserted.uses), flows: others(inserted.flows) }).toEqual({ path, definitions: keys.definitions, uses: keys.uses, flows: keys.flows });
    }
  }, 300_000);
});
