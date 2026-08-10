import { z } from "zod";

import type { SymbolTable } from "@symbols/index";

export interface DependencyGraphNode {
  readonly id: string;
  readonly filePath: string;
  readonly symbolId: string;
}

export interface DependencyGraphEdge {
  readonly id: string;
  readonly sourceFilePath: string;
  readonly targetFilePath: string;
  readonly importSymbolId: string;
  readonly targetExportSymbolId: string;
  readonly moduleSpecifier: string;
}

export interface DependencyGraph {
  readonly nodes: readonly DependencyGraphNode[];
  readonly edges: readonly DependencyGraphEdge[];
  readonly cycles: readonly (readonly string[])[];
}

export interface DependencyGraphService {
  build(symbolTables: readonly SymbolTable[]): DependencyGraph;
}

const nodeSchema = z.object({
  id: z.string().min(1),
  filePath: z.string().min(1),
  symbolId: z.string().min(1),
});

const edgeSchema = z.object({
  id: z.string().min(1),
  sourceFilePath: z.string().min(1),
  targetFilePath: z.string().min(1),
  importSymbolId: z.string().min(1),
  targetExportSymbolId: z.string().min(1),
  moduleSpecifier: z.string().min(1),
});

const graphSchema = z.object({ nodes: z.array(nodeSchema), edges: z.array(edgeSchema), cycles: z.array(z.array(z.string().min(1)).min(2)) });

export function validateDependencyGraph(graph: unknown): DependencyGraph {
  const parsedGraph = graphSchema.parse(graph);

  return Object.freeze({
    nodes: Object.freeze(parsedGraph.nodes.map((node) => Object.freeze({ ...node }))),
    edges: Object.freeze(parsedGraph.edges.map((edge) => Object.freeze({ ...edge }))),
    cycles: Object.freeze(parsedGraph.cycles.map((cycle) => Object.freeze([...cycle]))),
  });
}
