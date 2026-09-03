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
  const symbolTable = symbolExtractor.extract(ast);
  const symbols = symbolTable.symbols;

  const dfgBuilder = new DeterministicDataFlowGraphBuilder();
  const dfg = dfgBuilder.build(ast, undefined, symbols);

  const flowEngine = new DeterministicFlowAnalysisEngine();
  const flowResult = flowEngine.analyze([ast], undefined, [symbolTable]);

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

  // ─── CodeRabbit Remediation: Finding 1 (Default Expression Flow) ─────────────

  it("Test 11: Destructuring default expression in declaration propagates taint from default source to sink", async () => {
    const source = `
      const { cmd = req.body.cmd } = options;
      child_process.exec(cmd);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const cmdDef = dfg.definitions.find((d) => d.name === "cmd");
    expect(cmdDef).toBeDefined();

    const taintFlow = dfg.taintFlows.find((f) => f.path.includes("child_process.exec"));
    expect(taintFlow).toBeDefined();
    expect(taintFlow?.state).toBe("CONFIRMED");
    expect(taintFlow?.path).toContain(cmdDef!.id);
  });

  it("Test 12: Destructuring default expression in assignment propagates taint from default source to sink", async () => {
    const source = `
      let cmd;
      ({ cmd = req.body.cmd } = options);
      child_process.exec(cmd);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const cmdDef = dfg.definitions.find((d) => d.name === "cmd" && d.kind === "assignment");
    expect(cmdDef).toBeDefined();

    const taintFlow = dfg.taintFlows.find((f) => f.path.includes("child_process.exec"));
    expect(taintFlow).toBeDefined();
    expect(taintFlow?.state).toBe("CONFIRMED");
  });

  it("Test 13: Nested destructuring default expression propagates taint to sink", async () => {
    const source = `
      const { user: { cmd = req.body.cmd } } = options;
      child_process.exec(cmd);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const cmdDef = dfg.definitions.find((d) => d.name === "cmd");
    expect(cmdDef).toBeDefined();

    const taintFlow = dfg.taintFlows.find((f) => f.path.includes("child_process.exec"));
    expect(taintFlow).toBeDefined();
    expect(taintFlow?.state).toBe("CONFIRMED");
  });

  it("Test 14: Destructuring default with alias binds alias and propagates default taint", async () => {
    const source = `
      const { command: cmd = req.body.command } = options;
      child_process.exec(cmd);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const cmdDef = dfg.definitions.find((d) => d.name === "cmd");
    expect(cmdDef).toBeDefined();
    expect(dfg.definitions.find((d) => d.name === "command")).toBeUndefined();

    const taintFlow = dfg.taintFlows.find((f) => f.path.includes("child_process.exec"));
    expect(taintFlow).toBeDefined();
    expect(taintFlow?.state).toBe("CONFIRMED");
  });

  it("Test 15: Array destructuring default expression propagates taint", async () => {
    const source = `
      const [ cmd = req.body.cmd ] = options;
      child_process.exec(cmd);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const cmdDef = dfg.definitions.find((d) => d.name === "cmd");
    expect(cmdDef).toBeDefined();

    const taintFlow = dfg.taintFlows.find((f) => f.path.includes("child_process.exec"));
    expect(taintFlow).toBeDefined();
    expect(taintFlow?.state).toBe("CONFIRMED");
  });

  // ─── CodeRabbit Remediation: Finding 2 (Formal Parameter Slot Semantics) ────

  it("Test 16: Destructured parameter with two bindings maps argument to single formal slot and propagates to second binding", async () => {
    const source = `
      function handle({ first, second }) {
        child_process.exec(second);
      }
      const body = req.body;
      handle(body);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const firstDef = dfg.definitions.find((d) => d.name === "first" && d.kind === "parameter");
    const secondDef = dfg.definitions.find((d) => d.name === "second" && d.kind === "parameter");
    expect(firstDef).toBeDefined();
    expect(secondDef).toBeDefined();

    // Summary must group both definitions into slot 0
    const summary = dfg.functionSummaries[0];
    expect(summary).toBeDefined();
    expect(summary?.parameterDefinitionIds.length).toBe(1);
    const slot0 = summary?.parameterDefinitionIds[0];
    expect(Array.isArray(slot0)).toBe(true);
    expect(slot0).toContain(firstDef!.id);
    expect(slot0).toContain(secondDef!.id);

    // Call binding to slot 0 must connect req.body to both first and second
    const interprocedural = dfg.interproceduralFlows.filter((f) => f.kind === "argument-to-parameter");
    expect(interprocedural.some((f) => f.targetDefinitionId === firstDef!.id)).toBe(true);
    expect(interprocedural.some((f) => f.targetDefinitionId === secondDef!.id)).toBe(true);

    // Taint from req.body must reach child_process.exec through second
    const taintFlow = dfg.taintFlows.find((f) => f.path.includes("child_process.exec"));
    expect(taintFlow).toBeDefined();
    expect(taintFlow?.state).toBe("CONFIRMED");
    expect(taintFlow?.path).toContain(secondDef!.id);
  });

  it("Test 17: Multiple formal parameters with destructuring correctly align slots", async () => {
    const source = `
      function handle({ first, second }, third) {
        child_process.exec(second);
        child_process.exec(third);
      }
      handle(req.body, req.query);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const firstDef = dfg.definitions.find((d) => d.name === "first" && d.kind === "parameter");
    const secondDef = dfg.definitions.find((d) => d.name === "second" && d.kind === "parameter");
    const thirdDef = dfg.definitions.find((d) => d.name === "third" && d.kind === "parameter");
    expect(firstDef).toBeDefined();
    expect(secondDef).toBeDefined();
    expect(thirdDef).toBeDefined();

    // 2 formal parameter slots: slot 0 has [first, second], slot 1 has [third]
    const summary = dfg.functionSummaries[0];
    expect(summary).toBeDefined();
    expect(summary?.parameterDefinitionIds.length).toBe(2);
    expect(summary?.parameterDefinitionIds[0]).toContain(firstDef!.id);
    expect(summary?.parameterDefinitionIds[0]).toContain(secondDef!.id);
    expect(summary?.parameterDefinitionIds[1]).toContain(thirdDef!.id);

    // Both sinks must have confirmed taint flows (one from req.body, one from req.query)
    expect(dfg.taintFlows.length).toBe(2);
    expect(dfg.taintFlows.every((f) => f.state === "CONFIRMED")).toBe(true);
  });

  it("Test 18: Destructured array parameter maps argument to single formal slot and propagates to second binding", async () => {
    const source = `
      function handle([first, second]) {
        child_process.exec(second);
      }
      handle(req.body);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const secondDef = dfg.definitions.find((d) => d.name === "second" && d.kind === "parameter");
    expect(secondDef).toBeDefined();

    const taintFlow = dfg.taintFlows.find((f) => f.path.includes("child_process.exec"));
    expect(taintFlow).toBeDefined();
    expect(taintFlow?.state).toBe("CONFIRMED");
    expect(taintFlow?.path).toContain(secondDef!.id);
  });

  it("Test 19: Destructured parameter with alias maps alias to slot and propagates taint", async () => {
    const source = `
      function handle({ command: cmd }) {
        child_process.exec(cmd);
      }
      handle(req.body);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const cmdDef = dfg.definitions.find((d) => d.name === "cmd" && d.kind === "parameter");
    expect(cmdDef).toBeDefined();

    const taintFlow = dfg.taintFlows.find((f) => f.path.includes("child_process.exec"));
    expect(taintFlow).toBeDefined();
    expect(taintFlow?.state).toBe("CONFIRMED");
    expect(taintFlow?.path).toContain(cmdDef!.id);
  });

  it("Test 20: Destructured parameter default expression propagates taint when default is provided", async () => {
    const source = `
      function handle({ first, second = req.body.second }) {
        child_process.exec(second);
      }
      handle(options);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const secondDef = dfg.definitions.find((d) => d.name === "second" && d.kind === "parameter");
    expect(secondDef).toBeDefined();

    const taintFlow = dfg.taintFlows.find((f) => f.path.includes("child_process.exec"));
    expect(taintFlow).toBeDefined();
    expect(taintFlow?.state).toBe("CONFIRMED");
  });

  it("Test 21: Direct parameter default expression propagates taint", async () => {
    const source = `
      function handle(cmd = req.body.cmd) {
        child_process.exec(cmd);
      }
      handle(options);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const cmdDef = dfg.definitions.find((d) => d.name === "cmd" && d.kind === "parameter");
    expect(cmdDef).toBeDefined();

    const taintFlow = dfg.taintFlows.find((f) => f.path.includes("child_process.exec"));
    expect(taintFlow).toBeDefined();
    expect(taintFlow?.state).toBe("CONFIRMED");
  });
});
