import { z } from "zod";
import { compareCodePoints } from "@shared/ordering";

/** Certainty of an analysis result. Missing facts must never be treated as resolved facts. */
export type AnalysisState = "RESOLVED" | "INFERRED" | "UNRESOLVED" | "UNSUPPORTED" | "CONFLICTING" | "REQUIRES_REVIEW";
/** Certainty attached to an individual finding rather than the graph as a whole. */
export type EvidenceState = "CONFIRMED" | "INFERRED" | "UNRESOLVED" | "UNSUPPORTED" | "REQUIRES_REVIEW";

export type ControlFlowEdgeKind = "next" | "true" | "false" | "case" | "loop-back" | "break" | "continue" | "return" | "throw" | "exception" | "finally";

export interface ControlFlowNode { readonly id: string; readonly type: string; readonly location?: { readonly line: number; readonly column: number }; }
export interface BasicBlock { readonly id: string; readonly statements: readonly ControlFlowNode[]; readonly predecessorIds: readonly string[]; readonly successorIds: readonly string[]; readonly terminator?: string; }
export interface ControlFlowEdge { readonly id: string; readonly fromBlockId: string; readonly toBlockId: string; readonly kind: ControlFlowEdgeKind; }
export interface DominatorInfo { readonly blockId: string; readonly immediateDominatorId?: string; }
export interface NaturalLoop { readonly headerBlockId: string; readonly blockIds: readonly string[]; }
export interface ControlFlowGraph { readonly id: string; readonly filePath: string; readonly scopeName: string; readonly state: AnalysisState; readonly entryBlockId: string; readonly exitBlockId: string; readonly blocks: readonly BasicBlock[]; readonly edges: readonly ControlFlowEdge[]; readonly dominators: readonly DominatorInfo[]; readonly loops: readonly NaturalLoop[]; readonly unreachableBlockIds: readonly string[]; readonly deadCodeNodeIds: readonly string[]; }

export interface VariableDefinition { readonly id: string; readonly filePath: string; readonly name: string; readonly kind: "declaration" | "assignment" | "parameter" | "return"; readonly constantValue?: string | number | boolean | null; }
export interface VariableUse { readonly id: string; readonly filePath: string; readonly name: string; readonly definitionId?: string; }
export interface VariableLifetime { readonly name: string; readonly filePath: string; readonly declarationId: string; readonly useIds: readonly string[]; }
export interface DefUseChain { readonly definitionId: string; readonly useIds: readonly string[]; }
export interface TaintFlow { readonly sourceId: string; readonly sinkId: string; readonly path: readonly string[]; readonly state: EvidenceState; }
export interface InterproceduralFlow { readonly id: string; readonly callId: string; readonly kind: "argument-to-parameter" | "return-value" | "return-to-receiver"; readonly sourceDefinitionId: string; readonly targetDefinitionId: string; }
/** A semantic call target that has been proven by the canonical call resolver. */
export interface ProvenCallTarget { readonly callId: string; readonly sourceFilePath: string; readonly location: { readonly line: number; readonly column: number }; readonly targetSymbolId: string; }
/** Minimal per-function linkage required for deterministic whole-program DFG transfers. */
export interface FunctionFlowSummary { readonly symbolId: string; readonly filePath: string; readonly parameterDefinitionIds: readonly (readonly string[] | string)[]; readonly returnDefinitionIds: readonly string[]; }
/** Minimal caller-side linkage for a semantic target; no AST or symbol payload is duplicated. */
export interface CallFlowBinding { readonly callId: string; readonly targetSymbolId: string; readonly argumentDefinitionIds: readonly (string | undefined)[]; readonly receiverDefinitionId?: string; /** Per argument, the source passed straight in (`f(req.body)`); present only when one is (BA-04). */ readonly argumentSourceIds?: readonly (string | undefined)[]; }
export interface DataFlowGraph { readonly id: string; readonly filePath: string; readonly state: AnalysisState; readonly definitions: readonly VariableDefinition[]; readonly uses: readonly VariableUse[]; readonly defUseChains: readonly DefUseChain[]; readonly lifetimes: readonly VariableLifetime[]; readonly taintFlows: readonly TaintFlow[]; readonly interproceduralFlows: readonly InterproceduralFlow[]; readonly functionSummaries: readonly FunctionFlowSummary[]; readonly callBindings: readonly CallFlowBinding[]; }

