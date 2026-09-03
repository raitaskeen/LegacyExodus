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
  private unlocatedStatementSequence = 0;
  public constructor(private readonly filePath: string, private readonly scopeName: string) {}
  public createBlock(): string { const id = hash(`${this.filePath}:${this.scopeName}:block:${this.sequence++}`); this.blocks.push({ id, statements: [] }); return id; }
  public addEdge(fromBlockId: string, toBlockId: string, kind: ControlFlowEdgeKind): void {
    const id = hash(`${fromBlockId}:${toBlockId}:${kind}`);
    if (this.edges.some((candidate) => candidate.id === id)) return;
    this.edges.push({ id, fromBlockId, toBlockId, kind });
  }
  public buildStatements(nodes: readonly ASTNode[], current: string, exit: string | undefined, control: ControlContext | undefined): string {
    let block = current;
    let terminated = false;
    for (const node of nodes) {
      if (isFunction(node)) continue;
      if (isTerminator(node)) {
        this.addNode(block, node);
        this.block(block).terminator = node.type;
        const termTarget = node.type === "ThrowStatement" ? control?.exceptionTarget ?? exit : control?.returnTarget ?? exit;
        if (termTarget !== undefined) {
          this.addEdge(block, termTarget, node.type === "ThrowStatement" ? "throw" : "return");
        }
        block = this.createBlock();
        terminated = true;
        continue;
      }
      if (node.type === "BreakStatement") { const target = resolveBreakTarget(node, control); if (target !== undefined) { this.addNode(block, node); this.block(block).terminator = node.type; this.addEdge(block, resolveBreakFinalizerTarget(node, control) ?? target, "break"); block = this.createBlock(); terminated = true; continue; } }
      if (node.type === "ContinueStatement") { const target = resolveContinueTarget(node, control); if (target !== undefined) { this.addNode(block, node); this.block(block).terminator = node.type; this.addEdge(block, resolveContinueFinalizerTarget(node, control) ?? target, "continue"); block = this.createBlock(); terminated = true; continue; } }
      if (node.type === "LabeledStatement") { block = this.buildLabeled(node, block, control); continue; }
      if (node.type === "IfStatement") { block = this.buildIf(node, block, control); continue; }
      if (node.type === "DoWhileStatement") { block = this.buildDoWhile(node, block, control); continue; }
      if (isLoop(node)) { block = this.buildLoop(node, block, control); continue; }
      if (node.type === "SwitchStatement") { block = this.buildSwitch(node, block, control); continue; }
      if (node.type === "TryStatement") { block = this.buildTry(node, block, exit ?? current, control); continue; }
      this.addNode(block, node);
      terminated = false;
    }
    if (exit !== undefined && block !== exit && this.block(block).terminator === undefined && !terminated) this.addEdge(block, exit, "next");
    return block;
  }
  private buildIf(node: ASTNode, block: string, control: ControlContext | undefined): string { this.addNode(block, node); const consequent = this.createBlock(); const alternate = this.createBlock(); const join = this.createBlock(); const condition = staticBoolean(node.children.find((child) => child.role === "test")); if (condition !== false) this.addEdge(block, consequent, "true"); if (condition !== true) this.addEdge(block, alternate, "false"); const children = node.children.filter((child) => child.role === "consequent" || child.role === "alternate"); const yes = children.filter((child) => child.role === "consequent").flatMap(statementChildren); const no = children.filter((child) => child.role === "alternate").flatMap(statementChildren); this.buildStatements(yes, consequent, join, control); this.buildStatements(no, alternate, join, control); return join; }
  private buildLabeled(node: ASTNode, block: string, control: ControlContext | undefined): string { this.addNode(block, node); const label = labelName(node); const body = node.children.find((child) => child.role === "body"); if (body === undefined || label === undefined) return block; if (body.type === "DoWhileStatement") return this.buildDoWhile(body, block, control, label); if (isLoop(body)) return this.buildLoop(body, block, control, label); const after = this.createBlock(); const labels = withLabel(control?.labels, label, { breakTarget: after }); this.buildStatements(statementChildren(body), block, after, { ...control, labels }); return after; }
  private buildDoWhile(node: ASTNode, block: string, control: ControlContext | undefined, label?: string): string { const body = this.createBlock(); const conditionBlock = this.createBlock(); const after = this.createBlock(); const condition = staticBoolean(node.children.find((child) => child.role === "test")); this.addNode(block, node); this.addEdge(block, body, "next"); const labels = label === undefined ? control?.labels : withLabel(control?.labels, label, { breakTarget: after, continueTarget: conditionBlock }); const content = node.children.filter((child) => child.role === "body").flatMap(statementChildren); const last = this.buildStatements(content, body, undefined, { ...control, breakTarget: after, continueTarget: conditionBlock, labels }); if (this.block(last).terminator === undefined) this.addEdge(last, conditionBlock, "next"); if (condition !== false) this.addEdge(conditionBlock, body, "true"); if (condition !== true) this.addEdge(conditionBlock, after, "false"); return after; }
  private buildLoop(node: ASTNode, block: string, control: ControlContext | undefined, label?: string): string { const header = block; this.addNode(header, node); const body = this.createBlock(); const after = this.createBlock(); const condition = staticBoolean(node.children.find((child) => child.role === "test")); if (condition !== false) this.addEdge(header, body, "true"); if (condition !== true) this.addEdge(header, after, "false"); const labels = label === undefined ? control?.labels : withLabel(control?.labels, label, { breakTarget: after, continueTarget: header }); const content = node.children.filter((child) => child.role === "body").flatMap(statementChildren); const last = this.buildStatements(content, body, undefined, { ...control, breakTarget: after, continueTarget: header, labels }); if (this.block(last).terminator === undefined && condition !== false) this.addEdge(last, header, "loop-back"); return after; }
  private buildSwitch(node: ASTNode, block: string, control: ControlContext | undefined): string { this.addNode(block, node); const after = this.createBlock(); const cases = node.children.filter((child) => child.role === "cases"); if (cases.length === 0) { this.addEdge(block, after, "next"); return after; } const blocks = cases.map(() => this.createBlock()); const hasDefault = cases.some((candidate) => candidate.children.every((child) => child.role !== "test")); for (const [index, branch] of cases.entries()) { const caseBlock = blocks[index]; if (caseBlock === undefined) continue; this.addEdge(block, caseBlock, "case"); const last = this.buildStatements(switchCaseStatements(branch), caseBlock, undefined, { ...control, breakTarget: after, continueTarget: control?.continueTarget }); if (this.block(last).terminator === undefined) { const next = blocks[index + 1] ?? after; this.addEdge(last, next, "next"); } } if (!hasDefault) this.addEdge(block, after, "next"); return after; }
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
  private addNode(blockId: string, node: ASTNode): void {
    const position = node.location === undefined
      ? `anon-${this.unlocatedStatementSequence++}`
      : `${node.location.start.line}:${node.location.start.column}`;
    this.block(blockId).statements.push({
      id: hash(`${this.filePath}:${node.type}:${position}`),
      type: node.type,
      ...(node.location === undefined ? {} : { location: node.location.start }),
    });
  }
  private block(id: string): MutableBlock { const block = this.blocks.find((candidate) => candidate.id === id); if (block === undefined) throw new ControlFlowInvariantError(id); return block; }
  private retagCompletionEdge(fromBlockId: string, toBlockId: string, sourceKind: ControlFlowEdgeKind, targetKind: ControlFlowEdgeKind): void { const edge = this.edges.find((candidate) => candidate.fromBlockId === fromBlockId && candidate.toBlockId === toBlockId && candidate.kind === sourceKind); if (edge === undefined) return; const index = this.edges.indexOf(edge); this.edges[index] = { ...edge, id: hash(`${fromBlockId}:${toBlockId}:${targetKind}`), kind: targetKind }; }
  private retagIncomingEdges(toBlockId: string | undefined, sourceKind: ControlFlowEdgeKind, targetKind: ControlFlowEdgeKind): void { if (toBlockId === undefined) return; for (const [index, edge] of this.edges.entries()) { if (edge.toBlockId === toBlockId && edge.kind === sourceKind) this.edges[index] = { ...edge, id: hash(`${edge.fromBlockId}:${toBlockId}:${targetKind}`), kind: targetKind }; } }
  public finish(entry: string, exit: string): ControlFlowGraph {
    const predecessorsByBlock = new Map<string, string[]>();
    const successorsByBlock = new Map<string, string[]>();
    for (const block of this.blocks) {
      predecessorsByBlock.set(block.id, []);
      successorsByBlock.set(block.id, []);
    }
    for (const edge of this.edges) {
      successorsByBlock.get(edge.fromBlockId)?.push(edge.toBlockId);
      predecessorsByBlock.get(edge.toBlockId)?.push(edge.fromBlockId);
    }

    const reachable = reachableBlocks(entry, successorsByBlock);
    const blocks: BasicBlock[] = this.blocks.map((block) => ({
      id: block.id,
      statements: block.statements,
      predecessorIds: (predecessorsByBlock.get(block.id) ?? []).sort(),
      successorIds: (successorsByBlock.get(block.id) ?? []).sort(),
      ...(block.terminator === undefined ? {} : { terminator: block.terminator }),
    }));
    const dominators = calculateDominators(entry, blocks, this.edges);
    const idomMap = new Map<string, string | undefined>();
    for (const d of dominators) {
      idomMap.set(d.blockId, d.immediateDominatorId);
    }
    const loopHeaders = new Map<string, Set<string>>();
    for (const edge of this.edges) {
      if (
        edge.kind === "loop-back" ||
        (isDominator(idomMap, edge.toBlockId, edge.fromBlockId) && (edge.kind === "continue" || edge.kind === "true"))
      ) {
        const headerId = edge.toBlockId;
        const loopBlocks = computeNaturalLoopBlocks(headerId, edge.fromBlockId, predecessorsByBlock);
        const existing = loopHeaders.get(headerId) ?? new Set<string>();
        for (const b of loopBlocks) existing.add(b);
        loopHeaders.set(headerId, existing);
      }
    }
    const loops = Array.from(loopHeaders.entries())
      .map(([headerBlockId, blockSet]) => ({
        headerBlockId,
        blockIds: Array.from(blockSet).sort(),
      }))
      .sort((left, right) =>
        left.headerBlockId === right.headerBlockId
          ? left.blockIds.join(",").localeCompare(right.blockIds.join(","))
          : left.headerBlockId.localeCompare(right.headerBlockId),
      );
    const unreachableBlockIds = blocks.filter((block) => !reachable.has(block.id)).map((block) => block.id).sort();
    return createControlFlowGraph({
      id: hash(`cfg:${this.filePath}:${this.scopeName}`),
      filePath: this.filePath,
      scopeName: this.scopeName,
      state: "RESOLVED",
      entryBlockId: entry,
      exitBlockId: exit,
      blocks: blocks.sort((left, right) => left.id.localeCompare(right.id)),
      edges: this.edges.sort((left, right) => left.id.localeCompare(right.id)),
      dominators,
      loops,
      unreachableBlockIds,
      deadCodeNodeIds: blocks
        .filter((block) => unreachableBlockIds.includes(block.id))
        .flatMap((block) => block.statements.map((statement) => statement.id))
        .sort(),
    });
  }
}
function collectFunctions(root: ASTNode): readonly { readonly name: string; readonly node: ASTNode }[] {
  const functions: { name: string; node: ASTNode }[] = [];
  let unlocatedSequence = 0;
  const visit = (node: ASTNode): void => {
    if (isFunction(node)) {
      const name = functionName(node);
      const position = node.location === undefined
        ? `anon-${unlocatedSequence++}`
        : `${node.location.start.line}:${node.location.start.column}`;
      functions.push({ name: `${name}@${position}`, node });
    }
    for (const child of node.children) visit(child);
  };
  for (const child of root.children) visit(child);
  return functions.sort((left, right) => left.name.localeCompare(right.name));
}
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
function reachableBlocks(entry: string, successorsByBlock: ReadonlyMap<string, readonly string[]>): Set<string> {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    const successors = successorsByBlock.get(current);
    if (successors !== undefined) {
      for (const succ of successors) {
        if (!seen.has(succ)) pending.push(succ);
      }
    }
  }
  return seen;
}
function calculateDominators(entry: string, blocks: readonly BasicBlock[], _edges: readonly ControlFlowEdge[]): readonly { readonly blockId: string; readonly immediateDominatorId?: string }[] {
  const count = blocks.length;
  if (count === 0) return [];
  const firstBlock = blocks[0];
  if (count === 1 && firstBlock !== undefined) return [{ blockId: firstBlock.id }];

  const blockIndexById = new Map<string, number>();
  const blockIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const b = blocks[i];
    if (b !== undefined) {
      blockIndexById.set(b.id, i);
      blockIds.push(b.id);
    }
  }

  const entryIndex = blockIndexById.get(entry);
  const predecessorIndices: number[][] = [];
  for (let i = 0; i < count; i++) {
    const b = blocks[i];
    const indices: number[] = [];
    if (b !== undefined) {
      for (const predId of b.predecessorIds) {
        const idx = blockIndexById.get(predId);
        if (idx !== undefined) indices.push(idx);
      }
    }
    predecessorIndices.push(indices);
  }

  const wordsPerBlock = Math.ceil(count / 32);
  const dom: Uint32Array[] = [];
  for (let i = 0; i < count; i++) {
    const bitset = new Uint32Array(wordsPerBlock);
    if (entryIndex !== undefined && i === entryIndex) {
      bitset[entryIndex >>> 5] = 1 << (entryIndex & 31);
    } else {
      bitset.fill(0xffffffff);
    }
    dom.push(bitset);
  }

  const temp = new Uint32Array(wordsPerBlock);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < count; i++) {
      if (entryIndex !== undefined && i === entryIndex) continue;
      const preds = predecessorIndices[i] ?? [];

      if (preds.length === 0) {
        temp.fill(0);
      } else {
        const firstIdx = preds[0];
        const first = firstIdx !== undefined ? dom[firstIdx] : undefined;
        if (first !== undefined) {
          for (let w = 0; w < wordsPerBlock; w++) {
            temp[w] = first[w] ?? 0;
          }
          for (let p = 1; p < preds.length; p++) {
            const nextIdx = preds[p];
            const next = nextIdx !== undefined ? dom[nextIdx] : undefined;
            if (next !== undefined) {
              for (let w = 0; w < wordsPerBlock; w++) {
                const tw = temp[w] ?? 0;
                temp[w] = tw & (next[w] ?? 0);
              }
            }
          }
        }
      }

      temp[i >>> 5] = (temp[i >>> 5] ?? 0) | (1 << (i & 31));

      const current = dom[i];
      if (current !== undefined) {
        for (let w = 0; w < wordsPerBlock; w++) {
          const cw = current[w] ?? 0;
          const tw = temp[w] ?? 0;
          if (cw !== tw) {
            current[w] = tw;
            changed = true;
          }
        }
      }
    }
  }

  const result: { blockId: string; immediateDominatorId?: string }[] = [];
  for (let i = 0; i < count; i++) {
    const blockId = blockIds[i];
    if (blockId === undefined) continue;
    if (entryIndex !== undefined && i === entryIndex) {
      result.push({ blockId });
      continue;
    }

    const current = dom[i];
    if (current === undefined) {
      result.push({ blockId });
      continue;
    }

    const candidates: number[] = [];
    for (let c = 0; c < count; c++) {
      if (c !== i && ((current[c >>> 5] ?? 0) & (1 << (c & 31))) !== 0) {
        candidates.push(c);
      }
    }

    const immediate = candidates.find((candidate) => {
      const candidateDom = dom[candidate];
      if (candidateDom === undefined) return false;
      return candidates.every(
        (other) => other === candidate || ((candidateDom[other >>> 5] ?? 0) & (1 << (other & 31))) !== 0,
      );
    });

    const immediateId = immediate !== undefined ? blockIds[immediate] : undefined;
    result.push({
      blockId,
      ...(immediateId === undefined ? {} : { immediateDominatorId: immediateId }),
    });
  }

  return result.sort((left, right) => left.blockId.localeCompare(right.blockId));
}
function computeNaturalLoopBlocks(
  headerId: string,
  tailId: string,
  predecessorsByBlock: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const loopBlocks = new Set<string>([headerId]);
  if (headerId === tailId) {
    return [headerId];
  }

  loopBlocks.add(tailId);
  const worklist: string[] = [tailId];

  while (worklist.length > 0) {
    const current = worklist.pop()!;
    const preds = predecessorsByBlock.get(current);
    if (preds !== undefined) {
      for (const pred of preds) {
        if (!loopBlocks.has(pred)) {
          loopBlocks.add(pred);
          worklist.push(pred);
        }
      }
    }
  }

  return Array.from(loopBlocks).sort();
}

function isDominator(
  idomMap: ReadonlyMap<string, string | undefined>,
  ancestorId: string,
  blockId: string,
): boolean {
  if (ancestorId === blockId) return true;
  let curr: string | undefined = idomMap.get(blockId);
  const visited = new Set<string>();
  while (curr !== undefined && !visited.has(curr)) {
    if (curr === ancestorId) return true;
    visited.add(curr);
    curr = idomMap.get(curr);
  }
  return false;
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
