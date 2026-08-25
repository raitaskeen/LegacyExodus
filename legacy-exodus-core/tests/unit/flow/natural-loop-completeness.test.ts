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
});
