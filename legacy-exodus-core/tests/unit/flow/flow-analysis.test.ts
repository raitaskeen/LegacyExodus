import { describe, expect, test } from "bun:test";

import { DeterministicControlFlowGraphBuilder, DeterministicDataFlowGraphBuilder, DeterministicFlowAnalysisEngine } from "@flow/index";
import { DeterministicDependencyGraphBuilder } from "@graph/index";
import { JavaScriptParser } from "@parser/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

describe("control and data flow analysis", () => {
  test("builds deterministic branch, loop, dominator, reachability, and dead-code information", async (): Promise<void> => {
    const source = `
      let total = 0;
      if (true) { total = 1; } else { total = 2; }
      while (total < 3) { total = total + 1; continue; }
      return total;
      console.log("unreachable");
    `;
    const ast = (await new JavaScriptParser().parse({ file: { id: "flow", path: "src/flow.js", language: "javascript", size: source.length }, source })).result;
    const graph = new DeterministicControlFlowGraphBuilder().build(ast);

    expect(graph.edges.some((edge) => edge.kind === "true")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "false")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "loop-back")).toBe(true);
    expect(graph.dominators).toHaveLength(graph.blocks.length);
    expect(graph.unreachableBlockIds.length).toBeGreaterThan(0);
    expect(graph.deadCodeNodeIds.length).toBeGreaterThan(0);
    expect(Object.isFrozen(graph)).toBe(true);
  });

  test("builds deterministic definitions, uses, chains, lifetimes, and conservative constants", async (): Promise<void> => {
    const source = "const PORT = 3000; const id = PORT; console.log(id);";
    const ast = (await new JavaScriptParser().parse({ file: { id: "data", path: "src/data.js", language: "javascript", size: source.length }, source })).result;
    const graph = new DeterministicDataFlowGraphBuilder().build(ast);
    const port = graph.definitions.find((definition) => definition.name === "PORT");
    const id = graph.definitions.find((definition) => definition.name === "id");

    expect(port?.constantValue).toBe(3000);
    expect(graph.uses.some((use) => use.name === "PORT" && use.definitionId === port?.id)).toBe(true);
    expect(graph.uses.some((use) => use.name === "id" && use.definitionId === id?.id)).toBe(true);
    expect(graph.defUseChains.find((chain) => chain.definitionId === id?.id)?.useIds.length).toBeGreaterThan(0);
    expect(graph.lifetimes.find((lifetime) => lifetime.name === "id")?.declarationId).toBe(id?.id);
    expect(graph.taintFlows).toEqual([]);
    expect(Object.isFrozen(graph)).toBe(true);
  });

  test("creates independent module, function, arrow-function, and method CFGs", async (): Promise<void> => {
    const source = `
      function calculate(value) { if (value) return value; return 0; }
      const normalize = (input) => { return input; };
      class Catalog { load(id) { while (id) { break; } return id; } }
    `;
    const ast = (await new JavaScriptParser().parse({ file: { id: "scopes", path: "src/scopes.js", language: "javascript", size: source.length }, source })).result;
    const result = new DeterministicFlowAnalysisEngine().analyze([ast]);

    expect(result.controlFlowGraphs.map((graph) => graph.scopeName)).toEqual(expect.arrayContaining(["module", expect.stringMatching(/^calculate@/), expect.stringMatching(/^anonymous@/), expect.stringMatching(/^load@/)]));
    expect(result.controlFlowGraphs.filter((graph) => graph.scopeName !== "module").every((graph) => graph.blocks.length >= 2)).toBe(true);
    expect(result.controlFlowGraphs.map((graph) => graph.id)).toEqual([...result.controlFlowGraphs].map((graph) => graph.id).sort());
  });

  test("marks compile-time false branches and loops as unreachable", async (): Promise<void> => {
    const source = "if (false) { console.log('never'); } while (false) { console.log('also-never'); }";
    const ast = (await new JavaScriptParser().parse({ file: { id: "constants", path: "src/constants.js", language: "javascript", size: source.length }, source })).result;
    const graph = new DeterministicControlFlowGraphBuilder().build(ast);

    expect(graph.unreachableBlockIds.length).toBeGreaterThan(0);
    expect(graph.deadCodeNodeIds.length).toBeGreaterThan(0);
    expect(graph.edges.filter((edge) => edge.kind === "true")).toHaveLength(0);
  });

  test("uses a deterministic golden CFG for switch fall-through, default, and break", async (): Promise<void> => {
    const source = `switch (mode) { case "a": value = 1; case "b": value = 2; break; default: value = 3; }`;
    const ast = (await new JavaScriptParser().parse({ file: { id: "switch", path: "src/switch.js", language: "javascript", size: source.length }, source })).result;
    const builder = new DeterministicControlFlowGraphBuilder();
    const first = builder.build(ast);
    const second = builder.build(ast);

    expect(first.edges.filter((edge) => edge.kind === "case")).toHaveLength(3);
    expect(first.edges.filter((edge) => edge.kind === "break")).toHaveLength(1);
    expect(first.edges.filter((edge) => edge.kind === "next").length).toBeGreaterThan(1);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.state).toBe("RESOLVED");
  });

  test("selects the closest immediate dominator rather than an arbitrary ancestor", async (): Promise<void> => {
    const source = "if (condition) { work(); } else { recover(); }";
    const ast = (await new JavaScriptParser().parse({ file: { id: "dominators", path: "src/dominators.js", language: "javascript", size: source.length }, source })).result;
    const graph = new DeterministicControlFlowGraphBuilder().build(ast);
    const conditionBlock = graph.blocks.find((block) => block.statements.some((statement) => statement.type === "IfStatement"));
    const trueTarget = graph.edges.find((edge) => edge.fromBlockId === conditionBlock?.id && edge.kind === "true")?.toBlockId;

    expect(conditionBlock).toBeDefined();
    expect(graph.dominators.find((dominator) => dominator.blockId === trueTarget)?.immediateDominatorId).toBe(conditionBlock?.id);
  });

  test("resolves labeled break and continue to the declared outer loop topology", async (): Promise<void> => {
    const source = `
      outer: while (outerCondition) {
        while (innerCondition) { break outer; }
        continue outer;
      }
    `;
    const ast = (await new JavaScriptParser().parse({ file: { id: "labels", path: "src/labels.js", language: "javascript", size: source.length }, source })).result;
    const graph = new DeterministicControlFlowGraphBuilder().build(ast);
    const outerHeader = graph.blocks.find((block) => block.statements.some((statement) => statement.type === "LabeledStatement"));
    const outerAfter = graph.edges.find((edge) => edge.fromBlockId === outerHeader?.id && edge.kind === "false")?.toBlockId;
    const breakBlock = graph.blocks.find((block) => block.terminator === "BreakStatement");
    const continueBlock = graph.blocks.find((block) => block.terminator === "ContinueStatement");

    expect(outerHeader).toBeDefined();
    expect(graph.edges.find((edge) => edge.fromBlockId === breakBlock?.id && edge.kind === "break")?.toBlockId).toBe(outerAfter);
    expect(graph.edges.find((edge) => edge.fromBlockId === continueBlock?.id && edge.kind === "continue")?.toBlockId).toBe(outerHeader?.id);
    expect(JSON.stringify(graph)).toBe(JSON.stringify(new DeterministicControlFlowGraphBuilder().build(ast)));
  });

  test("routes normal try completion through finally exactly once before continuation", async (): Promise<void> => {
    const source = `try { work(); } finally { cleanup(); } after();`;
    const graph = await buildControlFlowGraph("try-normal", source);
    const tryBlock = findBlock(graph, "TryStatement");
    const tryBody = successor(graph, tryBlock.id, "next");
    const finalizer = successor(graph, tryBody, "finally");
    const continuation = successor(graph, finalizer, "next");

    expect(graph.blocks.find((block) => block.id === finalizer)?.statements.map((statement) => statement.type)).toEqual(["BlockStatement", "ExpressionStatement"]);
    expect(graph.blocks.find((block) => block.id === continuation)?.statements.map((statement) => statement.type)).toEqual(["ExpressionStatement"]);
    expect(graph.edges.some((edge) => edge.fromBlockId === tryBody && (edge.kind === "exception" || edge.kind === "throw"))).toBe(false);
    expect(graph.edges.some((edge) => edge.fromBlockId === finalizer && (edge.kind === "exception" || edge.kind === "throw"))).toBe(false);
    expect(graph.edges.filter((edge) => edge.toBlockId === finalizer && edge.kind === "finally")).toHaveLength(1);
  });

  test("consumes a try throw after normal catch completion and continues through finally", async (): Promise<void> => {
    const source = `try { throw err; } catch (error) { handle(error); } finally { cleanup(); } after();`;
    const graph = await buildControlFlowGraph("try-caught", source);
    const throwBlock = findBlock(graph, "ThrowStatement");
    const catchBlock = successor(graph, throwBlock.id, "throw");
    const finalizer = successor(graph, catchBlock, "finally");
    const continuation = successor(graph, finalizer, "next");

    expect(graph.blocks.find((block) => block.id === catchBlock)?.statements.map((statement) => statement.type)).toEqual(["ExpressionStatement"]);
    expect(graph.blocks.find((block) => block.id === continuation)?.statements.map((statement) => statement.type)).toEqual(["ExpressionStatement"]);
    expect(graph.edges.some((edge) => edge.fromBlockId === catchBlock && edge.kind === "throw")).toBe(false);
    expect(graph.edges.some((edge) => edge.fromBlockId === finalizer && edge.kind === "throw")).toBe(false);
  });

  test("routes a catch rethrow through finally to outer propagation without catch re-entry", async (): Promise<void> => {
    const source = `try { throw err1; } catch (error) { throw err2; } finally { cleanup(); }`;
    const graph = await buildControlFlowGraph("try-rethrow", source);
    const throwBlocks = graph.blocks.filter((block) => block.terminator === "ThrowStatement").sort((left, right) => (left.statements[0]?.location?.column ?? 0) - (right.statements[0]?.location?.column ?? 0));
    const tryThrow = throwBlocks[0];
    const catchThrow = throwBlocks[1];
    if (tryThrow === undefined || catchThrow === undefined) throw new Error("B1 fixture requires two throw blocks.");
    const catchBlock = successor(graph, tryThrow.id, "throw");
    const thrownFinalizer = successor(graph, catchThrow.id, "finally");
    const outerPropagation = successor(graph, thrownFinalizer, "throw");

    expect(catchBlock).not.toBe(thrownFinalizer);
    expect(outerPropagation).toBe(graph.exitBlockId);
    expect(graph.edges.some((edge) => edge.fromBlockId === catchThrow.id && edge.toBlockId === catchBlock)).toBe(false);
    expect(graph.edges.some((edge) => edge.fromBlockId === thrownFinalizer && edge.toBlockId === thrownFinalizer)).toBe(false);
    expect(graph.edges.filter((edge) => edge.toBlockId === thrownFinalizer && edge.kind === "finally")).toHaveLength(1);
  });

  test("routes a try return through finally to function exit without continuation", async (): Promise<void> => {
    const graph = await buildControlFlowGraph("return-try", `try { return 1; } finally { cleanup(); } after();`);
    const pendingReturn = returnBlockEnteredBy(graph, "next");
    if (pendingReturn === undefined) throw new Error("B2 fixture requires a pending return.");
    const finalizer = successor(graph, pendingReturn.id, "finally");

    expect(successor(graph, finalizer, "return")).toBe(graph.exitBlockId);
    expect(graph.edges.some((edge) => edge.fromBlockId === pendingReturn.id && edge.toBlockId === graph.exitBlockId && edge.kind === "return")).toBe(false);
    expect(graph.edges.some((edge) => edge.fromBlockId === finalizer && edge.kind === "next")).toBe(false);
    expect(JSON.stringify(graph)).toBe(JSON.stringify(await buildControlFlowGraph("return-try", `try { return 1; } finally { cleanup(); } after();`)));
  });

  test("routes a catch return through finally to function exit without continuation", async (): Promise<void> => {
    const graph = await buildControlFlowGraph("return-catch", `try { throw error; } catch (caught) { return 1; } finally { cleanup(); } after();`);
    const catchReturn = returnBlockEnteredBy(graph, "throw");
    if (catchReturn === undefined) throw new Error("B2 fixture requires a catch return.");
    const finalizer = successor(graph, catchReturn.id, "finally");

    expect(successor(graph, finalizer, "return")).toBe(graph.exitBlockId);
    expect(graph.edges.some((edge) => edge.fromBlockId === catchReturn.id && edge.toBlockId === graph.exitBlockId && edge.kind === "return")).toBe(false);
    expect(graph.edges.some((edge) => edge.fromBlockId === finalizer && edge.kind === "next")).toBe(false);
  });

  test("lets a finally return override the pending try return", async (): Promise<void> => {
    const graph = await buildControlFlowGraph("return-override", `try { return 1; } finally { return 2; } after();`);
    const pendingReturn = returnBlockEnteredBy(graph, "next");
    if (pendingReturn === undefined) throw new Error("B2 fixture requires a pending return.");
    const finalizer = successor(graph, pendingReturn.id, "finally");
    const finalizerReturn = graph.blocks.find((block) => block.id === finalizer);
    if (finalizerReturn === undefined) throw new Error("B2 fixture requires a finalizer return.");

    expect(finalizer).toBe(finalizerReturn.id);
    expect(successor(graph, finalizerReturn.id, "return")).toBe(graph.exitBlockId);
    expect(graph.edges.some((edge) => edge.fromBlockId === pendingReturn.id && edge.toBlockId === graph.exitBlockId && edge.kind === "return")).toBe(false);
    expect(graph.edges.some((edge) => edge.fromBlockId === finalizerReturn.id && edge.kind === "finally")).toBe(false);
  });

  test("lets a finally throw override the pending try return", async (): Promise<void> => {
    const graph = await buildControlFlowGraph("throw-override", `try { return 1; } finally { throw error; } after();`);
    const pendingReturn = returnBlockEnteredBy(graph, "next");
    if (pendingReturn === undefined) throw new Error("B2 fixture requires a pending return.");
    const finalizer = successor(graph, pendingReturn.id, "finally");
    const finalizerThrow = graph.blocks.find((block) => block.id === finalizer);
    if (finalizerThrow === undefined) throw new Error("B2 fixture requires a finalizer throw.");

    expect(finalizer).toBe(finalizerThrow.id);
    expect(finalizerThrow.terminator).toBe("ThrowStatement");
    expect(successor(graph, finalizerThrow.id, "throw")).toBe(graph.exitBlockId);
    expect(graph.edges.some((edge) => edge.fromBlockId === pendingReturn.id && edge.toBlockId === graph.exitBlockId && edge.kind === "return")).toBe(false);
    expect(graph.edges.some((edge) => edge.fromBlockId === finalizerThrow.id && edge.kind === "return")).toBe(false);
  });

  test("allows a finally return to override a catch-originating pending return", async (): Promise<void> => {
    const graph = await buildControlFlowGraph("catch-return-override", `try { throw error; } catch (caught) { return 1; } finally { return 2; }`);
    const catchReturn = returnBlockEnteredBy(graph, "throw");
    if (catchReturn === undefined) throw new Error("B2 fixture requires a catch return.");
    const finalizer = successor(graph, catchReturn.id, "finally");
    const finalizerReturn = graph.blocks.find((block) => block.id === finalizer);
    if (finalizerReturn === undefined) throw new Error("B2 fixture requires a finalizer return.");

    expect(finalizer).toBe(finalizerReturn.id);
    expect(successor(graph, finalizerReturn.id, "return")).toBe(graph.exitBlockId);
    expect(graph.edges.some((edge) => edge.fromBlockId === catchReturn.id && edge.toBlockId === graph.exitBlockId && edge.kind === "return")).toBe(false);
  });

  test("routes an unlabeled break through finally to the nearest loop exit", async (): Promise<void> => {
    const graph = await buildControlFlowGraph("break-finally", `while (active) { try { break; } finally { cleanup(); } skipped(); } afterLoop();`);
    const breakBlock = findBlock(graph, "BreakStatement");
    const loopHeader = findBlock(graph, "WhileStatement");
    const loopExit = successor(graph, loopHeader.id, "false");
    const finalizer = successor(graph, breakBlock.id, "finally");

    expect(successor(graph, finalizer, "break")).toBe(loopExit);
    expect(graph.edges.some((edge) => edge.fromBlockId === breakBlock.id && edge.toBlockId === loopExit && edge.kind === "break")).toBe(false);
    expect(graph.edges.some((edge) => edge.fromBlockId === finalizer && edge.kind === "next")).toBe(false);
    expect(graph.edges.some((edge) => edge.fromBlockId === finalizer && edge.toBlockId === finalizer)).toBe(false);
  });

  test("routes an unlabeled continue through finally to the nearest loop header", async (): Promise<void> => {
    const graph = await buildControlFlowGraph("continue-finally", `while (active) { try { continue; } finally { cleanup(); } skipped(); } afterLoop();`);
    const continueBlock = findBlock(graph, "ContinueStatement");
    const loopHeader = findBlock(graph, "WhileStatement");
    const finalizer = successor(graph, continueBlock.id, "finally");

    expect(successor(graph, finalizer, "continue")).toBe(loopHeader.id);
    expect(graph.edges.some((edge) => edge.fromBlockId === continueBlock.id && edge.toBlockId === loopHeader.id && edge.kind === "continue")).toBe(false);
    expect(graph.edges.some((edge) => edge.fromBlockId === finalizer && edge.kind === "next")).toBe(false);
    expect(graph.edges.some((edge) => edge.fromBlockId === finalizer && edge.toBlockId === finalizer)).toBe(false);
  });

  test("lets a finally return override a pending break without resuming the loop exit", async (): Promise<void> => {
    const graph = await buildControlFlowGraph("break-finally-return", `while (active) { try { break; } finally { return value; } } afterLoop();`);
    const breakBlock = findBlock(graph, "BreakStatement");
    const loopHeader = findBlock(graph, "WhileStatement");
    const loopExit = successor(graph, loopHeader.id, "false");
    const finalizer = successor(graph, breakBlock.id, "finally");

    expect(graph.blocks.find((block) => block.id === finalizer)?.terminator).toBe("ReturnStatement");
    expect(successor(graph, finalizer, "return")).toBe(graph.exitBlockId);
    expect(graph.edges.some((edge) => edge.fromBlockId === finalizer && edge.toBlockId === loopExit && edge.kind === "break")).toBe(false);
  });

  test("lets a finally throw override a pending break without resuming the loop exit", async (): Promise<void> => {
    const graph = await buildControlFlowGraph("break-finally-throw", `while (active) { try { break; } finally { throw error; } } afterLoop();`);
    const breakBlock = findBlock(graph, "BreakStatement");
    const loopHeader = findBlock(graph, "WhileStatement");
    const loopExit = successor(graph, loopHeader.id, "false");
    const finalizer = successor(graph, breakBlock.id, "finally");

    expect(graph.blocks.find((block) => block.id === finalizer)?.terminator).toBe("ThrowStatement");
    expect(successor(graph, finalizer, "throw")).toBe(graph.exitBlockId);
    expect(graph.edges.some((edge) => edge.fromBlockId === finalizer && edge.toBlockId === loopExit && edge.kind === "break")).toBe(false);
  });

  test("lets a finally return override a pending continue without resuming the loop header", async (): Promise<void> => {
    const graph = await buildControlFlowGraph("continue-finally-return", `while (active) { try { continue; } finally { return value; } } afterLoop();`);
    const continueBlock = findBlock(graph, "ContinueStatement");
    const loopHeader = findBlock(graph, "WhileStatement");
    const finalizer = successor(graph, continueBlock.id, "finally");

    expect(graph.blocks.find((block) => block.id === finalizer)?.terminator).toBe("ReturnStatement");
    expect(successor(graph, finalizer, "return")).toBe(graph.exitBlockId);
    expect(graph.edges.some((edge) => edge.fromBlockId === finalizer && edge.toBlockId === loopHeader.id && edge.kind === "continue")).toBe(false);
  });

  test("lets a finally throw override a pending continue without resuming the loop header", async (): Promise<void> => {
    const graph = await buildControlFlowGraph("continue-finally-throw", `while (active) { try { continue; } finally { throw error; } } afterLoop();`);
    const continueBlock = findBlock(graph, "ContinueStatement");
    const loopHeader = findBlock(graph, "WhileStatement");
    const finalizer = successor(graph, continueBlock.id, "finally");

    expect(graph.blocks.find((block) => block.id === finalizer)?.terminator).toBe("ThrowStatement");
    expect(successor(graph, finalizer, "throw")).toBe(graph.exitBlockId);
    expect(graph.edges.some((edge) => edge.fromBlockId === finalizer && edge.toBlockId === loopHeader.id && edge.kind === "continue")).toBe(false);
  });

  test("preserves nearest nested-loop targets after a finally completion", async (): Promise<void> => {
    const breakGraph = await buildControlFlowGraph("nested-break-finally", `while (outer) { while (inner) { try { break; } finally { cleanup(); } } }`);
    const breakHeaders = breakGraph.blocks.filter((block) => block.statements.some((statement) => statement.type === "WhileStatement")).sort((left, right) => (left.statements[0]?.location?.column ?? 0) - (right.statements[0]?.location?.column ?? 0));
    const innerBreakHeader = breakHeaders[1];
    if (innerBreakHeader === undefined) throw new Error("B3 fixture requires an inner loop.");
    const breakBlock = findBlock(breakGraph, "BreakStatement");
    expect(successor(breakGraph, successor(breakGraph, breakBlock.id, "finally"), "break")).toBe(successor(breakGraph, innerBreakHeader.id, "false"));

    const continueGraph = await buildControlFlowGraph("nested-continue-finally", `while (outer) { while (inner) { try { continue; } finally { cleanup(); } } }`);
    const continueHeaders = continueGraph.blocks.filter((block) => block.statements.some((statement) => statement.type === "WhileStatement")).sort((left, right) => (left.statements[0]?.location?.column ?? 0) - (right.statements[0]?.location?.column ?? 0));
    const innerContinueHeader = continueHeaders[1];
    if (innerContinueHeader === undefined) throw new Error("B3 fixture requires an inner loop.");
    const continueBlock = findBlock(continueGraph, "ContinueStatement");
    expect(successor(continueGraph, successor(continueGraph, continueBlock.id, "finally"), "continue")).toBe(innerContinueHeader.id);
  });

  test("routes labeled break and continue through finally to their declared outer loop targets", async (): Promise<void> => {
    const breakGraph = await buildControlFlowGraph("labeled-break-finally", `
      outer: while (outerCondition) {
        while (innerCondition) { try { break outer; } finally { cleanup(); } }
      }
      afterOuter();
    `);
    const breakHeaders = loopHeaders(breakGraph);
    const outerBreakHeader = breakHeaders[0];
    const innerBreakHeader = breakHeaders[1];
    if (outerBreakHeader === undefined || innerBreakHeader === undefined) throw new Error("B4 fixture requires nested loops.");
    const breakBlock = findBlock(breakGraph, "BreakStatement");
    const breakFinalizer = successor(breakGraph, breakBlock.id, "finally");
    const outerExit = successor(breakGraph, outerBreakHeader.id, "false");
    const innerExit = successor(breakGraph, innerBreakHeader.id, "false");

    expect(successor(breakGraph, breakFinalizer, "break")).toBe(outerExit);
    expect(successor(breakGraph, breakFinalizer, "break")).not.toBe(innerExit);
    expect(breakGraph.edges.some((edge) => edge.fromBlockId === breakBlock.id && edge.toBlockId === outerExit && edge.kind === "break")).toBe(false);
    expect(breakGraph.edges.some((edge) => edge.fromBlockId === breakFinalizer && edge.toBlockId === breakFinalizer)).toBe(false);
    expect(JSON.stringify(breakGraph)).toBe(JSON.stringify(await buildControlFlowGraph("labeled-break-finally", `
      outer: while (outerCondition) {
        while (innerCondition) { try { break outer; } finally { cleanup(); } }
      }
      afterOuter();
    `)));

    const continueGraph = await buildControlFlowGraph("labeled-continue-finally", `
      outer: while (outerCondition) {
        while (innerCondition) { try { continue outer; } finally { cleanup(); } }
      }
    `);
    const continueHeaders = loopHeaders(continueGraph);
    const outerContinueHeader = continueHeaders[0];
    const innerContinueHeader = continueHeaders[1];
    if (outerContinueHeader === undefined || innerContinueHeader === undefined) throw new Error("B4 fixture requires nested loops.");
    const continueBlock = findBlock(continueGraph, "ContinueStatement");
    const continueFinalizer = successor(continueGraph, continueBlock.id, "finally");

    expect(successor(continueGraph, continueFinalizer, "continue")).toBe(outerContinueHeader.id);
    expect(successor(continueGraph, continueFinalizer, "continue")).not.toBe(innerContinueHeader.id);
    expect(continueGraph.edges.some((edge) => edge.fromBlockId === continueBlock.id && edge.toBlockId === outerContinueHeader.id && edge.kind === "continue")).toBe(false);
  });

  test("preserves exact middle and outer label targets through finally", async (): Promise<void> => {
    const breakGraph = await buildControlFlowGraph("middle-break-finally", `
      outer: while (outerCondition) {
        middle: while (middleCondition) {
          inner: while (innerCondition) { try { break middle; } finally { cleanup(); } }
        }
      }
    `);
    const breakHeaders = loopHeaders(breakGraph);
    const middleHeader = breakHeaders[1];
    if (middleHeader === undefined) throw new Error("B4 fixture requires a middle loop.");
    const breakBlock = findBlock(breakGraph, "BreakStatement");
    expect(successor(breakGraph, successor(breakGraph, breakBlock.id, "finally"), "break")).toBe(successor(breakGraph, middleHeader.id, "false"));

    const continueGraph = await buildControlFlowGraph("outer-continue-finally", `
      outer: while (outerCondition) {
        middle: while (middleCondition) {
          inner: while (innerCondition) { try { continue outer; } finally { cleanup(); } }
        }
      }
    `);
    const outerHeader = loopHeaders(continueGraph)[0];
    if (outerHeader === undefined) throw new Error("B4 fixture requires an outer loop.");
    const continueBlock = findBlock(continueGraph, "ContinueStatement");
    expect(successor(continueGraph, successor(continueGraph, continueBlock.id, "finally"), "continue")).toBe(outerHeader.id);
  });

  test("lets finalizer return and throw override pending labeled transfers", async (): Promise<void> => {
    const breakReturnGraph = await buildControlFlowGraph("labeled-break-return", `outer: while (condition) { try { break outer; } finally { return value; } }`);
    const breakReturn = findBlock(breakReturnGraph, "BreakStatement");
    const breakReturnFinalizer = successor(breakReturnGraph, breakReturn.id, "finally");
    expect(successor(breakReturnGraph, breakReturnFinalizer, "return")).toBe(breakReturnGraph.exitBlockId);
    expect(breakReturnGraph.edges.some((edge) => edge.fromBlockId === breakReturnFinalizer && edge.kind === "break")).toBe(false);

    const breakThrowGraph = await buildControlFlowGraph("labeled-break-throw", `outer: while (condition) { try { break outer; } finally { throw error; } }`);
    const breakThrow = findBlock(breakThrowGraph, "BreakStatement");
    const breakThrowFinalizer = successor(breakThrowGraph, breakThrow.id, "finally");
    expect(successor(breakThrowGraph, breakThrowFinalizer, "throw")).toBe(breakThrowGraph.exitBlockId);
    expect(breakThrowGraph.edges.some((edge) => edge.fromBlockId === breakThrowFinalizer && edge.kind === "break")).toBe(false);

    const continueReturnGraph = await buildControlFlowGraph("labeled-continue-return", `outer: while (condition) { try { continue outer; } finally { return value; } }`);
    const continueReturn = findBlock(continueReturnGraph, "ContinueStatement");
    const continueReturnFinalizer = successor(continueReturnGraph, continueReturn.id, "finally");
    expect(successor(continueReturnGraph, continueReturnFinalizer, "return")).toBe(continueReturnGraph.exitBlockId);
    expect(continueReturnGraph.edges.some((edge) => edge.fromBlockId === continueReturnFinalizer && edge.kind === "continue")).toBe(false);

    const continueThrowGraph = await buildControlFlowGraph("labeled-continue-throw", `outer: while (condition) { try { continue outer; } finally { throw error; } }`);
    const continueThrow = findBlock(continueThrowGraph, "ContinueStatement");
    const continueThrowFinalizer = successor(continueThrowGraph, continueThrow.id, "finally");
    expect(successor(continueThrowGraph, continueThrowFinalizer, "throw")).toBe(continueThrowGraph.exitBlockId);
    expect(continueThrowGraph.edges.some((edge) => edge.fromBlockId === continueThrowFinalizer && edge.kind === "continue")).toBe(false);
  });

  test("keeps labeled break targets ahead of a nearer switch after finally", async (): Promise<void> => {
    const graph = await buildControlFlowGraph("labeled-switch-finally", `outer: { switch (kind) { case 1: try { break outer; } finally { cleanup(); } } } afterOuter();`);
    const breakBlock = findBlock(graph, "BreakStatement");
    const finalizer = successor(graph, breakBlock.id, "finally");
    const switchBlock = findBlock(graph, "SwitchStatement");
    const switchCase = successor(graph, switchBlock.id, "case");
    const switchExit = successor(graph, switchCase, "next");

    expect(successor(graph, finalizer, "break")).not.toBe(switchExit);
    expect(graph.edges.some((edge) => edge.fromBlockId === breakBlock.id && edge.toBlockId === switchExit && edge.kind === "break")).toBe(false);
  });

  test("preserves catch rethrow routing while labeled finalizer targets are available", async (): Promise<void> => {
    const graph = await buildControlFlowGraph("labeled-catch-rethrow", `outer: while (condition) { try { throw first; } catch (error) { throw second; } finally { cleanup(); } }`);
    const throws = graph.blocks.filter((block) => block.terminator === "ThrowStatement").sort((left, right) => (left.statements[0]?.location?.column ?? 0) - (right.statements[0]?.location?.column ?? 0));
    const tryThrow = throws[0];
    const catchThrow = throws[1];
    if (tryThrow === undefined || catchThrow === undefined) throw new Error("B4 fixture requires two throw blocks.");
    const catchBlock = successor(graph, tryThrow.id, "throw");
    const finalizer = successor(graph, catchThrow.id, "finally");

    expect(successor(graph, finalizer, "throw")).toBe(graph.exitBlockId);
    expect(graph.edges.some((edge) => edge.fromBlockId === catchThrow.id && edge.toBlockId === catchBlock)).toBe(false);
    expect(graph.edges.some((edge) => edge.fromBlockId === finalizer && edge.toBlockId === finalizer)).toBe(false);
  });

  test("unwinds normal nested finalizers before continuing outer execution", async (): Promise<void> => {
    const graph = await buildControlFlowGraph("nested-normal-finally", `try { try { work(); } finally { innerCleanup(); } afterInner(); } finally { outerCleanup(); } afterOuter();`);
    const innerTry = tryStatementBlocks(graph)[1];
    if (innerTry === undefined) throw new Error("B5 fixture requires an inner try block.");
    const workBlock = successor(graph, innerTry.id, "next");
    const innerFinalizer = successor(graph, workBlock, "finally");
    const afterInner = successor(graph, innerFinalizer, "next");
    const outerFinalizer = successor(graph, afterInner, "finally");
    const afterOuter = successor(graph, outerFinalizer, "next");

    expect(innerFinalizer).not.toBe(outerFinalizer);
    expect(graph.blocks.find((block) => block.id === afterInner)?.statements.map((statement) => statement.type)).toEqual(["ExpressionStatement"]);
    expect(graph.blocks.find((block) => block.id === afterOuter)?.statements.map((statement) => statement.type)).toEqual(["ExpressionStatement"]);
    expect(graph.edges.some((edge) => edge.fromBlockId === workBlock && edge.toBlockId === outerFinalizer && edge.kind === "finally")).toBe(false);
    expect(JSON.stringify(graph)).toBe(JSON.stringify(await buildControlFlowGraph("nested-normal-finally", `try { try { work(); } finally { innerCleanup(); } afterInner(); } finally { outerCleanup(); } afterOuter();`)));
  });

  test("unwinds return and throw completions from inner to outer finalizers", async (): Promise<void> => {
    const returnGraph = await buildControlFlowGraph("nested-return-finally", `try { try { return value; } finally { innerCleanup(); } } finally { outerCleanup(); }`);
    const pendingReturn = returnBlockEnteredBy(returnGraph, "next");
    if (pendingReturn === undefined) throw new Error("B5 fixture requires a pending return.");
    const innerFinalizer = successor(returnGraph, pendingReturn.id, "finally");
    const outerFinalizer = successor(returnGraph, innerFinalizer, "finally");
    expect(successor(returnGraph, outerFinalizer, "return")).toBe(returnGraph.exitBlockId);
    expect(returnGraph.edges.some((edge) => edge.fromBlockId === pendingReturn.id && edge.toBlockId === outerFinalizer)).toBe(false);

    const throwGraph = await buildControlFlowGraph("nested-throw-finally", `try { try { throw error; } finally { innerCleanup(); } } finally { outerCleanup(); }`);
    const throwBlock = findBlock(throwGraph, "ThrowStatement");
    const thrownInnerFinalizer = successor(throwGraph, throwBlock.id, "finally");
    const thrownOuterFinalizer = successor(throwGraph, thrownInnerFinalizer, "finally");
    expect(successor(throwGraph, thrownOuterFinalizer, "throw")).toBe(throwGraph.exitBlockId);
    expect(throwGraph.edges.some((edge) => edge.fromBlockId === throwBlock.id && edge.toBlockId === thrownOuterFinalizer)).toBe(false);
  });

  test("propagates inner and outer finalizer overrides through nested unwinding", async (): Promise<void> => {
    const innerReturnGraph = await buildControlFlowGraph("nested-inner-return", `try { try { return one; } finally { return two; } } finally { outerCleanup(); }`);
    const pendingReturn = returnBlockEnteredBy(innerReturnGraph, "next");
    if (pendingReturn === undefined) throw new Error("B5 fixture requires a pending return.");
    const innerReturn = successor(innerReturnGraph, pendingReturn.id, "finally");
    const outerFinalizer = successor(innerReturnGraph, innerReturn, "finally");
    expect(innerReturnGraph.blocks.find((block) => block.id === innerReturn)?.terminator).toBe("ReturnStatement");
    expect(successor(innerReturnGraph, outerFinalizer, "return")).toBe(innerReturnGraph.exitBlockId);

    const innerThrowGraph = await buildControlFlowGraph("nested-inner-throw", `try { try { return one; } finally { throw error; } } finally { outerCleanup(); }`);
    const throwReturn = returnBlockEnteredBy(innerThrowGraph, "next");
    if (throwReturn === undefined) throw new Error("B5 fixture requires a pending return.");
    const innerThrow = successor(innerThrowGraph, throwReturn.id, "finally");
    const thrownOuterFinalizer = successor(innerThrowGraph, innerThrow, "finally");
    expect(innerThrowGraph.blocks.find((block) => block.id === innerThrow)?.terminator).toBe("ThrowStatement");
    expect(successor(innerThrowGraph, thrownOuterFinalizer, "throw")).toBe(innerThrowGraph.exitBlockId);

    const outerOverrideGraph = await buildControlFlowGraph("nested-outer-return", `try { try { return one; } finally { return two; } } finally { return three; }`);
    const originalReturn = returnBlockEnteredBy(outerOverrideGraph, "next");
    if (originalReturn === undefined) throw new Error("B5 fixture requires a pending return.");
    const innerOverride = successor(outerOverrideGraph, originalReturn.id, "finally");
    const outerOverride = successor(outerOverrideGraph, innerOverride, "finally");
    expect(outerOverrideGraph.blocks.find((block) => block.id === outerOverride)?.terminator).toBe("ReturnStatement");
    expect(successor(outerOverrideGraph, outerOverride, "return")).toBe(outerOverrideGraph.exitBlockId);
    expect(outerOverrideGraph.edges.some((edge) => edge.fromBlockId === innerOverride && edge.kind === "return")).toBe(false);
  });

  test("routes nested exceptions, break, continue, and labels through every active finalizer", async (): Promise<void> => {
    const catchGraph = await buildControlFlowGraph("nested-outer-catch", `try { try { throw error; } finally { innerCleanup(); } } catch (caught) { handle(caught); }`);
    const tryThrow = findBlock(catchGraph, "ThrowStatement");
    const innerFinalizer = successor(catchGraph, tryThrow.id, "finally");
    const outerCatch = successor(catchGraph, innerFinalizer, "throw");
    expect(catchGraph.blocks.find((block) => block.id === outerCatch)?.statements.map((statement) => statement.type)).toEqual(["ExpressionStatement"]);

    const rethrowGraph = await buildControlFlowGraph("nested-rethrow-unwind", `try { try { throw first; } catch (caught) { throw second; } finally { innerCleanup(); } } finally { outerCleanup(); }`);
    const rethrows = rethrowGraph.blocks.filter((block) => block.terminator === "ThrowStatement").sort((left, right) => (left.statements[0]?.location?.column ?? 0) - (right.statements[0]?.location?.column ?? 0));
    const catchRethrow = rethrows[1];
    if (catchRethrow === undefined) throw new Error("B5 fixture requires a catch rethrow.");
    const rethrowInnerFinalizer = successor(rethrowGraph, catchRethrow.id, "finally");
    const rethrowOuterFinalizer = successor(rethrowGraph, rethrowInnerFinalizer, "finally");
    expect(successor(rethrowGraph, rethrowOuterFinalizer, "throw")).toBe(rethrowGraph.exitBlockId);

    const breakGraph = await buildControlFlowGraph("nested-break-unwind", `outer: while (condition) { try { try { break outer; } finally { innerCleanup(); } } finally { outerCleanup(); } unreachableAfterBreak(); }`);
    const breakBlock = findBlock(breakGraph, "BreakStatement");
    const innerBreakFinalizer = successor(breakGraph, breakBlock.id, "finally");
    const outerBreakFinalizer = successor(breakGraph, innerBreakFinalizer, "finally");
    const loopHeader = findBlock(breakGraph, "WhileStatement");
    expect(successor(breakGraph, outerBreakFinalizer, "break")).toBe(successor(breakGraph, loopHeader.id, "false"));

    const continueGraph = await buildControlFlowGraph("nested-continue-unwind", `outer: while (condition) { try { try { continue outer; } finally { innerCleanup(); } } finally { outerCleanup(); } }`);
    const continueBlock = findBlock(continueGraph, "ContinueStatement");
    const innerContinueFinalizer = successor(continueGraph, continueBlock.id, "finally");
    const outerContinueFinalizer = successor(continueGraph, innerContinueFinalizer, "finally");
    const outerHeader = loopHeaders(continueGraph)[0];
    if (outerHeader === undefined) throw new Error("B5 fixture requires an outer loop.");
    expect(successor(continueGraph, outerContinueFinalizer, "continue")).toBe(outerHeader.id);
    expect(continueGraph.edges.some((edge) => edge.fromBlockId === continueBlock.id && edge.toBlockId === outerHeader.id && edge.kind === "continue")).toBe(false);
  });

  test("resolves lexical shadowing and reports deterministic taint source-to-sink paths", async (): Promise<void> => {
    const source = `
      const value = 1;
      function render(value) { return value; }
      const input = req.query;
      const alias = input;
      child_process.exec(alias);
      const clean = sanitize(alias);
      child_process.exec(clean);
      user.name = alias;
    `;
    const ast = (await new JavaScriptParser().parse({ file: { id: "scope", path: "src/scope.js", language: "javascript", size: source.length }, source })).result;
    const graph = new DeterministicDataFlowGraphBuilder().build(ast);
    const values = graph.definitions.filter((definition) => definition.name === "value");

    expect(values).toHaveLength(2);
    expect(graph.uses.filter((use) => use.name === "value").map((use) => use.definitionId)).toEqual([values[1]?.id]);
    expect(graph.definitions.some((definition) => definition.name === "user.name" && definition.kind === "assignment")).toBe(true);
    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
    expect(graph.state).toBe("INFERRED");
  });

  test("connects direct arguments, parameters, returns, and receiving variables", async (): Promise<void> => {
    const graph = await buildDataFlowGraph("interprocedural-direct", `
      function add(x) { return x + 1; }
      const a = value;
      const b = add(a);
    `);
    const a = definition(graph, "a", "declaration");
    const parameter = definition(graph, "x", "parameter");
    const returned = definition(graph, "add:return", "return");
    const b = definition(graph, "b", "declaration");

    expect(flowExists(graph, "argument-to-parameter", a.id, parameter.id)).toBe(true);
    expect(flowExists(graph, "return-value", parameter.id, returned.id)).toBe(true);
    expect(flowExists(graph, "return-to-receiver", returned.id, b.id)).toBe(true);
    expect(JSON.stringify(graph)).toBe(JSON.stringify(await buildDataFlowGraph("interprocedural-direct", `
      function add(x) { return x + 1; }
      const a = value;
      const b = add(a);
    `)));
  });

  test("maps arguments positionally and avoids irrelevant parameter flows", async (): Promise<void> => {
    const graph = await buildDataFlowGraph("interprocedural-parameters", `
      function choose(first, second) { return first; }
      const left = inputLeft;
      const right = inputRight;
      const result = choose(left, right);
    `);
    const left = definition(graph, "left", "declaration");
    const right = definition(graph, "right", "declaration");
    const first = definition(graph, "first", "parameter");
    const second = definition(graph, "second", "parameter");
    const returned = definition(graph, "choose:return", "return");

    expect(flowExists(graph, "argument-to-parameter", left.id, first.id)).toBe(true);
    expect(flowExists(graph, "argument-to-parameter", right.id, second.id)).toBe(true);
    expect(flowExists(graph, "argument-to-parameter", left.id, second.id)).toBe(false);
    expect(flowExists(graph, "argument-to-parameter", right.id, first.id)).toBe(false);
    expect(flowExists(graph, "return-value", first.id, returned.id)).toBe(true);
    expect(flowExists(graph, "return-value", second.id, returned.id)).toBe(false);
  });

  test("preserves alias, nested-call, method, and shadowed parameter transfers", async (): Promise<void> => {
    const graph = await buildDataFlowGraph("interprocedural-composed", `
      const value = outer;
      function identity(value) { const alias = value; return alias; }
      function inner(x) { return x; }
      function outer(y) { return inner(y); }
      class Service { transform(input) { return input; } }
      const input = requestValue;
      const aliasOutput = identity(input);
      const nestedOutput = outer(input);
      const methodOutput = service.transform(input);
    `);
    const input = definition(graph, "input", "declaration");
    const identityParameter = definition(graph, "value", "parameter");
    const outerParameter = definition(graph, "y", "parameter");
    const innerParameter = definition(graph, "x", "parameter");
    const methodParameter = definition(graph, "input", "parameter");
    const alias = definition(graph, "alias", "declaration");
    const identityReturn = definition(graph, "identity:return", "return");
    const outerReturn = definition(graph, "outer:return", "return");

    expect(flowExists(graph, "argument-to-parameter", input.id, identityParameter.id)).toBe(true);
    expect(graph.uses.some((use) => use.name === "value" && use.definitionId === identityParameter.id)).toBe(true);
    expect(flowExists(graph, "return-value", alias.id, identityReturn.id)).toBe(true);
    expect(flowExists(graph, "argument-to-parameter", outerParameter.id, innerParameter.id)).toBe(true);
    expect(graph.interproceduralFlows.some((flow) => flow.kind === "return-to-receiver" && flow.targetDefinitionId === outerReturn.id)).toBe(true);
    expect(flowExists(graph, "argument-to-parameter", input.id, methodParameter.id)).toBe(true);
  });

  test("does not fabricate cross-function data flow for unresolved dynamic calls", async (): Promise<void> => {
    const graph = await buildDataFlowGraph("interprocedural-unresolved", `
      const input = userValue;
      const result = fn(input);
      const dynamic = object[userControlledName](input);
    `);
    const input = definition(graph, "input", "declaration");

    expect(graph.interproceduralFlows).toHaveLength(0);
    expect(graph.interproceduralFlows.some((flow) => flow.sourceDefinitionId === input.id)).toBe(false);
  });

  test("keeps closure captures lexical and does not invent an unresolved closure invocation", async (): Promise<void> => {
    const graph = await buildDataFlowGraph("interprocedural-closure", `
      function outer(captured) {
        return function inner() { return captured; };
      }
      const input = sourceValue;
      const factory = outer(input);
    `);
    const captured = definition(graph, "captured", "parameter");

    expect(graph.uses.some((use) => use.name === "captured" && use.definitionId === captured.id)).toBe(true);
    expect(graph.interproceduralFlows.some((flow) => flow.kind === "argument-to-parameter" && flow.targetDefinitionId === captured.id)).toBe(true);
    expect(graph.interproceduralFlows.filter((flow) => flow.kind === "return-to-receiver")).toHaveLength(1);
  });

  test("propagates direct local taint through each proven assignment to its sink", async (): Promise<void> => {
    const graph = await buildDataFlowGraph("taint-local", `const a = req.body.name; const b = a; const c = b; child_process.exec(c);`);
    const a = definition(graph, "a", "declaration");
    const b = definition(graph, "b", "declaration");
    const c = definition(graph, "c", "declaration");
    const flow = taintFlowTo(graph, "child_process.exec");

    expect(flow.path.slice(1)).toEqual([a.id, b.id, c.id, "child_process.exec"]);
    expect(flow.path[0]).toBe(flow.sourceId);
    expect(graph.taintFlows).toHaveLength(1);
  });

  test("propagates taint through direct and nested resolved function returns", async (): Promise<void> => {
    const direct = await buildDataFlowGraph("taint-direct-call", `function normalize(value) { return value.trim(); } const name = req.body.name; const result = normalize(name); child_process.exec(result);`);
    const name = definition(direct, "name", "declaration");
    const value = definition(direct, "value", "parameter");
    const returned = definition(direct, "normalize:return", "return");
    const result = definition(direct, "result", "declaration");
    expect(taintFlowTo(direct, "child_process.exec").path.slice(1)).toEqual([name.id, value.id, returned.id, result.id, "child_process.exec"]);

    const nested = await buildDataFlowGraph("taint-nested-call", `function inner(value) { return value; } function outer(input) { return inner(input); } const result = outer(req.body.name); child_process.exec(result);`);
    const outerInput = definition(nested, "input", "parameter");
    const innerValue = definition(nested, "value", "parameter");
    const innerReturn = definition(nested, "inner:return", "return");
    const outerReturn = definition(nested, "outer:return", "return");
    const nestedResult = definition(nested, "result", "declaration");
    expect(taintFlowTo(nested, "child_process.exec").path.slice(1)).toEqual([outerInput.id, innerValue.id, innerReturn.id, outerReturn.id, nestedResult.id, "child_process.exec"]);
  });

  test("stops recognized sanitizers while retaining non-sanitized proven paths", async (): Promise<void> => {
    const sanitized = await buildDataFlowGraph("taint-sanitized", `const input = req.body.name; const clean = sanitize(input); child_process.exec(clean);`);
    expect(sanitized.taintFlows).toEqual([]);

    const acrossCall = await buildDataFlowGraph("taint-sanitized-call", `function send(value) { return value; } const input = req.body.name; const clean = sanitize(input); const output = send(clean); child_process.exec(output);`);
    expect(acrossCall.taintFlows).toEqual([]);

    const unrecognized = await buildDataFlowGraph("taint-unrecognized", `const input = req.body.name; const output = unknownTransform(input); child_process.exec(output);`);
    expect(unrecognized.taintFlows).toEqual([]);
  });

  test("tracks supported property paths and separate source and sink provenance", async (): Promise<void> => {
    const property = await buildDataFlowGraph("taint-property", `const user = {}; user.name = req.body.name; child_process.exec(user.name);`);
    const userName = definition(property, "user.name", "assignment");
    expect(taintFlowTo(property, "child_process.exec").path.slice(1)).toEqual([userName.id, "child_process.exec"]);

    const multiple = await buildDataFlowGraph("taint-multiple", `const body = req.body.name; const query = req.query.id; child_process.exec(body); child_process.exec(query);`);
    expect(multiple.taintFlows).toHaveLength(2);
    expect(new Set(multiple.taintFlows.map((flow) => flow.sourceId)).size).toBe(2);
    expect(new Set(multiple.taintFlows.map((flow) => flow.sinkId)).size).toBe(2);
  });

  test("remains conservative for branch-local and dynamic call results", async (): Promise<void> => {
    const branch = await buildDataFlowGraph("taint-branch", `const input = req.body.name; let value; if (condition) { value = input; } child_process.exec(value);`);
    expect(branch.taintFlows).toEqual([]);

    const dynamic = await buildDataFlowGraph("taint-dynamic", `const input = req.body.name; const result = object[userControlledName](input); child_process.exec(result);`);
    expect(dynamic.taintFlows).toEqual([]);
    expect(JSON.stringify(dynamic)).toBe(JSON.stringify(await buildDataFlowGraph("taint-dynamic", `const input = req.body.name; const result = object[userControlledName](input); child_process.exec(result);`)));
  });

  test("uses the proven semantic function target and canonical call id for interprocedural flow", async (): Promise<void> => {
    const source = "function process(value) { return value; } const input = sourceValue; const result = process(input);";
    const { graph, semantic } = await buildResolvedDataFlow("semantic-function", source);
    const call = semantic.calls.find((candidate) => candidate.calleeName === "process");
    const input = definition(graph, "input", "declaration");
    const parameter = definition(graph, "value", "parameter");

    expect(call?.resolutionState).toBe("RESOLVED");
    expect(flowExists(graph, "argument-to-parameter", input.id, parameter.id)).toBe(true);
    expect(graph.interproceduralFlows.find((flow) => flow.kind === "argument-to-parameter")?.callId).toBe(call?.id);
  });

  test("uses a proven class method target for interprocedural flow", async (): Promise<void> => {
    const source = "class Service { transform(value) { return value; } } const service = new Service(); const input = sourceValue; const result = service.transform(input);";
    const { graph, semantic } = await buildResolvedDataFlow("semantic-method", source);
    const call = semantic.calls.find((candidate) => candidate.calleeName === "service.transform");
    const input = definition(graph, "input", "declaration");
    const parameter = definition(graph, "value", "parameter");

    expect(call?.resolutionState).toBe("RESOLVED");
    expect(flowExists(graph, "argument-to-parameter", input.id, parameter.id)).toBe(true);
    expect(graph.interproceduralFlows.some((flow) => flow.callId === call?.id && flow.kind === "return-to-receiver")).toBe(true);
  });

  test("does not create DFG transfers for an unresolved receiver", async (): Promise<void> => {
    const { graph, semantic } = await buildResolvedDataFlow("semantic-unknown-receiver", "const input = sourceValue; const object = unknownFactory(); const result = object.handle(input);");

    expect(semantic.calls.find((call) => call.calleeName === "object.handle")?.resolutionState).toBe("UNRESOLVED");
    expect(graph.interproceduralFlows).toEqual([]);
  });

  test("does not select an ambiguous same-name method for DFG flow", async (): Promise<void> => {
    const source = "class A { handle(value) { return value; } } class B { handle(value) { return value; } } const input = sourceValue; const receiver = condition ? new A() : new B(); const result = receiver.handle(input);";
    const { graph, semantic } = await buildResolvedDataFlow("semantic-ambiguous-method", source);
    const call = semantic.calls.find((candidate) => candidate.calleeName === "receiver.handle");

    expect(call?.resolutionState).toBe("UNRESOLVED");
    expect(graph.interproceduralFlows.some((flow) => flow.callId === call?.id)).toBe(false);
  });

  test("does not create DFG transfers for computed dynamic calls", async (): Promise<void> => {
    const { graph, semantic } = await buildResolvedDataFlow("semantic-computed", "const input = sourceValue; const method = getMethod(); const result = object[method](input);");

    expect(semantic.calls.some((call) => call.calleeName.includes("object"))).toBe(false);
    expect(graph.interproceduralFlows).toEqual([]);
  });

  test("connects a resolved imported function to its cross-file parameter and return", async (): Promise<void> => {
    const files = [
      { id: "service", path: "src/service.js", language: "javascript", size: 1 },
      { id: "consumer", path: "src/consumer.js", language: "javascript", size: 1 },
    ] as const;
    const sources = ["export function normalize(value) { return value; }", "import { normalize } from './service'; const input = sourceValue; const result = normalize(input);"] as const;
    const parser = new JavaScriptParser();
    const asts = await Promise.all(files.map((file, index) => {
      const source = sources[index];
      if (source === undefined) throw new Error("Cross-file fixture source is missing.");
      return parser.parse({ file, source });
    }));
    const results = asts.map((response) => response.result);
    const extractor = new JavaScriptSymbolExtractor();
    const tables = results.map((result) => extractor.extract(result));
    const dependencies = new DeterministicDependencyGraphBuilder().build(tables, files);
    const semantic = new DeterministicSemanticAnalysisEngine().analyze({ astResults: results, dependencyGraph: dependencies, symbolTables: tables });
    const flow = new DeterministicFlowAnalysisEngine().analyze(results, semantic.calls, tables);
    const consumer = flow.dataFlowGraphs.find((graph) => graph.filePath === "src/consumer.js");
    const service = flow.dataFlowGraphs.find((graph) => graph.filePath === "src/service.js");
    const call = semantic.calls.find((candidate) => candidate.sourceFilePath === "src/consumer.js" && candidate.calleeName === "normalize");
    if (consumer === undefined || service === undefined || call === undefined) throw new Error("Expected resolved cross-file fixture artifacts.");
    const input = definition(consumer, "input", "declaration");
    const result = definition(consumer, "result", "declaration");
    const parameter = definition(service, "value", "parameter");
    const returned = definition(service, "normalize:return", "return");

    expect(call.resolutionState).toBe("RESOLVED");
    expect(flowExists(consumer, "argument-to-parameter", input.id, parameter.id)).toBe(true);
    expect(flowExists(consumer, "return-to-receiver", returned.id, result.id)).toBe(true);
    expect(consumer.interproceduralFlows.some((transfer) => transfer.callId === call.id && transfer.targetDefinitionId === parameter.id)).toBe(true);
  });

  test("links renamed ESM and CommonJS exports to their canonical local function summaries", async (): Promise<void> => {
    const cases = [
      { id: "renamed-esm", service: "function foo(value) { return value; } export { foo as bar };", consumer: "import { bar } from './service'; const input = sourceValue; const result = bar(input);", callee: "bar" },
      { id: "commonjs-default", service: "function foo(value) { return value; } module.exports = foo;", consumer: "const foo = require('./service'); const input = sourceValue; const result = foo(input);", callee: "foo" },
      { id: "commonjs-named", service: "function foo(value) { return value; } exports.bar = foo;", consumer: "const { bar } = require('./service'); const input = sourceValue; const result = bar(input);", callee: "bar" },
    ] as const;

    for (const testCase of cases) {
      const { consumer, service, semantic } = await buildCrossFileFlow(testCase.id, testCase.service, testCase.consumer);
      const call = semantic.calls.find((candidate) => candidate.sourceFilePath === "src/consumer.js" && candidate.calleeName === testCase.callee);
      if (call === undefined) throw new Error(`Expected ${testCase.id} semantic call.`);
      const input = definition(consumer, "input", "declaration");
      const result = definition(consumer, "result", "declaration");
      const parameter = definition(service, "value", "parameter");
      const returned = definition(service, "foo:return", "return");

      expect(call.resolutionState).toBe("RESOLVED");
      expect(flowExists(consumer, "argument-to-parameter", input.id, parameter.id)).toBe(true);
      expect(flowExists(consumer, "return-to-receiver", returned.id, result.id)).toBe(true);
      expect(consumer.interproceduralFlows.some((transfer) => transfer.callId === call.id && transfer.targetDefinitionId === parameter.id)).toBe(true);
    }
  });

  test("does not treat RegExp.exec as a command-execution sink", async (): Promise<void> => {
    const source = "const input = req.body.name; const match = pattern.exec(input); child_process.exec(input);";
    const graph = await buildDataFlowGraph("taint-qualified-exec", source);

    expect(graph.taintFlows).toHaveLength(1);
    expect(graph.taintFlows[0]?.path.at(-1)).toBe("child_process.exec");
    expect(graph.taintFlows[0]?.state).toBe("CONFIRMED");
  });

  test("uses the proven semantic function target and canonical call id for interprocedural flow", async (): Promise<void> => {
    const source = "function process(value) { return value; } const input = sourceValue; const result = process(input);";
    const { graph, semantic } = await buildResolvedDataFlow("semantic-function", source);
    const call = semantic.calls.find((candidate) => candidate.calleeName === "process");
    const input = definition(graph, "input", "declaration");
    const parameter = definition(graph, "value", "parameter");

    expect(call?.resolutionState).toBe("RESOLVED");
    expect(flowExists(graph, "argument-to-parameter", input.id, parameter.id)).toBe(true);
    expect(graph.interproceduralFlows.find((flow) => flow.kind === "argument-to-parameter")?.callId).toBe(call?.id);
  });

  test("uses a proven class method target for interprocedural flow", async (): Promise<void> => {
    const source = "class Service { transform(value) { return value; } } const service = new Service(); const input = sourceValue; const result = service.transform(input);";
    const { graph, semantic } = await buildResolvedDataFlow("semantic-method", source);
    const call = semantic.calls.find((candidate) => candidate.calleeName === "service.transform");
    const input = definition(graph, "input", "declaration");
    const parameter = definition(graph, "value", "parameter");

    expect(call?.resolutionState).toBe("RESOLVED");
    expect(flowExists(graph, "argument-to-parameter", input.id, parameter.id)).toBe(true);
    expect(graph.interproceduralFlows.some((flow) => flow.callId === call?.id && flow.kind === "return-to-receiver")).toBe(true);
  });

  test("does not create DFG transfers for an unresolved receiver", async (): Promise<void> => {
    const { graph, semantic } = await buildResolvedDataFlow("semantic-unknown-receiver", "const input = sourceValue; const object = unknownFactory(); const result = object.handle(input);");

    expect(semantic.calls.find((call) => call.calleeName === "object.handle")?.resolutionState).toBe("UNRESOLVED");
    expect(graph.interproceduralFlows).toEqual([]);
  });

  test("does not select an ambiguous same-name method for DFG flow", async (): Promise<void> => {
    const source = "class A { handle(value) { return value; } } class B { handle(value) { return value; } } const input = sourceValue; const receiver = condition ? new A() : new B(); const result = receiver.handle(input);";
    const { graph, semantic } = await buildResolvedDataFlow("semantic-ambiguous-method", source);
    const call = semantic.calls.find((candidate) => candidate.calleeName === "receiver.handle");

    expect(call?.resolutionState).toBe("UNRESOLVED");
    expect(graph.interproceduralFlows.some((flow) => flow.callId === call?.id)).toBe(false);
  });

  test("does not create DFG transfers for computed dynamic calls", async (): Promise<void> => {
    const { graph, semantic } = await buildResolvedDataFlow("semantic-computed", "const input = sourceValue; const method = getMethod(); const result = object[method](input);");

    expect(semantic.calls.some((call) => call.calleeName.includes("object"))).toBe(false);
    expect(graph.interproceduralFlows).toEqual([]);
  });

  test("connects a resolved imported function to its cross-file parameter and return", async (): Promise<void> => {
    const files = [
      { id: "service", path: "src/service.js", language: "javascript", size: 1 },
      { id: "consumer", path: "src/consumer.js", language: "javascript", size: 1 },
    ] as const;
    const sources = ["export function normalize(value) { return value; }", "import { normalize } from './service'; const input = sourceValue; const result = normalize(input);"] as const;
    const parser = new JavaScriptParser();
    const asts = await Promise.all(files.map((file, index) => {
      const source = sources[index];
      if (source === undefined) throw new Error("Cross-file fixture source is missing.");
      return parser.parse({ file, source });
    }));
    const results = asts.map((response) => response.result);
    const extractor = new JavaScriptSymbolExtractor();
    const tables = results.map((result) => extractor.extract(result));
    const dependencies = new DeterministicDependencyGraphBuilder().build(tables, files);
    const semantic = new DeterministicSemanticAnalysisEngine().analyze({ astResults: results, dependencyGraph: dependencies, symbolTables: tables });
    const flow = new DeterministicFlowAnalysisEngine().analyze(results, semantic.calls, tables);
    const consumer = flow.dataFlowGraphs.find((graph) => graph.filePath === "src/consumer.js");
    const service = flow.dataFlowGraphs.find((graph) => graph.filePath === "src/service.js");
    const call = semantic.calls.find((candidate) => candidate.sourceFilePath === "src/consumer.js" && candidate.calleeName === "normalize");
    if (consumer === undefined || service === undefined || call === undefined) throw new Error("Expected resolved cross-file fixture artifacts.");
    const input = definition(consumer, "input", "declaration");
    const result = definition(consumer, "result", "declaration");
    const parameter = definition(service, "value", "parameter");
    const returned = definition(service, "normalize:return", "return");

    expect(call.resolutionState).toBe("RESOLVED");
    expect(flowExists(consumer, "argument-to-parameter", input.id, parameter.id)).toBe(true);
    expect(flowExists(consumer, "return-to-receiver", returned.id, result.id)).toBe(true);
    expect(consumer.interproceduralFlows.some((transfer) => transfer.callId === call.id && transfer.targetDefinitionId === parameter.id)).toBe(true);
  });
});

