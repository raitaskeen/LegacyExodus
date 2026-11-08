import { describe, expect, it } from "bun:test";
import { JavaScriptParser } from "../../../src/parser/adapters/javascript/javascript-parser";
import type { ASTNode } from "../../../src/parser/index";
import { DeterministicControlFlowGraphBuilder } from "../../../src/flow/control-flow-builder";
import { analyzeControlFlow, joinTaint, combineTaint, type Taint } from "../../../src/flow/cfg-dataflow";

/**
 * Wave 3a (WAVE3-DFG-DESIGN.md): the CFG data-flow core, not yet wired into the DFG builder.
 * Sources are calls to `source()`; a use reports its reaching definitions and its taint, where
 * `must` means the source reaches the use on every path from the entry.
 */

function name(node: ASTNode): string | undefined {
  const value = node.attributes.name;
  return typeof value === "string" ? value : undefined;
}

async function analyze(code: string, scope = "module") {
  const response = await new JavaScriptParser().parse({ file: { id: "f1", path: "t.js", language: "javascript", size: code.length }, source: code });
  const built = new DeterministicControlFlowGraphBuilder().buildAllWithNodes(response.result);
  const graph = built.graphs.find((candidate) => candidate.scopeName === scope || candidate.scopeName.startsWith(`${scope}@`));
  if (graph === undefined) throw new Error(`scope ${scope} not found`);
  const result = analyzeControlFlow(graph, built, {
    definitionId: (node, binding) => `${binding}@${node.location?.start.line ?? 0}`,
    sourceOf: (call) => {
      const callee = call.children.find((child) => child.role === "callee");
      return callee !== undefined && name(callee) === "source" ? `source@${call.location?.start.line ?? 0}` : undefined;
    },
  });
  /** The use of `binding` on `line`, as "defs | sources" with `!` marking must. */
  const use = (binding: string, line: number): string => {
    const found = result.uses.filter((candidate) => candidate.binding === binding && candidate.node.location?.start.line === line);
    if (found.length !== 1) throw new Error(`expected one use of ${binding} on line ${line}, found ${found.length}`);
    const fact = found[0]!;
    return `${fact.definitions.join(",")} | ${fact.taint.map((entry) => `${entry.sourceId}${entry.must ? "!" : ""}`).join(",")}`;
  };
  return { built, graph, result, use };
}

const taint = (entries: Record<string, boolean>): Taint => new Map(Object.entries(entries));

describe("Wave 3a lattice", () => {
  it("path join keeps every source but only sources that are must on both sides stay must", () => {
    expect([...joinTaint(taint({ a: true, b: true }), taint({ a: true, c: true }))]).toEqual([["a", true], ["b", false], ["c", false]]);
  });

  it("value combination keeps a source must when either operand carries it", () => {
    expect([...combineTaint(taint({ a: true }), taint({ a: false, b: false }))]).toEqual([["a", true], ["b", false]]);
  });
});

