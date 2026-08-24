import { describe, expect, it } from "bun:test";
import type { GroundTruthFact } from "../../../src/contracts/fidelity";
import { MigrationFidelityValidator } from "../../../src/governance/fidelity/fidelity-validator";

describe("FINDING-FID-02 — Fidelity Metric Semantics", () => {
  it("classifies unmatched predictions in OPEN_WORLD_SAMPLE as UNVERIFIED_SCOPED, not FALSE_POSITIVE", () => {
    const validator = new MigrationFidelityValidator();

    const sampleGT: GroundTruthFact[] = [
      {
        id: "gt-sym-1",
        category: "symbol",
        filePath: "lib/app.js",
        attributes: { filePath: "lib/app.js", name: "init", kind: "function", exported: true },
        provenance: "MANUAL_VERIFICATION",
        sourceDescription: "init function",
        migrationRelevance: "App initialization",
      },
    ];

    // Predictor outputs 10 symbols in lib/app.js, but GT only samples 1 of them
    const predictions = {
      symbols: [
        { filePath: "lib/app.js", name: "init", kind: "function", exported: true },
        { filePath: "lib/app.js", name: "helper1", kind: "function", exported: false },
        { filePath: "lib/app.js", name: "helper2", kind: "function", exported: false },
        { filePath: "lib/app.js", name: "config", kind: "variable", exported: false },
        { filePath: "other/file.js", name: "outside", kind: "function", exported: true },
      ],
    };

    const report = validator.validate(sampleGT, predictions, {
      targetName: "test-sample",
      isSampleBased: true,
      closedScopeFilePaths: ["lib/app.js"],
      categoryScopes: { symbol: "OPEN_WORLD_SAMPLE" },
    });

    const symbolMetrics = report.categories.find((c) => c.category === "symbol");
    expect(symbolMetrics).toBeDefined();

    // Recall: 1/1 = 100%
    expect(symbolMetrics?.truePositives).toBe(1);
    expect(symbolMetrics?.falseNegatives).toBe(0);
    expect(symbolMetrics?.recall).toBe(1.0);

    // False Positives in open-world sample must be 0 (no disproven/known-negative violations)
    expect(symbolMetrics?.falsePositives).toBe(0);

    // Unverified scoped predictions: 3 helpers inside lib/app.js that are unground-truthed
    expect((symbolMetrics as any)?.unverifiedScopedCount).toBe(3);

    // Unvalidated predictions: 1 symbol in other/file.js outside closedScopeFilePaths
    expect(symbolMetrics?.unvalidatedCount).toBe(1);

    // Precision in OPEN_WORLD_SAMPLE must be null (not mathematically measurable)
    expect(symbolMetrics?.precision).toBeNull();

    // Check match details statuses
    const unverifiedDetails = report.matchDetails.filter((m) => m.category === "symbol" && m.status === ("UNVERIFIED_SCOPED" as any));
    expect(unverifiedDetails.length).toBe(3);

    const falsePositiveDetails = report.matchDetails.filter((m) => m.category === "symbol" && m.status === "FALSE_POSITIVE");
    expect(falsePositiveDetails.length).toBe(0);
  });

  it("classifies unmatched predictions in CLOSED_WORLD as FALSE_POSITIVE and calculates true precision", () => {
    const validator = new MigrationFidelityValidator();

    const closedGT: GroundTruthFact[] = [
      {
        id: "gt-dep-1",
        category: "dependency",
        attributes: { name: "express", kind: "production" },
        provenance: "GROUND_TRUTH_SOURCE",
        sourceDescription: "package.json dependencies",
        migrationRelevance: "core framework",
      },
    ];

    // Predictor finds express and an extra hallucinated dependency
    const predictions = {
      dependencies: [
        { name: "express", kind: "production" },
        { name: "hallucinated-package", kind: "production" },
      ],
    };

    const report = validator.validate(closedGT, predictions, {
      targetName: "test-closed",
      isSampleBased: false,
      categoryScopes: { dependency: "CLOSED_WORLD" },
    });

    const depMetrics = report.categories.find((c) => c.category === "dependency");
    expect(depMetrics).toBeDefined();

    expect(depMetrics?.truePositives).toBe(1);
    expect(depMetrics?.falsePositives).toBe(1);
    expect(depMetrics?.falseNegatives).toBe(0);
    expect(depMetrics?.recall).toBe(1.0);
    // Closed world precision: 1 / (1 + 1) = 50%
    expect(depMetrics?.precision).toBe(0.5);
  });

  it("classifies known-negative violations as FALSE_POSITIVE even in open-world sample", () => {
    const validator = new MigrationFidelityValidator();

    const sampleGTWithKnownNeg: GroundTruthFact[] = [
      {
        id: "gt-sym-valid",
        category: "symbol",
        filePath: "lib/app.js",
        attributes: { filePath: "lib/app.js", name: "init", kind: "function", exported: true },
        provenance: "MANUAL_VERIFICATION",
        sourceDescription: "init function",
        migrationRelevance: "App initialization",
      },
      {
        id: "gt-neg-forbidden",
        category: "symbol",
        filePath: "lib/app.js",
        attributes: { filePath: "lib/app.js", name: "forbiddenSecret", kind: "function" },
        provenance: "KNOWN_NEGATIVE",
        isKnownNegative: true,
        sourceDescription: "forbiddenSecret must not exist",
        migrationRelevance: "Security check",
      },
    ];

    const predictions = {
      symbols: [
        { filePath: "lib/app.js", name: "init", kind: "function", exported: true },
        { filePath: "lib/app.js", name: "forbiddenSecret", kind: "function" },
        { filePath: "lib/app.js", name: "normalHelper", kind: "function" },
      ],
    };

    const report = validator.validate(sampleGTWithKnownNeg, predictions, {
      targetName: "test-neg",
      isSampleBased: true,
      closedScopeFilePaths: ["lib/app.js"],
      categoryScopes: { symbol: "OPEN_WORLD_SAMPLE" },
    });

    const symbolMetrics = report.categories.find((c) => c.category === "symbol");
    expect(symbolMetrics?.truePositives).toBe(1);
    expect(symbolMetrics?.falsePositives).toBe(1); // 1 known-negative violation
    expect((symbolMetrics as any)?.unverifiedScopedCount).toBe(1); // 1 unground-truthed helper

    const knownNegViolations = report.matchDetails.filter((m) => m.groundTruth?.isKnownNegative && m.status === "FALSE_POSITIVE");
    expect(knownNegViolations.length).toBe(1);
  });
});
