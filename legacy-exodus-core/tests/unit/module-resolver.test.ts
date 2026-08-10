import { describe, expect, test } from "bun:test";

import type { FileArtifact } from "@contracts/discovery";
import { DeterministicDependencyGraphBuilder, ModuleResolver } from "@graph/index";
import { JavaScriptParser } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

const files: readonly FileArtifact[] = [
  { id: "api", path: "src/api.js", language: "javascript", size: 1 },
  { id: "billing", path: "src/billing.js", language: "javascript", size: 1 },
  { id: "barrel", path: "src/utils/index.js", language: "javascript", size: 1 },
];

describe("ModuleResolver", () => {
  test("resolves relative paths, extensions, and directory index modules deterministically", (): void => {
    const resolver = new ModuleResolver();

    expect(resolver.resolve("src/api.js", "./billing", files).resolvedPath).toBe("src/billing.js");
    expect(resolver.resolve("src/api.js", "./utils", files).resolvedPath).toBe("src/utils/index.js");
    expect(resolver.resolve("src/api.js", "express", files).resolvedPath).toBeNull();
  });

  test("builds a directed edge from a local import to a target export", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const api = extractor.extract((await parser.parse({ file: files[0]!, source: 'import Billing from "./billing";' })).result);
    const billing = extractor.extract((await parser.parse({ file: files[1]!, source: "export default class Billing {}" })).result);
    const graph = new DeterministicDependencyGraphBuilder().build([api, billing], files);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.sourceFilePath).toBe("src/api.js");
    expect(graph.edges[0]?.targetFilePath).toBe("src/billing.js");
    expect(Object.isFrozen(graph)).toBe(true);
  });

  test("terminates and reports circular file dependencies", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const cycleFiles = [
      { id: "a", path: "src/a.js", language: "javascript", size: 1 },
      { id: "b", path: "src/b.js", language: "javascript", size: 1 },
    ] as const;
    const a = extractor.extract((await parser.parse({ file: cycleFiles[0], source: 'import b from "./b"; export default b;' })).result);
    const b = extractor.extract((await parser.parse({ file: cycleFiles[1], source: 'import a from "./a"; export default a;' })).result);
    const graph = new DeterministicDependencyGraphBuilder().build([a, b], cycleFiles);
    expect(graph.cycles.length).toBeGreaterThan(0);
  });
});
