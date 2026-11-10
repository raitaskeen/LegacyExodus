import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatCoverage, isTestPath, measureCoverage } from "../../../benchmarks/fact-diff";

describe("call coverage report (Phase A2)", () => {
  test("counts resolved calls and the reasons for the rest, older engines under not-recorded", () => {
    const directory = mkdtempSync(join(tmpdir(), "lx-coverage-"));
    try {
      writeFileSync(join(directory, "semantic.json"), JSON.stringify({ calls: [
        { resolutionState: "RESOLVED", sourceFilePath: "lib/a.js" },
        { resolutionState: "UNRESOLVED", reason: "package-import", sourceFilePath: "lib/a.js" },
        { resolutionState: "EXTERNAL", sourceFilePath: "test/a.test.js" },
        { resolutionState: "UNRESOLVED", sourceFilePath: "test/a.test.js" },
      ] }));
      const coverage = measureCoverage(directory);
      expect(coverage.calls).toBe(4);
      expect(coverage.resolved).toBe(1);
      expect([...coverage.byReason]).toEqual([["package-import", 1], ["external", 1], ["not-recorded", 1]]);
      expect(coverage.source).toEqual({ calls: 2, accounted: 1 });
      expect(coverage.tests).toEqual({ calls: 2, accounted: 1 });
      expect(formatCoverage(coverage)).toEqual([
        "Calls: 4.", "", "| Calls | Count | Share |", "|---|---|---|",
        "| resolved | 1 | 25.0% |", "| external | 1 | 25.0% |", "| not-recorded | 1 | 25.0% |", "| package-import | 1 | 25.0% |", "",
        "Accounted for (RESOLVED or EXTERNAL): source files 50.0% of 2 calls, test files 50.0% of 2.", "",
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

  test("test directories and *.test / *.spec files are test code; the rest is source", () => {
    for (const path of ["test/app.js", "lib/__tests__/a.ts", "spec/x.mjs", "src/a.test.ts", "src/a.spec.tsx", "packages/x/tests/b.js"]) expect(isTestPath(path)).toBe(true);
    for (const path of ["lib/router/index.js", "src/testing.ts", "src/attest.js", "fastify.js"]) expect(isTestPath(path)).toBe(false);
  });
});
