import { createHash } from "node:crypto";
import type { ASTNode, ASTResult } from "@parser/index";
import { createControlFlowGraph, type BasicBlock, type ControlFlowEdge, type ControlFlowEdgeKind, type ControlFlowGraph, type ControlFlowNode } from "./flow-contracts";
import { ControlFlowInvariantError } from "./flow-errors";

interface MutableBlock { readonly id: string; readonly statements: ControlFlowNode[]; terminator?: string; }
interface LabelTarget { readonly breakTarget: string; readonly continueTarget?: string; readonly breakFinalizerTarget?: string; readonly continueFinalizerTarget?: string; }
interface PendingLabelFinalizer { readonly label: string; readonly target: LabelTarget; readonly breakFinalizer?: string; readonly continueFinalizer?: string; }
interface ControlContext { readonly breakTarget?: string; readonly continueTarget?: string; readonly breakFinalizerTarget?: string; readonly continueFinalizerTarget?: string; readonly exceptionTarget?: string; readonly returnTarget?: string; readonly labels?: ReadonlyMap<string, LabelTarget>; }

export class DeterministicControlFlowGraphBuilder {
  public build(ast: ASTResult): ControlFlowGraph {
    return this.buildScope(ast.metadata.sourcePath, "module", ast.root.children);
  }

  public buildAll(ast: ASTResult): readonly ControlFlowGraph[] {
    const functions = collectFunctions(ast.root);
    return Object.freeze([
      this.build(ast),
      ...functions.map((candidate) => this.buildScope(ast.metadata.sourcePath, candidate.name, statementChildren(candidate.node.children.find((child) => child.role === "body") ?? candidate.node))),
    ].sort((left, right) => left.id.localeCompare(right.id)));
  }

  private buildScope(filePath: string, scopeName: string, nodes: readonly ASTNode[]): ControlFlowGraph {
    const state = new FlowState(filePath, scopeName);
    const entry = state.createBlock();
    const exit = state.createBlock();
    state.buildStatements(nodes, entry, exit, { exceptionTarget: exit, returnTarget: exit });
    return state.finish(entry, exit);
  }
}

