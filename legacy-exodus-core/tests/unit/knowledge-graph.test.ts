import { describe, expect, test } from "bun:test";

import { DeterministicDependencyGraphBuilder } from "@graph/index";
import { DeterministicKnowledgeGraphBuilder } from "@knowledge/index";
import { JavaScriptParser } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

describe("DeterministicKnowledgeGraphBuilder", () => {
  test("creates immutable file and symbol nodes with deterministic relationships", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const files = [
      { id: "api", path: "src/api.js", language: "javascript", size: 1 },
      { id: "auth", path: "src/auth.js", language: "javascript", size: 1 },
    ] as const;
    const api = extractor.extract((await parser.parse({ file: files[0], source: 'import { login } from "./auth";' })).result);
    const auth = extractor.extract((await parser.parse({ file: files[1], source: "export function login() {}" })).result);
    const dependencyGraph = new DeterministicDependencyGraphBuilder().build([api, auth], files);
    const graph = new DeterministicKnowledgeGraphBuilder().build([auth, api], dependencyGraph);

    expect(graph.nodes.some((node) => node.kind === "file" && node.filePath === "src/api.js")).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "symbol" && node.name === "login")).toBe(true);
    expect(graph.edges.some((edge) => edge.relationship === "contains")).toBe(true);
    expect(graph.edges.some((edge) => edge.relationship === "imports")).toBe(true);
    expect(Object.isFrozen(graph)).toBe(true);
    expect(Object.isFrozen(graph.nodes)).toBe(true);
    expect(graph.nodes.map((node) => node.id)).toEqual([...graph.nodes].map((node) => node.id).sort());
    expect(graph.edges.map((edge) => edge.id)).toEqual([...graph.edges].map((edge) => edge.id).sort());
  });
});
