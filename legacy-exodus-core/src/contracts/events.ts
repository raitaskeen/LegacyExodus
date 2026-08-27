import type { DomainEvent } from "@core/events/domain-event";

export interface ProjectInitializedPayload {
  readonly projectId: string;
  readonly name: string;
}

export interface FileDiscoveredPayload {
  readonly fileId: string;
  readonly path: string;
  readonly language: string;
}

export interface KnowledgeUpdatedPayload {
  readonly artifactId: string;
}

export interface DependencyDetectedPayload {
  readonly name: string;
  readonly version: string;
}

export interface FrameworkDetectedPayload {
  readonly name: string;
  readonly evidence: string;
}

export interface DiscoveryCompletedPayload {
  readonly projectId: string;
  readonly fileCount: number;
  readonly dependencyCount: number;
  readonly frameworkCount: number;
  readonly enumerationFailureCount?: number;
}

export interface DiscoveryEnumerationFailurePayload {
  readonly path: string;
  readonly kind: "directory-read" | "entry-stat";
  readonly code: string;
}

export interface FileParsedPayload {
  readonly fileId: string;
  readonly path: string;
  readonly parserId: string;
  readonly nodeCount: number;
  readonly errorCount: number;
}

export interface SymbolsExtractedPayload {
  readonly fileId: string;
  readonly path: string;
  readonly symbolCount: number;
}
export interface ParserFailurePayload {
  readonly fileId: string;
  readonly path: string;
  readonly code: string;
}
export interface SymbolsExtractionFailurePayload {
  readonly fileId: string;
  readonly path: string;
  readonly code: string;
}

export interface AnalysisRunStartedPayload {
  readonly projectId: string;
  readonly analysisRunId: string;
}

export interface AnalysisRunCompletedPayload {
  readonly projectId: string;
  readonly analysisRunId: string;
  readonly durationMs: number;
}

export interface AnalysisRunFailedPayload {
  readonly projectId: string;
  readonly analysisRunId: string;
  readonly error: string;
}

export type ProjectInitialized = DomainEvent<ProjectInitializedPayload, "ProjectInitialized">;

export type FileDiscovered = DomainEvent<FileDiscoveredPayload, "FileDiscovered">;

export type KnowledgeUpdated = DomainEvent<KnowledgeUpdatedPayload, "KnowledgeUpdated">;

export type DependencyDetected = DomainEvent<DependencyDetectedPayload, "DependencyDetected">;

export type FrameworkDetected = DomainEvent<FrameworkDetectedPayload, "FrameworkDetected">;

export type DiscoveryCompleted = DomainEvent<DiscoveryCompletedPayload, "DiscoveryCompleted">;
export type DiscoveryEnumerationFailure = DomainEvent<DiscoveryEnumerationFailurePayload, "DiscoveryEnumerationFailure">;
export type FileParsed = DomainEvent<FileParsedPayload, "FileParsed">;
export type SymbolsExtracted = DomainEvent<SymbolsExtractedPayload, "SymbolsExtracted">;
export type ParserFailure = DomainEvent<ParserFailurePayload, "ParserFailure">;
export type SymbolsExtractionFailure = DomainEvent<SymbolsExtractionFailurePayload, "SymbolsExtractionFailure">;
export type AnalysisRunStarted = DomainEvent<AnalysisRunStartedPayload, "AnalysisRunStarted">;
export type AnalysisRunCompleted = DomainEvent<AnalysisRunCompletedPayload, "AnalysisRunCompleted">;
export type AnalysisRunFailed = DomainEvent<AnalysisRunFailedPayload, "AnalysisRunFailed">;
