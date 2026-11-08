import type { ASTResult } from "@parser/index";
import type { SemanticCall } from "@semantic/index";
import type { SymbolTable } from "@symbols/index";
import { createHash } from "node:crypto";
import type { BuildContextResult } from "./data-flow-builder";
import { DeterministicControlFlowGraphBuilder } from "./control-flow-builder";
import { DeterministicDataFlowGraphBuilder } from "./data-flow-builder";
import { createDataFlowGraph, createProvenCallTargets, type ControlFlowGraph, type DataFlowGraph, type InterproceduralFlow } from "./flow-contracts";
import { compareCodePoints } from "@shared/ordering";
import { propagateTaintPaths, setTaintPath } from "./taint-propagation";
import { immutable } from "@shared/immutability";

/** What connecting needs of a file's data-flow graph; the rest of the graph can wait on disk (ADR-009 step 4a). */
export type ConnectionGraph = Pick<DataFlowGraph, "filePath" | "functionSummaries" | "callBindings" | "interproceduralFlows">;
/**
 * The rest of a file's data-flow graph, which waits on disk as JSON. Call bindings stay in memory: their argument
 * lists are sparse, and JSON would turn the holes into nulls.
 */
export type DataFlowGraphBody = Omit<DataFlowGraph, Exclude<keyof ConnectionGraph, "filePath">>;
export interface ConnectionContext { readonly graph: ConnectionGraph; readonly state: BuildContextResult["state"] }

export interface FlowAnalysisResult { readonly controlFlowGraphs: readonly ControlFlowGraph[]; readonly dataFlowGraphs: readonly DataFlowGraph[]; }
export class DeterministicFlowAnalysisEngine {
  public constructor(public readonly controlFlowBuilder: DeterministicControlFlowGraphBuilder = new DeterministicControlFlowGraphBuilder(), public readonly dataFlowBuilder: DeterministicDataFlowGraphBuilder = new DeterministicDataFlowGraphBuilder()) {}
  public analyze(astResults: readonly ASTResult[], semanticCalls?: readonly SemanticCall[], symbolTables: readonly SymbolTable[] = []): FlowAnalysisResult {
    const results = [...astResults].sort((left, right) => compareCodePoints(left.metadata.sourcePath, right.metadata.sourcePath));
    const symbolsByPath = new Map(symbolTables.map((table) => [table.filePath, table.symbols]));
    const contexts = results.map((ast) =>
      this.dataFlowBuilder.buildContext(
        ast,
        semanticCalls === undefined
          ? undefined
          : createProvenCallTargets(
              semanticCalls.flatMap((call) =>
                call.sourceFilePath === ast.metadata.sourcePath && call.resolutionState === "RESOLVED" && call.targetSymbolId !== undefined && call.location !== undefined
                  ? [{ callId: call.id, sourceFilePath: call.sourceFilePath, location: call.location, targetSymbolId: call.targetSymbolId }]
                  : [],
              ),
            ),
        symbolsByPath.get(ast.metadata.sourcePath) ?? [],
      ),
    );
    const owners = (path: string) => (symbolsByPath.get(path) ?? []).filter((symbol) => symbol.kind === "function" || symbol.kind === "method" || symbol.kind === "class");
    const controlFlowGraphs = results.flatMap((ast) => this.controlFlowBuilder.buildAllWithNodes(ast, owners(ast.metadata.sourcePath)).graphs);
    return this.connect(controlFlowGraphs, contexts, symbolTables);
  }

  public connect(
    controlFlowGraphs: readonly ControlFlowGraph[],
    contexts: readonly BuildContextResult[],
    symbolTables: readonly SymbolTable[] = [],
  ): FlowAnalysisResult {
    const connected: DataFlowGraph[] = [];
    this.connectDataFlow(contexts, contexts.map(({ graph }) => graph), symbolTables, (graph) => connected.push(graph));
    return immutable({
      controlFlowGraphs: immutable([...controlFlowGraphs]),
      dataFlowGraphs: immutable(connected),
    });
  }

