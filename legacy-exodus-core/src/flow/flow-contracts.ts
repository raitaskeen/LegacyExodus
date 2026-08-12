import { z } from "zod";

export type ControlFlowEdgeKind = "next" | "true" | "false" | "case" | "loop-back" | "break" | "continue" | "return" | "throw" | "exception" | "finally";

export interface ControlFlowNode { readonly id: string; readonly type: string; readonly location?: { readonly line: number; readonly column: number }; }
export interface BasicBlock { readonly id: string; readonly statements: readonly ControlFlowNode[]; readonly predecessorIds: readonly string[]; readonly successorIds: readonly string[]; readonly terminator?: string; }
export interface ControlFlowEdge { readonly id: string; readonly fromBlockId: string; readonly toBlockId: string; readonly kind: ControlFlowEdgeKind; }
export interface DominatorInfo { readonly blockId: string; readonly immediateDominatorId?: string; }
export interface NaturalLoop { readonly headerBlockId: string; readonly blockIds: readonly string[]; }
export interface ControlFlowGraph { readonly id: string; readonly filePath: string; readonly scopeName: string; readonly entryBlockId: string; readonly exitBlockId: string; readonly blocks: readonly BasicBlock[]; readonly edges: readonly ControlFlowEdge[]; readonly dominators: readonly DominatorInfo[]; readonly loops: readonly NaturalLoop[]; readonly unreachableBlockIds: readonly string[]; readonly deadCodeNodeIds: readonly string[]; }

export interface VariableDefinition { readonly id: string; readonly filePath: string; readonly name: string; readonly kind: "declaration" | "assignment"; readonly constantValue?: string | number | boolean | null; }
export interface VariableUse { readonly id: string; readonly filePath: string; readonly name: string; readonly definitionId?: string; }
export interface VariableLifetime { readonly name: string; readonly filePath: string; readonly declarationId: string; readonly useIds: readonly string[]; }
export interface DefUseChain { readonly definitionId: string; readonly useIds: readonly string[]; }
export interface TaintFlow { readonly sourceId: string; readonly sinkId: string; readonly path: readonly string[]; }
export interface DataFlowGraph { readonly id: string; readonly filePath: string; readonly definitions: readonly VariableDefinition[]; readonly uses: readonly VariableUse[]; readonly defUseChains: readonly DefUseChain[]; readonly lifetimes: readonly VariableLifetime[]; readonly taintFlows: readonly TaintFlow[]; }

const nodeSchema = z.object({ id: z.string().min(1), type: z.string().min(1), location: z.object({ line: z.number().int().positive(), column: z.number().int().nonnegative() }).optional() });
const blockSchema = z.object({ id: z.string().min(1), statements: z.array(nodeSchema), predecessorIds: z.array(z.string().min(1)), successorIds: z.array(z.string().min(1)), terminator: z.string().min(1).optional() });
const edgeSchema = z.object({ id: z.string().min(1), fromBlockId: z.string().min(1), toBlockId: z.string().min(1), kind: z.enum(["next", "true", "false", "case", "loop-back", "break", "continue", "return", "throw", "exception", "finally"]) });
const cfgSchema = z.object({ id: z.string().min(1), filePath: z.string().min(1), scopeName: z.string().min(1), entryBlockId: z.string().min(1), exitBlockId: z.string().min(1), blocks: z.array(blockSchema), edges: z.array(edgeSchema), dominators: z.array(z.object({ blockId: z.string().min(1), immediateDominatorId: z.string().min(1).optional() })), loops: z.array(z.object({ headerBlockId: z.string().min(1), blockIds: z.array(z.string().min(1)) })), unreachableBlockIds: z.array(z.string().min(1)), deadCodeNodeIds: z.array(z.string().min(1)) });
const dfgSchema = z.object({ id: z.string().min(1), filePath: z.string().min(1), definitions: z.array(z.object({ id: z.string().min(1), filePath: z.string().min(1), name: z.string().min(1), kind: z.enum(["declaration", "assignment"]), constantValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional() })), uses: z.array(z.object({ id: z.string().min(1), filePath: z.string().min(1), name: z.string().min(1), definitionId: z.string().min(1).optional() })), defUseChains: z.array(z.object({ definitionId: z.string().min(1), useIds: z.array(z.string().min(1)) })), lifetimes: z.array(z.object({ name: z.string().min(1), filePath: z.string().min(1), declarationId: z.string().min(1), useIds: z.array(z.string().min(1)) })), taintFlows: z.array(z.object({ sourceId: z.string().min(1), sinkId: z.string().min(1), path: z.array(z.string().min(1)) })) });

export function createControlFlowGraph(graph: ControlFlowGraph): ControlFlowGraph { return freeze(cfgSchema.parse(graph)); }
export function createDataFlowGraph(graph: DataFlowGraph): DataFlowGraph { return freeze(dfgSchema.parse(graph)); }

function freeze<T>(value: T): T { return deepFreeze(value); }
function deepFreeze<T>(value: T): T { if (value === null || typeof value !== "object") return value; for (const nested of Object.values(value)) deepFreeze(nested); return Object.freeze(value); }
