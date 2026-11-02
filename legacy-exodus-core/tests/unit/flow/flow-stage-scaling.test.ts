import { describe, expect, test } from "bun:test";
import { JavaScriptParser } from "@parser/index";
import { DeterministicControlFlowGraphBuilder } from "@flow/control-flow-builder";
import { DeterministicDataFlowGraphBuilder } from "@flow/data-flow-builder";

/**
 * Wave 3d scale gate (WAVE3-DFG-DESIGN.md, BA-28): the CFG and data-flow stages, timed together on
 * generated files, may grow by at most the stated factor each time the input doubles. Timings are
 * the best of three runs, so a noisy machine cannot fail the gate by one slow run.
 */

async function stageMs(code: string): Promise<number> {
  const ast = (await new JavaScriptParser().parse({ file: { id: "s", path: "scale.js", language: "javascript", size: code.length }, source: code })).result;
  let best = Number.POSITIVE_INFINITY;
  for (let run = 0; run < 3; run++) {
    const started = performance.now();
    const controlFlow = new DeterministicControlFlowGraphBuilder().buildAllWithNodes(ast);
    new DeterministicDataFlowGraphBuilder().buildContext(ast, undefined, [], controlFlow);
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

async function ratios(sizes: readonly number[], generate: (size: number) => string): Promise<readonly number[]> {
  const times: number[] = [];
  for (const size of sizes) times.push(await stageMs(generate(size)));
  return times.slice(1).map((time, index) => time / Math.max(times[index]!, 1));
}

/** The audit's BA-28 shape: N small functions, each with one `if`, and one source-to-sink call. */
function manyFunctions(count: number): string {
  let code = "";
  for (let index = 0; index < count; index++) code += `function f${index}(a) {\n  if (a) { a = a + ${index}; }\n  return a;\n}\n`;
  return `${code}child_process.exec(f0(req.body));\n`;
}

/** One long function: a chain of bindings, each conditionally updated, from one source to a sink. */
function longFunction(statements: number): string {
  let code = "function big(a) {\n  let v0 = req.body;\n";
  for (let index = 1; index < statements; index++) code += `  let v${index} = v${index - 1};\n  if (a > ${index}) { v${index} = v${index} + ${index}; }\n`;
  return `${code}  child_process.exec(v${statements - 1});\n}\n`;
}

describe("Wave 3d stage scaling", () => {
  test("many functions: each doubling costs at most 2.5x", async () => {
    const measured = await ratios([1000, 2000, 4000], manyFunctions);
    for (const ratio of measured) expect(ratio).toBeLessThanOrEqual(2.5);
  }, 120_000);

  test("one long function: each doubling costs at most 4.5x (no cubic stage)", async () => {
    const measured = await ratios([200, 400, 800], longFunction);
    for (const ratio of measured) expect(ratio).toBeLessThanOrEqual(4.5);
  }, 120_000);
});
