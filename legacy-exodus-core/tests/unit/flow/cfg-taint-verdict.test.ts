import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JavaScriptParser } from "@parser/index";
import { DeterministicDataFlowGraphBuilder } from "@flow/data-flow-builder";

/**
 * Wave 3b (WAVE3-DFG-DESIGN.md): CFG data flow decides taint between a source and a sink of the same
 * function; the legacy transfers keep flows that cross a call or a file.
 */

async function flows(code: string): Promise<readonly string[]> {
  const ast = (await new JavaScriptParser().parse({ file: { id: "p", path: "p.js", language: "javascript", size: code.length }, source: code })).result;
  return new DeterministicDataFlowGraphBuilder().build(ast).taintFlows.map((flow) => `${flow.path.at(-1)}:${flow.state}`);
}

describe("Wave 3b taint verdicts", () => {
  it("a shadowing declaration in an inner block does not hide the outer flow", async () => {
    expect(await flows(`let v = req.body; { let v = "safe"; } res.send(v);`)).toEqual(["res.send:CONFIRMED"]);
  });

  it("an inner block's own binding stays clean", async () => {
    expect(await flows(`let v = "safe"; { let v = req.body; } res.send(v);`)).toEqual([]);
  });

  it("a function that is never referenced cannot overwrite the binding", async () => {
    expect(await flows(`let v = req.body; function clean() { v = "safe"; } res.send(v);`)).toEqual(["res.send:CONFIRMED"]);
  });

  it("a function that may run makes its overwrite possible: the flow stays, as INFERRED", async () => {
    expect(await flows(`let v = req.body; function clean() { v = "safe"; } clean(); res.send(v);`)).toEqual(["res.send:INFERRED"]);
  });

  it("a closure's tainted write reaches a later read of the outer binding", async () => {
    expect(await flows(`let v = "safe"; const load = () => { v = req.body; }; load(); res.send(v);`)).toEqual(["res.send:INFERRED"]);
  });

  it("a flow through a local function's parameter and return is kept", async () => {
    expect(await flows(`function id(a) { return a; } const v = id(req.body); res.send(v);`)).toHaveLength(1);
  });

  it("a written member path is read back instead of its object", async () => {
    expect(await flows(`const o = {}; o.p = req.body; res.send(o.p);`)).toEqual(["res.send:CONFIRMED"]);
    expect(await flows(`let o = req.body; o.p = "safe"; res.send(o.p);`)).toEqual([]);
  });

  it("literal destructuring binds each target from its own part", async () => {
    expect(await flows(`const { a, b } = { a: req.body, b: "safe" }; res.send(b);`)).toEqual([]);
    expect(await flows(`const [a, b] = [req.body, "safe"]; res.send(a);`)).toEqual(["res.send:CONFIRMED"]);
  });

  it("a sanitizer cuts taint", async () => {
    expect(await flows(`const v = sanitize(req.body); res.send(v);`)).toEqual([]);
  });

  it("builds share no state: the same file gives the same flows before and after another build (BA-27)", async () => {
    const code = `let v = ""; if (c) { v = req.body; } res.send(v);`;
    const first = await flows(code);
    await flows(`let w = req.query; if (d) { w = "x"; } res.json(w);`);
    expect(await flows(code)).toEqual(first);
    const source = readFileSync(join(import.meta.dir, "../../../src/flow/data-flow-builder.ts"), "utf8");
    expect(source).not.toMatch(/^const \w+ = new (Weak)?Map/m);
  });
});
