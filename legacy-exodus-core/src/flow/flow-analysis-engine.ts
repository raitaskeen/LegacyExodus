import type { ASTResult } from "@parser/index";
import { DeterministicControlFlowGraphBuilder } from "./control-flow-builder";
import { DeterministicDataFlowGraphBuilder } from "./data-flow-builder";
import type { ControlFlowGraph, DataFlowGraph } from "./flow-contracts";

export interface FlowAnalysisResult { readonly controlFlowGraphs: readonly ControlFlowGraph[]; readonly dataFlowGraphs: readonly DataFlowGraph[]; }
export class DeterministicFlowAnalysisEngine {
  public constructor(private readonly controlFlowBuilder: DeterministicControlFlowGraphBuilder = new DeterministicControlFlowGraphBuilder(), private readonly dataFlowBuilder: DeterministicDataFlowGraphBuilder = new DeterministicDataFlowGraphBuilder()) {}
  public analyze(astResults: readonly ASTResult[]): FlowAnalysisResult { const results = [...astResults].sort((left, right) => left.metadata.sourcePath.localeCompare(right.metadata.sourcePath)); return Object.freeze({ controlFlowGraphs: Object.freeze(results.flatMap((ast) => this.controlFlowBuilder.buildAll(ast))), dataFlowGraphs: Object.freeze(results.map((ast) => this.dataFlowBuilder.build(ast))) }); }
}
