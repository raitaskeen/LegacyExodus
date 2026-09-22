import type { ASTResult } from "@parser/index";
import type { SemanticCall } from "@semantic/index";
import type { SymbolTable } from "@symbols/index";
import { createHash } from "node:crypto";
import type { BuildContextResult } from "./data-flow-builder";
import { DeterministicControlFlowGraphBuilder } from "./control-flow-builder";
import { DeterministicDataFlowGraphBuilder } from "./data-flow-builder";
import { createDataFlowGraph, createProvenCallTargets, type ControlFlowGraph, type DataFlowGraph, type InterproceduralFlow } from "./flow-contracts";

export interface FlowAnalysisResult { readonly controlFlowGraphs: readonly ControlFlowGraph[]; readonly dataFlowGraphs: readonly DataFlowGraph[]; }
export class DeterministicFlowAnalysisEngine {
  public constructor(public readonly controlFlowBuilder: DeterministicControlFlowGraphBuilder = new DeterministicControlFlowGraphBuilder(), public readonly dataFlowBuilder: DeterministicDataFlowGraphBuilder = new DeterministicDataFlowGraphBuilder()) {}
  public analyze(astResults: readonly ASTResult[], semanticCalls?: readonly SemanticCall[], symbolTables: readonly SymbolTable[] = []): FlowAnalysisResult {
    const results = [...astResults].sort((left, right) => left.metadata.sourcePath.localeCompare(right.metadata.sourcePath));
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
    const controlFlowGraphs = results.flatMap((ast) => this.controlFlowBuilder.buildAll(ast));
    return this.connect(controlFlowGraphs, contexts, symbolTables);
  }

  public connect(
    controlFlowGraphs: readonly ControlFlowGraph[],
    contexts: readonly BuildContextResult[],
    symbolTables: readonly SymbolTable[] = [],
  ): FlowAnalysisResult {

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
    const allCrossFileTransfers: { sourceDefinitionId: string; targetDefinitionId: string }[] = [];

    for (const { graph } of contexts) {
      const transfers: InterproceduralFlow[] = [...graph.interproceduralFlows];
      for (const binding of graph.callBindings) {
        const target = summaries.get(binding.targetSymbolId);
        if (target === undefined || target.filePath === graph.filePath) continue;
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

    const allTransfers = [
      ...contexts.flatMap(({ state }) => state.transfers),
      ...allCrossFileTransfers,
    ].sort((left, right) => `${left.sourceDefinitionId}:${left.targetDefinitionId}`.localeCompare(`${right.sourceDefinitionId}:${right.targetDefinitionId}`));

    const transferIndexesBySource = new Map<string, number[]>();
    let currentQueue: number[] = [];
    let currentQueued = new Set<number>();
    let nextQueue: number[] = [];
    let nextQueued = new Set<number>();

    for (const [index, transfer] of allTransfers.entries()) {
      const dependents = transferIndexesBySource.get(transfer.sourceDefinitionId) ?? [];
      dependents.push(index);
      transferIndexesBySource.set(transfer.sourceDefinitionId, dependents);
      if (globalTaintPaths.has(transfer.sourceDefinitionId)) {
        enqueueTransferIndex(currentQueue, currentQueued, index);
      }
    }

    while (currentQueue.length > 0 || nextQueue.length > 0) {
      if (currentQueue.length === 0) {
        currentQueue = nextQueue;
        currentQueued = nextQueued;
        nextQueue = [];
        nextQueued = new Set<number>();
      }

      const transferIndex = dequeueTransferIndex(currentQueue, currentQueued);
      const transfer = allTransfers[transferIndex];
      if (transfer === undefined) continue;
      const sourcePaths = globalTaintPaths.get(transfer.sourceDefinitionId);
      if (sourcePaths === undefined) continue;

      let targetChanged = false;
      for (const [sourceId, path] of sourcePaths) {
        if (setGlobalTaintPath(globalTaintPaths, transfer.targetDefinitionId, sourceId, [...path, transfer.targetDefinitionId])) {
          targetChanged = true;
        }
      }
      if (!targetChanged) continue;

      for (const dependentIndex of transferIndexesBySource.get(transfer.targetDefinitionId) ?? []) {
        if (dependentIndex > transferIndex) {
          enqueueTransferIndex(currentQueue, currentQueued, dependentIndex);
        } else {
          enqueueTransferIndex(nextQueue, nextQueued, dependentIndex);
        }
      }
    }

    const connected = contexts.map(({ graph, state }) => {
      const transfers = crossFileTransfersByGraph.get(graph.filePath) ?? [...graph.interproceduralFlows];
      const unique = [...new Map(transfers.map((transfer) => [transfer.id, transfer] as const)).values()].sort((left, right) => left.id.localeCompare(right.id));
      const taintFlows = this.dataFlowBuilder.computeTaintFlows(state, globalTaintPaths);

      return createDataFlowGraph({
        ...graph,
        interproceduralFlows: unique,
        taintFlows,
      });
    });

    return Object.freeze({
      controlFlowGraphs: Object.freeze([...controlFlowGraphs]),
      dataFlowGraphs: Object.freeze(connected),
    });
  }
}

function enqueueTransferIndex(queue: number[], queued: Set<number>, index: number): void {
  if (queued.has(index)) return;
  queued.add(index);
  queue.push(index);
  for (let child = queue.length - 1; child > 0;) {
    const parent = Math.floor((child - 1) / 2);
    const childValue = queue[child];
    const parentValue = queue[parent];
    if (childValue === undefined || parentValue === undefined || parentValue <= childValue) break;
    queue[parent] = childValue;
    queue[child] = parentValue;
    child = parent;
  }
}

function dequeueTransferIndex(queue: number[], queued: Set<number>): number {
  const first = queue[0];
  if (first === undefined) throw new Error("Transfer worklist is unexpectedly empty.");
  const last = queue.pop();
  queued.delete(first);
  if (queue.length === 0 || last === undefined) return first;
  queue[0] = last;

  for (let parent = 0;;) {
    const left = parent * 2 + 1;
    const right = left + 1;
    let smallest = parent;
    if (queue[left] !== undefined && queue[smallest] !== undefined && queue[left]! < queue[smallest]!) smallest = left;
    if (queue[right] !== undefined && queue[smallest] !== undefined && queue[right]! < queue[smallest]!) smallest = right;
    if (smallest === parent) break;
    const parentValue = queue[parent];
    const childValue = queue[smallest];
    if (parentValue === undefined || childValue === undefined) break;
    queue[parent] = childValue;
    queue[smallest] = parentValue;
    parent = smallest;
  }

  return first;
}

function setGlobalTaintPath(
  taintPaths: Map<string, Map<string, readonly string[]>>,
  definitionId: string,
  sourceId: string,
  path: readonly string[],
): boolean {
  if (path.slice(0, -1).includes(definitionId)) return false;
  const paths = taintPaths.get(definitionId) ?? new Map<string, readonly string[]>();
  const existing = paths.get(sourceId);
  if (existing !== undefined && (existing.length <= path.length || existing.join(":") <= path.join(":"))) return false;
  paths.set(sourceId, Object.freeze([...path]));
  taintPaths.set(definitionId, paths);
  return true;
}

function createTransfer(callId: string, kind: InterproceduralFlow["kind"], sourceDefinitionId: string, targetDefinitionId: string): InterproceduralFlow {
  return { id: createHash("sha256").update(`interprocedural:${callId}:${kind}:${sourceDefinitionId}:${targetDefinitionId}`).digest("hex"), callId, kind, sourceDefinitionId, targetDefinitionId };
}