async function buildControlFlowGraph(id: string, source: string) {
  const ast = (await new JavaScriptParser().parse({ file: { id, path: `src/${id}.js`, language: "javascript", size: source.length }, source })).result;
  return new DeterministicControlFlowGraphBuilder().build(ast);
}

async function buildDataFlowGraph(id: string, source: string) {
  const ast = (await new JavaScriptParser().parse({ file: { id, path: `src/${id}.js`, language: "javascript", size: source.length }, source })).result;
  return new DeterministicDataFlowGraphBuilder().build(ast);
}

async function buildResolvedDataFlow(id: string, source: string) {
  const file = { id, path: `src/${id}.js`, language: "javascript", size: source.length } as const;
  const ast = (await new JavaScriptParser().parse({ file, source })).result;
  const symbols = new JavaScriptSymbolExtractor().extract(ast);
  const dependencyGraph = new DeterministicDependencyGraphBuilder().build([symbols], [file]);
  const semantic = new DeterministicSemanticAnalysisEngine().analyze({ astResults: [ast], dependencyGraph, symbolTables: [symbols] });
  const graph = new DeterministicFlowAnalysisEngine().analyze([ast], semantic.calls, [symbols]).dataFlowGraphs[0];
  if (graph === undefined) throw new Error("Expected a data-flow graph.");
  return { graph, semantic };
}

