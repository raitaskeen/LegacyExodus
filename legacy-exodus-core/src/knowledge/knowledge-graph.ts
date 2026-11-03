import { createHash } from "node:crypto";

import { z } from "zod";

import type { DependencyGraph } from "@graph/index";
import type { SymbolTable } from "@symbols/index";
import { compareCodePoints } from "@shared/ordering";

export type KnowledgeNodeKind = "file" | "symbol";
export type KnowledgeRelationship = "contains" | "imports";

export interface KnowledgeNode {
  readonly id: string;
  readonly kind: KnowledgeNodeKind;
  readonly name: string;
  readonly filePath: string;
}

export interface KnowledgeEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly relationship: KnowledgeRelationship;
}

export interface KnowledgeGraph {
  readonly nodes: readonly KnowledgeNode[];
  readonly edges: readonly KnowledgeEdge[];
}

const graphSchema = z.object({
  nodes: z.array(z.object({ id: z.string().min(1), kind: z.enum(["file", "symbol"]), name: z.string().min(1), filePath: z.string().min(1) })),
  edges: z.array(z.object({ id: z.string().min(1), from: z.string().min(1), to: z.string().min(1), relationship: z.enum(["contains", "imports"]) })),
});

export class DeterministicKnowledgeGraphBuilder {
  /** `symbolTables` are read once, in order (they can come from disk one at a time). */
  public build(symbolTables: Iterable<SymbolTable>, dependencyGraph: DependencyGraph): KnowledgeGraph {
    const nodes: KnowledgeNode[] = [];
    const edges: KnowledgeEdge[] = [];
    for (const table of symbolTables) {
      const fileId = `file:${table.filePath}`;
      nodes.push({ id: fileId, kind: "file", name: table.filePath, filePath: table.filePath });
      for (const symbol of table.symbols) {
        const symbolId = `symbol:${symbol.id}`;
        nodes.push({ id: symbolId, kind: "symbol", name: symbol.name, filePath: table.filePath });
        edges.push(createEdge(fileId, symbolId, "contains"));
      }
    }
    for (const edge of dependencyGraph.edges) {
      edges.push(createEdge(`symbol:${edge.importSymbolId}`, `symbol:${edge.targetExportSymbolId}`, "imports"));
    }
    const parsed = graphSchema.parse({ nodes, edges });
    return Object.freeze({
      nodes: Object.freeze(parsed.nodes.sort((left, right) => compareCodePoints(left.id, right.id)).map((node) => Object.freeze(node))),
      edges: Object.freeze(parsed.edges.sort((left, right) => compareCodePoints(left.id, right.id)).map((edge) => Object.freeze(edge))),
    });
  }
}

function createEdge(from: string, to: string, relationship: KnowledgeRelationship): KnowledgeEdge {
  return { id: createHash("sha256").update(`${from}:${relationship}:${to}`).digest("hex"), from, to, relationship };
}
