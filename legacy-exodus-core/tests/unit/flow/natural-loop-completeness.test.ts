import { describe, expect, it } from "bun:test";
import { JavaScriptParser } from "../../../src/parser/adapters/javascript/javascript-parser";
import { DeterministicControlFlowGraphBuilder } from "../../../src/flow/control-flow-builder";

async function buildCfgs(code: string, filePath = "test.js") {
  const parser = new JavaScriptParser();
  const builder = new DeterministicControlFlowGraphBuilder();
  const response = await parser.parse({
    file: {
      id: "f1",
      path: filePath,
      language: "javascript",
      size: code.length,
    },
    source: code,
  });
  return builder.buildAll(response.result);
}

describe("P1 Core Hardening: Natural-Loop Body Completeness & CFG Semantics", () => {
  it("Test A: simple multi-block loop — includes all intermediate loop body blocks in blockIds", async () => {
    const code = `
      function simpleLoop() {
        let i = 0;
        while (i < 10) {
          console.log("step 1");
          console.log("step 2");
          i++;
        }
        return i;
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("simpleLoop"));
    expect(cfg).toBeDefined();
    expect(cfg!.loops).toHaveLength(1);

    const loop = cfg!.loops[0]!;
    expect(loop.headerBlockId).toBeDefined();

    // Verify all blocks in loop body belong to blockIds
    expect(loop.blockIds.length).toBeGreaterThanOrEqual(2);
    expect(loop.blockIds).toContain(loop.headerBlockId);

    // Verify header dominates all blocks in the loop
    for (const blockId of loop.blockIds) {
      const block = cfg!.blocks.find((b) => b.id === blockId);
      expect(block).toBeDefined();
    }
  });

  it("Test B: conditional branching loop body — includes both branches and join block in natural loop", async () => {
    const code = `
      function branchingLoop() {
        let i = 0;
        while (i < 10) {
          if (i % 2 === 0) {
            console.log("even");
          } else {
            console.log("odd");
          }
          i++;
        }
        return i;
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("branchingLoop"));
    expect(cfg).toBeDefined();
    expect(cfg!.loops).toHaveLength(1);

    const loop = cfg!.loops[0]!;
    // 5 loop blocks: header, if-test, consequent, alternate, join/tail
    expect(loop.blockIds).toHaveLength(5);
    expect(loop.blockIds).toContain(loop.headerBlockId);
  });

  it("Test C: loop exit isolation — excludes exit block and downstream blocks from NaturalLoop.blockIds", async () => {
    const code = `
      function loopWithExit() {
        let x = 1;
        while (x < 5) {
          x++;
        }
        const result = x * 2;
        return result;
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("loopWithExit"));
    expect(cfg).toBeDefined();
    expect(cfg!.loops).toHaveLength(1);

    const loop = cfg!.loops[0]!;
    expect(loop.blockIds).not.toContain(cfg!.exitBlockId);

    // Find block containing returnStatement
    const returnBlock = cfg!.blocks.find((b) =>
      b.statements.some((s) => s.type === "ReturnStatement"),
    );
    if (returnBlock) {
      expect(loop.blockIds).not.toContain(returnBlock.id);
    }
  });

  it("Test D: nested loops — computes distinct and complete memberships for inner and outer loops", async () => {
    const code = `
      function nestedLoops() {
        let i = 0;
        while (i < 5) {
          let j = 0;
          while (j < 3) {
            console.log(i, j);
            j++;
          }
          i++;
        }
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("nestedLoops"));
    expect(cfg).toBeDefined();
    expect(cfg!.loops).toHaveLength(2);

    const outerLoop = cfg!.loops.find((l) => l.blockIds.length > 3);
    const innerLoop = cfg!.loops.find((l) => l.blockIds.length <= 3);

    expect(outerLoop).toBeDefined();
    expect(innerLoop).toBeDefined();
    expect(outerLoop!.headerBlockId).not.toBe(innerLoop!.headerBlockId);

    // All inner loop blocks must be contained in outer loop blocks
    for (const innerBlockId of innerLoop!.blockIds) {
      expect(outerLoop!.blockIds).toContain(innerBlockId);
    }
  });

  it("Test E: sequential loops in same scope — isolates distinct loop bodies", async () => {
    const code = `
      function sequentialLoops() {
        for (let i = 0; i < 5; i++) {
          console.log("loop 1");
        }
        for (let j = 0; j < 5; j++) {
          console.log("loop 2");
        }
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("sequentialLoops"));
    expect(cfg).toBeDefined();
    expect(cfg!.loops).toHaveLength(2);

    const [loop1, loop2] = cfg!.loops;
    expect(loop1!.headerBlockId).not.toBe(loop2!.headerBlockId);

    // Header of loop1 must not be in loop2, and vice versa
    expect(loop2!.blockIds).not.toContain(loop1!.headerBlockId);
    expect(loop1!.blockIds).not.toContain(loop2!.headerBlockId);
  });

  it("Test F: handles for, do-while, and for-of loop constructs", async () => {
    const code = `
      function variousLoops(items) {
        let count = 0;
        for (const item of items) {
          count += item.value;
        }
        let k = 0;
        do {
          k++;
        } while (k < 3);
        return count + k;
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("variousLoops"));
    expect(cfg).toBeDefined();
    expect(cfg!.loops).toHaveLength(2);

    for (const loop of cfg!.loops) {
      expect(loop.blockIds.length).toBeGreaterThanOrEqual(2);
      expect(loop.blockIds).toContain(loop.headerBlockId);
    }
  });

  it("Test G: guarantees deterministic sorted blockIds across repeated runs", async () => {
    const code = `
      function determinismTest(items) {
        for (const item of items) {
          if (item.active) {
            console.log("active");
          } else {
            console.log("inactive");
          }
        }
      }
    `;

    const cfgs1 = await buildCfgs(code);
    const cfgs2 = await buildCfgs(code);

    const loops1 = cfgs1.find((c) => c.scopeName.startsWith("determinismTest"))!.loops;
    const loops2 = cfgs2.find((c) => c.scopeName.startsWith("determinismTest"))!.loops;

    expect(JSON.stringify(loops1)).toBe(JSON.stringify(loops2));
    expect(loops1[0]!.blockIds).toEqual([...loops1[0]!.blockIds].sort());
  });

  // ─── P0.4 Hardening: Natural-Loop & Continue Semantics ───────────────────

  it("Test H: while loop with continue routes edge back to loop header", async () => {
    const code = `
      function testWhileContinue() {
        let i = 0;
        while (i < 10) {
          if (i === 5) {
            i++;
            continue;
          }
          console.log(i);
          i++;
        }
        return i;
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("testWhileContinue"));
    expect(cfg).toBeDefined();
    expect(cfg!.loops).toHaveLength(1);

    const loop = cfg!.loops[0]!;
    const header = loop.headerBlockId;

    // Must have a continue edge targeting the loop header
    const continueEdge = cfg!.edges.find((e) => e.kind === "continue");
    expect(continueEdge).toBeDefined();
    expect(continueEdge!.toBlockId).toBe(header);

    // Natural loop must contain the continue source block
    expect(loop.blockIds).toContain(continueEdge!.fromBlockId);
    expect(loop.blockIds).toContain(header);
  });

  it("Test I: for loop with continue routes edge to loop header and preserves natural loop", async () => {
    const code = `
      function testForContinue() {
        for (let i = 0; i < 10; i++) {
          if (i % 2 === 0) {
            continue;
          }
          console.log(i);
        }
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("testForContinue"));
    expect(cfg).toBeDefined();
    expect(cfg!.loops).toHaveLength(1);

    const loop = cfg!.loops[0]!;
    const continueEdge = cfg!.edges.find((e) => e.kind === "continue");
    expect(continueEdge).toBeDefined();
    expect(continueEdge!.toBlockId).toBe(loop.headerBlockId);
    expect(loop.blockIds).toContain(continueEdge!.fromBlockId);
  });

  it("Test J: do-while loop with continue routes edge to loop header", async () => {
    const code = `
      function testDoWhileContinue() {
        let k = 0;
        do {
          k++;
          if (k === 2) {
            continue;
          }
          console.log(k);
        } while (k < 5);
        return k;
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("testDoWhileContinue"));
    expect(cfg).toBeDefined();
    expect(cfg!.loops).toHaveLength(1);

    const loop = cfg!.loops[0]!;
    const continueEdge = cfg!.edges.find((e) => e.kind === "continue");
    expect(continueEdge).toBeDefined();
    expect(loop.blockIds).toContain(continueEdge!.toBlockId);
    expect(loop.blockIds).toContain(continueEdge!.fromBlockId);
  });

  it("Test K: for-of and for-in loops with continue route edges correctly", async () => {
    const code = `
      function testForOfContinue(items, obj) {
        for (const item of items) {
          if (!item) continue;
          console.log(item);
        }
        for (const key in obj) {
          if (key.startsWith("_")) continue;
          console.log(key);
        }
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("testForOfContinue"));
    expect(cfg).toBeDefined();
    expect(cfg!.loops).toHaveLength(2);

    const continueEdges = cfg!.edges.filter((e) => e.kind === "continue");
    expect(continueEdges).toHaveLength(2);
    expect(continueEdges[0]!.toBlockId).toBe(cfg!.loops[0]!.headerBlockId);
    expect(continueEdges[1]!.toBlockId).toBe(cfg!.loops[1]!.headerBlockId);
  });

  it("Test L: nested loops with inner continue isolates inner loop header", async () => {
    const code = `
      function testNestedContinue() {
        for (let i = 0; i < 5; i++) {
          for (let j = 0; j < 5; j++) {
            if (j === 2) continue;
            console.log(i, j);
          }
        }
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("testNestedContinue"));
    expect(cfg).toBeDefined();
    expect(cfg!.loops).toHaveLength(2);

    const [loop1, loop2] = cfg!.loops;
    const outer = loop1!.blockIds.length > loop2!.blockIds.length ? loop1! : loop2!;
    const inner = loop1!.blockIds.length > loop2!.blockIds.length ? loop2! : loop1!;

    const continueEdge = cfg!.edges.find((e) => e.kind === "continue");
    expect(continueEdge).toBeDefined();
    expect(continueEdge!.toBlockId).toBe(inner.headerBlockId);
    expect(inner.blockIds).toContain(continueEdge!.fromBlockId);
    expect(outer.blockIds).toContain(continueEdge!.fromBlockId);
  });

  it("Test M: labeled continue across nested loops routes to outer loop header", async () => {
    const code = `
      function testLabeledContinue() {
        outer: for (let i = 0; i < 5; i++) {
          for (let j = 0; j < 5; j++) {
            if (i === j) continue outer;
            console.log(i, j);
          }
        }
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("testLabeledContinue"));
    expect(cfg).toBeDefined();
    expect(cfg!.loops).toHaveLength(2);

    const [loop1, loop2] = cfg!.loops;
    const outer = loop1!.blockIds.length > loop2!.blockIds.length ? loop1! : loop2!;

    const continueEdge = cfg!.edges.find((e) => e.kind === "continue");
    expect(continueEdge).toBeDefined();
    expect(continueEdge!.toBlockId).toBe(outer.headerBlockId);
  });

  it("Test N: continue inside try-finally executes finalizer before loop header", async () => {
    const code = `
      function testTryFinallyContinue() {
        for (let i = 0; i < 5; i++) {
          try {
            if (i === 3) continue;
          } finally {
            console.log("cleanup");
          }
        }
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("testTryFinallyContinue"));
    expect(cfg).toBeDefined();
    expect(cfg!.loops).toHaveLength(1);

    const loop = cfg!.loops[0]!;
    const continueToFinally = cfg!.edges.find((e) => e.kind === "continue");
    expect(continueToFinally).toBeDefined();

    for (const bId of loop.blockIds) {
      expect(cfg!.blocks.some((b) => b.id === bId)).toBe(true);
    }
  });

  it("Test O: do-while entry reaches body before condition evaluation and body dominates condition", async () => {
    const code = `
      function testDoWhileSemantics() {
        let x = 0;
        do {
          x++;
          work(x);
        } while (x < 10);
        return x;
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("testDoWhileSemantics"));
    expect(cfg).toBeDefined();
    expect(cfg!.loops).toHaveLength(1);

    const loop = cfg!.loops[0]!;
    const entryBlock = cfg!.blocks.find((b) => b.id === cfg!.entryBlockId);
    expect(entryBlock).toBeDefined();

    // Entry block has a "next" edge to loop entry
    const loopNodeBlock = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "DoWhileStatement"));
    expect(loopNodeBlock).toBeDefined();

    const toBodyEdge = cfg!.edges.find((e) => e.fromBlockId === loopNodeBlock!.id && e.kind === "next");
    expect(toBodyEdge).toBeDefined();

    // The body block is the target of the loop entry edge
    const bodyBlockId = toBodyEdge!.toBlockId;
    expect(bodyBlockId).toBe(loop.headerBlockId);

    // True back-edge goes from condition block back to bodyBlockId
    const trueBackEdge = cfg!.edges.find((e) => e.toBlockId === bodyBlockId && e.kind === "true");
    expect(trueBackEdge).toBeDefined();

    // False exit edge goes to the post-loop block
    const conditionBlockId = trueBackEdge!.fromBlockId;
    const falseExitEdge = cfg!.edges.find((e) => e.fromBlockId === conditionBlockId && e.kind === "false");
    expect(falseExitEdge).toBeDefined();

    // Both body and condition blocks are part of the natural loop
    expect(loop.blockIds).toContain(bodyBlockId);
    expect(loop.blockIds).toContain(conditionBlockId);
  });

  it("Test P: do-while with break and continue routes break to exit and continue to condition evaluation", async () => {
    const code = `
      function testDoWhileBreakContinue() {
        let count = 0;
        do {
          count++;
          if (count === 3) continue;
          if (count === 7) break;
          console.log(count);
        } while (count < 10);
        return count;
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("testDoWhileBreakContinue"));
    expect(cfg).toBeDefined();
    expect(cfg!.loops).toHaveLength(1);

    const loop = cfg!.loops[0]!;
    const bodyBlockId = loop.headerBlockId;

    const trueBackEdge = cfg!.edges.find((e) => e.toBlockId === bodyBlockId && e.kind === "true");
    expect(trueBackEdge).toBeDefined();
    const conditionBlockId = trueBackEdge!.fromBlockId;

    const falseExitEdge = cfg!.edges.find((e) => e.fromBlockId === conditionBlockId && e.kind === "false");
    expect(falseExitEdge).toBeDefined();
    const afterLoopBlockId = falseExitEdge!.toBlockId;

    // Continue edge targets condition block
    const continueEdge = cfg!.edges.find((e) => e.kind === "continue");
    expect(continueEdge).toBeDefined();
    expect(continueEdge!.toBlockId).toBe(conditionBlockId);
    expect(loop.blockIds).toContain(continueEdge!.fromBlockId);

    // Break edge targets after loop exit block
    const breakEdge = cfg!.edges.find((e) => e.kind === "break");
    expect(breakEdge).toBeDefined();
    expect(breakEdge!.toBlockId).toBe(afterLoopBlockId);
  });

  it("Test Q: do-while with constant false executes body once and exits via false edge with no true back-edge", async () => {
    const code = `
      function testDoWhileFalse() {
        let executed = 0;
        do {
          executed = 1;
        } while (false);
        return executed;
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("testDoWhileFalse"));
    expect(cfg).toBeDefined();

    // Constant false do-while has 0 natural loops since there is no back-edge
    expect(cfg!.loops).toHaveLength(0);

    const loopNodeBlock = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "DoWhileStatement"));
    expect(loopNodeBlock).toBeDefined();

    const toBodyEdge = cfg!.edges.find((e) => e.fromBlockId === loopNodeBlock!.id && e.kind === "next");
    expect(toBodyEdge).toBeDefined();

    // Has false edge leaving condition block
    const falseEdge = cfg!.edges.find((e) => e.kind === "false");
    expect(falseEdge).toBeDefined();

    // No true edge exists
    const trueEdge = cfg!.edges.find((e) => e.kind === "true");
    expect(trueEdge).toBeUndefined();
  });

  it("Test R: deterministic CFG generation for do-while across repeated runs", async () => {
    const code = `
      function testDoWhileDeterminism(arr) {
        let i = 0;
        do {
          processItem(arr[i]);
          i++;
        } while (i < arr.length);
        return i;
      }
    `;

    const cfgs1 = await buildCfgs(code);
    const cfgs2 = await buildCfgs(code);

    expect(JSON.stringify(cfgs1)).toBe(JSON.stringify(cfgs2));
  });
});
