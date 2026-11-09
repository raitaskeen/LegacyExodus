import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { instrument, originalColumn, preloadSource } from "../../../benchmarks/call-oracle";

describe("call oracle instrumentation (Phase A3)", () => {
  test("adds a probe after a function's directives and wraps an arrow's expression body", () => {
    const source = "function f() { 'use strict'; return 1; }\nconst g = (x) => x + 1;\n";
    const { code, insertions } = instrument(source, 7);
    expect(code).toBe("function f() { 'use strict';__lxEnter(7,1,0); return 1; }\nconst g = (x) => (__lxEnter(7,2,10),x + 1);\n");
    expect(insertions.map((insertion) => [insertion.line, insertion.column, insertion.length])).toEqual([[1, 28, 17], [2, 17, 19], [2, 22, 1]]);
  });

  test("maps an instrumented column back to the original column on that line", () => {
    const insertions = [{ line: 2, column: 17, length: 19 }, { line: 2, column: 22, length: 1 }];
    expect(originalColumn(insertions, 2, 10)).toBe(10);
    expect(originalColumn(insertions, 2, 17 + 19 + 2)).toBe(19);
    expect(originalColumn(insertions, 2, 22 + 19 + 1 + 3)).toBe(25);
    expect(originalColumn(insertions, 3, 40)).toBe(40);
  });

  test("records which call site entered which function, in a real Node run", () => {
    const node = spawnSync("node", ["--version"], { encoding: "utf8" });
    if (node.status !== 0) return; // Node is not installed here: the oracle cannot run either.
    const work = mkdtempSync(join(tmpdir(), "lx-oracle-test-"));
    try {
      const root = join(work, "app");
      mkdirSync(root);
      const files = ["a.js", "b.js"];
      writeFileSync(join(root, "b.js"), instrument("exports.hello = function hello() { return 1; };\n", 1).code);
      writeFileSync(join(root, "a.js"), instrument("const b = require('./b');\nfunction main() { return b.hello(); }\nmain();\n", 0).code);
      const traces = join(work, "traces");
      mkdirSync(traces);
      writeFileSync(join(work, "preload.cjs"), preloadSource(root, files, traces));
      const run = spawnSync("node", ["--require", join(work, "preload.cjs"), join(root, "a.js")], { encoding: "utf8" });
      expect(run.status).toBe(0);
      const trace = JSON.parse(readFileSync(join(traces, readdirSync(traces)[0]!), "utf8"));
      // a.js line 3 `main()` enters main (a.js 2:0); line 2 `b.hello()` enters hello (b.js 1:16).
      expect(trace["0:3:1"]).toEqual(["0:2:0"]);
      expect(Object.entries(trace).find(([, callees]) => (callees as string[]).includes("1:1:16"))?.[0].startsWith("0:2:")).toBe(true);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