const nodeSchema = z.object({ id: z.string().min(1), type: z.string().min(1), location: z.object({ line: z.number().int().positive(), column: z.number().int().nonnegative() }).optional() });
const blockSchema = z.object({ id: z.string().min(1), statements: z.array(nodeSchema), predecessorIds: z.array(z.string().min(1)), successorIds: z.array(z.string().min(1)), terminator: z.string().min(1).optional() });
const edgeSchema = z.object({ id: z.string().min(1), fromBlockId: z.string().min(1), toBlockId: z.string().min(1), kind: z.enum(["next", "true", "false", "case", "loop-back", "break", "continue", "return", "throw", "exception", "finally"]) });
const analysisStateSchema = z.enum(["RESOLVED", "INFERRED", "UNRESOLVED", "UNSUPPORTED", "CONFLICTING", "REQUIRES_REVIEW"]);
const cfgSchema = z.object({ id: z.string().min(1), filePath: z.string().min(1), scopeName: z.string().min(1), state: analysisStateSchema, entryBlockId: z.string().min(1), exitBlockId: z.string().min(1), blocks: z.array(blockSchema), edges: z.array(edgeSchema), dominators: z.array(z.object({ blockId: z.string().min(1), immediateDominatorId: z.string().min(1).optional() })), loops: z.array(z.object({ headerBlockId: z.string().min(1), blockIds: z.array(z.string().min(1)) })), unreachableBlockIds: z.array(z.string().min(1)), deadCodeNodeIds: z.array(z.string().min(1)) });
const evidenceStateSchema = z.enum(["CONFIRMED", "INFERRED", "UNRESOLVED", "UNSUPPORTED", "REQUIRES_REVIEW"]);
const provenCallTargetSchema = z.object({ callId: z.string().min(1), sourceFilePath: z.string().min(1), location: z.object({ line: z.number().int().positive(), column: z.number().int().nonnegative() }), targetSymbolId: z.string().min(1) });
const functionSummarySchema = z.object({ symbolId: z.string().min(1), filePath: z.string().min(1), parameterDefinitionIds: z.array(z.union([z.string().min(1), z.array(z.string().min(1))])), returnDefinitionIds: z.array(z.string().min(1)) });
export const callFlowBindingSchema = z.object({ callId: z.string().min(1), targetSymbolId: z.string().min(1), argumentDefinitionIds: z.array(z.string().min(1).optional()), receiverDefinitionId: z.string().min(1).optional(), argumentSourceIds: z.array(z.string().min(1).optional()).optional() });
export const dataFlowGraphSchema = z.object({ id: z.string().min(1), filePath: z.string().min(1), state: analysisStateSchema, definitions: z.array(z.object({ id: z.string().min(1), filePath: z.string().min(1), name: z.string().min(1), kind: z.enum(["declaration", "assignment", "parameter", "return"]), constantValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional() })), uses: z.array(z.object({ id: z.string().min(1), filePath: z.string().min(1), name: z.string().min(1), definitionId: z.string().min(1).optional() })), defUseChains: z.array(z.object({ definitionId: z.string().min(1), useIds: z.array(z.string().min(1)) })), lifetimes: z.array(z.object({ name: z.string().min(1), filePath: z.string().min(1), declarationId: z.string().min(1), useIds: z.array(z.string().min(1)) })), taintFlows: z.array(z.object({ sourceId: z.string().min(1), sinkId: z.string().min(1), path: z.array(z.string().min(1)), state: evidenceStateSchema })), interproceduralFlows: z.array(z.object({ id: z.string().min(1), callId: z.string().min(1), kind: z.enum(["argument-to-parameter", "return-value", "return-to-receiver"]), sourceDefinitionId: z.string().min(1), targetDefinitionId: z.string().min(1) })), functionSummaries: z.array(functionSummarySchema), callBindings: z.array(callFlowBindingSchema) });

export const controlFlowGraphSchema = cfgSchema;

export function createControlFlowGraph(graph: ControlFlowGraph): ControlFlowGraph { return freeze(controlFlowGraphSchema.parse(graph)); }
export function createDataFlowGraph(graph: DataFlowGraph): DataFlowGraph { return freeze(dataFlowGraphSchema.parse(graph)); }
export function createProvenCallTargets(targets: readonly ProvenCallTarget[]): readonly ProvenCallTarget[] {
  return Object.freeze(provenCallTargetSchema.array().parse(targets).map((target) => Object.freeze({ ...target, location: Object.freeze({ ...target.location }) })).sort((left, right) => compareCodePoints(`${left.sourceFilePath}:${left.location.line}:${left.location.column}:${left.callId}`, `${right.sourceFilePath}:${right.location.line}:${right.location.column}:${right.callId}`)));
}

function freeze<T>(value: T): T { return deepFreeze(value); }
function deepFreeze<T>(value: T): T { if (value === null || typeof value !== "object") return value; for (const nested of Object.values(value)) deepFreeze(nested); return Object.freeze(value); }
