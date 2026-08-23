/**
 * Phase 3A — Benchmark Type Contracts & Governance Schema
 *
 * Machine-readable types for benchmark manifests, results, determinism reports,
 * health scores, quality sampling, regression detection, and audit findings.
 *
 * Architectural Rule:
 *   Benchmark code may depend on LegacyExodus core.
 *   LegacyExodus core MUST NOT depend on benchmark code.
 */

// ─── Size Class & Tier ─────────────────────────────────────────────────────────

export type SizeClass = "small" | "medium" | "large";
export type CorpusTier = "tier-1" | "tier-2" | "tier-3" | "self-analysis";

// ─── Benchmark Manifest ───────────────────────────────────────────────────────

export interface BenchmarkManifest {
  /** Unique repository identifier (e.g. "fastify", "cookie-parser"). */
  readonly name: string;
  /** Git clone URL. Omitted for local-only benchmarks (e.g. self-analysis). */
  readonly repository?: string;
  /** Pinned git revision (tag, branch, or commit SHA). */
  readonly revision?: string;
  /** Tier classification. */
  readonly tier?: CorpusTier;
  /** Primary languages in the repository. */
  readonly languageProfile: readonly string[];
  /** Known frameworks present. */
  readonly frameworkProfile: readonly string[];
  /** Size classification. */
  readonly sizeClass: SizeClass;
  /** SPDX license identifier. */
  readonly license: string;
  /** Why this repository is in the benchmark corpus. */
  readonly reason: string;
  /** Known interesting hotspots for manual inspection. */
  readonly knownHotspots?: readonly string[];
  /** Known features the engine should detect. */
  readonly knownFeatures?: readonly string[];
  /** Local path override (for self-analysis or pre-acquired repos). */
  readonly localPath?: string;
  /** Flag indicating whether this is an internal self-analysis benchmark. */
  readonly isSelfAnalysis?: boolean;
}

// ─── Analysis Disposition ─────────────────────────────────────────────────────

export interface AnalysisDisposition {
  readonly filesDiscovered: number;
  readonly filesAnalyzed: number;
  readonly parserFailures: number;
  readonly symbolExtractionFailures: number;
  readonly unsupportedFiles: number;
  readonly nonSourceArtifacts: number;
  readonly unclassifiedArtifacts: number;
  readonly enumerationFailures?: number;
  readonly discoveryComplete?: boolean;
  readonly durationMs: number;
}

// ─── Mathematical File Accounting ─────────────────────────────────────────────

export interface FileAccounting {
  readonly filesDiscovered: number;
  readonly computedTotal: number;
  readonly reconciles: boolean;
  readonly discrepancy: number;
  readonly breakdown: {
    readonly analyzed: number;
    readonly parserFailures: number;
    readonly symbolExtractionFailures: number;
    readonly unsupportedFiles: number;
    readonly nonSourceArtifacts: number;
    readonly unclassifiedArtifacts: number;
  };
}

// ─── Analysis Completeness ────────────────────────────────────────────────────

export type CompletenessStatus = "PASS" | "FAIL" | "NEEDS_REVIEW";

export interface AnalysisCompleteness {
  readonly status: CompletenessStatus;
  readonly unanalyzedSourceFiles: readonly string[];
  readonly unassignedFailures: readonly string[];
  readonly duplicateDispositions: readonly string[];
  readonly benchmarkCacheContaminationDetected: boolean;
  readonly enumerationFailures?: number;
  readonly discoveryComplete?: boolean;
  readonly details: readonly string[];
}

// ─── Benchmark Contamination Guard ────────────────────────────────────────────

export interface ContaminationGuardReport {
  readonly isContaminated: boolean;
  readonly ignoredDirectories: readonly string[];
  readonly ignoredFiles: readonly string[];
  readonly generatedArtifactsExcluded: readonly string[];
  readonly benchmarkArtifactsExcluded: readonly string[];
}

