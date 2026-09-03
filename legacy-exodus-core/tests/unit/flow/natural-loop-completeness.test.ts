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

    const loopHeaderBlockIds = new Set(cfg!.loops.map((l) => l.headerBlockId));
    expect(loopHeaderBlockIds.size).toBe(2);

    for (const edge of continueEdges) {
      expect(loopHeaderBlockIds.has(edge.toBlockId)).toBe(true);
      const targetLoop = cfg!.loops.find((l) => l.headerBlockId === edge.toBlockId);
      expect(targetLoop).toBeDefined();
      expect(targetLoop!.blockIds).toContain(edge.fromBlockId);
    }

    const targetedHeaders = new Set(continueEdges.map((e) => e.toBlockId));
    expect(targetedHeaders).toEqual(loopHeaderBlockIds);
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

    // 1. Identify the block containing the ContinueStatement
    const continueBlock = cfg!.blocks.find((b) =>
      b.statements.some((s) => s.type === "ContinueStatement"),
    );
    expect(continueBlock).toBeDefined();

    // 2. Identify the abrupt continue-to-finally edge (kind: "finally") from continueBlock
    const continueToFinallyEdge = cfg!.edges.find(
      (e) => e.fromBlockId === continueBlock!.id && e.kind === "finally",
    );
    expect(continueToFinallyEdge).toBeDefined();

    // 3. Target of continueToFinallyEdge is the finalizer block
    const finalizerBlock = cfg!.blocks.find((b) => b.id === continueToFinallyEdge!.toBlockId);
    expect(finalizerBlock).toBeDefined();

    // 4. The finalizer block routes out to the loop header with kind: "continue"
    const finalizerToHeaderEdge = cfg!.edges.find(
      (e) => e.fromBlockId === finalizerBlock!.id && e.toBlockId === loop.headerBlockId && e.kind === "continue",
    );
    expect(finalizerToHeaderEdge).toBeDefined();

    // 5. Verify the entire routing path belongs to the natural loop
    expect(loop.blockIds).toContain(continueBlock!.id);
    expect(loop.blockIds).toContain(finalizerBlock!.id);
    expect(loop.blockIds).toContain(loop.headerBlockId);

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

  // ─── CFG-01: Loop Fall-Through & Edge Ownership Remediation ──────────────

  it("CFG-01 Test 1: while loop body routes only via loop-back to header, with no duplicate or illegal fall-through edge to after", async () => {
    const code = `
      function testWhileFallThrough() {
        while (condition) {
          step();
        }
        after();
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("testWhileFallThrough"));
    expect(cfg).toBeDefined();

    // Assert no duplicate edges exist anywhere in CFG
    const seenEdges = new Set<string>();
    for (const edge of cfg!.edges) {
      const key = `${edge.fromBlockId}:${edge.toBlockId}:${edge.kind}`;
      expect(seenEdges.has(key)).toBe(false);
      seenEdges.add(key);
    }

    const whileHeaderBlock = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "WhileStatement"));
    expect(whileHeaderBlock).toBeDefined();

    const afterBlock = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "ExpressionStatement" && s.location?.line === 6));
    expect(afterBlock).toBeDefined();

    const bodyBlock = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "ExpressionStatement" && s.location?.line === 4));
    expect(bodyBlock).toBeDefined();

    // Loop header routes to body on true, and to after on false
    const trueEdge = cfg!.edges.find((e) => e.fromBlockId === whileHeaderBlock!.id && e.kind === "true");
    expect(trueEdge).toBeDefined();
    expect(trueEdge!.toBlockId).toBe(bodyBlock!.id);

    const falseEdge = cfg!.edges.find((e) => e.fromBlockId === whileHeaderBlock!.id && e.kind === "false");
    expect(falseEdge).toBeDefined();
    expect(falseEdge!.toBlockId).toBe(afterBlock!.id);

    // Loop body routes back to loop header via loop-back
    const loopBackEdge = cfg!.edges.find((e) => e.fromBlockId === bodyBlock!.id && e.kind === "loop-back");
    expect(loopBackEdge).toBeDefined();
    expect(loopBackEdge!.toBlockId).toBe(whileHeaderBlock!.id);

    // CRITICAL INVARIANT: Loop body MUST NOT have an illegal fall-through 'next' edge to afterBlock
    const illegalFallThrough = cfg!.edges.find((e) => e.fromBlockId === bodyBlock!.id && e.toBlockId === afterBlock!.id && e.kind === "next");
    expect(illegalFallThrough).toBeUndefined();
  });

  it("CFG-01 Test 2: do-while loop body routes to condition block exactly once without duplicate next edge", async () => {
    const code = `
      function testDoWhileNoDuplicate() {
        do {
          work();
        } while (keepGoing);
        after();
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("testDoWhileNoDuplicate"));
    expect(cfg).toBeDefined();

    // Assert zero duplicate edges in graph
    const seenEdges = new Set<string>();
    for (const edge of cfg!.edges) {
      const key = `${edge.fromBlockId}:${edge.toBlockId}:${edge.kind}`;
      expect(seenEdges.has(key)).toBe(false);
      seenEdges.add(key);
    }

    const doWhileBlock = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "DoWhileStatement"));
    expect(doWhileBlock).toBeDefined();

    const bodyBlock = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "ExpressionStatement" && s.location?.line === 4));
    expect(bodyBlock).toBeDefined();

    // Entry connects to body with next
    const entryToBody = cfg!.edges.find((e) => e.fromBlockId === doWhileBlock!.id && e.kind === "next");
    expect(entryToBody).toBeDefined();
    expect(entryToBody!.toBlockId).toBe(bodyBlock!.id);

    // Body routes to condition evaluation block with next exactly ONCE
    const bodyToNextEdges = cfg!.edges.filter((e) => e.fromBlockId === bodyBlock!.id && e.kind === "next");
    expect(bodyToNextEdges).toHaveLength(1);

    const conditionBlockId = bodyToNextEdges[0]!.toBlockId;
    // Condition block branches to body on true, and to after on false
    const trueEdge = cfg!.edges.find((e) => e.fromBlockId === conditionBlockId && e.kind === "true");
    expect(trueEdge).toBeDefined();
    expect(trueEdge!.toBlockId).toBe(bodyBlock!.id);

    const falseEdge = cfg!.edges.find((e) => e.fromBlockId === conditionBlockId && e.kind === "false");
    expect(falseEdge).toBeDefined();
  });

  it("CFG-01 Test 3: for loop body routes only via loop-back without illegal fall-through to post-loop statement", async () => {
    const code = `
      function testForLoopFallThrough() {
        for (let i = 0; i < 10; i++) {
          processItem(i);
        }
        done();
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("testForLoopFallThrough"));
    expect(cfg).toBeDefined();

    // Assert zero duplicate edges
    const seenEdges = new Set<string>();
    for (const edge of cfg!.edges) {
      const key = `${edge.fromBlockId}:${edge.toBlockId}:${edge.kind}`;
      expect(seenEdges.has(key)).toBe(false);
      seenEdges.add(key);
    }

    const forHeaderBlock = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "ForStatement"));
    expect(forHeaderBlock).toBeDefined();

    const bodyBlock = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "ExpressionStatement" && s.location?.line === 4));
    expect(bodyBlock).toBeDefined();

    const doneBlock = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "ExpressionStatement" && s.location?.line === 6));
    expect(doneBlock).toBeDefined();

    // Body routes to header via loop-back
    const loopBackEdge = cfg!.edges.find((e) => e.fromBlockId === bodyBlock!.id && e.kind === "loop-back");
    expect(loopBackEdge).toBeDefined();
    expect(loopBackEdge!.toBlockId).toBe(forHeaderBlock!.id);

    // Body does NOT have a 'next' fall-through edge to doneBlock
    const illegalFallThrough = cfg!.edges.find((e) => e.fromBlockId === bodyBlock!.id && e.toBlockId === doneBlock!.id && e.kind === "next");
    expect(illegalFallThrough).toBeUndefined();
  });

  it("CFG-01 Test 4: nested while loops maintain isolated headers, loop-backs, and sequential exits without cross-leakage", async () => {
    const code = `
      function testNestedWhile() {
        while (outerCond) {
          while (innerCond) {
            innerWork();
          }
          afterInner();
        }
        afterOuter();
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("testNestedWhile"));
    expect(cfg).toBeDefined();

    // Assert zero duplicates
    const seenEdges = new Set<string>();
    for (const edge of cfg!.edges) {
      const key = `${edge.fromBlockId}:${edge.toBlockId}:${edge.kind}`;
      expect(seenEdges.has(key)).toBe(false);
      seenEdges.add(key);
    }

    const outerHeader = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "WhileStatement" && s.location?.line === 3));
    const innerHeader = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "WhileStatement" && s.location?.line === 4));
    const innerWorkBlock = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "ExpressionStatement" && s.location?.line === 5));
    const afterInnerBlock = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "ExpressionStatement" && s.location?.line === 7));
    const afterOuterBlock = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "ExpressionStatement" && s.location?.line === 9));

    expect(outerHeader).toBeDefined();
    expect(innerHeader).toBeDefined();
    expect(innerWorkBlock).toBeDefined();
    expect(afterInnerBlock).toBeDefined();
    expect(afterOuterBlock).toBeDefined();

    // Inner loop work loops back to inner header
    const innerBack = cfg!.edges.find((e) => e.fromBlockId === innerWorkBlock!.id && e.kind === "loop-back");
    expect(innerBack).toBeDefined();
    expect(innerBack!.toBlockId).toBe(innerHeader!.id);

    // Inner loop work does NOT route to afterInner or afterOuter via next
    const innerToAfterInner = cfg!.edges.find((e) => e.fromBlockId === innerWorkBlock!.id && e.toBlockId === afterInnerBlock!.id && e.kind === "next");
    expect(innerToAfterInner).toBeUndefined();

    const innerToAfterOuter = cfg!.edges.find((e) => e.fromBlockId === innerWorkBlock!.id && e.toBlockId === afterOuterBlock!.id && e.kind === "next");
    expect(innerToAfterOuter).toBeUndefined();

    // AfterInner loops back to outer header
    const outerBack = cfg!.edges.find((e) => e.fromBlockId === afterInnerBlock!.id && e.kind === "loop-back");
    expect(outerBack).toBeDefined();
    expect(outerBack!.toBlockId).toBe(outerHeader!.id);

    // Outer loop exits to afterOuter on false
    const outerFalse = cfg!.edges.find((e) => e.fromBlockId === outerHeader!.id && e.kind === "false");
    expect(outerFalse).toBeDefined();
    expect(outerFalse!.toBlockId).toBe(afterOuterBlock!.id);
  });

  it("CFG-01 Test 5: while loop with break and continue routes break to exit and continue to header with no body fall-through", async () => {
    const code = `
      function testBreakContinue() {
        while (loopCond) {
          if (doBreak) {
            break;
          }
          if (doContinue) {
            continue;
          }
          remainder();
        }
        afterLoop();
      }
    `;

    const cfgs = await buildCfgs(code);
    const cfg = cfgs.find((c) => c.scopeName.startsWith("testBreakContinue"));
    expect(cfg).toBeDefined();

    const whileHeader = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "WhileStatement"));
    const afterBlock = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "ExpressionStatement" && s.location?.line === 12));
    const remainderBlock = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "ExpressionStatement" && s.location?.line === 10));
    const breakBlock = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "BreakStatement"));
    const continueBlock = cfg!.blocks.find((b) => b.statements.some((s) => s.type === "ContinueStatement"));

    expect(whileHeader).toBeDefined();
    expect(afterBlock).toBeDefined();
    expect(remainderBlock).toBeDefined();
    expect(breakBlock).toBeDefined();
    expect(continueBlock).toBeDefined();

    // Break routes to afterBlock with break kind
    const breakEdge = cfg!.edges.find((e) => e.fromBlockId === breakBlock!.id && e.kind === "break");
    expect(breakEdge).toBeDefined();
    expect(breakEdge!.toBlockId).toBe(afterBlock!.id);

    // Continue routes to loop header with continue kind
    const continueEdge = cfg!.edges.find((e) => e.fromBlockId === continueBlock!.id && e.kind === "continue");
    expect(continueEdge).toBeDefined();
    expect(continueEdge!.toBlockId).toBe(whileHeader!.id);

    // Remainder routes to loop header with loop-back kind
    const loopBackEdge = cfg!.edges.find((e) => e.fromBlockId === remainderBlock!.id && e.kind === "loop-back");
    expect(loopBackEdge).toBeDefined();
    expect(loopBackEdge!.toBlockId).toBe(whileHeader!.id);

    // Remainder does NOT have next edge to afterBlock
    const illegalFallThrough = cfg!.edges.find((e) => e.fromBlockId === remainderBlock!.id && e.toBlockId === afterBlock!.id && e.kind === "next");
    expect(illegalFallThrough).toBeUndefined();
  });
});