describe("Wave 3a transfer functions", () => {
  it("straight-line flow is must and a reassignment kills it", async () => {
    const { use } = await analyze("let x = source();\nsink(x);\nx = 1;\nsink(x);\n");
    expect(use("x", 2)).toBe("x@1 | source@1!");
    expect(use("x", 4)).toBe("x@3 | ");
  });

  it("an if joins both arms: may keeps the source, must drops it", async () => {
    const { use } = await analyze("let x = 1;\nif (c) { x = source(); }\nsink(x);\n");
    expect(use("x", 3)).toBe("x@1,x@2 | source@2");
  });

  it("a definition on both arms stays must", async () => {
    const { use } = await analyze("let x;\nif (c) { x = source(); } else { x = source(); }\nsink(x);\n");
    expect(use("x", 3)).toBe("x@2 | source@2!");
  });

  it("a loop reaches its fixed point: a definition in the body reaches the header and the exit", async () => {
    const { use } = await analyze("let x = 1;\nwhile (c(x)) {\n  x = source();\n}\nsink(x);\n");
    expect(use("x", 2)).toBe("x@1,x@3 | source@3");
    expect(use("x", 5)).toBe("x@1,x@3 | source@3");
  });

  it("switch fall-through and break both reach the join", async () => {
    const { use } = await analyze("let x = 1;\nswitch (k) {\n  case 1: x = source();\n  case 2: break;\n  default: x = 2;\n}\nsink(x);\n");
    expect(use("x", 7)).toBe("x@1,x@3,x@5 | source@3");
  });

  it("an exception edge carries the states before each throwing statement", async () => {
    const { use } = await analyze("let x = source();\ntry {\n  x = 1;\n  f();\n  x = 2;\n} catch (e) {\n  sink(x);\n}\n");
    expect(use("x", 7)).toBe("x@1,x@3,x@5 | source@1");
  });

  it("&&, || and ?? evaluate their right side on one path only", async () => {
    const { use } = await analyze("let x = 1;\nc && (x = source());\nsink(x);\nlet y = a || source();\nsink(y);\nlet z = a ?? b;\nsink(z);\n");
    expect(use("x", 3)).toBe("x@1,x@2 | source@2");
    expect(use("y", 5)).toBe("y@4 | source@4");
    expect(use("z", 7)).toBe("z@6 | ");
  });

  it("a conditional's value joins its arms, and its test produces uses only (BA-06)", async () => {
    const { use } = await analyze("let s = source();\nlet v = s ? 1 : 2;\nsink(v);\nlet w = c ? source() : source();\nsink(w);\n");
    expect(use("v", 3)).toBe("v@2 | ");
    expect(use("s", 2)).toBe("s@1 | source@1!");
    expect(use("w", 5)).toBe("w@4 | source@4!");
  });

  it("an if test produces uses only", async () => {
    const { use } = await analyze("let s = source();\nlet x = 1;\nif (s) { x = 2; }\nsink(x);\n");
    expect(use("x", 4)).toBe("x@2,x@3 | ");
  });

  it("logical assignment keeps the old value on one path", async () => {
    const { use } = await analyze("let x = source();\nx ||= 1;\nsink(x);\nlet y = 1;\ny ??= source();\nsink(y);\n");
    expect(use("x", 3)).toBe("x@1,x@2 | source@1");
    expect(use("y", 6)).toBe("y@4,y@5 | source@5");
  });

  it("compound assignment combines old and new values", async () => {
    const { use } = await analyze("let x = source();\nx += 'a';\nsink(x);\n");
    expect(use("x", 3)).toBe("x@2 | source@1!");
  });

  it("a source passed directly to a call is a tainted value of that call's argument", async () => {
    const { result } = await analyze("sink(source());\n");
    expect(result.calls.map((call) => call.argumentTaint.map((entry) => entry.map((t) => `${t.sourceId}${t.must ? "!" : ""}`)))).toEqual([[["source@1!"]], []]);
  });

  it("for-of binds its variable from the iterable on every iteration", async () => {
    const { use } = await analyze("const xs = source();\nfor (const x of xs) {\n  sink(x);\n}\n");
    expect(use("x", 3)).toBe("x@2 | source@1!");
  });

  it("a do-while test is evaluated in its condition block, after the body", async () => {
    const { use } = await analyze("let x = 1;\ndo {\n  x = source();\n} while (c(x));\n");
    expect(use("x", 4)).toBe("x@3 | source@3!");
  });

  it("destructuring with a default joins the default", async () => {
    const { use } = await analyze("const { a = source() } = o;\nsink(a);\n");
    expect(use("a", 2)).toBe("a@1 | source@1");
  });

  it("a nested function body is not evaluated in the enclosing scope", async () => {
    const { result } = await analyze("let x = 1;\nconst f = () => { x = source(); };\nsink(x);\n");
    expect(result.uses.filter((use) => use.binding === "x").map((use) => use.node.location?.start.line)).toEqual([3]);
  });

  it("runs inside function scopes and is deterministic", async () => {
    const code = "function f(p) {\n  let x = p;\n  if (p) x = source();\n  return x;\n}\n";
    const first = await analyze(code, "f");
    const second = await analyze(code, "f");
    expect(first.use("x", 4)).toBe("x@2,x@3 | source@3");
    expect(JSON.stringify(first.result.uses.map((use) => [use.binding, use.definitions, use.taint]))).toBe(JSON.stringify(second.result.uses.map((use) => [use.binding, use.definitions, use.taint])));
  });

  it("buildAllWithNodes returns the same graphs as buildAll", async () => {
    const code = "let x = 1;\nfunction f() { try { g(); } finally { h(); } }\ndo { x++; } while (x < 3);\n";
    const response = await new JavaScriptParser().parse({ file: { id: "f1", path: "t.js", language: "javascript", size: code.length }, source: code });
    const builder = new DeterministicControlFlowGraphBuilder();
    expect(JSON.stringify(builder.buildAllWithNodes(response.result).graphs)).toBe(JSON.stringify(builder.buildAll(response.result)));
  });
});
