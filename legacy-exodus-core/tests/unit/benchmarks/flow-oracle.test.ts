import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { executedAt, readCoverage } from "../../../benchmarks/flow-oracle";

describe("flow oracle (Phase A4)", () => {
  test("the innermost coverage range decides whether a position ran", () => {
    // A function that ran once, with an `if` body that never ran inside it.
    const ranges = [{ start: 0, end: 100, count: 1 }, { start: 40, end: 60, count: 0 }];
    expect(executedAt(ranges, 10)).toBe(true);
    expect(executedAt(ranges, 45)).toBe(false);
    expect(executedAt(ranges, 70)).toBe(true);
    expect(executedAt(ranges, 150)).toBe(false);
    expect(executedAt(undefined, 10)).toBe(false);
  });

  test("reads V8 coverage files into ranges per corpus file, skipping dependencies and other roots", () => {
    const work = mkdtempSync(join(tmpdir(), "lx-flow-oracle-test-"));
    try {
      const root = join(work, "app");
      mkdirSync(join(root, "lib"), { recursive: true });
      const url = (path: string) => pathToFileURL(join(root, path)).href;
      writeFileSync(join(work, "coverage-1.json"), JSON.stringify({ result: [
        { url: url("lib/a.js"), functions: [{ ranges: [{ startOffset: 0, endOffset: 30, count: 2 }] }] },
        { url: url("node_modules/x/index.js"), functions: [{ ranges: [{ startOffset: 0, endOffset: 5, count: 1 }] }] },
        { url: "node:internal/x", functions: [] },
      ] }));
      writeFileSync(join(work, "coverage-2.json"), JSON.stringify({ result: [
        { url: url("lib/a.js"), functions: [{ ranges: [{ startOffset: 10, endOffset: 20, count: 0 }] }] },
      ] }));
      const coverage = readCoverage(work, root);
      expect([...coverage.keys()]).toEqual(["lib/a.js"]);
      expect(coverage.get("lib/a.js")).toEqual([{ start: 0, end: 30, count: 2 }, { start: 10, end: 20, count: 0 }]);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
