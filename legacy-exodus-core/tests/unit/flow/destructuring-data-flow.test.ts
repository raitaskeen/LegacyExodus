import { describe, expect, it } from "bun:test";
import { JavaScriptParser } from "@parser/adapters/javascript/javascript-parser";
import { DeterministicDataFlowGraphBuilder } from "@flow/data-flow-builder";
import { DeterministicFlowAnalysisEngine } from "@flow/flow-analysis-engine";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";
import type { ASTResult } from "@parser/contracts/ast-result";

async function parseAndAnalyze(source: string): Promise<{
  ast: ASTResult;
  dfg: ReturnType<DeterministicDataFlowGraphBuilder["build"]>;
  flowResult: ReturnType<DeterministicFlowAnalysisEngine["analyze"]>;
}> {
  const parser = new JavaScriptParser();
  const file = { id: "test-file", path: "src/handler.js", language: "javascript", size: source.length };
  const parsed = await parser.parse({ file, source });
  const ast = parsed.result!;

  const symbolExtractor = new JavaScriptSymbolExtractor();
  const symbols = symbolExtractor.extract(ast);

  const dfgBuilder = new DeterministicDataFlowGraphBuilder();
  const dfg = dfgBuilder.build(ast);

  const flowEngine = new DeterministicFlowAnalysisEngine();
  const flowResult = flowEngine.analyze([ast], undefined, [symbols]);

  return { ast, dfg, flowResult };
}

describe("P0-2: Data-Flow Destructuring & Taint Propagation", () => {
  it("Test 1: Object destructuring creates variable definition and tracks def-use", async () => {
    const source = `
      const { input } = req.query;
      console.log(input);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const inputDef = dfg.definitions.find((d) => d.name === "input");
    expect(inputDef).toBeDefined();
    expect(inputDef?.kind).toBe("declaration");

    const inputUse = dfg.uses.find((u) => u.name === "input");
    expect(inputUse).toBeDefined();
    expect(inputUse?.definitionId).toBe(inputDef?.id);
  });

  it("Test 2: Object alias destructuring binds local alias name, not property key", async () => {
    const source = `
      const { input: queryParam } = req.query;
      console.log(queryParam);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const aliasDef = dfg.definitions.find((d) => d.name === "queryParam");
    expect(aliasDef).toBeDefined();
    expect(aliasDef?.kind).toBe("declaration");

    // The property key 'input' should NOT be defined as a local variable
    const keyDef = dfg.definitions.find((d) => d.name === "input");
    expect(keyDef).toBeUndefined();

    const aliasUse = dfg.uses.find((u) => u.name === "queryParam");
    expect(aliasUse).toBeDefined();
    expect(aliasUse?.definitionId).toBe(aliasDef?.id);
  });

  it("Test 3: Array destructuring creates definitions for each element", async () => {
    const source = `
      const [first, second] = req.body;
      console.log(first, second);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const firstDef = dfg.definitions.find((d) => d.name === "first");
    const secondDef = dfg.definitions.find((d) => d.name === "second");
    expect(firstDef).toBeDefined();
    expect(secondDef).toBeDefined();

    const firstUse = dfg.uses.find((u) => u.name === "first");
    const secondUse = dfg.uses.find((u) => u.name === "second");
    expect(firstUse?.definitionId).toBe(firstDef?.id);
    expect(secondUse?.definitionId).toBe(secondDef?.id);
  });

  it("Test 4: Object destructuring assignment updates definitions", async () => {
    const source = `
      let input;
      ({ input } = req.query);
      console.log(input);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const assignDef = dfg.definitions.find((d) => d.name === "input" && d.kind === "assignment");
    expect(assignDef).toBeDefined();

    const inputUse = dfg.uses.find((u) => u.name === "input");
    expect(inputUse).toBeDefined();
    expect(inputUse?.definitionId).toBe(assignDef?.id);
  });

  it("Test 5: Array destructuring assignment updates definitions", async () => {
    const source = `
      let first;
      [first] = req.body;
      console.log(first);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const assignDef = dfg.definitions.find((d) => d.name === "first" && d.kind === "assignment");
    expect(assignDef).toBeDefined();

    const firstUse = dfg.uses.find((u) => u.name === "first");
    expect(firstUse).toBeDefined();
    expect(firstUse?.definitionId).toBe(assignDef?.id);
  });

  it("Test 6: Taint propagation through object destructuring to command-execution sink", async () => {
    const source = `
      const { cmd } = req.body;
      child_process.exec(cmd);
    `;
    const { dfg } = await parseAndAnalyze(source);

    expect(dfg.taintFlows.length).toBeGreaterThan(0);
    const flow = dfg.taintFlows[0];
    expect(flow?.state).toBe("CONFIRMED");
    expect(flow?.path).toContain("child_process.exec");
  });

  it("Test 7: Taint propagation through object alias destructuring to sink", async () => {
    const source = `
      const { cmd: command } = req.body;
      child_process.exec(command);
    `;
    const { dfg } = await parseAndAnalyze(source);

    expect(dfg.taintFlows.length).toBeGreaterThan(0);
    const flow = dfg.taintFlows[0];
    expect(flow?.state).toBe("CONFIRMED");
    expect(flow?.path).toContain("child_process.exec");
  });

  it("Test 8: Taint propagation through array destructuring to sink", async () => {
    const source = `
      const [cmd] = req.body;
      child_process.exec(cmd);
    `;
    const { dfg } = await parseAndAnalyze(source);

    expect(dfg.taintFlows.length).toBeGreaterThan(0);
    const flow = dfg.taintFlows[0];
    expect(flow?.state).toBe("CONFIRMED");
    expect(flow?.path).toContain("child_process.exec");
  });

  it("Test 9: Destructuring with default values extracts binding identifier", async () => {
    const source = `
      const { cmd = "ls" } = req.body;
      child_process.exec(cmd);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const cmdDef = dfg.definitions.find((d) => d.name === "cmd");
    expect(cmdDef).toBeDefined();
    expect(dfg.taintFlows.length).toBeGreaterThan(0);
  });

  it("Test 10: Function parameter destructuring creates parameter definitions and taint flow", async () => {
    const source = `
      function handle({ cmd }) {
        child_process.exec(cmd);
      }
    `;
    const { dfg } = await parseAndAnalyze(source);

    const cmdDef = dfg.definitions.find((d) => d.name === "cmd" && d.kind === "parameter");
    expect(cmdDef).toBeDefined();

    const cmdUse = dfg.uses.find((u) => u.name === "cmd");
    expect(cmdUse?.definitionId).toBe(cmdDef?.id);
  });
});
