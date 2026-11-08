import { describe, expect, it } from "bun:test";

import { formatAccuracy, summarize, type ExpectationResult } from "../../../benchmarks/accuracy";

/** The accuracy report counts planted facts as recall and negative controls as precision, per category. */
describe("accuracy report", () => {
  const results: readonly ExpectationResult[] = [
    { caseId: "a", id: "a:1", category: "taint", kind: "planted", holds: true },
    { caseId: "a", id: "a:2", category: "taint", kind: "planted", holds: false, gap: "NA-03" },
    { caseId: "a", id: "a:3", category: "taint", kind: "control", holds: true },
    { caseId: "b", id: "b:1", category: "calls", kind: "planted", holds: true },
  ];

  it("summarizes recall and precision per category, in code-point order", () => {
    expect(summarize(results)).toEqual([
      { category: "calls", planted: 1, plantedHolding: 1, controls: 0, controlsHolding: 0, checks: 0, checksHolding: 0 },
      { category: "taint", planted: 2, plantedHolding: 1, controls: 1, controlsHolding: 1, checks: 0, checksHolding: 0 },
    ]);
  });

  it("lists a known gap with its owner and separates regressions", () => {
    const markdown = formatAccuracy(results);
    expect(markdown).toContain("Planted facts found (recall): **2/3 (66.7%)**");
    expect(markdown).toContain("| a:2 | taint | NA-03 |");
    expect(markdown).toContain("Regressions: **0**");
    expect(formatAccuracy([...results, { caseId: "c", id: "c:1", category: "calls", kind: "planted", holds: false }])).toContain("## Regressions");
  });
});
