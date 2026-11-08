import { createHash } from "node:crypto";

import { z } from "zod";

import type { DependencyGraph } from "@graph/index";
import type { SymbolTable } from "@symbols/index";
import { sortedFactArray, type FactArray, type FactStore } from "@shared/fact-array";
import { compareCodePoints } from "@shared/ordering";
import { immutable } from "@shared/immutability";

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

const nodeSchema = z.object({ id: z.string().min(1), kind: z.enum(["file", "symbol"]), name: z.string().min(1), filePath: z.string().min(1) });
const edgeSchema = z.object({ id: z.string().min(1), from: z.string().min(1), to: z.string().min(1), relationship: z.enum(["contains", "imports"]) });
const graphSchema = z.object({ nodes: z.array(nodeSchema), edges: z.array(edgeSchema) });

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
    return immutable({
      nodes: immutable(parsed.nodes.sort((left, right) => compareCodePoints(left.id, right.id)).map((node) => immutable(node))),
      edges: immutable(parsed.edges.sort((left, right) => compareCodePoints(left.id, right.id)).map((edge) => immutable(edge))),
    });
  }
}

/**
 * `DeterministicKnowledgeGraphBuilder.build` with its node and edge lists sorted on disk, in bounded memory
 * (ADR-009 step 5): the same items, validated one at a time, in the same order.
 */
export function buildKnowledgeGraphOnDisk(store: FactStore, symbolTables: Iterable<SymbolTable>, dependencyGraph: DependencyGraph): { readonly nodes: FactArray<KnowledgeNode>; readonly edges: FactArray<KnowledgeEdge> } {
  const nodes = store.writer<KnowledgeNode>();
  const edges = store.writer<KnowledgeEdge>();
  for (const table of symbolTables) {
    const fileId = `file:${table.filePath}`;
    nodes.append(nodeSchema.parse({ id: fileId, kind: "file", name: table.filePath, filePath: table.filePath }));
    for (const symbol of table.symbols) {
      const symbolId = `symbol:${symbol.id}`;
      nodes.append(nodeSchema.parse({ id: symbolId, kind: "symbol", name: symbol.name, filePath: table.filePath }));
      edges.append(edgeSchema.parse(createEdge(fileId, symbolId, "contains")));
    }
  }
  for (const edge of dependencyGraph.edges) {
    edges.append(edgeSchema.parse(createEdge(`symbol:${edge.importSymbolId}`, `symbol:${edge.targetExportSymbolId}`, "imports")));
  }
  return { nodes: sortedFactArray(store, nodes.seal(), (node) => node.id), edges: sortedFactArray(store, edges.seal(), (edge) => edge.id) };
}

function createEdge(from: string, to: string, relationship: KnowledgeRelationship): KnowledgeEdge {
  return { id: createHash("sha256").update(`${from}:${relationship}:${to}`).digest("hex"), from, to, relationship };
}
