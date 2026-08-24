import { describe, expect, test } from "bun:test";

import {
  computeFileAccounting,
  computeHealthScore,
  detectContamination,
  verifyCompleteness,
} from "../../../benchmarks/governance";
import type { AnalysisDisposition, ContaminationGuardReport } from "../../../benchmarks/types";

describe("Phase 3B Completeness Policy & Discovery Coverage", () => {
  const cleanContamination: ContaminationGuardReport = {
    isContaminated: false,
    ignoredDirectories: [".git", "node_modules", ".cache", ".discovery", "dist", "build", ".legacy-exodus"],
    ignoredFiles: [],
    generatedArtifactsExcluded: [],
    benchmarkArtifactsExcluded: [],
  };

  test("Case A: Fully analyzable repository passes completeness gate with zero unaccounted files", () => {
    const disposition: AnalysisDisposition = {
      filesDiscovered: 10,
      filesAnalyzed: 10,
      parserFailures: 0,
      symbolExtractionFailures: 0,
      unsupportedFiles: 0,
      nonSourceArtifacts: 0,
      unclassifiedArtifacts: 0,
      enumerationFailures: 0,
      discoveryComplete: true,
      durationMs: 100,
    };

    const accounting = computeFileAccounting(disposition);
    expect(accounting.reconciles).toBe(true);
    expect(accounting.discrepancy).toBe(0);
    expect(accounting.computedTotal).toBe(10);

    const completeness = verifyCompleteness(disposition, accounting, cleanContamination);
    expect(completeness.status).toBe("PASS");
    expect(completeness.details).toEqual([]);

    const health = computeHealthScore(accounting, completeness, true);
    expect(health.correctness).toBe("PASS");
    expect(health.completeness).toBe("PASS");
    expect(health.overall).toBe("PASS");
  });

  test("Case B: Intentionally excluded / non-source files are accounted and do not falsely reduce completeness", () => {
    const disposition: AnalysisDisposition = {
      filesDiscovered: 25,
      filesAnalyzed: 15,
      parserFailures: 0,
      symbolExtractionFailures: 0,
      unsupportedFiles: 0,
      nonSourceArtifacts: 10,
      unclassifiedArtifacts: 0,
      enumerationFailures: 0,
      discoveryComplete: true,
      durationMs: 150,
    };

    const accounting = computeFileAccounting(disposition);
    expect(accounting.reconciles).toBe(true);
    expect(accounting.discrepancy).toBe(0);

    const completeness = verifyCompleteness(disposition, accounting, cleanContamination);
    expect(completeness.status).toBe("PASS");
    expect(completeness.details).toEqual([]);

    const health = computeHealthScore(accounting, completeness, true);
    expect(health.completeness).toBe("PASS");
    expect(health.overall).toBe("PASS");
  });

  test("Case C: Unsupported source files in non-JS languages are explicitly accounted without failing completeness", () => {
    const disposition: AnalysisDisposition = {
      filesDiscovered: 20,
      filesAnalyzed: 14,
      parserFailures: 0,
      symbolExtractionFailures: 0,
      unsupportedFiles: 2,
      nonSourceArtifacts: 4,
      unclassifiedArtifacts: 0,
      enumerationFailures: 0,
      discoveryComplete: true,
      durationMs: 120,
    };

    const accounting = computeFileAccounting(disposition);
    expect(accounting.reconciles).toBe(true);
    expect(accounting.discrepancy).toBe(0);

    const completeness = verifyCompleteness(disposition, accounting, cleanContamination);
    expect(completeness.status).toBe("PASS");

    const health = computeHealthScore(accounting, completeness, true);
    expect(health.completeness).toBe("PASS");
    expect(health.overall).toBe("PASS");
  });

  test("Case D: Analysis failures (parser or symbol extraction) demote completeness to NEEDS_REVIEW with actionable diagnostic", () => {
    const parserFailureDisposition: AnalysisDisposition = {
      filesDiscovered: 10,
      filesAnalyzed: 9,
      parserFailures: 1,
      symbolExtractionFailures: 0,
      unsupportedFiles: 0,
      nonSourceArtifacts: 0,
      unclassifiedArtifacts: 0,
      enumerationFailures: 0,
      discoveryComplete: true,
      durationMs: 90,
    };

    const accounting = computeFileAccounting(parserFailureDisposition);
    expect(accounting.reconciles).toBe(true);

    const completeness = verifyCompleteness(parserFailureDisposition, accounting, cleanContamination);
    expect(completeness.status).toBe("NEEDS_REVIEW");
    expect(completeness.details).toContain("1 parser failure(s) recorded");

    const health = computeHealthScore(accounting, completeness, true);
    expect(health.correctness).toBe("PASS");
    expect(health.completeness).toBe("NEEDS_REVIEW");
    expect(health.overall).toBe("NEEDS_REVIEW");
  });

  test("Case E: Unaccounted files cause accounting mismatch and hard FAIL on completeness", () => {
    const disposition: AnalysisDisposition = {
      filesDiscovered: 10,
      filesAnalyzed: 8,
      parserFailures: 0,
      symbolExtractionFailures: 0,
      unsupportedFiles: 0,
      nonSourceArtifacts: 1,
      unclassifiedArtifacts: 0,
      enumerationFailures: 0,
      discoveryComplete: true,
      durationMs: 80,
    };

    const accounting = computeFileAccounting(disposition);
    expect(accounting.reconciles).toBe(false);
    expect(accounting.discrepancy).toBe(1);
    expect(accounting.computedTotal).toBe(9);

    const completeness = verifyCompleteness(disposition, accounting, cleanContamination);
    expect(completeness.status).toBe("FAIL");
    expect(completeness.details.some((d) => d.includes("File accounting mismatch"))).toBe(true);

    const health = computeHealthScore(accounting, completeness, true);
    expect(health.correctness).toBe("FAIL");
    expect(health.completeness).toBe("FAIL");
    expect(health.overall).toBe("FAIL");
  });

  test("Case F: Determinism - identical accounting and completeness results across repeated calls", () => {
    const disposition1: AnalysisDisposition = {
      filesDiscovered: 100,
      filesAnalyzed: 70,
      parserFailures: 1,
      symbolExtractionFailures: 1,
      unsupportedFiles: 3,
      nonSourceArtifacts: 20,
      unclassifiedArtifacts: 5,
      enumerationFailures: 0,
      discoveryComplete: true,
      durationMs: 500,
    };

    const disposition2: AnalysisDisposition = { ...disposition1 };

    const acc1 = computeFileAccounting(disposition1);
    const acc2 = computeFileAccounting(disposition2);
    expect(acc1).toEqual(acc2);

    const comp1 = verifyCompleteness(disposition1, acc1, cleanContamination);
    const comp2 = verifyCompleteness(disposition2, acc2, cleanContamination);
    expect(comp1).toEqual(comp2);
  });

  test("Case G: Unclassified files demote completeness to NEEDS_REVIEW and detail exact count", () => {
    const disposition: AnalysisDisposition = {
      filesDiscovered: 50,
      filesAnalyzed: 40,
      parserFailures: 0,
      symbolExtractionFailures: 0,
      unsupportedFiles: 0,
      nonSourceArtifacts: 8,
      unclassifiedArtifacts: 2,
      enumerationFailures: 0,
      discoveryComplete: true,
      durationMs: 300,
    };

    const accounting = computeFileAccounting(disposition);
    expect(accounting.reconciles).toBe(true);

    const completeness = verifyCompleteness(disposition, accounting, cleanContamination);
    expect(completeness.status).toBe("NEEDS_REVIEW");
    expect(completeness.details).toContain("2 unclassified artifact(s) recorded");
  });

  test("Case H: Contamination guard immediately triggers FAIL on completeness", () => {
    const disposition: AnalysisDisposition = {
      filesDiscovered: 10,
      filesAnalyzed: 10,
      parserFailures: 0,
      symbolExtractionFailures: 0,
      unsupportedFiles: 0,
      nonSourceArtifacts: 0,
      unclassifiedArtifacts: 0,
      enumerationFailures: 0,
      discoveryComplete: true,
      durationMs: 100,
    };

    const accounting = computeFileAccounting(disposition);
    const contaminated: ContaminationGuardReport = detectContamination([
      { path: "src/index.js" },
      { path: "benchmarks/.cache/polluted.js" },
    ]);

    expect(contaminated.isContaminated).toBe(true);
    const completeness = verifyCompleteness(disposition, accounting, contaminated);
    expect(completeness.status).toBe("FAIL");
    expect(completeness.benchmarkCacheContaminationDetected).toBe(true);
    expect(completeness.details.some((d) => d.includes("Contamination detected"))).toBe(true);
  });
});