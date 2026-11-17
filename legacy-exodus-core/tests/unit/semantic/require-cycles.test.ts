import { describe, expect, test } from "bun:test";

import { requireCycles, staleExportFiles, type LoadTimeModuleFacts } from "@semantic/require-cycles";

const at = (line: number): { readonly line: number; readonly column: number } => ({ line, column: 0 });
const file = (filePath: string, loads: readonly [string, number][], exportsReplacedAt: readonly number[] = []): LoadTimeModuleFacts => ({
  filePath,
  loads: loads.map(([specifier, line]) => ({ specifier, at: at(line) })),
  exportsReplacedAt: exportsReplacedAt.map(at),
});
// Specifiers are the target paths themselves in these tests.
const resolve = (_importer: string, specifier: string): string | undefined => specifier;

describe("require cycles (RT-M9)", () => {
  test("finds a three-file cycle and a file that loads itself, and nothing else", () => {
    const facts = [
      file("a.js", [["b.js", 1]]),
      file("b.js", [["c.js", 1]]),
      file("c.js", [["a.js", 1], ["d.js", 2]]),
      file("d.js", []),
      file("self.js", [["self.js", 1]]),
    ];
    const cycles = requireCycles(facts, resolve);

    expect([...(cycles.get("a.js") ?? [])].sort()).toEqual(["a.js", "b.js", "c.js"]);
    expect(cycles.get("b.js")).toBe(cycles.get("a.js"));
    expect(cycles.has("d.js")).toBe(false);
    expect([...(cycles.get("self.js") ?? [])]).toEqual(["self.js"]);
  });

  test("ignores loads that resolve to no analysed file", () => {
    const cycles = requireCycles([file("a.js", [["fs", 1], ["missing.js", 2]])], (_importer, specifier) => (specifier === "fs" ? undefined : specifier));

    expect(cycles.size).toBe(0);
  });

  test("marks a file stale only when it replaces module.exports after loading a file of its cycle", () => {
    const facts = [
      file("late.js", [["other.js", 1]], [3]),
      file("other.js", [["late.js", 1]]),
      file("early.js", [["peer.js", 5]], [2]),
      file("peer.js", [["early.js", 1]]),
      file("alone.js", [], [1]),
    ];
    const stale = staleExportFiles(facts, requireCycles(facts, resolve), resolve);

    expect([...stale].sort()).toEqual(["late.js"]);
  });
});
