export { ClassHierarchy, collectClassHierarchyFacts, type ClassHierarchyFile } from "./class-hierarchy";
export { collectForeignExportWrites, collectGlobalWrites, collectUnstableExportIds, DeterministicCallGraphBuilder, foreignExportWriteTargets, packageWriteKeys, type ForeignExportWrite } from "./call-graph-builder";
export { collectFactoryFacts, FactoryIndex, type FactoryFile } from "./factory-objects";
export { DeterministicSemanticAnalysisEngine, FactUsage, findHttpCalls } from "./semantic-engine";
export type { SemanticContext } from "./semantic-context";
export type { DeadCodeFinding, ExpressRoute, MiddlewareChain, ScopeAnalysis, SemanticAnalysis, SemanticCall, SemanticEntryPoint, SymbolReference } from "./semantic-contracts";
export { callSchema, createSemanticAnalysis, referenceSchema, SortedFactList, UNRESOLVED_REASONS, type CallState, type ExternalTarget, type UnresolvedReason } from "./semantic-contracts";
