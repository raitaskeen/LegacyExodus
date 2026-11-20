import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CORPUS_TESTS, innermostSite, instrument, judgeRun, originalColumn, preloadSource, runNotes, runProblems, targetFunctions, testCommand, testEnvironment } from "../../../benchmarks/call-oracle";

describe("oracle test runs (AUD-16)", () => {
  test("leaves out only the tests that fail for that oracle", () => {
    const base = ["npx", "borp", "--reporter=@jsumners/line-reporter"];
    expect(testCommand("fastify", "flow")).toEqual([...base, "--ignore", "test/build/version.test.js", "--ignore", "test/http2/closing.test.js"]);
    expect(testCommand("fastify", "call")).toEqual([...base, "--ignore", "test/build/version.test.js", "--ignore", "test/plugin.1.test.js", "--ignore", "test/plugin.4.test.js", "--ignore", "test/issue-4959.test.js", "--ignore", "test/http2/closing.test.js"]);
    expect(testCommand("express", "call")).toEqual(["npm", "run", "test"]);
    expect(() => testCommand("unknown", "call")).toThrow("No test command");
  });

  test("runs the tests without GITHUB_ACTION, whose reporter crashed Fastify's CI runs", () => {
    const env = testEnvironment({ NODE_OPTIONS: "--require=x" }, { GITHUB_ACTION: "__run", GITHUB_ACTIONS: "true", PATH: "p" });
    expect(env.GITHUB_ACTION).toBeUndefined();
    expect(env).toMatchObject({ GITHUB_ACTIONS: "true", PATH: "p", NODE_OPTIONS: "--require=x", CI: "1", NO_COLOR: "1" });
  });

  test("gives every left-out test a reason", () => {
    for (const tests of Object.values(CORPUS_TESTS)) for (const skipped of tests.skip) expect(skipped.reason.length).toBeGreaterThan(20);
  });

  test("a failing suite or a run below its floor is not evidence", () => {
    expect(runProblems("fastify", 0, { observedSites: 9000 })).toEqual([]);
    expect(runProblems("fastify", 1, { observedSites: 9000 })).toEqual(["the test run exited with 1"]);
    expect(runProblems("fastify", null, {})).toEqual(["the test run exited with null"]);
    expect(runProblems("express", 0, { observedSites: 10 })).toEqual(["10 call sites observed, below the floor of 3200"]);
    expect(runProblems("express", 0, { executedStatements: 10 })).toEqual(["10 statements executed, below the floor of 9000"]);
    expect(runNotes("express", "call", ["the test run exited with 1"])).toEqual(["**Not evidence: the test run exited with 1.**", ""]);
  });
});

/** A symbol location starting at `needle` on 1-based `line` of `lines`. */
const at = (lines: readonly string[], line: number, needle: string) => {
  const column = lines[line - 1]!.indexOf(needle);
  if (column < 0) throw new Error(`${needle} not on line ${line}`);
  return { start: { line, column }, end: { line, column: column + needle.length } };
};
const position = (file: string, lines: readonly string[], line: number, needle: string) => `${file}:${line}:${at(lines, line, needle).start.column}`;

