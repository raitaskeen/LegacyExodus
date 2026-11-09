import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatCoverage, measureCoverage } from "../../../benchmarks/fact-diff";

describe("call coverage report (Phase A2)", () => {
  test("counts resolved calls and the reasons for the rest, older engines under not-recorded", () => {
    const directory = mkdtempSync(join(tmpdir(), "lx-coverage-"));
    try {
      writeFileSync(join(directory, "semantic.json"), JSON.stringify({ calls: [
        { resolutionState: "RESOLVED" },
        { resolutionState: "UNRESOLVED", reason: "package-import" },
        { resolutionState: "UNRESOLVED", reason: "package-import" },
        { resolutionState: "UNRESOLVED" },
      ] }));
      const coverage = measureCoverage(directory);
      expect(coverage.calls).toBe(4);
      expect(coverage.resolved).toBe(1);
      expect([...coverage.byReason]).toEqual([["package-import", 2], ["not-recorded", 1]]);
      expect(formatCoverage(coverage)).toEqual([
        "Calls: 4.", "", "| Calls | Count | Share |", "|---|---|---|",
        "| resolved | 1 | 25.0% |", "| package-import | 2 | 50.0% |", "| not-recorded | 1 | 25.0% |", "",
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("puts base and head side by side, with shares of the head", () => {
    const base = { calls: 2, resolved: 0, byReason: new Map([["not-recorded", 2]]) };
    const head = { calls: 2, resolved: 1, byReason: new Map([["unbound-name", 1]]) };
    expect(formatCoverage(head, base)).toEqual([
      "Calls: base 2, head 2.", "", "| Calls | Base | Head | Share (head) |", "|---|---|---|---|",
      "| resolved | 0 | 1 | 50.0% |", "| unbound-name | 0 | 1 | 50.0% |", "| not-recorded | 2 | 0 | 0.0% |", "",
    ]);
  });
});