  /**
   * `connect` without the pass-through of control-flow graphs: each file's connected data-flow graph is handed
   * to `emit` as it is made, in context order, so a caller can write it away instead of holding them all.
   * `graphs` are the files' graphs as built, in context order; they are read once, while emitting, so they can
   * come from disk while `contexts` keep only what connecting needs.
   */
  public connectDataFlow(
    contexts: readonly ConnectionContext[],
    graphs: Iterable<DataFlowGraphBody>,
    /** Every table in full, read once (they can come from disk one at a time). */
    symbolTables: Iterable<SymbolTable>,
    emit: (graph: DataFlowGraph) => void,
  ): void {

    const summaries = new Map(contexts.flatMap(({ graph }) => graph.functionSummaries.map((summary) => [summary.symbolId, summary] as const)));
    for (const table of symbolTables) {
      for (const exported of table.symbols.filter((symbol) => symbol.kind === "export" && symbol.moduleSpecifier === undefined)) {
        const localName = exported.sourceSymbolName ?? exported.name;
        const candidates = table.symbols.filter((symbol) =>
          (symbol.kind === "function" || symbol.kind === "method")
          && symbol.name === localName
          && symbol.scopeId === exported.scopeId,
        );
        const local = candidates.length === 1 ? candidates[0] : undefined;
        if (local === undefined) continue;
        const summary = summaries.get(local.id);
        if (summary !== undefined) summaries.set(exported.id, summary);
      }
    }

    const crossFileTransfersByGraph = new Map<string, InterproceduralFlow[]>();
    // A source passed straight into another file's function taints that parameter (BA-04).
    const crossFileSourceSeeds: { readonly sourceId: string; readonly parameterDefinitionId: string }[] = [];
    const allCrossFileTransfers: { sourceDefinitionId: string; targetDefinitionId: string }[] = [];

    for (const { graph } of contexts) {
      const transfers: InterproceduralFlow[] = [...graph.interproceduralFlows];
      for (const binding of graph.callBindings) {
        const target = summaries.get(binding.targetSymbolId);
        if (target === undefined || target.filePath === graph.filePath) continue;
        for (const [index, sourceId] of (binding.argumentSourceIds ?? []).entries()) {
          const slot = target.parameterDefinitionIds[index];
          if (sourceId === undefined || slot === undefined) continue;
          for (const parameterDefinitionId of Array.isArray(slot) ? slot : [slot]) crossFileSourceSeeds.push({ sourceId, parameterDefinitionId });
        }
        for (const [index, sourceDefinitionId] of binding.argumentDefinitionIds.entries()) {
          const slot = target.parameterDefinitionIds[index];
          if (sourceDefinitionId !== undefined && slot !== undefined) {
            const targetIds = Array.isArray(slot) ? slot : [slot];
            for (const parameterDefinitionId of targetIds) {
              transfers.push(createTransfer(binding.callId, "argument-to-parameter", sourceDefinitionId, parameterDefinitionId));
              allCrossFileTransfers.push({ sourceDefinitionId, targetDefinitionId: parameterDefinitionId });
            }
          }
        }
        if (binding.receiverDefinitionId !== undefined) {
          for (const returned of target.returnDefinitionIds) {
            transfers.push(createTransfer(binding.callId, "return-to-receiver", returned, binding.receiverDefinitionId));
            allCrossFileTransfers.push({ sourceDefinitionId: returned, targetDefinitionId: binding.receiverDefinitionId });
          }
        }
      }
      crossFileTransfersByGraph.set(graph.filePath, transfers);
    }

    const globalTaintPaths = new Map<string, Map<string, readonly string[]>>();
    for (const { state } of contexts) {
      for (const [defId, sourceMap] of state.taintPaths) {
        const globalSourceMap = globalTaintPaths.get(defId) ?? new Map<string, readonly string[]>();
        for (const [sourceId, path] of sourceMap) {
          globalSourceMap.set(sourceId, [...path]);
        }
        globalTaintPaths.set(defId, globalSourceMap);
      }
    }

    for (const seed of crossFileSourceSeeds) setTaintPath(globalTaintPaths, seed.parameterDefinitionId, seed.sourceId, [seed.sourceId, seed.parameterDefinitionId]);

    propagateTaintPaths([
      ...contexts.flatMap(({ state }) => state.transfers),
      ...allCrossFileTransfers,
    ], globalTaintPaths);

    // A path can pass through joins of any file; each build keeps its own (BA-27).
    const allJoins = new Map(contexts.flatMap(({ state }) => [...state.joins]));
    const allFactKeys = new Map(contexts.flatMap(({ state }) => [...(state.factKeys ?? [])]));
    const built = graphs[Symbol.iterator]();
    for (const { graph, state } of contexts) {
      const next = built.next();
      if (next.done === true || next.value.filePath !== graph.filePath) throw new Error(`Data-flow graph of ${graph.filePath} is missing.`);
      const transfers = crossFileTransfersByGraph.get(graph.filePath) ?? [...graph.interproceduralFlows];
      const unique = [...new Map(transfers.map((transfer) => [transfer.id, transfer] as const)).values()].sort((left, right) => compareCodePoints(left.id, right.id));
      const taintFlows = this.dataFlowBuilder.computeTaintFlows({ ...state, joins: allJoins, factKeys: allFactKeys }, globalTaintPaths);

      emit(createDataFlowGraph({
        ...next.value,
        functionSummaries: graph.functionSummaries,
        callBindings: graph.callBindings,
        interproceduralFlows: unique,
        taintFlows,
      }));
    }
  }
}

function createTransfer(callId: string, kind: InterproceduralFlow["kind"], sourceDefinitionId: string, targetDefinitionId: string): InterproceduralFlow {
  return { id: createHash("sha256").update(`interprocedural:${callId}:${kind}:${sourceDefinitionId}:${targetDefinitionId}`).digest("hex"), callId, kind, sourceDefinitionId, targetDefinitionId };
}