async function buildCrossFileFlow(id: string, serviceSource: string, consumerSource: string) {
  const files = [
    { id: `${id}-service`, path: "src/service.js", language: "javascript", size: serviceSource.length },
    { id: `${id}-consumer`, path: "src/consumer.js", language: "javascript", size: consumerSource.length },
  ] as const;
  const parser = new JavaScriptParser();
  const results = await Promise.all([parser.parse({ file: files[0], source: serviceSource }), parser.parse({ file: files[1], source: consumerSource })]);
  const astResults = results.map((result) => result.result);
  const extractor = new JavaScriptSymbolExtractor();
  const tables = astResults.map((result) => extractor.extract(result));
  const dependencyGraph = new DeterministicDependencyGraphBuilder().build(tables, files);
  const semantic = new DeterministicSemanticAnalysisEngine().analyze({ astResults, dependencyGraph, symbolTables: tables });
  const flow = new DeterministicFlowAnalysisEngine().analyze(astResults, semantic.calls, tables);
  const service = flow.dataFlowGraphs.find((graph) => graph.filePath === "src/service.js");
  const consumer = flow.dataFlowGraphs.find((graph) => graph.filePath === "src/consumer.js");
  if (service === undefined || consumer === undefined) throw new Error("Expected cross-file data-flow graphs.");
  return { service, consumer, semantic };
}

