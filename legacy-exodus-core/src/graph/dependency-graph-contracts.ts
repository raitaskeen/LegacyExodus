import { z } from "zod";

import type { SymbolTable } from "@symbols/index";
import {
  sourceAnchorSchema, moduleReferenceFormSchema, sourcePhaseSchema, freezeSourceAnchor, unresolvedModuleReferenceSchema, freezeUnresolvedModuleReference,
  type SourceAnchor, type UnresolvedModuleReference,
} from "@symbols/module-reference-contracts";

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

export interface ModuleDependencyEdge {
  readonly id: string;
  readonly sourceFilePath: string;
  readonly targetFilePath: string;
  readonly moduleSpecifier: string;
  readonly sourceAnchor: SourceAnchor;
  readonly form: "esm-side-effect" | "esm-binding" | "commonjs-import" | "dynamic-import";
  readonly sourcePhase?: "value" | "type" | "mixed";
}
export interface UnresolvedModuleDependency extends UnresolvedModuleReference {
  readonly sourceFilePath: string;
}
export interface ModuleDependencyLayer {
  readonly contract: "f07-import-relations-v1";
  readonly edges: readonly ModuleDependencyEdge[];
  /** Module loads with a computed specifier (`import(name)`, `require(name)`); present only when non-empty. */
  readonly unresolvedReferences?: readonly UnresolvedModuleDependency[];
}
export interface CurrentDependencyGraph extends DependencyGraph {
  readonly moduleGraph: ModuleDependencyLayer;
}

export interface DependencyGraph {
  readonly nodes: readonly DependencyGraphNode[];
  readonly edges: readonly DependencyGraphEdge[];
  readonly cycles: readonly (readonly string[])[];
  readonly moduleGraph?: ModuleDependencyLayer;
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

export const moduleDependencyLayerSchema = z.object({
  contract: z.literal("f07-import-relations-v1"),
  edges: z.array(z.object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    sourceFilePath: z.string().min(1),
    targetFilePath: z.string().min(1),
    moduleSpecifier: z.string().min(1),
    sourceAnchor: sourceAnchorSchema,
    form: moduleReferenceFormSchema,
    sourcePhase: sourcePhaseSchema.optional(),
  }).strict()),
  unresolvedReferences: z.array(unresolvedModuleReferenceSchema.extend({ sourceFilePath: z.string().min(1) })).min(1).optional(),
}).strict();

const graphSchema = z.object({ nodes: z.array(nodeSchema), edges: z.array(edgeSchema), cycles: z.array(z.array(z.string().min(1)).min(2)), moduleGraph: moduleDependencyLayerSchema.optional() })
  .refine((graph) => !Object.hasOwn(graph, "moduleGraph") || graph.moduleGraph !== undefined, "Present moduleGraph must satisfy the current contract.");

export function validateDependencyGraph(graph: unknown): DependencyGraph {
  const parsedGraph = graphSchema.parse(graph);

  return Object.freeze({
    nodes: Object.freeze(parsedGraph.nodes.map((node) => Object.freeze({ ...node }))),
    edges: Object.freeze(parsedGraph.edges.map((edge) => Object.freeze({ ...edge }))),
    cycles: Object.freeze(parsedGraph.cycles.map((cycle) => Object.freeze([...cycle]))),
    ...(parsedGraph.moduleGraph === undefined ? {} : { moduleGraph: Object.freeze({
      contract: parsedGraph.moduleGraph.contract,
      edges: Object.freeze(parsedGraph.moduleGraph.edges.map((edge) => Object.freeze({ ...edge, sourceAnchor: freezeSourceAnchor(edge.sourceAnchor) }))),
      ...(parsedGraph.moduleGraph.unresolvedReferences === undefined ? {} : {
        unresolvedReferences: Object.freeze(parsedGraph.moduleGraph.unresolvedReferences.map((reference) => Object.freeze({
          ...freezeUnresolvedModuleReference(reference), sourceFilePath: reference.sourceFilePath,
        }))),
      }),
    }) }),
  });
}

export function validateCurrentDependencyGraph(graph: unknown): CurrentDependencyGraph {
  const validated = validateDependencyGraph(graph);
  if (validated.moduleGraph === undefined) throw new Error("Current dependency graph requires f07-import-relations-v1.");
  return Object.freeze({ ...validated, moduleGraph: validated.moduleGraph });
}
