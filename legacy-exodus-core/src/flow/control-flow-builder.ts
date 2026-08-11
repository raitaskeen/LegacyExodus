import { createHash } from "node:crypto";
import type { ASTNode, ASTResult } from "@parser/index";
import { createControlFlowGraph, type BasicBlock, type ControlFlowEdge, type ControlFlowEdgeKind, type ControlFlowGraph, type ControlFlowNode } from "./flow-contracts";

interface MutableBlock { readonly id: string; readonly statements: ControlFlowNode[]; terminator?: string; }
interface LoopContext { readonly header: string; readonly after: string; }

export class DeterministicControlFlowGraphBuilder {
  public build(ast: ASTResult): ControlFlowGraph {
    const state = new FlowState(ast.metadata.sourcePath);
    const entry = state.createBlock();
    const exit = state.createBlock();
    state.buildStatements(ast.root.children, entry, exit, undefined);
    return state.finish(entry, exit);
  }
}

class FlowState {
  private readonly blocks: MutableBlock[] = [];
  private readonly edges: ControlFlowEdge[] = [];
  private sequence = 0;
  public constructor(private readonly filePath: string) {}
  public createBlock(): string { const id = hash(`${this.filePath}:block:${this.sequence++}`); this.blocks.push({ id, statements: [] }); return id; }
  public addEdge(fromBlockId: string, toBlockId: string, kind: ControlFlowEdgeKind): void { this.edges.push({ id: hash(`${fromBlockId}:${toBlockId}:${kind}`), fromBlockId, toBlockId, kind }); }
  public buildStatements(nodes: readonly ASTNode[], current: string, exit: string, loop: LoopContext | undefined): string {
    let block = current;
    for (const node of nodes) {
      if (isFunction(node)) continue;
      if (isTerminator(node)) { this.addNode(block, node); this.block(block).terminator = node.type; this.addEdge(block, exit, node.type === "ThrowStatement" ? "throw" : "return"); block = this.createBlock(); continue; }
      if (node.type === "BreakStatement" && loop !== undefined) { this.addNode(block, node); this.block(block).terminator = node.type; this.addEdge(block, loop.after, "break"); block = this.createBlock(); continue; }
      if (node.type === "ContinueStatement" && loop !== undefined) { this.addNode(block, node); this.block(block).terminator = node.type; this.addEdge(block, loop.header, "continue"); block = this.createBlock(); continue; }
      if (node.type === "IfStatement") { block = this.buildIf(node, block, loop); continue; }
      if (isLoop(node)) { block = this.buildLoop(node, block); continue; }
      if (node.type === "SwitchStatement") { block = this.buildSwitch(node, block, loop); continue; }
      if (node.type === "TryStatement") { block = this.buildTry(node, block, exit, loop); continue; }
      this.addNode(block, node);
    }
    if (block !== exit && this.block(block).terminator === undefined) this.addEdge(block, exit, "next");
    return block;
  }
  private buildIf(node: ASTNode, block: string, loop: LoopContext | undefined): string { this.addNode(block, node); const consequent = this.createBlock(); const alternate = this.createBlock(); const join = this.createBlock(); this.addEdge(block, consequent, "true"); this.addEdge(block, alternate, "false"); const children = node.children.filter((child) => child.role === "consequent" || child.role === "alternate"); const yes = children.filter((child) => child.role === "consequent").flatMap(statementChildren); const no = children.filter((child) => child.role === "alternate").flatMap(statementChildren); this.buildStatements(yes, consequent, join, loop); this.buildStatements(no, alternate, join, loop); return join; }
  private buildLoop(node: ASTNode, block: string): string { const header = block; this.addNode(header, node); const body = this.createBlock(); const after = this.createBlock(); this.addEdge(header, body, "true"); this.addEdge(header, after, "false"); const content = node.children.filter((child) => child.role === "body").flatMap(statementChildren); const last = this.buildStatements(content, body, after, { header, after }); if (this.block(last).terminator === undefined) this.addEdge(last, header, "loop-back"); return after; }
  private buildSwitch(node: ASTNode, block: string, loop: LoopContext | undefined): string { this.addNode(block, node); const after = this.createBlock(); const cases = node.children.filter((child) => child.role === "cases"); if (cases.length === 0) this.addEdge(block, after, "next"); for (const branch of cases) { const caseBlock = this.createBlock(); this.addEdge(block, caseBlock, "case"); this.buildStatements(statementChildren(branch), caseBlock, after, loop); } return after; }
  private buildTry(node: ASTNode, block: string, exit: string, loop: LoopContext | undefined): string { this.addNode(block, node); const after = this.createBlock(); const tryBlock = this.createBlock(); this.addEdge(block, tryBlock, "next"); const body = node.children.find((child) => child.role === "block"); this.buildStatements(body === undefined ? [] : statementChildren(body), tryBlock, after, loop); const handler = node.children.find((child) => child.role === "handler"); if (handler !== undefined) { const catchBlock = this.createBlock(); this.addEdge(block, catchBlock, "exception"); this.buildStatements(statementChildren(handler), catchBlock, after, loop); } const finalizer = node.children.find((child) => child.role === "finalizer"); if (finalizer !== undefined) { const finalBlock = this.createBlock(); this.addEdge(after, finalBlock, "finally"); this.buildStatements(statementChildren(finalizer), finalBlock, exit, loop); return finalBlock; } return after; }
  private addNode(blockId: string, node: ASTNode): void { this.block(blockId).statements.push({ id: hash(`${this.filePath}:${node.type}:${node.location?.start.line ?? 0}:${node.location?.start.column ?? 0}`), type: node.type, ...(node.location === undefined ? {} : { location: node.location.start }) }); }
  private block(id: string): MutableBlock { const block = this.blocks.find((candidate) => candidate.id === id); if (block === undefined) throw new Error("Control-flow block was not found."); return block; }
  public finish(entry: string, exit: string): ControlFlowGraph { const reachable = reachableBlocks(entry, this.edges); const blocks: BasicBlock[] = this.blocks.map((block) => ({ id: block.id, statements: block.statements, predecessorIds: this.edges.filter((edge) => edge.toBlockId === block.id).map((edge) => edge.fromBlockId).sort(), successorIds: this.edges.filter((edge) => edge.fromBlockId === block.id).map((edge) => edge.toBlockId).sort(), ...(block.terminator === undefined ? {} : { terminator: block.terminator }) })); const dominators = calculateDominators(entry, blocks, this.edges); const loops = this.edges.filter((edge) => edge.kind === "loop-back").map((edge) => ({ headerBlockId: edge.toBlockId, blockIds: [edge.toBlockId, edge.fromBlockId].sort() })); const unreachableBlockIds = blocks.filter((block) => !reachable.has(block.id)).map((block) => block.id).sort(); return createControlFlowGraph({ id: hash(`cfg:${this.filePath}`), filePath: this.filePath, entryBlockId: entry, exitBlockId: exit, blocks: blocks.sort((left, right) => left.id.localeCompare(right.id)), edges: this.edges.sort((left, right) => left.id.localeCompare(right.id)), dominators, loops, unreachableBlockIds, deadCodeNodeIds: blocks.filter((block) => unreachableBlockIds.includes(block.id)).flatMap((block) => block.statements.map((statement) => statement.id)).sort() }); }
}
function statementChildren(node: ASTNode): readonly ASTNode[] { return node.type === "BlockStatement" || node.type === "Program" ? node.children : [node]; }
function isFunction(node: ASTNode): boolean { return ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassMethod", "ObjectMethod"].includes(node.type); }
function isTerminator(node: ASTNode): boolean { return node.type === "ReturnStatement" || node.type === "ThrowStatement"; }
function isLoop(node: ASTNode): boolean { return ["WhileStatement", "DoWhileStatement", "ForStatement", "ForInStatement", "ForOfStatement"].includes(node.type); }
function reachableBlocks(entry: string, edges: readonly ControlFlowEdge[]): Set<string> { const seen = new Set<string>(); const pending = [entry]; while (pending.length > 0) { const current = pending.pop(); if (current === undefined || seen.has(current)) continue; seen.add(current); for (const edge of edges.filter((candidate) => candidate.fromBlockId === current)) pending.push(edge.toBlockId); } return seen; }
function calculateDominators(entry: string, blocks: readonly BasicBlock[], edges: readonly ControlFlowEdge[]): readonly { readonly blockId: string; readonly immediateDominatorId?: string }[] { const all = new Set(blocks.map((block) => block.id)); const sets = new Map(blocks.map((block) => [block.id, block.id === entry ? new Set([entry]) : new Set(all)])); for (let iteration = 0; iteration < blocks.length * blocks.length; iteration += 1) { let changed = false; for (const block of blocks.filter((candidate) => candidate.id !== entry)) { const predecessors = edges.filter((edge) => edge.toBlockId === block.id).map((edge) => edge.fromBlockId); const intersection = predecessors.length === 0 ? new Set<string>() : predecessors.map((id) => sets.get(id) ?? new Set<string>()).reduce((left, right) => new Set([...left].filter((value) => right.has(value)))); intersection.add(block.id); const previous = sets.get(block.id) ?? new Set<string>(); if (previous.size !== intersection.size || [...previous].some((value) => !intersection.has(value))) { sets.set(block.id, intersection); changed = true; } } if (!changed) break; } return blocks.map((block) => { if (block.id === entry) return { blockId: block.id }; const candidates = [...(sets.get(block.id) ?? [])].filter((id) => id !== block.id).sort(); return { blockId: block.id, ...(candidates.length === 0 ? {} : { immediateDominatorId: candidates.at(-1) }) }; }).sort((left, right) => left.blockId.localeCompare(right.blockId)); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