function findBlock(graph: Awaited<ReturnType<typeof buildControlFlowGraph>>, statementType: string) {
  const block = graph.blocks.find((candidate) => candidate.statements.some((statement) => statement.type === statementType));
  if (block === undefined) throw new Error(`Expected ${statementType} block.`);
  return block;
}

function successor(graph: Awaited<ReturnType<typeof buildControlFlowGraph>>, fromBlockId: string, kind: string): string {
  const edge = graph.edges.find((candidate) => candidate.fromBlockId === fromBlockId && candidate.kind === kind);
  if (edge === undefined) throw new Error(`Expected ${kind} successor.`);
  return edge.toBlockId;
}

function returnBlockEnteredBy(graph: Awaited<ReturnType<typeof buildControlFlowGraph>>, incomingKind: string) {
  return graph.blocks.find((block) => block.terminator === "ReturnStatement" && graph.edges.some((edge) => edge.toBlockId === block.id && edge.kind === incomingKind));
}

function loopHeaders(graph: Awaited<ReturnType<typeof buildControlFlowGraph>>) {
  return graph.blocks.filter((block) => block.statements.some((statement) => statement.type === "WhileStatement")).sort((left, right) => (left.statements[0]?.location?.line ?? 0) - (right.statements[0]?.location?.line ?? 0));
}

