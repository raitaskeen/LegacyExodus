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

describe("DFG-01: Destructuring Data-Flow Precision & Semantic Integrity", () => {
  // ─── 1. Object Destructuring Property Isolation ───────────────────────────
  it("Case 1: Object destructuring isolates tainted vs safe properties from object literal", async () => {
    const source = `
      const { tainted, safe } = { tainted: req.body.cmd, safe: "clean" };
      child_process.exec(safe);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const safeDef = dfg.definitions.find((d) => d.name === "safe");
    expect(safeDef).toBeDefined();

    // safe must NOT be tainted by tainted property
    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(0);
  });

  // ─── 2. Object Aliasing Isolation ─────────────────────────────────────────
  it("Case 2: Object alias destructuring isolates properties and binds only alias target", async () => {
    const source = `
      const { tainted: tVar, safe: sVar } = { tainted: req.body.cmd, safe: "clean" };
      child_process.exec(sVar);
    `;
    const { dfg } = await parseAndAnalyze(source);

    expect(dfg.definitions.find((d) => d.name === "tainted")).toBeUndefined();
    expect(dfg.definitions.find((d) => d.name === "safe")).toBeUndefined();

    const sDef = dfg.definitions.find((d) => d.name === "sVar");
    expect(sDef).toBeDefined();

    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(0);
  });

  // ─── 3. Nested Object Destructuring Isolation ─────────────────────────────
  it("Case 3: Nested object destructuring isolates inner safe properties from sibling taint", async () => {
    const source = `
      const { user: { secret, name } } = { user: { secret: req.body.token, name: "Alice" } };
      child_process.exec(name);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(0);
  });

  // ─── 4. Array Destructuring Element Isolation ─────────────────────────────
  it("Case 4: Array destructuring isolates elements positionally from array literal", async () => {
    const source = `
      const [tainted, safe] = [req.body.cmd, "clean"];
      child_process.exec(safe);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(0);
  });

  // ─── 5. Sparse Array Destructuring Alignment ──────────────────────────────
  it("Case 5: Sparse array destructuring aligns indices correctly across skipped holes", async () => {
    const source = `
      const [a, , c] = [req.body.cmd, "middle_safe", "c_safe"];
      child_process.exec(c);
    `;
    const { dfg } = await parseAndAnalyze(source);

    // c is index 2 ("c_safe"), should not be tainted
    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(0);
  });

  it("Case 5b: Sparse array correctly propagates taint to non-skipped target", async () => {
    const source = `
      const [a, , c] = ["safe_0", "safe_1", req.body.cmd];
      child_process.exec(c);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const cDef = dfg.definitions.find((d) => d.name === "c");
    expect(cDef).toBeDefined();

    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(1);
    expect(taintFlows[0]?.path).toContain(cDef!.id);
  });

  // ─── 6. Array Rest Element Isolation ──────────────────────────────────────
  it("Case 6: Array rest element isolates excluded elements from array literal", async () => {
    const source = `
      const [first, ...rest] = [req.body.cmd, "safe1", "safe2"];
      child_process.exec(rest);
    `;
    const { dfg } = await parseAndAnalyze(source);

    // rest only contains index 1 and 2, which are safe literals
    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(0);
  });

  // ─── 7. Object Rest Element Isolation ─────────────────────────────────────
  it("Case 7: Object rest element isolates extracted properties from object literal", async () => {
    const source = `
      const { password, ...safeRest } = { password: req.body.cmd, name: "Alice", role: "user" };
      child_process.exec(safeRest);
    `;
    const { dfg } = await parseAndAnalyze(source);

    // safeRest only receives name and role, NOT password
    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(0);
  });

  // ─── 8. Default Values Isolation ──────────────────────────────────────────
  it("Case 8: Default values do not cross-taint sibling variables", async () => {
    const source = `
      const { a = "safe", b = req.body.cmd } = {};
      child_process.exec(a);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(0);
  });

  it("Case 8b: Explicit literal value suppresses default value taint", async () => {
    const source = `
      const { a = req.body.cmd } = { a: "safe_constant" };
      child_process.exec(a);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(0);
  });

  // ─── 9. Nested Defaults ───────────────────────────────────────────────────
  it("Case 9: Nested default values propagate only to their own target", async () => {
    const source = `
      const { user: { token = "safe_token", secret = req.body.cmd } = {} } = {};
      child_process.exec(token);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(0);
  });

  // ─── 10. Assignment Destructuring Isolation ───────────────────────────────
  it("Case 10: Assignment destructuring isolates properties from object literal", async () => {
    const source = `
      let a, b;
      ({ a, b } = { a: req.body.cmd, b: "safe" });
      child_process.exec(b);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(0);
  });

  // ─── 11. Member Expression Targets in Assignment Destructuring ───────────
  it("Case 11: Member expression targets in object destructuring assignment are tracked", async () => {
    const source = `
      let config = {};
      ({ cmd: config.execPath } = { cmd: req.body.cmd });
      child_process.exec(config.execPath);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const memberDef = dfg.definitions.find((d) => d.name === "config.execPath" && d.kind === "assignment");
    expect(memberDef).toBeDefined();

    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(1);
    expect(taintFlows[0]?.path).toContain(memberDef!.id);
  });

  it("Case 11b: Member expression targets in array destructuring assignment are tracked", async () => {
    const source = `
      let config = {};
      [config.execPath] = [req.body.cmd];
      child_process.exec(config.execPath);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const memberDef = dfg.definitions.find((d) => d.name === "config.execPath" && d.kind === "assignment");
    expect(memberDef).toBeDefined();

    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(1);
  });

  // ─── 12. Deep Member Expression Sources ───────────────────────────────────
  it("Case 12: Deep member expression sources propagate taint through nested destructuring", async () => {
    const source = `
      const { user: { token } } = req.body;
      child_process.exec(token);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const tokenDef = dfg.definitions.find((d) => d.name === "token");
    expect(tokenDef).toBeDefined();

    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(1);
    expect(taintFlows[0]?.path).toContain(tokenDef!.id);
  });

  // ─── 13. Composite Expressions in Initializer ─────────────────────────────
  it("Case 13: Composite logical and conditional expressions preserve source taint", async () => {
    const source = `
      const { cmd } = options.override ? req.body : { cmd: "default" };
      child_process.exec(cmd);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const cmdDef = dfg.definitions.find((d) => d.name === "cmd");
    expect(cmdDef).toBeDefined();

    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(1);
  });

  // ─── 14. Multiple Declarators in Single Statement ─────────────────────────
  it("Case 14: Multiple declarators in a single statement do not cross-contaminate", async () => {
    const source = `
      const { a } = { a: req.body.cmd }, { b } = { b: "safe" };
      child_process.exec(b);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(0);
  });

  // ─── 15. Sanitizer Interaction with Destructured Fields ───────────────────
  it("Case 15: Sanitizer applied to specific destructured property neutralizes taint", async () => {
    const source = `
      const { tainted, safe } = { tainted: req.body.cmd, safe: sanitize(req.body.cmd) };
      child_process.exec(safe);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(0);
  });

  // ─── 16. Chained Sequential Destructuring vs Nested ───────────────────────
  it("Case 16: Sequential destructuring preserves complete def-use and taint chain", async () => {
    const source = `
      const { user } = req.body;
      const { cmd } = user;
      child_process.exec(cmd);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const userDef = dfg.definitions.find((d) => d.name === "user");
    const cmdDef = dfg.definitions.find((d) => d.name === "cmd");
    expect(userDef).toBeDefined();
    expect(cmdDef).toBeDefined();

    // user is used to define cmd, so def-use chain resolves user
    const userUse = dfg.uses.find((u) => u.name === "user" && u.definitionId === userDef!.id);
    expect(userUse).toBeDefined();

    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(1);
    expect(taintFlows[0]?.path).toContain(userDef!.id);
    expect(taintFlows[0]?.path).toContain(cmdDef!.id);
  });

  // ─── 17. Reassignment of Destructured Variable ────────────────────────────
  it("Case 17: Reassignment of destructured variable creates new definition and disconnects sink taint", async () => {
    const source = `
      let { cmd } = req.body;
      cmd = "safe_literal";
      child_process.exec(cmd);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const defs = dfg.definitions.filter((d) => d.name === "cmd");
    expect(defs.length).toBe(2);
    const assignDef = defs.find((d) => d.kind === "assignment");
    expect(assignDef).toBeDefined();

    // Use at exec should bind to the assignment, which has no taint
    const execUse = dfg.uses.find((u) => u.name === "cmd" && u.definitionId === assignDef!.id);
    expect(execUse).toBeDefined();

    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(0);
  });

  // ─── 18. Shadowing in Destructuring Parameter ─────────────────────────────
  it("Case 18: Parameter destructuring does not link to shadowed outer variable", async () => {
    const source = `
      const value = req.body.cmd;
      function f({ value: inner }) {
        child_process.exec(inner);
      }
      f({ value: "safe_value" });
    `;
    const { dfg } = await parseAndAnalyze(source);

    const innerDef = dfg.definitions.find((d) => d.name === "inner");
    expect(innerDef).toBeDefined();

    const outerDef = dfg.definitions.find((d) => d.name === "value" && d.kind === "declaration");
    expect(outerDef).toBeDefined();

    // Exec sink must NOT be tainted by outer value
    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(0);
  });

  // ─── 19. Mixed Object and Array Destructuring ─────────────────────────────
  it("Case 19: Mixed object-in-array and array-in-object patterns maintain isolation", async () => {
    const source = `
      const [{ cmd }, safe] = [{ cmd: req.body.cmd }, "safe_val"];
      child_process.exec(safe);
    `;
    const { dfg } = await parseAndAnalyze(source);

    const taintFlows = dfg.taintFlows.filter((f) => f.path.includes("child_process.exec"));
    expect(taintFlows.length).toBe(0);
  });

  // ─── 20. Deterministic Representation ─────────────────────────────────────
  it("Case 20: DFG construction is bit-for-bit deterministic across multiple runs", async () => {
    const source = `
      const { a, b: alias = "def", c: [x, , y] = [1, 2, 3], ...rest } = req.body;
      let target = {};
      ({ x: target.val } = { x: a });
      child_process.exec(alias);
      child_process.exec(y);
      child_process.exec(target.val);
    `;

    const run1 = await parseAndAnalyze(source);
    const run2 = await parseAndAnalyze(source);
    const run3 = await parseAndAnalyze(source);

    expect(JSON.stringify(run1.dfg)).toBe(JSON.stringify(run2.dfg));
    expect(JSON.stringify(run2.dfg)).toBe(JSON.stringify(run3.dfg));
  });
});
