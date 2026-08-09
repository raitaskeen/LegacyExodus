import { describe, expect, test } from "bun:test";

import { validateDependencyGraph } from "@graph/index";

describe("DependencyGraph contracts", () => {
  test("validates and freezes directed dependency edges", (): void => {
    const graph = validateDependencyGraph({
      nodes: [{ id: "node-a", filePath: "src/api.js", symbolId: "symbol-a" }],
      edges: [{
        id: "edge-a",
        sourceFilePath: "src/api.js",
        targetFilePath: "src/billing.js",
        importSymbolId: "import-a",
        targetExportSymbolId: "export-b",
        moduleSpecifier: "./billing.js",
      }],
    });

    expect(Object.isFrozen(graph)).toBe(true);
    expect(Object.isFrozen(graph.edges)).toBe(true);
    expect(graph.edges[0]?.targetFilePath).toBe("src/billing.js");
  });
});