// ─── Semantic Summary ─────────────────────────────────────────────────────────

export interface SemanticSummary {
  readonly totalCalls: number;
  readonly resolvedCalls: number;
  readonly unresolvedCalls: number;
  readonly totalSymbols: number;
  readonly functions: number;
  readonly classes: number;
  readonly methods: number;
  readonly imports: number;
  readonly exports: number;
  readonly dependencyModules: number;
  readonly dependencyEdges: number;
  readonly cycles: number;
  readonly entryPoints: number;
  readonly routes: number;
  readonly middlewareChains: number;
  readonly deadCodeFindings: number;
  readonly unusedImports: number;
  readonly unusedExports: number;
}

// ─── Flow Summary ─────────────────────────────────────────────────────────────

export interface FlowSummary {
  readonly cfgCount: number;
  readonly basicBlockCount: number;
  readonly controlFlowEdgeCount: number;
  readonly dominatorRecordCount: number;
  readonly dfgCount: number;
  readonly totalDefinitions: number;
  readonly totalUses: number;
  readonly defUseChains: number;
  readonly taintFlows: number;
  readonly interproceduralFlows: number;
  readonly knowledgeNodes: number;
  readonly knowledgeEdges: number;
}

// ─── Artifact Hash ────────────────────────────────────────────────────────────

