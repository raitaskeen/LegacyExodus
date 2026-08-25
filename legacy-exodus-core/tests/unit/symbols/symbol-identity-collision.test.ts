import { describe, expect, test } from "bun:test";

import { DeterministicControlFlowGraphBuilder, DeterministicDataFlowGraphBuilder } from "@flow/index";
import { DeterministicDependencyGraphBuilder } from "@graph/index";
import { JavaScriptParser, type ASTNode, type ASTResult, type ParseRequest } from "@parser/index";
import { DeterministicCallGraphBuilder } from "@semantic/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

function createRequest(source: string, path = "src/identity-test.js"): ParseRequest {
  return {
    file: {
      id: "identity-test-file",
      path,
      language: "javascript",
      size: source.length,
    },
    source,
  };
}

/** Recursively strips location metadata from an AST node to simulate synthesized or unlocated nodes. */
function stripLocation(node: ASTNode): ASTNode {
  return {
    type: node.type,
    role: node.role,
    attributes: { ...node.attributes },
    children: node.children.map(stripLocation),
  };
}

function stripASTLocations(ast: ASTResult): ASTResult {
  return {
    ...ast,
    root: stripLocation(ast.root),
  };
}

describe("P0 Core Hardening: Deterministic Symbol & Node Identity Collision Safety", () => {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();

  // ─── Test A: Symbol Missing-Location Collision & Determinism ──────────────────
  test("Test A: assigns distinct, deterministic IDs to multiple symbols of identical kind and name lacking location", async (): Promise<void> => {
    const source = `
      { function helper() { return 1; } }
      { function helper() { return 2; } }
      { const item = 1; }
      { const item = 2; }
      class ContainerA { process() { return 1; } }
      class ContainerB { process() { return 2; } }
    `;
    const originalAst = (await parser.parse(createRequest(source))).result;
    const unlocatedAst = stripASTLocations(originalAst);

    const run1 = extractor.extract(unlocatedAst);
    const run2 = extractor.extract(unlocatedAst);

    // Verify all symbols have undefined location
    expect(run1.symbols.every((s) => s.location === undefined)).toBe(true);

    const helpers = run1.symbols.filter((s) => s.name === "helper");
    expect(helpers.length).toBe(2);
    expect(helpers[0]?.id).not.toBe(helpers[1]?.id);

    const items = run1.symbols.filter((s) => s.name === "item");
    expect(items.length).toBe(2);
    expect(items[0]?.id).not.toBe(items[1]?.id);

    const processes = run1.symbols.filter((s) => s.name === "process");
    expect(processes.length).toBe(2);
    expect(processes[0]?.id).not.toBe(processes[1]?.id);

    // CRITICAL: Distinct unlocated symbols in the same file must NEVER have identical IDs
    const idSet = new Set(run1.symbols.map((s) => s.id));
    expect(idSet.size).toBe(run1.symbols.length);

    // Determinism: Repeated identical analysis must produce 100% identical IDs
    expect(run1.symbols.map((s) => s.id)).toEqual(run2.symbols.map((s) => s.id));
  });

  // ─── Test B: Located Symbol Compatibility ────────────────────────────────────
  test("Test B: preserves exact canonical identity semantics for symbols with source locations", async (): Promise<void> => {
    const source = `
      export function calculateTotal(items) { return items.length; }
      export const TAX_RATE = 0.05;
      export class OrderService { processOrder() { return true; } }
    `;
    const ast = (await parser.parse(createRequest(source))).result;
    const run1 = extractor.extract(ast);
    const run2 = extractor.extract(ast);

    expect(run1.symbols.every((s) => s.location !== undefined)).toBe(true);

    const calculate = run1.symbols.find((s) => s.name === "calculateTotal");
    const tax = run1.symbols.find((s) => s.name === "TAX_RATE");
    const service = run1.symbols.find((s) => s.name === "OrderService");

    expect(calculate).toBeDefined();
    expect(tax).toBeDefined();
    expect(service).toBeDefined();

    // Verify hash stability across repeated runs
    expect(run1.symbols.map((s) => s.id)).toEqual(run2.symbols.map((s) => s.id));
  });

  // ─── Test C: CFG Missing-Location Node & Function Scope Collision ─────────────
  test("Test C: assigns distinct statement and scope IDs in CFG for unlocated nodes", async (): Promise<void> => {
    const source = `
      function a() { console.log(1); console.log(2); }
      function b() { console.log(3); }
    `;
    const originalAst = (await parser.parse(createRequest(source))).result;
    const unlocatedAst = stripASTLocations(originalAst);

    const cfgBuilder = new DeterministicControlFlowGraphBuilder();
    const run1 = cfgBuilder.buildAll(unlocatedAst);
    const run2 = cfgBuilder.buildAll(unlocatedAst);

    expect(run1.length).toBe(3); // module + function a + function b

    // Verify distinct CFG IDs
    const cfgIds = new Set(run1.map((g) => g.id));
    expect(cfgIds.size).toBe(run1.length);

    // Verify statement IDs within each block are distinct
    for (const cfg of run1) {
      for (const block of cfg.blocks) {
        const stmtIds = new Set(block.statements.map((s) => s.id));
        expect(stmtIds.size).toBe(block.statements.length);
      }
    }

    // Determinism across runs
    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });

  // ─── Test D: DFG Missing-Location Definition & Use Collision ──────────────────
  test("Test D: assigns distinct definition and use IDs in DFG for unlocated nodes", async (): Promise<void> => {
    const source = `
      let x = 1;
      let y = 2;
      x = 3;
      console.log(x);
      console.log(y);
    `;
    const originalAst = (await parser.parse(createRequest(source))).result;
    const unlocatedAst = stripASTLocations(originalAst);

    const dfgBuilder = new DeterministicDataFlowGraphBuilder();
    const run1 = dfgBuilder.build(unlocatedAst);
    const run2 = dfgBuilder.build(unlocatedAst);

    // Verify distinct definition IDs
    const defIds = new Set(run1.definitions.map((d) => d.id));
    expect(defIds.size).toBe(run1.definitions.length);

    // Verify distinct use IDs
    const useIds = new Set(run1.uses.map((u) => u.id));
    expect(useIds.size).toBe(run1.uses.length);

    // Determinism across runs
    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });

  // ─── Test E: Downstream Pipeline Integration with Unlocated Symbols ──────────
  test("Test E: downstream dependency graph and call resolution remain robust with unlocated symbols", async (): Promise<void> => {
    const sourceA = `
      export function helper(val) { return val * 2; }
    `;
    const sourceB = `
      import { helper } from "./module-a";
      export function run() { return helper(10); }
    `;

    const astA = stripASTLocations((await parser.parse(createRequest(sourceA, "src/module-a.js"))).result);
    const astB = stripASTLocations((await parser.parse(createRequest(sourceB, "src/module-b.js"))).result);

    const tableA = extractor.extract(astA);
    const tableB = extractor.extract(astB);

    expect(tableA.symbols.every((s) => s.location === undefined)).toBe(true);
    expect(tableB.symbols.every((s) => s.location === undefined)).toBe(true);

    const files = [
      { id: "mod-a", path: "src/module-a.js", language: "javascript", size: sourceA.length },
      { id: "mod-b", path: "src/module-b.js", language: "javascript", size: sourceB.length },
    ];

    const depGraphBuilder = new DeterministicDependencyGraphBuilder();
    const depGraph = depGraphBuilder.build([tableA, tableB], files);

    expect(depGraph.nodes.length).toBeGreaterThan(0);
    expect(depGraph.edges.length).toBe(1);
    expect(depGraph.edges[0]?.sourceFilePath).toBe("src/module-b.js");
    expect(depGraph.edges[0]?.targetFilePath).toBe("src/module-a.js");

    const callGraphBuilder = new DeterministicCallGraphBuilder();
    const { calls } = callGraphBuilder.build([astA, astB], [tableA, tableB], depGraph);

    expect(calls.length).toBe(1);
    expect(calls[0]?.calleeName).toBe("helper");
    expect(calls[0]?.resolutionState).toBe("RESOLVED");
  });
});
