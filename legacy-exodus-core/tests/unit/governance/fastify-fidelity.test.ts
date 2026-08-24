import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { fastifyGroundTruth } from "../../../benchmarks/fidelity/fastify-ground-truth";
import { runFidelityValidation } from "../../../benchmarks/fidelity/runner";
import { ensureDiscoveryProjections } from "./test-fidelity-helpers";

describe("Fastify Migration Fidelity Baseline", () => {
  it("validates representative Fastify ground-truth facts against discovery projections", async () => {
    const fastifyPath = resolve(import.meta.dir, "../../../benchmarks/.cache/fastify");
    await ensureDiscoveryProjections(fastifyPath);
    const report = await runFidelityValidation({
      repoPath: fastifyPath,
      groundTruth: fastifyGroundTruth,
    });

    expect(report.targetName).toBe("fastify");
    expect(report.totalGroundTruthFacts).toBeGreaterThanOrEqual(150);
    expect(report.isSampleBased).toBe(true);

    // Verify core files: 25/25 discovered (100% recall)
    const fileMetrics = report.categories.find((c) => c.category === "file");
    expect(fileMetrics).toBeDefined();
    expect(fileMetrics?.groundTruthCount).toBe(25);
    expect(fileMetrics?.truePositives).toBe(25);
    expect(fileMetrics?.falseNegatives).toBe(0);
    expect(fileMetrics?.recall).toBe(1.0);

    // Verify package dependencies: 14/14 matched (100% recall)
    const depMetrics = report.categories.find((c) => c.category === "dependency");
    expect(depMetrics).toBeDefined();
    expect(depMetrics?.groundTruthCount).toBe(14);
    expect(depMetrics?.truePositives).toBe(14);
    expect(depMetrics?.recall).toBe(1.0);

    // Verify symbols: 32/32 matched (100% recall)
    const symMetrics = report.categories.find((c) => c.category === "symbol");
    expect(symMetrics).toBeDefined();
    expect(symMetrics?.groundTruthCount).toBe(32);
    expect(symMetrics?.truePositives).toBe(32);
    expect(symMetrics?.recall).toBe(1.0);

    // Verify imports: 17/17 matched (100% recall)
    const impMetrics = report.categories.find((c) => c.category === "import");
    expect(impMetrics).toBeDefined();
    expect(impMetrics?.groundTruthCount).toBe(17);
    expect(impMetrics?.truePositives).toBe(17);
    expect(impMetrics?.recall).toBe(1.0);

    // Verify exports: 18/18 matched (100% recall)
    const expMetrics = report.categories.find((c) => c.category === "export");
    expect(expMetrics).toBeDefined();
    expect(expMetrics?.groundTruthCount).toBe(18);
    expect(expMetrics?.truePositives).toBe(18);
    expect(expMetrics?.recall).toBe(1.0);

    // Verify dependency edges: 20/20 discovered (100% recall)
    const edgeMetrics = report.categories.find((c) => c.category === "dependency_edge");
    expect(edgeMetrics).toBeDefined();
    expect(edgeMetrics?.groundTruthCount).toBe(20);
    expect(edgeMetrics?.truePositives).toBe(20);
    expect(edgeMetrics?.recall).toBe(1.0);

    // Verify calls: 16/16 discovered (100% recall across resolved and unresolved)
    const callMetrics = report.categories.find((c) => c.category === "call");
    expect(callMetrics).toBeDefined();
    expect(callMetrics?.groundTruthCount).toBe(16);
    expect(callMetrics?.truePositives).toBe(16);
    expect(callMetrics?.recall).toBe(1.0);

    // Verify CFGs: 7/7 discovered (100% recall)
    const cfgMetrics = report.categories.find((c) => c.category === "cfg");
    expect(cfgMetrics).toBeDefined();
    expect(cfgMetrics?.groundTruthCount).toBe(7);
    expect(cfgMetrics?.truePositives).toBe(7);
    expect(cfgMetrics?.recall).toBe(1.0);

    // Verify DFGs: 5/5 discovered (100% recall)
    const dfgMetrics = report.categories.find((c) => c.category === "dfg");
    expect(dfgMetrics).toBeDefined();
    expect(dfgMetrics?.groundTruthCount).toBe(5);
    expect(dfgMetrics?.truePositives).toBe(5);
    expect(dfgMetrics?.recall).toBe(1.0);

    // Overall sample ground-truth recall >= 95%
    expect(report.overallRecall).toBeGreaterThanOrEqual(0.95);

    // Actionable correctness on true positives must be 100%
    expect(report.overallActionableCorrectness).toBe(1.0);

    // Absolute Safety Invariant Check:
    // Sample-based validation MUST NOT claim full migration safety
    expect(report.migrationSafetyVerdict).toBe("MIGRATION_SAFETY_NOT_YET_ESTABLISHED");
  }, 180000);
});
