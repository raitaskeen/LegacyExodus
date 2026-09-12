import { describe, expect, test } from "bun:test";

import { DeterministicControlFlowGraphBuilder } from "@flow/index";
import { JavaScriptParser } from "@parser/index";

describe("CFG expression-level precision", () => {
  test("does not claim resolved control flow for logical short-circuit execution", async (): Promise<void> => {
    const source = "function run(flag) { flag && doWork(); return 1; }";
    const ast = (await new JavaScriptParser().parse({
      file: { id: "logical-and", path: "src/logical-and.js", language: "javascript", size: source.length },
      source,
    })).result;
    const builder = new DeterministicControlFlowGraphBuilder();
    const graphs = builder.buildAll(ast);
    const graph = graphs.find((candidate) => candidate.scopeName.startsWith("run@"));
    const repeated = builder.buildAll(ast).find((candidate) => candidate.scopeName.startsWith("run@"));

    expect(graph).toBeDefined();
    expect(graph?.state).toBe("UNSUPPORTED");
    expect(graphs.find((candidate) => candidate.scopeName === "module")?.state).toBe("RESOLVED");
    expect(JSON.stringify(graph)).toBe(JSON.stringify(repeated));
  });

  test("preserves resolved statement-level conditional control", async (): Promise<void> => {
    const source = "function run(flag) { if (flag) { doWork(); } return 1; }";
    const ast = (await new JavaScriptParser().parse({
      file: { id: "statement-if", path: "src/statement-if.js", language: "javascript", size: source.length },
      source,
    })).result;
    const graph = new DeterministicControlFlowGraphBuilder()
      .buildAll(ast)
      .find((candidate) => candidate.scopeName.startsWith("run@"));

    expect(graph?.state).toBe("RESOLVED");
    expect(graph?.edges.filter((edge) => edge.kind === "true")).toHaveLength(1);
    expect(graph?.edges.filter((edge) => edge.kind === "false")).toHaveLength(1);
  });

  test.each([
    ["logical OR", "flag || doWork();"],
    ["nullish coalescing", "flag ?? doWork();"],
    ["conditional expression", "flag ? doWork() : recover();"],
    ["optional call", "service?.doWork();"],
    ["short-circuit assignment", "flag &&= doWork();"],
  ])("marks %s control as unsupported instead of fabricating resolved paths", async (_label, expression): Promise<void> => {
    const source = `function run(flag) { ${expression} return 1; }`;
    const ast = (await new JavaScriptParser().parse({
      file: { id: "nearby-expression", path: "src/nearby-expression.js", language: "javascript", size: source.length },
      source,
    })).result;
    const graph = new DeterministicControlFlowGraphBuilder()
      .buildAll(ast)
      .find((candidate) => candidate.scopeName.startsWith("run@"));

    expect(graph?.state).toBe("UNSUPPORTED");
  });
});
