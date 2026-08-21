import type { ASTResult } from "@parser/index";
import type { SemanticCall } from "@semantic/index";
import type { SymbolTable } from "@symbols/index";
import { createHash } from "node:crypto";
import { DeterministicControlFlowGraphBuilder } from "./control-flow-builder";
import { DeterministicDataFlowGraphBuilder } from "./data-flow-builder";
import { createDataFlowGraph, createProvenCallTargets, type ControlFlowGraph, type DataFlowGraph, type InterproceduralFlow } from "./flow-contracts";

export interface FlowAnalysisResult { readonly controlFlowGraphs: readonly ControlFlowGraph[]; readonly dataFlowGraphs: readonly DataFlowGraph[]; }
export class DeterministicFlowAnalysisEngine {
  public constructor(private readonly controlFlowBuilder: DeterministicControlFlowGraphBuilder = new DeterministicControlFlowGraphBuilder(), private readonly dataFlowBuilder: DeterministicDataFlowGraphBuilder = new DeterministicDataFlowGraphBuilder()) {}
  public analyze(astResults: readonly ASTResult[], semanticCalls?: readonly SemanticCall[], symbolTables: readonly SymbolTable[] = []): FlowAnalysisResult {
    const results = [...astResults].sort((left, right) => left.metadata.sourcePath.localeCompare(right.metadata.sourcePath));
    const symbolsByPath = new Map(symbolTables.map((table) => [table.filePath, table.symbols]));
    const dataFlowGraphs = results.map((ast) => this.dataFlowBuilder.build(ast, semanticCalls === undefined ? undefined : createProvenCallTargets(semanticCalls.flatMap((call) => call.sourceFilePath === ast.metadata.sourcePath && call.resolutionState === "RESOLVED" && call.targetSymbolId !== undefined && call.location !== undefined ? [{ callId: call.id, sourceFilePath: call.sourceFilePath, location: call.location, targetSymbolId: call.targetSymbolId }] : [])), symbolsByPath.get(ast.metadata.sourcePath) ?? []));
    const summaries = new Map(dataFlowGraphs.flatMap((graph) => graph.functionSummaries.map((summary) => [summary.symbolId, summary] as const)));
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
    const connected = dataFlowGraphs.map((graph) => withCrossFileTransfers(graph, summaries));
    return Object.freeze({ controlFlowGraphs: Object.freeze(results.flatMap((ast) => this.controlFlowBuilder.buildAll(ast))), dataFlowGraphs: Object.freeze(connected) });
  }
}

function withCrossFileTransfers(graph: DataFlowGraph, summaries: ReadonlyMap<string, DataFlowGraph["functionSummaries"][number]>): DataFlowGraph {
  const transfers: InterproceduralFlow[] = [...graph.interproceduralFlows];
  for (const binding of graph.callBindings) {
    const target = summaries.get(binding.targetSymbolId);
    if (target === undefined || target.filePath === graph.filePath) continue;
    for (const [index, sourceDefinitionId] of binding.argumentDefinitionIds.entries()) {
      const parameterDefinitionId = target.parameterDefinitionIds[index];
      if (sourceDefinitionId !== undefined && parameterDefinitionId !== undefined) transfers.push(createTransfer(binding.callId, "argument-to-parameter", sourceDefinitionId, parameterDefinitionId));
    }
    if (binding.receiverDefinitionId !== undefined) for (const returned of target.returnDefinitionIds) transfers.push(createTransfer(binding.callId, "return-to-receiver", returned, binding.receiverDefinitionId));
  }
  const unique = [...new Map(transfers.map((transfer) => [transfer.id, transfer] as const)).values()].sort((left, right) => left.id.localeCompare(right.id));
  return createDataFlowGraph({ ...graph, interproceduralFlows: unique });
}

function createTransfer(callId: string, kind: InterproceduralFlow["kind"], sourceDefinitionId: string, targetDefinitionId: string): InterproceduralFlow {
  return { id: createHash("sha256").update(`interprocedural:${callId}:${kind}:${sourceDefinitionId}:${targetDefinitionId}`).digest("hex"), callId, kind, sourceDefinitionId, targetDefinitionId };
}
