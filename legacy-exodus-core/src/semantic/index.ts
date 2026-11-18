export { ClassHierarchy, collectClassHierarchyFacts, type ClassHierarchyFile } from "./class-hierarchy";
export { DeterministicCallGraphBuilder } from "./call-graph-builder";
export { collectForeignExportWrites, collectGlobalWrites, collectUnstableExportIds, foreignExportWriteTargets, packageWriteKeys, type ForeignExportWrite } from "./run-wide-writes";
export { collectLoadTimeModuleFacts, requireCycleFacts, type LoadTimeModuleFacts } from "./require-cycles";
export { collectFactoryFacts, FactoryIndex, type FactoryFile } from "./factory-objects";
export { DeterministicSemanticAnalysisEngine, FactUsage, findHttpCalls } from "./semantic-engine";
export type { SemanticContext } from "./semantic-context";
export type { DeadCodeFinding, ExpressRoute, MiddlewareChain, ScopeAnalysis, SemanticAnalysis, SemanticCall, SemanticEntryPoint, SymbolReference } from "./semantic-contracts";
export { callSchema, createSemanticAnalysis, referenceSchema, SortedFactList, UNRESOLVED_REASONS, type CallState, type ExternalTarget, type UnresolvedReason } from "./semantic-contracts";
