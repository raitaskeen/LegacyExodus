import { describe, expect, it } from "bun:test";
import type { GroundTruthFact } from "@contracts/fidelity";
import {
  MigrationFidelityValidator,
  type PredictionPayload,
} from "@governance/fidelity/fidelity-validator";
import { isFactActionable, normalizePath } from "@governance/fidelity/fidelity-matcher";

describe("MigrationFidelityValidator — Metric Correctness & Synthetic Suite", () => {
  const baseGT: readonly GroundTruthFact[] = [
    {
      id: "gt-1",
      category: "file",
      attributes: { path: "src/index.js", language: "javascript" },
      provenance: "GROUND_TRUTH_SOURCE",
      sourceDescription: "Main entry file",
      migrationRelevance: "File existence",
    },
    {
      id: "gt-2",
      category: "dependency",
      attributes: { name: "fastify", version: "^5.0.0", kind: "production" },
      provenance: "GROUND_TRUTH_SOURCE",
      sourceDescription: "Core dep",
      migrationRelevance: "Package dep",
    },
    {
      id: "gt-3",
      category: "symbol",
      filePath: "src/index.js",
      attributes: { filePath: "src/index.js", name: "app", kind: "variable", exported: true },
      provenance: "MANUAL_VERIFICATION",
      sourceDescription: "Exported app instance",
      migrationRelevance: "Symbol resolution",
    },
  ];

  // 1. Perfect precision and recall in closed world
  it("Scenario 1 & 2: evaluates perfect precision (1.0) and recall (1.0) on exact matches", () => {
    const predictions: PredictionPayload = {
      files: [{ path: "src/index.js", language: "javascript" }],
      dependencies: [{ name: "fastify", version: "^5.0.0", kind: "production" }],
      symbols: [{ filePath: "src/index.js", name: "app", kind: "variable", exported: true }],
    };

    const validator = new MigrationFidelityValidator();
    const report = validator.validate(baseGT, predictions, {
      targetName: "test-perfect",
      isSampleBased: false,
      categoryScopes: { file: "CLOSED_WORLD", dependency: "CLOSED_WORLD", symbol: "CLOSED_WORLD" },
    });

    expect(report.overallPrecision).toBe(1.0);
    expect(report.overallRecall).toBe(1.0);
    expect(report.overallTruePositives).toBe(3);
    expect(report.overallFalsePositives).toBe(0);
    expect(report.overallFalseNegatives).toBe(0);
  });

  // 3. Mixed TP / FP / FN
  it("Scenario 3: accurately calculates mixed TP, FP, and FN in closed scope", () => {
    const predictions: PredictionPayload = {
      files: [
        { path: "src/index.js", language: "javascript" }, // TP
        { path: "src/extra.js", language: "javascript" }, // FP (in closed world)
      ],
      dependencies: [
        // Missing gt-2 (FN)
        { name: "unexpected-pkg", version: "1.0.0", kind: "production" }, // FP
      ],
      symbols: [{ filePath: "src/index.js", name: "app", kind: "variable", exported: true }], // TP
    };

    const validator = new MigrationFidelityValidator();
    const report = validator.validate(baseGT, predictions, {
      targetName: "test-mixed",
      isSampleBased: false,
      categoryScopes: { file: "CLOSED_WORLD", dependency: "CLOSED_WORLD", symbol: "CLOSED_WORLD" },
    });

    expect(report.overallTruePositives).toBe(2); // file + symbol
    expect(report.overallFalsePositives).toBe(2); // extra file + unexpected pkg
    expect(report.overallFalseNegatives).toBe(1); // missing fastify dep
    expect(report.overallPrecision).toBeCloseTo(2 / 4, 2);
    expect(report.overallRecall).toBeCloseTo(2 / 3, 2);
  });

  // 4. Unvalidated Predictions (Crucial Metric Audit Rule)
  it("Scenario 4: classifies predictions outside the validated scope as UNVALIDATED, not False Positives", () => {
    const sampleGT: readonly GroundTruthFact[] = [
      {
        id: "gt-sym-app",
        category: "symbol",
        filePath: "src/index.js",
        attributes: { filePath: "src/index.js", name: "app", kind: "variable", exported: true },
        provenance: "MANUAL_VERIFICATION",
        sourceDescription: "app symbol",
        migrationRelevance: "Symbol",
      },
    ];

    // Predictions contain 1 symbol in validated scope (src/index.js) and 100 symbols in unvalidated files
    const predictions: PredictionPayload = {
      symbols: [
        { filePath: "src/index.js", name: "app", kind: "variable", exported: true }, // TP
        { filePath: "src/unverified1.js", name: "helper1", kind: "function" },      // UNVALIDATED
        { filePath: "src/unverified2.js", name: "helper2", kind: "function" },      // UNVALIDATED
      ],
    };

    const validator = new MigrationFidelityValidator();
    const report = validator.validate(sampleGT, predictions, {
      targetName: "test-unvalidated",
      isSampleBased: true,
      closedScopeFilePaths: ["src/index.js"],
    });

    const symMetric = report.categories.find((c) => c.category === "symbol");
    expect(symMetric).toBeDefined();
    expect(symMetric?.truePositives).toBe(1);
    expect(symMetric?.falsePositives).toBe(0); // MUST NOT BE 2!
    expect(symMetric?.unvalidatedCount).toBe(2);
    expect(symMetric?.precision).toBeNull(); // Precision in OPEN_WORLD_SAMPLE is null
    expect(symMetric?.recall).toBe(1.0);    // Recall on GT is 100%
  });

  // 5. Known Negatives
  it("Scenario 5: flags predictions that match known-negative facts as FALSE_POSITIVE", () => {
    const gtWithNegative: readonly GroundTruthFact[] = [
      {
        id: "gt-pos",
        category: "symbol",
        filePath: "src/index.js",
        attributes: { filePath: "src/index.js", name: "app", kind: "variable", exported: true },
        provenance: "MANUAL_VERIFICATION",
        sourceDescription: "app symbol",
        migrationRelevance: "Symbol",
      },
      {
        id: "gt-neg",
        category: "symbol",
        filePath: "src/index.js",
        attributes: { filePath: "src/index.js", name: "privatePassword", kind: "variable", exported: true },
        provenance: "KNOWN_NEGATIVE",
        isKnownNegative: true,
        sourceDescription: "privatePassword MUST NOT be exported",
        migrationRelevance: "Security boundary",
      },
    ];

    const predictions: PredictionPayload = {
      symbols: [
        { filePath: "src/index.js", name: "app", kind: "variable", exported: true },
        { filePath: "src/index.js", name: "privatePassword", kind: "variable", exported: true }, // VIOLATES KNOWN NEGATIVE!
      ],
    };

    const validator = new MigrationFidelityValidator();
    const report = validator.validate(gtWithNegative, predictions, { targetName: "test-negative" });

    expect(report.overallFalsePositives).toBeGreaterThan(0);
    const negMatch = report.matchDetails.find(
      (d) => d.status === "FALSE_POSITIVE" && d.groundTruth?.isKnownNegative,
    );
    expect(negMatch).toBeDefined();
    expect(negMatch?.notes).toContain("Known-negative fact violated");
  });

  // 6. Empty Ground Truth
  it("Scenario 6: returns null / not measurable when ground truth is empty", () => {
    const validator = new MigrationFidelityValidator();
    const report = validator.validate([], { files: [{ path: "src/index.js", language: "javascript" }] }, { targetName: "test-empty-gt" });

    expect(report.totalGroundTruthFacts).toBe(0);
    expect(report.overallRecall).toBeNull();
    const fileMetric = report.categories.find((c) => c.category === "file");
    expect(fileMetric?.status).toBe("NOT_MEASURED");
    expect(fileMetric?.recall).toBeNull();
  });

  // 7. Empty Predictions
  it("Scenario 7: evaluates 0% recall and 100% false negatives when predictions are empty", () => {
    const validator = new MigrationFidelityValidator();
    const report = validator.validate(baseGT, {}, { targetName: "test-empty-preds" });

    expect(report.overallTruePositives).toBe(0);
    expect(report.overallFalseNegatives).toBe(3);
    expect(report.overallRecall).toBe(0.0);
    expect(report.overallPrecision).toBeNull(); // 0 / 0
  });

  // 8. Category-Specific Universes
  it("Scenario 8: isolates evaluations per category without cross-category leakage", () => {
    const predictions: PredictionPayload = {
      files: [{ path: "src/index.js", language: "javascript" }],
      dependencies: [], // Missing
      symbols: [{ filePath: "src/index.js", name: "app", kind: "variable", exported: true }],
    };

    const validator = new MigrationFidelityValidator();
    const report = validator.validate(baseGT, predictions, { targetName: "test-categories" });

    const fileCat = report.categories.find((c) => c.category === "file");
    const depCat = report.categories.find((c) => c.category === "dependency");
    const symCat = report.categories.find((c) => c.category === "symbol");

    expect(fileCat?.recall).toBe(1.0);
    expect(depCat?.recall).toBe(0.0);
    expect(symCat?.recall).toBe(1.0);
  });

  // 9 & 10. Open-World vs Closed-World Validation
  it("Scenario 9 & 10: respects OPEN_WORLD_SAMPLE vs CLOSED_WORLD scoping rules", () => {
    const gt: readonly GroundTruthFact[] = [
      {
        id: "gt-1",
        category: "file",
        attributes: { path: "src/a.js", language: "javascript" },
        provenance: "GROUND_TRUTH_SOURCE",
        sourceDescription: "a.js",
        migrationRelevance: "File",
      },
    ];

    const predictions: PredictionPayload = {
      files: [
        { path: "src/a.js", language: "javascript" },
        { path: "src/b.js", language: "javascript" },
      ],
    };

    const validator = new MigrationFidelityValidator();

    // Closed-World: src/b.js IS an FP
    const closedReport = validator.validate(gt, predictions, {
      targetName: "closed",
      categoryScopes: { file: "CLOSED_WORLD" },
    });
    expect(closedReport.overallFalsePositives).toBe(1);

    // Open-World: src/b.js is UNVALIDATED
    const openReport = validator.validate(gt, predictions, {
      targetName: "open",
      categoryScopes: { file: "OPEN_WORLD_SAMPLE" },
      closedScopeFilePaths: ["src/a.js"],
    });
    expect(openReport.overallFalsePositives).toBe(0);
    expect(openReport.totalUnvalidatedPredictions).toBe(1);
  });

  // 11. Duplicate Predictions
  it("Scenario 11: prevents duplicate predictions from artificially inflating True Positives", () => {
    const singleGT: readonly GroundTruthFact[] = [
      {
        id: "gt-sym",
        category: "symbol",
        filePath: "src/index.js",
        attributes: { filePath: "src/index.js", name: "app", kind: "variable", exported: true },
        provenance: "MANUAL_VERIFICATION",
        sourceDescription: "app",
        migrationRelevance: "Symbol",
      },
    ];

    const predictions: PredictionPayload = {
      symbols: [
        { filePath: "src/index.js", name: "app", kind: "variable", exported: true },
        { filePath: "src/index.js", name: "app", kind: "variable", exported: true }, // DUPLICATE PREDICTION
      ],
    };

    const validator = new MigrationFidelityValidator();
    const report = validator.validate(singleGT, predictions, {
      targetName: "test-dup",
      categoryScopes: { symbol: "CLOSED_WORLD" },
    });

    expect(report.overallTruePositives).toBe(1); // Only matched once
    expect(report.overallFalsePositives).toBe(1); // Second one is unmatched/redundant in closed world
    expect(report.overallRecall).toBe(1.0);
  });

  // 12. Normalization Differences
  it("Scenario 12: handles Windows vs POSIX path normalization transparently", () => {
    expect(normalizePath("src\\controllers\\user.js")).toBe("src/controllers/user.js");
    expect(normalizePath("./lib/symbols.js")).toBe("lib/symbols.js");

    const gt: readonly GroundTruthFact[] = [
      {
        id: "gt-path",
        category: "file",
        attributes: { path: "src/lib/server.js", language: "javascript" },
        provenance: "GROUND_TRUTH_SOURCE",
        sourceDescription: "server",
        migrationRelevance: "Path test",
      },
    ];

    const predictions: PredictionPayload = {
      files: [{ path: "src\\lib\\server.js", language: "javascript" }],
    };

    const validator = new MigrationFidelityValidator();
    const report = validator.validate(gt, predictions, { targetName: "test-norm" });

    expect(report.overallTruePositives).toBe(1);
    expect(report.overallFalseNegatives).toBe(0);
  });

  // 13. Intentionally Corrupted Attributes
  it("Scenario 13: flags corrupted attributes as False Negatives for GT and False Positives for prediction", () => {
    const gt: readonly GroundTruthFact[] = [
      {
        id: "gt-dep",
        category: "dependency",
        attributes: { name: "fastify", version: "^5.0.0", kind: "production" },
        provenance: "GROUND_TRUTH_SOURCE",
        sourceDescription: "fastify dep",
        migrationRelevance: "Dep",
      },
    ];

    const predictions: PredictionPayload = {
      dependencies: [{ name: "fastify", version: "^5.0.0", kind: "development" }], // WRONG KIND!
    };

    const validator = new MigrationFidelityValidator();
    const report = validator.validate(gt, predictions, {
      targetName: "test-corrupt",
      categoryScopes: { dependency: "CLOSED_WORLD" },
    });

    expect(report.overallTruePositives).toBe(0);
    expect(report.overallFalseNegatives).toBe(1);
    expect(report.overallFalsePositives).toBe(1);
  });

  it("evaluates actionable correctness accurately on verified TPs", () => {
    const gtSymbol: GroundTruthFact = {
      id: "gt-sym",
      category: "symbol",
      attributes: { filePath: "src/index.js", name: "foo", kind: "function", exported: true },
      provenance: "MANUAL_VERIFICATION",
      sourceDescription: "Function foo",
      migrationRelevance: "Actionable function symbol",
    };

    expect(isFactActionable(gtSymbol, { name: "foo", kind: "function" })).toBe(true);
    expect(isFactActionable(gtSymbol, { name: "foo", kind: "unknown" })).toBe(false);
    expect(isFactActionable(gtSymbol, { name: "", kind: "function" })).toBe(false);
  });

  // 14. CFG & DFG Validation
  it("Scenario 14: evaluates CFG and DFG facts and verifies actionability", () => {
    const gt: readonly GroundTruthFact[] = [
      {
        id: "gt-cfg",
        category: "cfg",
        filePath: "src/router.js",
        attributes: { filePath: "src/router.js", minBlockCount: 3, minEdgeCount: 2 },
        provenance: "MANUAL_VERIFICATION",
        sourceDescription: "Router CFG",
        migrationRelevance: "CFG branch test",
      },
      {
        id: "gt-dfg",
        category: "dfg",
        filePath: "src/router.js",
        attributes: { filePath: "src/router.js", minDefinitionCount: 5, minUseCount: 10 },
        provenance: "MANUAL_VERIFICATION",
        sourceDescription: "Router DFG",
        migrationRelevance: "DFG flow test",
      },
    ];

    const predictions: PredictionPayload = {
      cfgs: [{ filePath: "src/router.js", blockCount: 5, edgeCount: 4, blocks: [{}, {}, {}, {}, {}], edges: [{}, {}, {}, {}] }],
      dfgs: [{ filePath: "src/router.js", defCount: 10, useCount: 20, definitions: new Array(10).fill({}), uses: new Array(20).fill({}) }],
    };

    const validator = new MigrationFidelityValidator();
    const report = validator.validate(gt, predictions, {
      targetName: "test-cfg-dfg",
      closedScopeFilePaths: ["src/router.js"],
    });

    expect(report.overallTruePositives).toBe(2);
    expect(report.overallFalseNegatives).toBe(0);
    expect(report.overallActionableCorrectness).toBe(1.0);
  });

  // 15. Call Resolution State Matching
  it("Scenario 15: correctly differentiates RESOLVED vs UNRESOLVED call facts", () => {
    const gt: readonly GroundTruthFact[] = [
      {
        id: "gt-call-resolved",
        category: "call",
        filePath: "src/app.js",
        attributes: { sourceFilePath: "src/app.js", calleeName: "helper", resolutionState: "RESOLVED" },
        provenance: "MANUAL_VERIFICATION",
        sourceDescription: "Static call",
        migrationRelevance: "Resolved call",
      },
      {
        id: "gt-call-unresolved",
        category: "call",
        filePath: "src/app.js",
        attributes: { sourceFilePath: "src/app.js", calleeName: "dynamicFn", resolutionState: "UNRESOLVED" },
        provenance: "MANUAL_VERIFICATION",
        sourceDescription: "Dynamic call",
        migrationRelevance: "Unresolved call",
      },
    ];

    const predictions: PredictionPayload = {
      calls: [
        { sourceFilePath: "src/app.js", calleeName: "helper", resolutionState: "RESOLVED", targetSymbolId: "sym-123" },
        { sourceFilePath: "src/app.js", calleeName: "dynamicFn", resolutionState: "UNRESOLVED" },
      ],
    };

    const validator = new MigrationFidelityValidator();
    const report = validator.validate(gt, predictions, {
      targetName: "test-calls",
      closedScopeFilePaths: ["src/app.js"],
    });

    expect(report.overallTruePositives).toBe(2);
    expect(report.overallFalseNegatives).toBe(0);
    expect(report.overallActionableCorrectness).toBe(1.0);
  });

  // 16. Missing Required Artifact/Manifest Throws Explicit Error (Runner Level)
  it("Scenario 16: runner throws explicit error when required discovery artifact or manifest is missing", async () => {
    const { runFidelityValidation } = await import("../../../benchmarks/fidelity/runner");

    // Attempting to validate a non-existent directory without predictions throws
    await expect(
      runFidelityValidation({ repoPath: "benchmarks/.nonexistent-cache-dir" }),
    ).rejects.toThrow(/Missing required discovery (manifest|artifact)/);
  });

  // 17. Deterministic Repeated Validation
  it("Scenario 17: produces bit-for-bit identical metrics on repeated validation runs", () => {
    const validator = new MigrationFidelityValidator();
    const predictions: PredictionPayload = {
      files: [{ path: "src/index.js", language: "javascript" }],
      dependencies: [{ name: "fastify", version: "^5.0.0", kind: "production" }],
      symbols: [{ filePath: "src/index.js", name: "app", kind: "variable", exported: true }],
    };

    const run1 = validator.validate(baseGT, predictions, { targetName: "repeat-test" });
    const run2 = validator.validate(baseGT, predictions, { targetName: "repeat-test" });

    expect(run1.overallPrecision).toBe(run2.overallPrecision);
    expect(run1.overallRecall).toBe(run2.overallRecall);
    expect(run1.overallTruePositives).toBe(run2.overallTruePositives);
    expect(run1.overallFalsePositives).toBe(run2.overallFalsePositives);
    expect(run1.overallFalseNegatives).toBe(run2.overallFalseNegatives);
    expect(run1.totalValidatedScopePredictions).toBe(run2.totalValidatedScopePredictions);
    expect(run1.totalUnvalidatedPredictions).toBe(run2.totalUnvalidatedPredictions);
  });

  // 18. F-022: Ground Truth Schema Contract Compliance
  it("Scenario 18: validates GroundTruthSymbol and GroundTruthImport contract optionality", () => {
    const symbolWithoutExport: GroundTruthFact = {
      id: "gt-sym-opt",
      category: "symbol",
      filePath: "lib/application.js",
      attributes: {
        filePath: "lib/application.js",
        name: "init",
        kind: "method",
      },
      provenance: "MANUAL_VERIFICATION",
      sourceDescription: "Prototype method without explicit export flag",
      migrationRelevance: "Symbol extraction",
    };

    const importWithoutLocal: GroundTruthFact = {
      id: "gt-imp-opt",
      category: "import",
      filePath: "lib/express.js",
      attributes: {
        filePath: "lib/express.js",
        moduleSpecifier: "./router",
      },
      provenance: "MANUAL_VERIFICATION",
      sourceDescription: "Module import without local alias requirement",
      migrationRelevance: "Dependency resolution",
    };

    const validator = new MigrationFidelityValidator();
    const predictions: PredictionPayload = {
      symbols: [{ filePath: "lib/application.js", name: "init", kind: "method" }],
      imports: [{ filePath: "lib/express.js", moduleSpecifier: "./router", localName: "Router" }],
    };

    const report = validator.validate([symbolWithoutExport, importWithoutLocal], predictions, {
      targetName: "test-opt-schema",
      closedScopeFilePaths: ["lib/application.js", "lib/express.js"],
    });

    expect(report.overallTruePositives).toBe(2);
    expect(report.overallFalseNegatives).toBe(0);
  });

  // 19. F-022: Express & Fastify Ground Truth Schema Validation
  it("Scenario 19: verifies all Express and Fastify ground truth facts conform to canonical schemas", async () => {
    const { expressGroundTruth } = await import("../../../benchmarks/fidelity/express-ground-truth");
    const { fastifyGroundTruth } = await import("../../../benchmarks/fidelity/fastify-ground-truth");
    const { fidelityFactCategorySchema, groundTruthProvenanceSchema } = await import("@contracts/fidelity");

    for (const fact of [...expressGroundTruth, ...fastifyGroundTruth]) {
      expect(fact.id).toBeDefined();
      expect(fact.id.length).toBeGreaterThan(0);
      expect(fidelityFactCategorySchema.safeParse(fact.category).success).toBe(true);
      expect(groundTruthProvenanceSchema.safeParse(fact.provenance).success).toBe(true);
      expect(typeof fact.sourceDescription).toBe("string");
      expect(typeof fact.migrationRelevance).toBe("string");
      expect(typeof fact.attributes).toBe("object");
    }
  });
});
