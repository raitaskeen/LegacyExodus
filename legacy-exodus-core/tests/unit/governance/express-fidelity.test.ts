import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

import { runFidelityValidation } from "../../../benchmarks/fidelity/runner";
import { ensureDiscoveryProjections } from "./test-fidelity-helpers";

describe("Express v4.21.2 Migration Fidelity Baseline", () => {
  it("validates representative Express ground-truth facts against discovery projections", async () => {
    const repoPath = resolve(import.meta.dir, "../../../benchmarks/.cache/express");
    await ensureDiscoveryProjections(repoPath);
    const report = await runFidelityValidation({ repoPath });

    expect(report.targetName).toBe("express");
    expect(report.isSampleBased).toBe(true);
    expect(report.totalGroundTruthFacts).toBeGreaterThanOrEqual(90);

    // P1.7A Hardened Metrics: Overall recall >= 95%, Call recall >= 90%, Symbol recall >= 85%
    expect(report.overallTruePositives).toBeGreaterThanOrEqual(95);
    expect(report.overallRecall).toBeGreaterThanOrEqual(0.95);

    const callCategory = report.categories.find((c) => c.category === "call");
    expect(callCategory?.recall).toBeGreaterThanOrEqual(0.9);

    const symbolCategory = report.categories.find((c) => c.category === "symbol");
    expect(symbolCategory?.recall).toBeGreaterThanOrEqual(0.85);

    // All verified TPs must have 100% actionable correctness
    expect(report.overallActionableCorrectness).toBe(1.0);

    // Safety verdict must be evidence-bound and not overstated
    expect(report.migrationSafetyVerdict).toBe("MIGRATION_SAFETY_NOT_YET_ESTABLISHED");

    // Known negatives (5 failure-first assertions) must not generate false positives
    const violatedKnownNegatives = report.matchDetails.filter((m) => m.groundTruth?.isKnownNegative && m.status === "FALSE_POSITIVE");
    expect(violatedKnownNegatives.length).toBe(0);

    // Verify all 10 semantic categories are present
    const categories = report.categories.map((c) => c.category);
    expect(categories).toContain("file");
    expect(categories).toContain("dependency");
    expect(categories).toContain("framework");
    expect(categories).toContain("symbol");
    expect(categories).toContain("import");
    expect(categories).toContain("export");
    expect(categories).toContain("dependency_edge");
    expect(categories).toContain("call");
    expect(categories).toContain("cfg");
    expect(categories).toContain("dfg");
  }, 180000);
});
