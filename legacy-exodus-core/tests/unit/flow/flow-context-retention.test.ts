import { describe, expect, test } from "bun:test";
import { DeterministicDataFlowGraphBuilder } from "@flow/data-flow-builder";
import { JavaScriptParser } from "@parser/index";

// `joins` moved here from module state (BA-27); `localDefinitionIds` (ids only) lets the CFG taint
// verdict tell a path within one function from one through a call or another file (Wave 3b).
const approvedStateKeys = Object.freeze(["joins", "localDefinitionIds", "sinks", "taintPaths", "transfers"]);
const forbiddenStateKeys = Object.freeze([
  "definitions",
  "uses",
  "functions",
  "resolvableFunctions",
  "functionsBySymbolId",
  "provenTargets",
  "hasSemanticResolution",
  "pendingCalls",
  "interproceduralFlows",
]);

describe("BuildContextResult connection-state retention", () => {
  test("returns only the compact state required for repository-wide connection", async () => {
    const context = await buildContext("retention-contract");
    const stateKeys = Object.keys(context.state).sort();

    expect(context.graph.definitions.map(({ name }) => name).sort()).toEqual([
      "identity",
      "identity:return",
      "input",
      "output",
      "value",
    ]);
    expect(context.graph.uses.map(({ name }) => name).sort()).toEqual([
      "input",
      "output",
      "req",
      "req.body.name",
      "value",
    ]);
    expect(context.graph.callBindings).toEqual([]);
    expect(context.graph.interproceduralFlows.map(({ kind }) => kind).sort()).toEqual([
      "argument-to-parameter",
      "return-to-receiver",
      "return-value",
    ]);
    expect(stateKeys).toEqual([...approvedStateKeys]);
    expect(forbiddenStateKeys.filter((key) => Object.prototype.hasOwnProperty.call(context.state, key))).toEqual([]);
  });

  test("does not hide build-only state behind symbols or a custom prototype", async () => {
    const context = await buildContext("retention-reachability");

    expect(Reflect.ownKeys(context.state).filter((key) => typeof key === "symbol")).toEqual([]);
    expect(Object.getPrototypeOf(context.state)).toBe(Object.prototype);
    expect("functions" in context.state).toBe(false);
    expect("definitions" in context.state).toBe(false);
  });

  test("retains zero build-only state fields across controlled repository sizes", async () => {
    for (const count of [12, 24, 48, 96]) {
      const contexts = await Promise.all(
        Array.from({ length: count }, (_, index) => buildContext(`retention-${count}-${index}`)),
      );
      const retainedForbiddenKeys = contexts.flatMap(({ state }) =>
        forbiddenStateKeys.filter((key) => Object.prototype.hasOwnProperty.call(state, key)),
      );

      expect(retainedForbiddenKeys).toEqual([]);
      expect(contexts.every(({ state }) => Object.keys(state).sort().join(",") === approvedStateKeys.join(","))).toBe(true);
    }
  });
});

async function buildContext(id: string) {
  const source = `
    function identity(value) { return value; }
    const input = req.body.name;
    const output = identity(input);
    res.send(output);
  `;
  const ast = (await new JavaScriptParser().parse({
    file: {
      id,
      path: `src/${id}.js`,
      language: "javascript",
      size: source.length,
    },
    source,
  })).result;

  return new DeterministicDataFlowGraphBuilder().buildContext(ast);
}