export interface ArtifactHash {
  readonly name: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

// ─── Quality Sampling Contracts ───────────────────────────────────────────────

export interface SampledCall {
  readonly calleeName: string;
  readonly resolutionState: string;
  readonly filePath?: string;
  readonly location?: Record<string, unknown>;
  readonly targetFilePath?: string;
  readonly targetSymbolName?: string;
  manualVerdict?: "correct" | "incorrect" | "uncertain";
  manualNote?: string;
}

export interface SampledDependencyEdge {
  readonly source: string;
  readonly target: string;
  readonly importedName?: string;
  readonly exportedName?: string;
  manualVerdict?: "correct" | "incorrect" | "uncertain";
  manualNote?: string;
}

export interface SampledTaintFlow {
  readonly filePath: string;
  readonly path: readonly string[];
  readonly state: string;
  manualVerdict?: "correct" | "incorrect" | "uncertain";
  manualNote?: string;
}

export interface QualitySamplingReport {
  readonly sampleSeed: number;
  readonly derivationHash: string;
  readonly sampleSize: number;
  readonly population: {
    readonly totalResolvedCalls: number;
    readonly totalUnresolvedCalls: number;
    readonly totalDependencyEdges: number;
    readonly totalTaintFlows: number;
  };
  readonly sampledResolvedCalls: readonly SampledCall[];
  readonly sampledUnresolvedCalls: readonly SampledCall[];
  readonly sampledDependencyEdges: readonly SampledDependencyEdge[];
  readonly sampledTaintFlows: readonly SampledTaintFlow[];
  readonly confidenceNotes: string;
}

// ─── Single Run Result ────────────────────────────────────────────────────────

export interface BenchmarkRunResult {
  readonly runIndex: number;
  readonly disposition: AnalysisDisposition;
  readonly semantic: SemanticSummary;
  readonly flow: FlowSummary;
  readonly fileAccounting: FileAccounting;
  readonly completeness: AnalysisCompleteness;
  readonly contamination: ContaminationGuardReport;
  readonly artifactHashes: readonly ArtifactHash[];
  readonly languages: readonly string[];
  readonly frameworks: readonly string[];
  readonly dependencyCount: number;
  readonly peakRssMb?: number;
}

// ─── Determinism Report ───────────────────────────────────────────────────────

export interface ArtifactDeterminismStatus {
  readonly name: string;
  readonly identical: boolean;
  readonly hashes?: readonly string[];
}

export interface DeterminismReport {
  readonly totalRuns: number;
  readonly allDeterministic: boolean;
  readonly artifacts: readonly ArtifactDeterminismStatus[];
  readonly variableFieldsIgnored: readonly string[];
  readonly semanticDifferences: readonly string[];
}

// ─── Engine & Repository Identity ─────────────────────────────────────────────

export interface EngineIdentity {
  readonly commitSha: string;
  readonly packageVersion: string;
  readonly bunVersion: string;
  readonly os: string;
  readonly arch: string;
  readonly schemaVersion: number;
}

export interface RepositoryIdentity {
  readonly name: string;
  readonly repositoryUrl?: string;
  readonly revision?: string;
  readonly commitSha?: string;
  readonly tag?: string;
  readonly tier: CorpusTier;
  readonly isSelfAnalysis: boolean;
  readonly languageProfile: readonly string[];
  readonly frameworkProfile: readonly string[];
  readonly license: string;
}

// ─── Benchmark Health Score ───────────────────────────────────────────────────

export type GateStatus = "PASS" | "FAIL" | "NEEDS_REVIEW";
export type PerformanceStatus = "IMPROVED" | "STABLE" | "REGRESSED" | "INCOMPARABLE";

export interface BenchmarkHealthScore {
  readonly correctness: GateStatus;
  readonly completeness: GateStatus;
  readonly determinism: GateStatus;
  readonly performance: PerformanceStatus;
  readonly qualitySample: GateStatus;
  readonly overall: GateStatus;
  readonly summary: string;
}

// ─── Performance Aggregate Metrics ────────────────────────────────────────────

export interface PerformanceMetrics {
  readonly avgDurationMs: number;
  readonly minDurationMs: number;
  readonly maxDurationMs: number;
  readonly filesPerSecond: number;
  readonly analyzedFilesPerSecond: number;
  readonly msPerCfg: number;
  readonly msPerDfg: number;
  readonly peakRssMb?: number;
}

// ─── Comprehensive Benchmark Result Contract ──────────────────────────────────

export interface BenchmarkResult {
  readonly version: 2;
  readonly id: string;
  readonly executedAt: string;
  readonly engine: EngineIdentity;
  readonly repository: RepositoryIdentity;
  readonly runs: readonly BenchmarkRunResult[];
  readonly determinism: DeterminismReport;
  readonly performance: PerformanceMetrics;
  readonly healthScore: BenchmarkHealthScore;
  readonly qualitySample?: QualitySamplingReport;
  readonly warnings: readonly string[];
  readonly limitations: readonly string[];
}

// ─── Regression Comparison Report ─────────────────────────────────────────────

export type DifferenceClassification = "EXPECTED" | "IMPROVEMENT" | "REGRESSION" | "UNKNOWN";

export interface MetricComparison<T> {
  readonly metric: string;
  readonly baselineValue: T;
  readonly currentValue: T;
  readonly delta?: number | string;
  readonly percentDelta?: number;
  readonly classification: DifferenceClassification;
  readonly notes?: string;
}

export interface RegressionComparisonReport {
  readonly baselineRunId: string;
  readonly currentRunId: string;
  readonly repository: string;
  readonly overallPerformanceStatus: PerformanceStatus;
  readonly overallSemanticStatus: DifferenceClassification;
  readonly metrics: readonly MetricComparison<number | string | boolean>[];
  readonly warnings: readonly string[];
}

// ─── Audit Contracts ──────────────────────────────────────────────────────────

export type AuditSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export interface AuditFinding {
  readonly category: string;
  readonly severity: AuditSeverity;
  readonly description: string;
  readonly evidence: string;
  readonly remediation?: string;
}

export interface BenchmarkAuditReport {
  readonly auditedAt: string;
  readonly engineSha: string;
  readonly totalChecks: number;
  readonly passedChecks: number;
  readonly failedChecks: number;
  readonly findings: readonly AuditFinding[];
  readonly verdict: "PASS" | "PASS_WITH_CONDITIONS" | "NO_GO";
}