class FlowState {
  private readonly blocks: MutableBlock[] = [];
  private readonly edges: ControlFlowEdge[] = [];
  private sequence = 0;
  public constructor(private readonly filePath: string, private readonly scopeName: string) {}
  public createBlock(): string { const id = hash(`${this.filePath}:${this.scopeName}:block:${this.sequence++}`); this.blocks.push({ id, statements: [] }); return id; }
  public addEdge(fromBlockId: string, toBlockId: string, kind: ControlFlowEdgeKind): void { this.edges.push({ id: hash(`${fromBlockId}:${toBlockId}:${kind}`), fromBlockId, toBlockId, kind }); }
  public buildStatements(nodes: readonly ASTNode[], current: string, exit: string, control: ControlContext | undefined): string {
    let block = current;
    for (const node of nodes) {
      if (isFunction(node)) continue;
      if (isTerminator(node)) { this.addNode(block, node); this.block(block).terminator = node.type; this.addEdge(block, node.type === "ThrowStatement" ? control?.exceptionTarget ?? exit : control?.returnTarget ?? exit, node.type === "ThrowStatement" ? "throw" : "return"); block = this.createBlock(); continue; }
      if (node.type === "BreakStatement") { const target = resolveBreakTarget(node, control); if (target !== undefined) { this.addNode(block, node); this.block(block).terminator = node.type; this.addEdge(block, resolveBreakFinalizerTarget(node, control) ?? target, "break"); block = this.createBlock(); continue; } }
      if (node.type === "ContinueStatement") { const target = resolveContinueTarget(node, control); if (target !== undefined) { this.addNode(block, node); this.block(block).terminator = node.type; this.addEdge(block, resolveContinueFinalizerTarget(node, control) ?? target, "continue"); block = this.createBlock(); continue; } }
      if (node.type === "LabeledStatement") { block = this.buildLabeled(node, block, control); continue; }
      if (node.type === "IfStatement") { block = this.buildIf(node, block, control); continue; }
      if (isLoop(node)) { block = this.buildLoop(node, block, control); continue; }
      if (node.type === "SwitchStatement") { block = this.buildSwitch(node, block, control); continue; }
      if (node.type === "TryStatement") { block = this.buildTry(node, block, exit, control); continue; }
      this.addNode(block, node);
    }
    if (block !== exit && this.block(block).terminator === undefined) this.addEdge(block, exit, "next");
    return block;
  }
  private buildIf(node: ASTNode, block: string, control: ControlContext | undefined): string { this.addNode(block, node); const consequent = this.createBlock(); const alternate = this.createBlock(); const join = this.createBlock(); const condition = staticBoolean(node.children.find((child) => child.role === "test")); if (condition !== false) this.addEdge(block, consequent, "true"); if (condition !== true) this.addEdge(block, alternate, "false"); const children = node.children.filter((child) => child.role === "consequent" || child.role === "alternate"); const yes = children.filter((child) => child.role === "consequent").flatMap(statementChildren); const no = children.filter((child) => child.role === "alternate").flatMap(statementChildren); this.buildStatements(yes, consequent, join, control); this.buildStatements(no, alternate, join, control); return join; }
  private buildLabeled(node: ASTNode, block: string, control: ControlContext | undefined): string { this.addNode(block, node); const label = labelName(node); const body = node.children.find((child) => child.role === "body"); if (body === undefined || label === undefined) return block; if (isLoop(body)) return this.buildLoop(body, block, control, label); const after = this.createBlock(); const labels = withLabel(control?.labels, label, { breakTarget: after }); this.buildStatements(statementChildren(body), block, after, { ...control, labels }); return after; }
  private buildLoop(node: ASTNode, block: string, control: ControlContext | undefined, label?: string): string { const header = block; this.addNode(header, node); const body = this.createBlock(); const after = this.createBlock(); const condition = node.type === "DoWhileStatement" ? undefined : staticBoolean(node.children.find((child) => child.role === "test")); if (condition !== false) this.addEdge(header, body, "true"); if (condition !== true) this.addEdge(header, after, "false"); const labels = label === undefined ? control?.labels : withLabel(control?.labels, label, { breakTarget: after, continueTarget: header }); const content = node.children.filter((child) => child.role === "body").flatMap(statementChildren); const last = this.buildStatements(content, body, after, { ...control, breakTarget: after, continueTarget: header, labels }); if (this.block(last).terminator === undefined && condition !== false) this.addEdge(last, header, "loop-back"); return after; }
  private buildSwitch(node: ASTNode, block: string, control: ControlContext | undefined): string { this.addNode(block, node); const after = this.createBlock(); const cases = node.children.filter((child) => child.role === "cases"); if (cases.length === 0) { this.addEdge(block, after, "next"); return after; } const blocks = cases.map(() => this.createBlock()); const hasDefault = cases.some((candidate) => candidate.children.every((child) => child.role !== "test")); for (const [index, branch] of cases.entries()) { const caseBlock = blocks[index]; if (caseBlock === undefined) continue; this.addEdge(block, caseBlock, "case"); const last = this.buildStatements(switchCaseStatements(branch), caseBlock, after, { ...control, breakTarget: after, continueTarget: control?.continueTarget }); if (this.block(last).terminator === undefined) { const next = blocks[index + 1] ?? after; this.addEdge(last, next, "next"); } } if (!hasDefault) this.addEdge(block, after, "next"); return after; }
  private buildTry(node: ASTNode, block: string, exit: string, control: ControlContext | undefined): string {
    this.addNode(block, node);
    const after = this.createBlock();
    const body = node.children.find((child) => child.role === "block");
    const handler = node.children.find((child) => child.role === "handler");
    const finalizer = node.children.find((child) => child.role === "finalizer");
    const outerExceptionTarget = control?.exceptionTarget ?? exit;
    const outerReturnTarget = control?.returnTarget ?? exit;
    const outerBreakTarget = control?.breakTarget;
    const outerContinueTarget = control?.continueTarget;
    const tryBlock = this.createBlock();
    const catchBlock = handler === undefined ? undefined : this.createBlock();
    const normalFinalizer = finalizer === undefined ? after : this.createBlock();
    const thrownFinalizer = finalizer === undefined ? undefined : this.createBlock();
    const returnedFinalizer = finalizer === undefined ? undefined : this.createBlock();
    const brokenFinalizer = finalizer === undefined || outerBreakTarget === undefined ? undefined : this.createBlock();
    const continuedFinalizer = finalizer === undefined || outerContinueTarget === undefined ? undefined : this.createBlock();
    const labeledFinalizers: readonly PendingLabelFinalizer[] = finalizer === undefined ? [] : [...(control?.labels?.entries() ?? [])].map(([label, target]) => ({
      label,
      target,
      breakFinalizer: this.createBlock(),
      ...(target.continueTarget === undefined ? {} : { continueFinalizer: this.createBlock() }),
    }));
    const protectedLabels = labeledFinalizers.length === 0 ? control?.labels : new Map(labeledFinalizers.map((candidate) => [candidate.label, {
      ...candidate.target,
      breakFinalizerTarget: candidate.breakFinalizer,
      ...(candidate.continueFinalizer === undefined ? {} : { continueFinalizerTarget: candidate.continueFinalizer }),
    }]));
    const protectedControl: ControlContext = {
      ...control,
      exceptionTarget: catchBlock ?? thrownFinalizer ?? outerExceptionTarget,
      returnTarget: returnedFinalizer ?? outerReturnTarget,
      ...(protectedLabels === undefined ? {} : { labels: protectedLabels }),
      ...(brokenFinalizer === undefined ? {} : { breakFinalizerTarget: brokenFinalizer }),
      ...(continuedFinalizer === undefined ? {} : { continueFinalizerTarget: continuedFinalizer }),
    };
    this.addEdge(block, tryBlock, "next");
    const tryLast = this.buildStatements(body === undefined ? [] : statementChildren(body), tryBlock, normalFinalizer, protectedControl);
    if (finalizer !== undefined) {
      this.retagCompletionEdge(tryLast, normalFinalizer, "next", "finally");
      if (catchBlock === undefined) this.retagIncomingEdges(thrownFinalizer, "throw", "finally");
      this.retagIncomingEdges(returnedFinalizer as string, "return", "finally");
      this.retagIncomingEdges(brokenFinalizer, "break", "finally");
      this.retagIncomingEdges(continuedFinalizer, "continue", "finally");
      for (const pending of labeledFinalizers) {
        this.retagIncomingEdges(pending.breakFinalizer, "break", "finally");
        this.retagIncomingEdges(pending.continueFinalizer, "continue", "finally");
      }
    }
    if (handler !== undefined && catchBlock !== undefined) {
      const catchLast = this.buildStatements(catchStatements(handler), catchBlock, normalFinalizer, {
        ...protectedControl,
        exceptionTarget: thrownFinalizer ?? outerExceptionTarget,
      });
      if (finalizer !== undefined) {
        this.retagCompletionEdge(catchLast, normalFinalizer, "next", "finally");
        this.retagIncomingEdges(thrownFinalizer as string, "throw", "finally");
        this.retagIncomingEdges(returnedFinalizer as string, "return", "finally");
        this.retagIncomingEdges(brokenFinalizer, "break", "finally");
        this.retagIncomingEdges(continuedFinalizer, "continue", "finally");
        for (const pending of labeledFinalizers) {
          this.retagIncomingEdges(pending.breakFinalizer, "break", "finally");
          this.retagIncomingEdges(pending.continueFinalizer, "continue", "finally");
        }
      }
    }
    if (finalizer !== undefined && thrownFinalizer !== undefined && returnedFinalizer !== undefined) {
      const finalizerStatements = statementChildren(finalizer);
      const finalizerControl: ControlContext = { ...control, exceptionTarget: outerExceptionTarget, returnTarget: outerReturnTarget };
      this.addNode(normalFinalizer, finalizer);
      this.buildStatements(finalizerStatements, normalFinalizer, after, finalizerControl);
      this.addNode(thrownFinalizer, finalizer);
      const thrownLast = this.buildStatements(finalizerStatements, thrownFinalizer, outerExceptionTarget, finalizerControl);
      this.retagCompletionEdge(thrownLast, outerExceptionTarget, "next", "throw");
      this.addNode(returnedFinalizer, finalizer);
      const returnedLast = this.buildStatements(finalizerStatements, returnedFinalizer, outerReturnTarget, finalizerControl);
      this.retagCompletionEdge(returnedLast, outerReturnTarget, "next", "return");
      if (brokenFinalizer !== undefined && outerBreakTarget !== undefined) {
        this.addNode(brokenFinalizer, finalizer);
        const breakDestination = control?.breakFinalizerTarget ?? outerBreakTarget;
        const brokenLast = this.buildStatements(finalizerStatements, brokenFinalizer, breakDestination, finalizerControl);
        this.retagCompletionEdge(brokenLast, breakDestination, "next", "break");
      }
      if (continuedFinalizer !== undefined && outerContinueTarget !== undefined) {
        this.addNode(continuedFinalizer, finalizer);
        const continueDestination = control?.continueFinalizerTarget ?? outerContinueTarget;
        const continuedLast = this.buildStatements(finalizerStatements, continuedFinalizer, continueDestination, finalizerControl);
        this.retagCompletionEdge(continuedLast, continueDestination, "next", "continue");
      }
      for (const pending of labeledFinalizers) {
        this.addNode(pending.breakFinalizer as string, finalizer);
        const breakDestination = pending.target.breakFinalizerTarget ?? pending.target.breakTarget;
        const brokenLast = this.buildStatements(finalizerStatements, pending.breakFinalizer as string, breakDestination, finalizerControl);
        this.retagCompletionEdge(brokenLast, breakDestination, "next", "break");
        if (pending.continueFinalizer !== undefined && pending.target.continueTarget !== undefined) {
          this.addNode(pending.continueFinalizer, finalizer);
          const continueDestination = pending.target.continueFinalizerTarget ?? pending.target.continueTarget;
          const continuedLast = this.buildStatements(finalizerStatements, pending.continueFinalizer, continueDestination, finalizerControl);
          this.retagCompletionEdge(continuedLast, continueDestination, "next", "continue");
        }
      }
    }
    return after;
  }
  private addNode(blockId: string, node: ASTNode): void { this.block(blockId).statements.push({ id: hash(`${this.filePath}:${node.type}:${node.location?.start.line ?? 0}:${node.location?.start.column ?? 0}`), type: node.type, ...(node.location === undefined ? {} : { location: node.location.start }) }); }
  private block(id: string): MutableBlock { const block = this.blocks.find((candidate) => candidate.id === id); if (block === undefined) throw new ControlFlowInvariantError(id); return block; }
  private retagCompletionEdge(fromBlockId: string, toBlockId: string, sourceKind: ControlFlowEdgeKind, targetKind: ControlFlowEdgeKind): void { const edge = this.edges.find((candidate) => candidate.fromBlockId === fromBlockId && candidate.toBlockId === toBlockId && candidate.kind === sourceKind); if (edge === undefined) return; const index = this.edges.indexOf(edge); this.edges[index] = { ...edge, id: hash(`${fromBlockId}:${toBlockId}:${targetKind}`), kind: targetKind }; }
  private retagIncomingEdges(toBlockId: string | undefined, sourceKind: ControlFlowEdgeKind, targetKind: ControlFlowEdgeKind): void { if (toBlockId === undefined) return; for (const [index, edge] of this.edges.entries()) { if (edge.toBlockId === toBlockId && edge.kind === sourceKind) this.edges[index] = { ...edge, id: hash(`${edge.fromBlockId}:${toBlockId}:${targetKind}`), kind: targetKind }; } }
  public finish(entry: string, exit: string): ControlFlowGraph { const reachable = reachableBlocks(entry, this.edges); const blocks: BasicBlock[] = this.blocks.map((block) => ({ id: block.id, statements: block.statements, predecessorIds: this.edges.filter((edge) => edge.toBlockId === block.id).map((edge) => edge.fromBlockId).sort(), successorIds: this.edges.filter((edge) => edge.fromBlockId === block.id).map((edge) => edge.toBlockId).sort(), ...(block.terminator === undefined ? {} : { terminator: block.terminator }) })); const dominators = calculateDominators(entry, blocks, this.edges); const loops = this.edges.filter((edge) => edge.kind === "loop-back").map((edge) => ({ headerBlockId: edge.toBlockId, blockIds: [edge.toBlockId, edge.fromBlockId].sort() })); const unreachableBlockIds = blocks.filter((block) => !reachable.has(block.id)).map((block) => block.id).sort(); return createControlFlowGraph({ id: hash(`cfg:${this.filePath}:${this.scopeName}`), filePath: this.filePath, scopeName: this.scopeName, state: "RESOLVED", entryBlockId: entry, exitBlockId: exit, blocks: blocks.sort((left, right) => left.id.localeCompare(right.id)), edges: this.edges.sort((left, right) => left.id.localeCompare(right.id)), dominators, loops, unreachableBlockIds, deadCodeNodeIds: blocks.filter((block) => unreachableBlockIds.includes(block.id)).flatMap((block) => block.statements.map((statement) => statement.id)).sort() }); }
}
function collectFunctions(root: ASTNode): readonly { readonly name: string; readonly node: ASTNode }[] { const functions: { name: string; node: ASTNode }[] = []; const visit = (node: ASTNode): void => { if (isFunction(node)) { const name = functionName(node); functions.push({ name: `${name}@${node.location?.start.line ?? 0}:${node.location?.start.column ?? 0}`, node }); } for (const child of node.children) visit(child); }; for (const child of root.children) visit(child); return functions.sort((left, right) => left.name.localeCompare(right.name)); }
function functionName(node: ASTNode): string { const name = node.children.find((child) => child.role === "id" || child.role === "key")?.attributes.name; return typeof name === "string" ? name : node.type === "ClassMethod" ? "method" : "anonymous"; }
function statementChildren(node: ASTNode): readonly ASTNode[] { return node.type === "BlockStatement" || node.type === "Program" ? node.children : [node]; }
function switchCaseStatements(node: ASTNode): readonly ASTNode[] { return node.children.filter((child) => child.role === "consequent"); }
function catchStatements(node: ASTNode): readonly ASTNode[] { const body = node.children.find((child) => child.role === "body"); return body === undefined ? [] : statementChildren(body); }
function labelName(node: ASTNode): string | undefined { const value = node.children.find((child) => child.role === "label")?.attributes.name; return typeof value === "string" && value.length > 0 ? value : undefined; }
function withLabel(labels: ReadonlyMap<string, LabelTarget> | undefined, label: string, target: LabelTarget): ReadonlyMap<string, LabelTarget> { return new Map([...(labels?.entries() ?? []), [label, target]]); }
function resolveBreakTarget(node: ASTNode, control: ControlContext | undefined): string | undefined { const label = labelName(node); return label === undefined ? control?.breakTarget : control?.labels?.get(label)?.breakTarget; }
function resolveContinueTarget(node: ASTNode, control: ControlContext | undefined): string | undefined { const label = labelName(node); return label === undefined ? control?.continueTarget : control?.labels?.get(label)?.continueTarget; }
function resolveBreakFinalizerTarget(node: ASTNode, control: ControlContext | undefined): string | undefined { const label = labelName(node); return label === undefined ? control?.breakFinalizerTarget : control?.labels?.get(label)?.breakFinalizerTarget; }
function resolveContinueFinalizerTarget(node: ASTNode, control: ControlContext | undefined): string | undefined { const label = labelName(node); return label === undefined ? control?.continueFinalizerTarget : control?.labels?.get(label)?.continueFinalizerTarget; }
function isFunction(node: ASTNode): boolean { return ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassMethod", "ObjectMethod"].includes(node.type); }
function isTerminator(node: ASTNode): boolean { return node.type === "ReturnStatement" || node.type === "ThrowStatement"; }
function isLoop(node: ASTNode): boolean { return ["WhileStatement", "DoWhileStatement", "ForStatement", "ForInStatement", "ForOfStatement"].includes(node.type); }
function staticBoolean(node: ASTNode | undefined): boolean | undefined { const value = node?.attributes.value; return typeof value === "boolean" ? value : undefined; }
function reachableBlocks(entry: string, edges: readonly ControlFlowEdge[]): Set<string> { const seen = new Set<string>(); const pending = [entry]; while (pending.length > 0) { const current = pending.pop(); if (current === undefined || seen.has(current)) continue; seen.add(current); for (const edge of edges.filter((candidate) => candidate.fromBlockId === current)) pending.push(edge.toBlockId); } return seen; }
function calculateDominators(entry: string, blocks: readonly BasicBlock[], edges: readonly ControlFlowEdge[]): readonly { readonly blockId: string; readonly immediateDominatorId?: string }[] { const all = new Set(blocks.map((block) => block.id)); const sets = new Map(blocks.map((block) => [block.id, block.id === entry ? new Set([entry]) : new Set(all)])); for (let iteration = 0; iteration < blocks.length * blocks.length; iteration += 1) { let changed = false; for (const block of blocks.filter((candidate) => candidate.id !== entry)) { const predecessors = edges.filter((edge) => edge.toBlockId === block.id).map((edge) => edge.fromBlockId); const intersection = predecessors.length === 0 ? new Set<string>() : predecessors.map((id) => sets.get(id) ?? new Set<string>()).reduce((left, right) => new Set([...left].filter((value) => right.has(value)))); intersection.add(block.id); const previous = sets.get(block.id) ?? new Set<string>(); if (previous.size !== intersection.size || [...previous].some((value) => !intersection.has(value))) { sets.set(block.id, intersection); changed = true; } } if (!changed) break; } return blocks.map((block) => { if (block.id === entry) return { blockId: block.id }; const candidates = [...(sets.get(block.id) ?? [])].filter((id) => id !== block.id); const immediate = candidates.find((candidate) => candidates.every((other) => other === candidate || sets.get(candidate)?.has(other) === true)); return { blockId: block.id, ...(immediate === undefined ? {} : { immediateDominatorId: immediate }) }; }).sort((left, right) => left.blockId.localeCompare(right.blockId)); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