function tryStatementBlocks(graph: Awaited<ReturnType<typeof buildControlFlowGraph>>) {
  return graph.blocks.filter((block) => block.statements.some((statement) => statement.type === "TryStatement")).sort((left, right) => (left.statements[0]?.location?.column ?? 0) - (right.statements[0]?.location?.column ?? 0));
}

function definition(graph: Awaited<ReturnType<typeof buildDataFlowGraph>>, name: string, kind: string) {
  const found = graph.definitions.find((candidate) => candidate.name === name && candidate.kind === kind);
  if (found === undefined) throw new Error(`Expected ${kind} definition for ${name}.`);
  return found;
}

function flowExists(graph: Awaited<ReturnType<typeof buildDataFlowGraph>>, kind: string, sourceDefinitionId: string, targetDefinitionId: string): boolean {
  return graph.interproceduralFlows.some((flow) => flow.kind === kind && flow.sourceDefinitionId === sourceDefinitionId && flow.targetDefinitionId === targetDefinitionId);
}

function taintFlowTo(graph: Awaited<ReturnType<typeof buildDataFlowGraph>>, sinkName: string) {
  const flow = graph.taintFlows.find((candidate) => candidate.path.at(-1) === sinkName);
  if (flow === undefined) throw new Error(`Expected taint flow to ${sinkName}.`);
  return flow;
}