describe("call oracle comparison (AUD-04)", () => {
  const lines = [
    "function plain() { return 1; }",
    "class WithCtor { constructor() { this.a = 1; } run() { return 2; } }",
    "class NoCtor { run() {} }",
    "const arrow = () => 3;",
    "const api = { go: plain, m() { return 4; }, data: { x: 1 } };",
    "exports.hook = function () { return 5; };",
    "const made = make();",
    "module.exports.plain = plain;", // 8: the shape `module.exports.createServer = createServer`
    "function runnerFactory(step) { return function runner() { return step; }; }", // 9
    "const runA = runnerFactory(1);", // 10: every call returns the same function
    "module.exports.built = (function () { const main = function inner() {}; return main; })();", // 11: an IIFE
    "var dup = function a() {}; var dup = function b() {}; function useParam(fn) { return fn; }", // 12
    "exports.again = dup; exports.param = useParam(plain);", // 13
    "function app() { const app = { x: 1 }; return app; } module.exports.app = app;", // 14: Fastify's `fastify` shape
  ];
  const find = targetFunctions((file) => (file === "a.js" ? lines.join("\n") : undefined));
  const target = (kind: string, line: number, needle: string) => find({ kind, name: "t", filePath: "a.js", location: at(lines, line, needle) });
  const where = (line: number, needle: string) => position("a.js", lines, line, needle);

  test("names the function a target denotes, from the source at the target's position", () => {
    expect(target("function", 1, "function plain")).toBe(where(1, "function plain"));
    expect(target("class", 2, "class WithCtor")).toBe(where(2, "constructor"));
    expect(target("method", 2, "run")).toBe(where(2, "run"));
    expect(target("variable", 4, "arrow")).toBe(where(4, "() =>"));
    expect(target("variable", 5, "go")).toBe(where(1, "function plain")); // `go: plain`, followed by name
    expect(target("variable", 5, "m()")).toBe(where(5, "m()"));
    expect(target("export", 6, "exports.hook")).toBe(where(6, "function ()"));
    expect(target("export", 8, "module.exports.plain")).toBe(where(1, "function plain"));
    expect(target("variable", 10, "runA")).toBe(where(9, "function runner("));
    expect(target("export", 11, "module.exports.built")).toBe(where(11, "function inner"));
    // The top-level `app` is the function; the `const app` inside it is another scope's binding.
    expect(target("export", 14, "module.exports.app")).toBe(where(14, "function app"));
  });

  test("does not follow a name bound twice in its scope, or a parameter", () => {
    expect(target("export", 13, "exports.again")).toBeUndefined();
    expect(target("export", 13, "exports.param")).toBeUndefined();
  });

  test("names nothing where the source shows no function", () => {
    expect(target("class", 3, "class NoCtor")).toBeUndefined();
    expect(target("variable", 5, "api")).toBeUndefined(); // an object
    expect(target("variable", 5, "data")).toBeUndefined();
    expect(target("variable", 7, "made")).toBeUndefined(); // a call result
    expect(find({ kind: "function", name: "x", filePath: "missing.js", location: at(lines, 1, "function plain") })).toBeUndefined();
  });

  test("counts a call that enters any other function as a contradiction, whatever the target's kind", () => {
    // The engine claims x.run -> the literal method run (a variable symbol, as C1 factory literals give) and
    // plain() -> plain. The run entered the neighbour `other` for x.run and, for plain(), a function nested in plain:
    // both were invisible before (a variable target was "not checkable"; a nested function was inside the span).
    const work = mkdtempSync(join(tmpdir(), "lx-oracle-judge-"));
    try {
      const main = [
        "function make() { return { run() { return 1; }, other() {} }; }",
        "function plain() { return function inner() {}; }",
        "const x = make();",
        "x.run();",
        "plain();",
        "x.other();",
      ];
      writeFileSync(join(work, "main.js"), main.join("\n"));
      mkdirSync(join(work, ".discovery"));
      const symbols = [
        { id: "s-run", kind: "variable", name: "run", filePath: "main.js", location: at(main, 1, "run") },
        { id: "s-other", kind: "variable", name: "other", filePath: "main.js", location: at(main, 1, "other") },
        { id: "s-plain", kind: "function", name: "plain", filePath: "main.js", location: { start: { line: 2, column: 0 }, end: { line: 2, column: main[1]!.length } } },
      ];
      const call = (line: number, calleeName: string, targetSymbolId: string) =>
        ({ sourceFilePath: "main.js", location: { line, column: 0 }, calleeName, callerName: "module", resolutionState: "RESOLVED", targetSymbolId });
      writeFileSync(join(work, ".discovery", "symbols.json"), JSON.stringify(symbols));
      writeFileSync(join(work, ".discovery", "semantic.json"), JSON.stringify({ calls: [call(4, "x.run", "s-run"), call(5, "plain", "s-plain"), call(6, "x.other", "s-other")] }));
      const observed = new Map([
        ["main.js:4:2", new Set([position("main.js", main, 1, "other")])],
        ["main.js:5:0", new Set([position("main.js", main, 2, "function inner")])],
        ["main.js:6:2", new Set([position("main.js", main, 1, "other")])],
      ]);
      const result = judgeRun({ corpus: "demo", clean: work, testExit: 0, observed, instrumentedFiles: 1, skippedFiles: [] });
      expect(result.matchedSites).toBe(3);
      expect(result.resolvedAgree).toBe(1);
      expect(result.unverifiable).toBe(0);
      expect(result.contradictions).toHaveLength(2);
      expect(result.contradictions[0]).toContain("x.run -> engine variable:run");
      expect(result.contradictions[1]).toContain("plain -> engine function:plain");
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

describe("call oracle instrumentation (Phase A3)", () => {
  test("adds a probe after a function's directives and wraps an arrow's expression body", () => {
    const source = "function f() { 'use strict'; return 1; }\nconst g = (x) => x + 1;\n";
    const { code, insertions } = instrument(source, 7);
    expect(code).toBe("function f() { 'use strict';__lxEnter(7,1,0); return 1; }\nconst g = (x) => (__lxEnter(7,2,10),x + 1);\n");
    expect(insertions.map((insertion) => [insertion.line, insertion.column, insertion.length])).toEqual([[1, 28, 17], [2, 17, 19], [2, 22, 1]]);
  });

  test("gives a position to the call that starts last there, so request(createApp()) is not request's", () => {
    // `    request(createApp())`: request spans 4..12 (to just past its parenthesis), createApp 12..22.
    const request = { from: 4, to: 12, name: "request" };
    const createApp = { from: 12, to: 22, name: "createApp" };
    expect(innermostSite([request, createApp], 12)?.name).toBe("createApp");
    expect(innermostSite([request, createApp], 4)?.name).toBe("request");
    // `f().g()`: both start at 0; the shorter callee span (f) owns position 0.
    expect(innermostSite([{ from: 0, to: 6, name: "g" }, { from: 0, to: 2, name: "f" }], 0)?.name).toBe("f");
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
      // The pid alone is not unique: Windows reuses pids within one test run, and a reused pid overwrote a trace.
      expect(readdirSync(traces)).toHaveLength(1);
      expect(readdirSync(traces)[0]).toMatch(new RegExp(`^trace-${run.pid}-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\\.json$`));
      const trace = JSON.parse(readFileSync(join(traces, readdirSync(traces)[0]!), "utf8"));
      // a.js line 3 `main()` enters main (a.js 2:0); line 2 `b.hello()` enters hello (b.js 1:16).
      expect(trace["0:3:1"]).toEqual(["0:2:0"]);
      expect(Object.entries(trace).find(([, callees]) => (callees as string[]).includes("1:1:16"))?.[0].startsWith("0:2:")).toBe(true);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
