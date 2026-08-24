import { z } from "zod";

/** Provenance of a ground-truth discovery fact. */
export type GroundTruthProvenance =
  | "GROUND_TRUTH_SOURCE"
  | "INDEPENDENT_DERIVATION"
  | "MANUAL_VERIFICATION"
  | "SAMPLED_MANUAL_VERIFICATION"
  | "KNOWN_NEGATIVE"
  | "NOT_VALIDATED";

/** Scope/Assumption under which a category or file is evaluated. */
export type ValidationWorldScope =
  | "CLOSED_WORLD"        // Complete ground truth exists for this category/file; extra predictions are FPs
  | "OPEN_WORLD_SAMPLE";   // Non-exhaustive sample; predictions outside sample are UNVALIDATED

/** Category of fact being validated for migration fidelity. */
export type FidelityFactCategory =
  | "file"
  | "dependency"
  | "framework"
  | "symbol"
  | "import"
  | "export"
  | "dependency_edge"
  | "call"
  | "cfg"
  | "dfg"
  | "route"
  | "hook";

/** Generic base structure for a ground truth fact. */
export interface GroundTruthFact<T = Record<string, unknown>> {
  readonly id: string;
  readonly category: FidelityFactCategory;
  readonly filePath?: string;
  readonly attributes: T;
  readonly provenance: GroundTruthProvenance;
  readonly sourceDescription: string;
  readonly migrationRelevance: string;
  /** If true, this fact asserts that the entity MUST NOT exist in discovery output. */
  readonly isKnownNegative?: boolean;
}

/** Specific ground truth payload shapes */
export interface GroundTruthFile {
  readonly path: string;
  readonly language: string;
  readonly fileKind?: string;
}

export interface GroundTruthDependency {
  readonly name: string;
  readonly version: string;
  readonly kind: "production" | "development";
}

export interface GroundTruthFramework {
  readonly name: string;
}

export interface GroundTruthSymbol {
  readonly filePath: string;
  readonly name: string;
  readonly kind: "function" | "class" | "method" | "variable" | "import" | "export" | "type" | "unknown";
  readonly exported: boolean;
  readonly defaultExport?: boolean;
}

export interface GroundTruthImport {
  readonly filePath: string;
  readonly moduleSpecifier: string;
  readonly importedSymbolName?: string;
  readonly localName: string;
}

export interface GroundTruthExport {
  readonly filePath: string;
  readonly exportName: string;
  readonly localSymbolName?: string;
  readonly defaultExport?: boolean;
}

export interface GroundTruthDependencyEdge {
  readonly sourceFilePath: string;
  readonly targetFilePath: string;
  readonly moduleSpecifier: string;
}

export interface GroundTruthCall {
  readonly sourceFilePath: string;
  readonly calleeName: string;
  readonly targetFilePath?: string;
  readonly targetSymbolName?: string;
  readonly resolutionState?: "RESOLVED" | "UNRESOLVED";
}

export interface GroundTruthCFG {
  readonly filePath: string;
  readonly functionName?: string;
  readonly minBlockCount?: number;
  readonly minEdgeCount?: number;
  readonly hasBranches?: boolean;
}

export interface GroundTruthDFG {
  readonly filePath: string;
  readonly functionName?: string;
  readonly minDefinitionCount?: number;
  readonly minUseCount?: number;
}

/** Result status for evaluating a prediction or ground-truth fact */
/** Result status for evaluating a prediction or ground-truth fact */
export type MatchStatus =
  | "TRUE_POSITIVE"     // Predicted fact correctly matched ground truth
  | "FALSE_POSITIVE"    // Prediction violates closed-world scope or matches a known negative
  | "FALSE_NEGATIVE"    // Ground-truth fact was not discovered by the engine
  | "UNVERIFIED_SCOPED" // Prediction is inside open-world sampled file, but unverified by representative GT
  | "UNVALIDATED";      // Prediction is outside ground-truth validation scope (NOT an error)

export interface FactMatchDetail {
  readonly category: FidelityFactCategory;
  readonly status: MatchStatus;
  readonly groundTruth?: GroundTruthFact;
  readonly prediction?: Record<string, unknown>;
  readonly isActionable: boolean;
  readonly notes?: string;
}

/** Category-level metric calculation result */
export interface CategoryFidelityMetrics {
  readonly category: FidelityFactCategory;
  readonly worldScope: ValidationWorldScope;
  readonly groundTruthCount: number;
  readonly scopedPredictedCount: number;
  readonly unvalidatedPredictedCount: number;
  readonly totalPredictedCount: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly unverifiedScopedCount: number;
  readonly unvalidatedCount: number;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly f1Score: number | null;
  readonly coverage: number;
  readonly actionableTruePositives: number;
  readonly actionableCorrectness: number | null;
  readonly status: "MEASURED" | "NOT_MEASURED" | "PARTIAL_SAMPLE";
}

export interface DiscoveryArtifactProvenance {
  readonly schemaVersion: number;
  readonly repository: {
    readonly name: string;
    readonly path: string;
    readonly packageVersion?: string;
    readonly commitSha?: string;
    readonly tag?: string;
  };
  readonly engine: {
    readonly packageVersion: string;
    readonly commitSha: string;
    readonly bunVersion: string;
  };
  readonly analysis: {
    readonly projectId: string;
    readonly analysisRunId?: string;
    readonly generatedAt: string;
  };
  readonly requiredArtifacts: readonly string[];
  readonly artifacts: Record<string, { readonly sha256: string; readonly bytes: number }>;
}

/** Overall fidelity evaluation report */
export interface FidelityValidationReport {
  readonly targetName: string;
  readonly timestamp: string;
  readonly isSampleBased: boolean;
  readonly samplingMethodology?: string;
  readonly totalGroundTruthFacts: number;
  readonly totalPredictedFacts: number;
  readonly totalValidatedScopePredictions: number;
  readonly totalUnverifiedScopedPredictions: number;
  readonly totalUnvalidatedPredictions: number;
  readonly overallTruePositives: number;
  readonly overallFalsePositives: number;
  readonly overallFalseNegatives: number;
  readonly overallPrecision: number | null;
  readonly overallRecall: number | null;
  readonly overallF1Score: number | null;
  readonly overallActionableCorrectness: number | null;
  readonly categories: readonly CategoryFidelityMetrics[];
  readonly matchDetails: readonly FactMatchDetail[];
  readonly actionableVerdict: "ACTIONABLE" | "PARTIALLY_ACTIONABLE" | "NON_ACTIONABLE";
  readonly migrationSafetyVerdict: "MIGRATION_SAFETY_NOT_YET_ESTABLISHED" | "MIGRATION_VALIDATED";
  readonly limitations: readonly string[];
  readonly provenanceEvidence?: DiscoveryArtifactProvenance;
  readonly freshnessStatus?: "FRESH" | "STALE" | "MISMATCHED" | "CORRUPTED" | "MISSING_PROVENANCE";
}

export const groundTruthProvenanceSchema = z.enum([
  "GROUND_TRUTH_SOURCE",
  "INDEPENDENT_DERIVATION",
  "MANUAL_VERIFICATION",
  "SAMPLED_MANUAL_VERIFICATION",
  "KNOWN_NEGATIVE",
  "NOT_VALIDATED",
]);

export const fidelityFactCategorySchema = z.enum([
  "file",
  "dependency",
  "framework",
  "symbol",
  "import",
  "export",
  "dependency_edge",
  "call",
  "cfg",
  "dfg",
  "route",
  "hook",
]);
