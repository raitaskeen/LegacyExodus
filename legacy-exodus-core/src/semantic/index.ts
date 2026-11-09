export { ClassHierarchy, collectClassHierarchyFacts, type ClassHierarchyFile } from "./class-hierarchy";
export { collectUnstableExportIds, DeterministicCallGraphBuilder } from "./call-graph-builder";
export { DeterministicSemanticAnalysisEngine, FactUsage, findHttpCalls } from "./semantic-engine";
export type { SemanticContext } from "./semantic-context";
export type { DeadCodeFinding, ExpressRoute, MiddlewareChain, ScopeAnalysis, SemanticAnalysis, SemanticCall, SemanticEntryPoint, SymbolReference } from "./semantic-contracts";
export { callSchema, createSemanticAnalysis, referenceSchema, SortedFactList, UNRESOLVED_REASONS, type UnresolvedReason } from "./semantic-contracts";
