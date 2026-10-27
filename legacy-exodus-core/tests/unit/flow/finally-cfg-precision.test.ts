import { describe, expect, it } from "bun:test";

import { DeterministicControlFlowGraphBuilder } from "@flow/control-flow-builder";
import type { ControlFlowGraph } from "@flow/flow-contracts";
import { JavaScriptParser, ParserManager, ParserRegistry } from "@parser/index";

async function buildFunctionCfg(source: string, fnName: string): Promise<ControlFlowGraph> {
  const registry = new ParserRegistry();
  registry.register(new JavaScriptParser());
  const parseResult = await new ParserManager(registry).parse({
    file: { id: "test", path: "src/test.js", language: "javascript", size: source.length },
    source,
  });

  const builder = new DeterministicControlFlowGraphBuilder();
  const cfgs = builder.buildAll(parseResult);
  const cfg = cfgs.find((c) => c.scopeName.startsWith(fnName));
  if (!cfg) {
    throw new Error(`CFG for scope ${fnName} not found in [${cfgs.map((c) => c.scopeName).join(", ")}]`);
  }
  return cfg;
}

describe("F-14: Control-Flow Finally Graph Bloat & Back-Edge Routing Integrity", () => {
  it("T1: clean try-finally with no abrupt exits produces 0 unreachable blocks and 0 dead code nodes", async () => {
    const code = `
      function cleanFinally() {
        try {
          doWork();
        } finally {
          cleanup();
        }
      }
    `;

    const cfg = await buildFunctionCfg(code, "cleanFinally");

    // Must not generate phantom unreached finalizer clones (throw, return, break, continue)
    expect(cfg.unreachableBlockIds).toEqual([]);
    expect(cfg.deadCodeNodeIds).toEqual([]);

    // Must have normal finalizer edge leading to normal continuation / exit
    expect(cfg.edges.some((e) => e.kind === "finally")).toBe(true);
    expect(cfg.state).toBe("RESOLVED");
  });

  it("T2: try-finally with return routes through finalizer with 0 unreachable blocks and 0 dead code nodes", async () => {
    const code = `
      function returnFinally() {
        try {
          return 1;
        } finally {
          cleanup();
        }
      }
    `;

    const cfg = await buildFunctionCfg(code, "returnFinally");

    // No phantom unreached finalizer clones (throw, break, continue, normal fallthrough)
    expect(cfg.unreachableBlockIds).toEqual([]);
    expect(cfg.deadCodeNodeIds).toEqual([]);

    // The return edge must route into the finalizer (retagged to finally)
    const toFinally = cfg.edges.find((e) => e.kind === "finally");
    expect(toFinally).toBeDefined();

    // The finalizer block must route out to exit with kind "return"
    const finalizerBlockId = toFinally!.toBlockId;
    const finalizerToExit = cfg.edges.find(
      (e) => e.fromBlockId === finalizerBlockId && e.toBlockId === cfg.exitBlockId && e.kind === "return",
    );
    expect(finalizerToExit).toBeDefined();
  });

  it("T3: try-finally with return followed by genuine dead code flags only the unreachable code", async () => {
    const code = `
      function returnDeadCode() {
        try {
          return 1;
        } finally {
          cleanup();
        }
        console.log("truly dead");
      }
    `;

    const cfg = await buildFunctionCfg(code, "returnDeadCode");

    // Exactly one unreachable block containing console.log("truly dead")
    expect(cfg.unreachableBlockIds.length).toBe(1);
    expect(cfg.deadCodeNodeIds.length).toBe(1);

    // Ensure the dead node is NOT cleanup()
    const unreachableBlock = cfg.blocks.find((b) => b.id === cfg.unreachableBlockIds[0]);
    expect(unreachableBlock).toBeDefined();
    expect(unreachableBlock!.statements.some((s) => s.type === "ExpressionStatement")).toBe(true);

    // Verify cleanup statements are live and reachable
    const finalizerBlock = cfg.blocks.find((b) =>
      b.statements.some((s) => s.type === "ExpressionStatement" && !cfg.deadCodeNodeIds.includes(s.id)),
    );
    expect(finalizerBlock).toBeDefined();
  });

  it("T4: loop with continue in try-finally routes through the update back to loop header with 0 false-positive dead nodes", async () => {
    const code = `
      function loopContinue() {
        for (let i = 0; i < 5; i++) {
          try {
            if (i === 3) continue;
          } finally {
            cleanup();
          }
        }
      }
    `;

    const cfg = await buildFunctionCfg(code, "loopContinue");

    // Zero unreachable blocks or false-positive dead code
    expect(cfg.unreachableBlockIds).toEqual([]);
    expect(cfg.deadCodeNodeIds).toEqual([]);

    // Loop must be recognized as natural loop containing the finalizer
    expect(cfg.loops).toHaveLength(1);
    const loop = cfg.loops[0]!;

    const continueBlock = cfg.blocks.find((b) =>
      b.statements.some((s) => s.type === "ContinueStatement"),
    );
    expect(continueBlock).toBeDefined();

    // Continue routes to finalizer with kind "finally"
    const continueToFinally = cfg.edges.find(
      (e) => e.fromBlockId === continueBlock!.id && e.kind === "finally",
    );
    expect(continueToFinally).toBeDefined();

    // Finalizer routes out to the for update with kind "continue" (F-003); the update loops back to the header
    const updateBlock = cfg.blocks.find((b) => b.statements.some((s) => s.type === "UpdateExpression"));
    expect(updateBlock).toBeDefined();
    const finalizerToUpdate = cfg.edges.find(
      (e) => e.fromBlockId === continueToFinally!.toBlockId && e.toBlockId === updateBlock!.id && e.kind === "continue",
    );
    expect(finalizerToUpdate).toBeDefined();
    expect(cfg.edges.filter((e) => e.fromBlockId === updateBlock!.id).map((e) => [e.toBlockId, e.kind])).toEqual([[loop.headerBlockId, "loop-back"]]);
    expect(loop.blockIds).toContain(continueToFinally!.toBlockId);
    expect(loop.blockIds).toContain(updateBlock!.id);
  });

  it("T5: loop with break in try-finally routes to loop exit with 0 false-positive dead nodes", async () => {
    const code = `
      function loopBreak() {
        for (let i = 0; i < 5; i++) {
          try {
            if (i === 3) break;
          } finally {
            cleanup();
          }
        }
      }
    `;

    const cfg = await buildFunctionCfg(code, "loopBreak");

    // Zero unreachable blocks or false-positive dead code
    expect(cfg.unreachableBlockIds).toEqual([]);
    expect(cfg.deadCodeNodeIds).toEqual([]);

    const breakBlock = cfg.blocks.find((b) =>
      b.statements.some((s) => s.type === "BreakStatement"),
    );
    expect(breakBlock).toBeDefined();

    // Break routes to finalizer with kind "finally"
    const breakToFinally = cfg.edges.find(
      (e) => e.fromBlockId === breakBlock!.id && e.kind === "finally",
    );
    expect(breakToFinally).toBeDefined();

    // Finalizer routes out with kind "break"
    const finalizerToBreakDest = cfg.edges.find(
      (e) => e.fromBlockId === breakToFinally!.toBlockId && e.kind === "break",
    );
    expect(finalizerToBreakDest).toBeDefined();
  });

  it("T6: try-catch-finally with handled exception routes throw -> catch -> finalizer with 0 dead nodes", async () => {
    const code = `
      function catchRecovery() {
        try {
          throw new Error();
        } catch (e) {
          recover();
        } finally {
          cleanup();
        }
      }
    `;

    const cfg = await buildFunctionCfg(code, "catchRecovery");

    expect(cfg.unreachableBlockIds).toEqual([]);
    expect(cfg.deadCodeNodeIds).toEqual([]);

    // Throw in try routes to catch block (kind: throw)
    const throwEdge = cfg.edges.find((e) => e.kind === "throw");
    expect(throwEdge).toBeDefined();

    // Catch routes to normal finalizer (kind: finally)
    const catchToFinally = cfg.edges.find(
      (e) => e.fromBlockId === throwEdge!.toBlockId && e.kind === "finally",
    );
    expect(catchToFinally).toBeDefined();
  });

  it("T7: try-catch-finally with catch rethrow routes catch -> finalizer -> exception target with 0 dead nodes", async () => {
    const code = `
      function catchRethrow() {
        try {
          throw new Error();
        } catch (e) {
          throw e;
        } finally {
          cleanup();
        }
      }
    `;

    const cfg = await buildFunctionCfg(code, "catchRethrow");

    expect(cfg.unreachableBlockIds).toEqual([]);
    expect(cfg.deadCodeNodeIds).toEqual([]);

    // Uncaught throw out of catch routes to finalizer with kind "finally"
    const catchToFinally = cfg.edges.find(
      (e) => e.kind === "finally",
    );
    expect(catchToFinally).toBeDefined();

    // Finalizer routes out to exit with kind "throw"
    const finalizerToExit = cfg.edges.find(
      (e) => e.fromBlockId === catchToFinally!.toBlockId && e.toBlockId === cfg.exitBlockId && e.kind === "throw",
    );
    expect(finalizerToExit).toBeDefined();
  });

  it("T8: nested try-finally blocks maintain strict LIFO execution with zero unreachable bloat", async () => {
    const code = `
      function nestedFinally() {
        try {
          try {
            work();
          } finally {
            innerCleanup();
          }
        } finally {
          outerCleanup();
        }
      }
    `;

    const cfg = await buildFunctionCfg(code, "nestedFinally");

    expect(cfg.unreachableBlockIds).toEqual([]);
    expect(cfg.deadCodeNodeIds).toEqual([]);

    // Both inner and outer finalizer edges exist
    const finallyEdges = cfg.edges.filter((e) => e.kind === "finally");
    expect(finallyEdges.length).toBeGreaterThanOrEqual(2);
  });
});
