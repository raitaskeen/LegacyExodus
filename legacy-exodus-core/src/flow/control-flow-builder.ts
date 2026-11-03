import { createHash } from "node:crypto";
import type { ASTNode, ASTResult } from "@parser/index";
import { createControlFlowGraph, type BasicBlock, type ControlFlowEdge, type ControlFlowEdgeKind, type ControlFlowGraph, type ControlFlowNode } from "./flow-contracts";
import { ControlFlowInvariantError } from "./flow-errors";
import { compareCodePoints } from "@shared/ordering";
import { stableId } from "@shared/identity";
import { FactKeyer, type CodeSymbol } from "@symbols/index";

export interface ControlFlowGraphsWithNodes {
  readonly graphs: readonly ControlFlowGraph[];
  readonly statementNodes: ReadonlyMap<string, ASTNode>;
  readonly blockClauses: ReadonlyMap<string, readonly ASTNode[]>;
  /** The Program or function node each graph id analyses. */
  readonly graphRoots: ReadonlyMap<string, ASTNode>;
}
interface MutableBlock { readonly id: string; readonly key?: string; readonly statements: ControlFlowNode[]; terminator?: string; }
/** One file's fact keys (ADR-008): shared by all of its graphs, so ordinals count across the file's owners. */
interface FileKeys { readonly keyer: FactKeyer; readonly statements: WeakMap<ASTNode, string>; readonly tests: WeakMap<ASTNode, string>; readonly values: WeakMap<ASTNode, string> }
interface LabelTarget { readonly breakTarget: string; readonly continueTarget?: string; readonly breakFinalizerTarget?: string; readonly continueFinalizerTarget?: string; }
interface PendingLabelFinalizer { readonly label: string; readonly target: LabelTarget; readonly breakFinalizer?: string; readonly continueFinalizer?: string; }
interface ControlContext {
  readonly breakTarget?: string;
  readonly continueTarget?: string;
  readonly breakFinalizerTarget?: string;
  readonly continueFinalizerTarget?: string;
  readonly exceptionTarget?: string;
  readonly potentialExceptionTarget?: string;
  readonly returnTarget?: string;
  readonly labels?: ReadonlyMap<string, LabelTarget>;
}

export class DeterministicControlFlowGraphBuilder {
  public build(ast: ASTResult): ControlFlowGraph {
    return this.buildScope(ast.metadata.sourcePath, "module", ast.root.children);
  }

  public buildAll(ast: ASTResult): readonly ControlFlowGraph[] {
    return this.buildAllWithNodes(ast).graphs;
  }

  /**
   * `buildAll` plus, for data flow (Wave 3), the AST node behind each statement id and the clauses a
   * block evaluates without a statement of its own (a do-while test). Neither map is persisted.
   */
  /** @param owners - the file's function, method and class symbols; given, every graph, block and node is keyed. */
  public buildAllWithNodes(ast: ASTResult, owners?: readonly CodeSymbol[]): ControlFlowGraphsWithNodes {
    const keys: FileKeys | undefined = owners === undefined ? undefined : { keyer: new FactKeyer(ast.metadata.sourcePath, ast.root, owners), statements: new WeakMap(), tests: new WeakMap(), values: new WeakMap() };
    const statementNodes = new Map<string, ASTNode>();
    const blockClauses = new Map<string, readonly ASTNode[]>();
    const graphRoots = new Map<string, ASTNode>();
    const functions = collectFunctions(ast.root);
    const rooted = (graph: ControlFlowGraph, root: ASTNode): ControlFlowGraph => { graphRoots.set(graph.id, root); return graph; };
    const graphs = [
      rooted(this.buildScope(ast.metadata.sourcePath, "module", ast.root.children, statementNodes, blockClauses, keys, undefined), ast.root),
      ...functions.map((candidate) => rooted(this.buildScope(ast.metadata.sourcePath, candidate.name, graphStatements(candidate.node), statementNodes, blockClauses, keys, candidate.node), candidate.node)),
    ].sort((left, right) => compareCodePoints(left.id, right.id));
    return { graphs: Object.freeze(graphs), statementNodes, blockClauses, graphRoots };
  }

  private buildScope(filePath: string, scopeName: string, nodes: readonly ASTNode[], statementNodes?: Map<string, ASTNode>, blockClauses?: Map<string, readonly ASTNode[]>, keys?: FileKeys, root?: ASTNode): ControlFlowGraph {
    // Parameters are evaluated on entry: their defaults run only for an undefined argument.
    const parameters = root?.children.filter((child) => child.role === "params" || child.role === "param") ?? [];
    // An unlocated root has no owner range to key it by; its scope name (with its anon ordinal) tells it apart.
    const graphKey = keys === undefined ? undefined : root === undefined ? `${filePath}#` : root.location === undefined ? `${filePath}#${scopeName}/`
      // A field initializer is no owner of its own: it is keyed under its class by the field's name.
      : isFieldInitializer(root) ? `${keys.keyer.ownerKey(root.location.start)}field:${functionName(root)}/` : keys.keyer.ownerKey(root.location.start);
    const state = new FlowState(filePath, scopeName, collectExpressionControl([...parameters, ...nodes]), keys, graphKey);
    const entry = state.createBlock();
    const exit = state.createBlock();
    state.buildStatements(nodes, state.lowerAll(entry, parameters), exit, { exceptionTarget: exit, returnTarget: exit });
    const graph = state.finish(entry, exit);
    for (const [id, node] of state.statementNodes) statementNodes?.set(id, node);
    for (const [id, clauses] of state.blockClauses) blockClauses?.set(id, clauses);
    return graph;
  }
}

class FlowState {
  private readonly blocks: MutableBlock[] = [];
  private readonly blocksById = new Map<string, MutableBlock>();
  private readonly edges: ControlFlowEdge[] = [];
  private sequence = 0;
  private unlocatedStatementSequence = 0;
  private readonly statementIds = new Set<string>();
  public readonly statementNodes = new Map<string, ASTNode>();
  public readonly blockClauses = new Map<string, ASTNode[]>();
  // Identifies the finally copy being built ("" for the original text), so each copied statement gets a unique id.
  private copyContext = "";
  public constructor(
    private readonly filePath: string,
    private readonly scopeName: string,
    private readonly expressionControl: ReadonlySet<ASTNode>,
    private readonly keys?: FileKeys,
    private readonly graphKey?: string,
  ) {}
  /** Expression control nodes split into decision blocks; any other one leaves the graph UNSUPPORTED. */
  private readonly loweredControl = new Set<ASTNode>();
  public createBlock(): string { const sequence = this.sequence++; const key = this.graphKey === undefined ? undefined : `${this.graphKey}/block@${sequence}`; const id = key === undefined ? hash(`${this.filePath}:${this.scopeName}:block:${sequence}`) : stableId("cfg-block", key); const block = { id, ...(key === undefined ? {} : { key }), statements: [] }; this.blocks.push(block); this.blocksById.set(id, block); return id; }
  /**
   * A node's fact key: the first instance of a node gets the next ordinal; a finally copy reuses it with its copy
   * context, so copies never shift the ordinals of other statements.
   */
  private readonly recordedValues = new Map<string, WeakSet<ASTNode>>();
  private keyOf(kind: "statements" | "tests" | "values", node: ASTNode): { readonly key?: string } {
    if (this.keys === undefined) return {};
    const known = this.keys[kind].get(node);
    const base = known ?? this.keys.keyer.key(kind === "statements" ? "stmt" : kind === "tests" ? "test" : "value", node.type, node.location?.start);
    if (known === undefined) this.keys[kind].set(node, base);
    return { key: this.copyContext === "" || known === undefined ? base : `${base}/copy:${this.copyContext}` };
  }
  // Constant-time duplicate and incoming checks: a scan per edge made long functions quadratic.
  private readonly edgeIds = new Map<string, number>();
  private readonly blocksWithIncoming = new Set<string>();
  public addEdge(fromBlockId: string, toBlockId: string, kind: ControlFlowEdgeKind): void {
    const id = this.edgeId(fromBlockId, toBlockId, kind);
    if (this.edgeIds.has(id)) return;
    this.edgeIds.set(id, 1);
    this.blocksWithIncoming.add(toBlockId);
    this.edges.push({ id, fromBlockId, toBlockId, kind });
  }
  public buildStatements(nodes: readonly ASTNode[], current: string, exit: string | undefined, control: ControlContext | undefined): string {
    let block = current;
    let terminated = false;
    // Unroll structural blocks in this frame so completion and control targets stay shared.
    const pending = [...nodes].reverse();
    while (pending.length > 0) {
      const node = pending.pop();
      if (node === undefined) continue;
      if (node.type === "BlockStatement") {
        for (const child of [...node.children].reverse()) pending.push(child);
        continue;
      }
      if (isFunction(node)) continue;
      const own = loweredExpressions(node);
      if (own !== undefined) block = this.lowerAll(block, own, control?.potentialExceptionTarget);
      // Header loops attribute each clause's potential exception to the block that evaluates it.
      if (control?.potentialExceptionTarget !== undefined && !hasLoopHeader(node) && hasPotentiallyThrowingEvaluation(node)) {
        this.addEdge(block, control.potentialExceptionTarget, "exception");
      }
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
      if (isLoop(node)) { block = this.buildLoop(node, block, control, undefined, control?.potentialExceptionTarget); continue; }
      if (node.type === "SwitchStatement") { block = this.buildSwitch(node, block, control); continue; }
      if (node.type === "TryStatement") {
        block = this.buildTry(node, block, exit ?? current, control);
        terminated = !this.hasIncomingEdges(block);
        continue;
      }
      this.addNode(block, node);
      terminated = false;
    }
    if (exit !== undefined && block !== exit && this.block(block).terminator === undefined && !terminated) this.addEdge(block, exit, "next");
    return block;
  }
  private buildIf(node: ASTNode, block: string, control: ControlContext | undefined): string { this.addNode(block, node); const consequent = this.createBlock(); const alternate = this.createBlock(); const join = this.createBlock(); const condition = staticBoolean(node.children.find((child) => child.role === "test")); if (condition !== false) this.addEdge(block, consequent, "true"); if (condition !== true) this.addEdge(block, alternate, "false"); const children = node.children.filter((child) => child.role === "consequent" || child.role === "alternate"); const yes = children.filter((child) => child.role === "consequent").flatMap(statementChildren); const no = children.filter((child) => child.role === "alternate").flatMap(statementChildren); this.buildStatements(yes, consequent, join, control); this.buildStatements(no, alternate, join, control); return join; }
  private buildLabeled(node: ASTNode, block: string, control: ControlContext | undefined): string { this.addNode(block, node); const label = labelName(node); const body = node.children.find((child) => child.role === "body"); if (body === undefined || label === undefined) return block; const potentialExceptionTarget = control?.potentialExceptionTarget; if (body.type === "DoWhileStatement") { if (potentialExceptionTarget !== undefined && hasPotentiallyThrowingEvaluation(body)) this.addEdge(block, potentialExceptionTarget, "exception"); return this.buildDoWhile(body, block, control, label); } if (isLoop(body)) return this.buildLoop(body, block, control, label, potentialExceptionTarget); const after = this.createBlock(); const labels = withLabel(control?.labels, label, { breakTarget: after }); this.buildStatements(statementChildren(body), block, after, { ...control, labels }); return after; }
  private buildDoWhile(node: ASTNode, block: string, control: ControlContext | undefined, label?: string): string { const body = this.createBlock(); const conditionBlock = this.createBlock(); const after = this.createBlock(); const condition = staticBoolean(node.children.find((child) => child.role === "test")); this.addNode(block, node); this.addEdge(block, body, "next"); const labels = label === undefined ? control?.labels : withLabel(control?.labels, label, { breakTarget: after, continueTarget: conditionBlock }); const content = node.children.filter((child) => child.role === "body").flatMap(statementChildren); const last = this.buildStatements(content, body, undefined, { ...control, breakTarget: after, continueTarget: conditionBlock, labels }); if (this.block(last).terminator === undefined) this.addEdge(last, conditionBlock, "next"); const test = node.children.find((child) => child.role === "test"); const tested = test === undefined ? conditionBlock : this.lower(conditionBlock, test); if (test !== undefined) this.blockClauses.set(tested, [test]); if (condition !== false) this.addEdge(tested, body, "true"); if (condition !== true) this.addEdge(tested, after, "false"); return after; }
  private buildLoop(node: ASTNode, block: string, control: ControlContext | undefined, label?: string, potentialExceptionTarget?: string): string {
    // The header holds only the loop test. Clauses evaluated once (for init, for-in/of object) stay
    // in the pre-loop block; a for update gets its own block, which is also the continue target.
    const once = node.children.find((child) => child.role === (node.type === "ForStatement" ? "init" : "right"));
    const updateNode = node.type === "ForStatement" ? node.children.find((child) => child.role === "update") : undefined;
    const preLoop = once === undefined ? block : this.addClause(block, once, potentialExceptionTarget);
    const header = this.createBlock();
    this.addEdge(preLoop, header, "next");
    // The test is lowered from the header (the loop-back target); the loop node completes it.
    const evaluated = node.children.filter((child) => child.role === "test" || child.role === "left");
    const test = this.lowerAll(header, evaluated, potentialExceptionTarget);
    this.addNode(test, node);
    if (potentialExceptionTarget !== undefined && evaluated.some(hasPotentiallyThrowingEvaluation)) {
      this.addEdge(test, potentialExceptionTarget, "exception");
    }
    const body = this.createBlock();
    const after = this.createBlock();
    const update = updateNode === undefined ? undefined : this.createBlock();
    const testNode = node.children.find((child) => child.role === "test");
    const condition = node.type === "ForStatement" && testNode === undefined ? true : staticBoolean(testNode);
    if (condition !== false) this.addEdge(test, body, "true");
    if (condition !== true) this.addEdge(test, after, "false");
    const continueTarget = update ?? header;
    const labels = label === undefined ? control?.labels : withLabel(control?.labels, label, { breakTarget: after, continueTarget });
    const content = node.children.filter((child) => child.role === "body").flatMap(statementChildren);
    const last = this.buildStatements(content, body, undefined, { ...control, breakTarget: after, continueTarget, labels });
    if (update !== undefined && updateNode !== undefined) {
      if (this.block(last).terminator === undefined) this.addEdge(last, update, "next");
      const updated = this.addClause(update, updateNode, potentialExceptionTarget);
      if (condition !== false) this.addEdge(updated, header, "loop-back");
    } else if (this.block(last).terminator === undefined && condition !== false) {
      this.addEdge(last, header, "loop-back");
    }
    return after;
  }
  /** Lowers a clause evaluated in `blockId`, records it in the block it completes in, and returns that block. */
  private addClause(blockId: string, clause: ASTNode, potentialExceptionTarget: string | undefined): string {
    const completed = this.lowerAll(blockId, [clause], potentialExceptionTarget);
    this.addNode(completed, clause);
    if (potentialExceptionTarget !== undefined && hasPotentiallyThrowingEvaluation(clause)) this.addEdge(completed, potentialExceptionTarget, "exception");
    return completed;
  }
  /**
   * Lowers each expression in evaluation order and returns the block in which they have all completed. With an
   * exception target, a decision or arm whose own expression may throw also gets an exception edge, so a throw is
   * shown where it can happen; the completing block keeps its edge for the statement as a whole.
   */
  public lowerAll(blockId: string, expressions: readonly ASTNode[], exceptionTarget?: string): string {
    const outer = this.loweringExceptionTarget;
    this.loweringExceptionTarget = exceptionTarget;
    try {
      let block = blockId;
      for (const expression of expressions) block = this.lower(block, expression);
      return block;
    } finally {
      this.loweringExceptionTarget = outer;
    }
  }
  private loweringExceptionTarget: string | undefined;
  private mayThrowFrom(blockId: string, node: ASTNode | undefined): void {
    if (this.loweringExceptionTarget !== undefined && node !== undefined && hasPotentiallyThrowingEvaluation(node)) this.addEdge(blockId, this.loweringExceptionTarget, "exception");
  }
  /**
   * Splits the branches inside one expression into blocks: `a && b`, `a || b`, `a ?? b`, `c ? x : y`,
   * `x &&= y` (and `||=`, `??=`) and optional chains. A decision block ends with the deciding expression;
   * `true` leads where evaluation continues when the left side is truthy (non-nullish for `??` and `?.`),
   * `false` where it is falsy (nullish). Each arm ends with the operand it evaluates; all arms join. Function
   * and class bodies are not evaluated here. Data flow still evaluates the whole statement once, in the block
   * where it completes, so its facts are unchanged; only the shape of control is refined.
   */
  private lower(blockId: string, node: ASTNode): string {
    if (isFunction(node) || node.type === "ClassExpression" || node.type === "ClassDeclaration") return blockId;
    if (node.type === "LogicalExpression" || isLogicalAssignment(node)) {
      const left = node.children.find((child) => child.role === "left");
      const right = node.children.find((child) => child.role === "right");
      const decision = left === undefined ? blockId : this.lower(blockId, left);
      this.mayThrowFrom(decision, left);
      return this.branch(decision, node, String(node.attributes.operator).startsWith("&&") ? "true" : "false", right === undefined ? [] : [right]);
    }
    // `x = d` in a pattern or a parameter: the default is evaluated only when the value is undefined (`true`).
    if (node.type === "AssignmentPattern") {
      const target = node.children.find((child) => child.role === "left");
      const fallback = node.children.find((child) => child.role === "right");
      const joined = this.branch(blockId, node, "true", fallback === undefined ? [] : [fallback]);
      return target === undefined ? joined : this.lower(joined, target);
    }
    // The value is evaluated before the pattern it is destructured into (and its defaults).
    if (node.type === "VariableDeclarator" || (node.type === "AssignmentExpression" && isPattern(node.children.find((child) => child.role === "left")))) {
      const value = node.children.find((child) => child.role === "init" || child.role === "right");
      const target = node.children.find((child) => child.role === "id" || child.role === "left");
      return this.lowerAll(this.lowerAll(blockId, value === undefined ? [] : [value], this.loweringExceptionTarget), target === undefined ? [] : [target], this.loweringExceptionTarget);
    }
    if (node.type === "ConditionalExpression") {
      const test = node.children.find((child) => child.role === "test");
      const decision = test === undefined ? blockId : this.lower(blockId, test);
      this.mayThrowFrom(decision, test);
      this.addDecision(decision, node, "test");
      this.loweredControl.add(node);
      const join = this.createBlock();
      for (const [role, kind] of [["consequent", "true"], ["alternate", "false"]] as const) {
        const arm = this.createBlock();
        this.addEdge(decision, arm, kind);
        const operand = node.children.find((child) => child.role === role);
        const end = operand === undefined ? arm : this.lower(arm, operand);
        this.mayThrowFrom(end, operand);
        if (operand !== undefined) this.addDecision(end, operand, "value");
        this.addEdge(end, join, "next");
      }
      return join;
    }
    if (isOptionalChain(node)) return this.lowerChain(blockId, node);
    let block = blockId;
    for (const child of node.children) block = this.lower(block, child);
    return block;
  }
  /** One short-circuit: from `decision`, the `continueOn` edge evaluates `operands`; the other edge skips them. */
  private branch(decision: string, node: ASTNode, continueOn: "true" | "false", operands: readonly ASTNode[]): string {
    this.addDecision(decision, node, "test");
    this.loweredControl.add(node);
    const arm = this.createBlock();
    const join = this.createBlock();
    this.addEdge(decision, arm, continueOn);
    this.addEdge(decision, join, continueOn === "true" ? "false" : "true");
    const end = this.lowerAll(arm, operands, this.loweringExceptionTarget);
    for (const operand of operands) this.mayThrowFrom(end, operand);
    for (const operand of operands) this.addDecision(end, operand, "value");
    this.addEdge(end, join, "next");
    return join;
  }
  /** `a?.b.c(d)`: each optional link tests the value so far; a nullish one skips the rest of the chain. */
  private lowerChain(blockId: string, root: ASTNode): string {
    const spine: ASTNode[] = [];
    let current: ASTNode | undefined = root;
    while (current !== undefined) {
      if (isOptionalChain(current)) {
        spine.push(current);
        current = current.children.find((child) => child.role === "object" || child.role === "callee");
        continue;
      }
      // `a?.b!.c`: the assertion keeps the chain going, so a nullish `a` still skips `.c`.
      const asserted = current.type === "TSNonNullExpression" ? current.children.find((child) => child.role === "expression") : undefined;
      if (asserted === undefined || !isOptionalChain(asserted)) break;
      current = asserted;
    }
    let block = current === undefined ? blockId : this.lower(blockId, current);
    this.mayThrowFrom(block, current);
    const end = this.createBlock();
    for (const link of spine.reverse()) {
      if (link.attributes.optional === true) {
        this.addDecision(block, link, "test");
        const next = this.createBlock();
        this.addEdge(block, next, "true");
        this.addEdge(block, end, "false");
        block = next;
      }
      this.loweredControl.add(link);
      for (const child of link.children) {
        if (child.role === "object" || child.role === "callee") continue;
        block = this.lower(block, child);
      }
    }
    this.addDecision(block, root, "value");
    this.addEdge(block, end, "next");
    return end;
  }
  /**
   * Records an expression in a block's shape without making it a statement (data flow does not evaluate it):
   * as the `test` a decision block ends with, or as the `value` an arm completes. A value already recorded for
   * this node in this copy is the same completion point and is not recorded again.
   */
  private addDecision(blockId: string, node: ASTNode, role: "test" | "value"): void {
    if (role === "value") {
      const recorded = this.recordedValues.get(this.copyContext) ?? new WeakSet<ASTNode>();
      if (recorded.has(node)) return;
      recorded.add(node);
      this.recordedValues.set(this.copyContext, recorded);
    }
    const position = node.location === undefined ? `anon-${this.unlocatedStatementSequence++}` : `${node.location.start.line}:${node.location.start.column}`;
    const keyed = this.keyOf(role === "test" ? "tests" : "values", node);
    const id = this.nodeId(`${this.filePath}:expression:${node.type}:${position}`, keyed.key);
    this.block(blockId).statements.push({ id, ...keyed, type: node.type, ...(node.location === undefined ? {} : { location: node.location.start }) });
  }
  private buildSwitch(node: ASTNode, entry: string, control: ControlContext | undefined): string {
    const discriminant = node.children.find((child) => child.role === "discriminant");
    const block = discriminant === undefined ? entry : this.lower(entry, discriminant);
    this.addNode(block, node);
    const after = this.createBlock();
    const cases = node.children.filter((child) => child.role === "cases");
    if (cases.length === 0) { this.addEdge(block, after, "next"); return after; }
    const blocks = cases.map(() => this.createBlock());
    const tests = cases.map((branch) => branch.children.find((child) => child.role === "test"));
    const defaultIndex = tests.findIndex((test) => test === undefined);
    if (tests.some((test) => test !== undefined && collectExpressionControl([test]).size > 0)) {
      // Case tests run in source order until one matches, then the default: a test that branches is
      // lowered where it runs, and each test decides between its case (`case`) and the next test (`false`).
      let probe = block;
      for (const [index, test] of tests.entries()) {
        if (test === undefined) continue;
        const tested = this.lowerAll(probe, [test], control?.potentialExceptionTarget);
        this.addDecision(tested, cases[index]!, "test");
        this.addEdge(tested, blocks[index]!, "case");
        probe = this.createBlock();
        this.addEdge(tested, probe, "false");
      }
      this.addEdge(probe, defaultIndex >= 0 ? blocks[defaultIndex]! : after, defaultIndex >= 0 ? "case" : "next");
    } else {
      for (const caseBlock of blocks) this.addEdge(block, caseBlock, "case");
      if (defaultIndex < 0) this.addEdge(block, after, "next");
    }
    for (const [index, branch] of cases.entries()) {
      const last = this.buildStatements(switchCaseStatements(branch), blocks[index]!, undefined, { ...control, breakTarget: after, continueTarget: control?.continueTarget });
      if (this.block(last).terminator === undefined) this.addEdge(last, blocks[index + 1] ?? after, "next");
    }
    return after;
  }
  private buildTry(node: ASTNode, block: string, exit: string, control: ControlContext | undefined): string {
    this.addNode(block, node);
    const after = this.createBlock();
    const body = node.children.find((child) => child.role === "block");
    const handler = node.children.find((child) => child.role === "handler");
    const finalizer = node.children.find((child) => child.role === "finalizer");
    const outerExceptionTarget = control?.exceptionTarget ?? exit;
    const outerPotentialExceptionTarget = control?.potentialExceptionTarget;
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
      potentialExceptionTarget: catchBlock ?? (
        finalizer === undefined
          ? outerPotentialExceptionTarget
          : outerPotentialExceptionTarget === undefined ? undefined : thrownFinalizer
      ),
      returnTarget: returnedFinalizer ?? outerReturnTarget,
      ...(protectedLabels === undefined ? {} : { labels: protectedLabels }),
      ...(brokenFinalizer === undefined ? {} : { breakFinalizerTarget: brokenFinalizer }),
      ...(continuedFinalizer === undefined ? {} : { continueFinalizerTarget: continuedFinalizer }),
    };
    this.addEdge(block, tryBlock, "next");
    const tryLast = this.buildStatements(body === undefined ? [] : statementChildren(body), tryBlock, normalFinalizer, protectedControl);
    if (finalizer !== undefined) {
      this.retagCompletionEdge(tryLast, normalFinalizer, "next", "finally");
      if (catchBlock === undefined) {
        this.retagIncomingEdges(thrownFinalizer, "throw", "finally");
        this.retagIncomingEdges(thrownFinalizer, "exception", "finally");
      }
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
        potentialExceptionTarget: finalizer === undefined
          ? outerPotentialExceptionTarget
          : outerPotentialExceptionTarget === undefined ? undefined : thrownFinalizer,
      });
      if (finalizer !== undefined) {
        this.retagCompletionEdge(catchLast, normalFinalizer, "next", "finally");
        this.retagIncomingEdges(thrownFinalizer as string, "throw", "finally");
        this.retagIncomingEdges(thrownFinalizer as string, "exception", "finally");
        this.retagIncomingEdges(returnedFinalizer as string, "return", "finally");
        this.retagIncomingEdges(brokenFinalizer, "break", "finally");
        this.retagIncomingEdges(continuedFinalizer, "continue", "finally");
        for (const pending of labeledFinalizers) {
          this.retagIncomingEdges(pending.breakFinalizer, "break", "finally");
          this.retagIncomingEdges(pending.continueFinalizer, "continue", "finally");
        }
      }
    }
    if (finalizer !== undefined) {
      const finalizerStatements = statementChildren(finalizer);
      const finalizerControl: ControlContext = { ...control, exceptionTarget: outerExceptionTarget, returnTarget: outerReturnTarget };

      if (this.hasIncomingEdges(normalFinalizer)) {
        this.addNode(normalFinalizer, finalizer);
        this.buildStatements(finalizerStatements, normalFinalizer, after, finalizerControl);
      } else {
        this.removeBlock(normalFinalizer);
      }

      if (thrownFinalizer !== undefined) {
        if (this.hasIncomingEdges(thrownFinalizer)) {
          const thrownLast = this.inFinalizerCopy("throw", () => {
            this.addNode(thrownFinalizer, finalizer);
            return this.buildStatements(finalizerStatements, thrownFinalizer, outerExceptionTarget, finalizerControl);
          });
          this.retagCompletionEdge(thrownLast, outerExceptionTarget, "next", "throw");
        } else {
          this.removeBlock(thrownFinalizer);
        }
      }

      if (returnedFinalizer !== undefined) {
        if (this.hasIncomingEdges(returnedFinalizer)) {
          const returnedLast = this.inFinalizerCopy("return", () => {
            this.addNode(returnedFinalizer, finalizer);
            return this.buildStatements(finalizerStatements, returnedFinalizer, outerReturnTarget, finalizerControl);
          });
          this.retagCompletionEdge(returnedLast, outerReturnTarget, "next", "return");
        } else {
          this.removeBlock(returnedFinalizer);
        }
      }

      if (brokenFinalizer !== undefined && outerBreakTarget !== undefined) {
        if (this.hasIncomingEdges(brokenFinalizer)) {
          const breakDestination = control?.breakFinalizerTarget ?? outerBreakTarget;
          const brokenLast = this.inFinalizerCopy("break", () => {
            this.addNode(brokenFinalizer, finalizer);
            return this.buildStatements(finalizerStatements, brokenFinalizer, breakDestination, finalizerControl);
          });
          this.retagCompletionEdge(brokenLast, breakDestination, "next", "break");
        } else {
          this.removeBlock(brokenFinalizer);
        }
      }

      if (continuedFinalizer !== undefined && outerContinueTarget !== undefined) {
        if (this.hasIncomingEdges(continuedFinalizer)) {
          const continueDestination = control?.continueFinalizerTarget ?? outerContinueTarget;
          const continuedLast = this.inFinalizerCopy("continue", () => {
            this.addNode(continuedFinalizer, finalizer);
            return this.buildStatements(finalizerStatements, continuedFinalizer, continueDestination, finalizerControl);
          });
          this.retagCompletionEdge(continuedLast, continueDestination, "next", "continue");
        } else {
          this.removeBlock(continuedFinalizer);
        }
      }

      for (const pending of labeledFinalizers) {
        if (this.hasIncomingEdges(pending.breakFinalizer)) {
          const breakDestination = pending.target.breakFinalizerTarget ?? pending.target.breakTarget;
          const brokenLast = this.inFinalizerCopy(`break:${pending.label}`, () => {
            this.addNode(pending.breakFinalizer as string, finalizer);
            return this.buildStatements(finalizerStatements, pending.breakFinalizer as string, breakDestination, finalizerControl);
          });
          this.retagCompletionEdge(brokenLast, breakDestination, "next", "break");
        } else {
          this.removeBlock(pending.breakFinalizer);
        }

        if (pending.continueFinalizer !== undefined && pending.target.continueTarget !== undefined) {
          if (this.hasIncomingEdges(pending.continueFinalizer)) {
            const continueDestination = pending.target.continueFinalizerTarget ?? pending.target.continueTarget;
            const continuedLast = this.inFinalizerCopy(`continue:${pending.label}`, () => {
              this.addNode(pending.continueFinalizer as string, finalizer);
              return this.buildStatements(finalizerStatements, pending.continueFinalizer as string, continueDestination, finalizerControl);
            });
            this.retagCompletionEdge(continuedLast, continueDestination, "next", "continue");
          } else {
            this.removeBlock(pending.continueFinalizer);
          }
        }
      }
    }
    return after;
  }
  private removeBlock(id: string | undefined): void {
    if (id === undefined) return;
    const index = this.blocks.findIndex((candidate) => candidate.id === id);
    if (index >= 0) {
      this.blocks.splice(index, 1);
      this.blocksById.delete(id);
    }
  }
  private hasIncomingEdges(toBlockId: string | undefined): boolean {
    return toBlockId !== undefined && this.blocksWithIncoming.has(toBlockId);
  }
  private addNode(blockId: string, node: ASTNode): void {
    const position = node.location === undefined
      ? `anon-${this.unlocatedStatementSequence++}`
      : `${node.location.start.line}:${node.location.start.column}`;
    const origin = `${this.filePath}:${node.type}:${position}`;
    // The first occurrence keeps its source-position id; a later one (a finally copy) derives its id from the copy
    // context, probing until unused (a copy holding an original and an original holding a copy can share a context).
    const keyed = this.keyOf("statements", node);
    const id = this.nodeId(origin, keyed.key);
    this.statementNodes.set(id, node);
    this.block(blockId).statements.push({
      id,
      ...keyed,
      type: node.type,
      ...(node.location === undefined ? {} : { location: node.location.start }),
    });
  }
  // A finally block is emitted once per completion kind (throw, return, break, continue, labelled jumps); nested copies compose.
  private inFinalizerCopy<T>(copy: string, build: () => T): T {
    const outer = this.copyContext;
    this.copyContext = outer === "" ? copy : `${outer}/${copy}`;
    try { return build(); } finally { this.copyContext = outer; }
  }
  private block(id: string): MutableBlock { const block = this.blocksById.get(id); if (block === undefined) throw new ControlFlowInvariantError(id); return block; }
  private retagCompletionEdge(fromBlockId: string, toBlockId: string, sourceKind: ControlFlowEdgeKind, targetKind: ControlFlowEdgeKind): void { const edge = this.edges.find((candidate) => candidate.fromBlockId === fromBlockId && candidate.toBlockId === toBlockId && candidate.kind === sourceKind); if (edge === undefined) return; const index = this.edges.indexOf(edge); this.retag(index, { ...edge, id: this.edgeId(fromBlockId, toBlockId, targetKind), kind: targetKind }); }
  private retagIncomingEdges(toBlockId: string | undefined, sourceKind: ControlFlowEdgeKind, targetKind: ControlFlowEdgeKind): void { if (toBlockId === undefined) return; for (const [index, edge] of this.edges.entries()) { if (edge.toBlockId === toBlockId && edge.kind === sourceKind) this.retag(index, { ...edge, id: this.edgeId(edge.fromBlockId, toBlockId, targetKind), kind: targetKind }); } }
  private edgeId(fromBlockId: string, toBlockId: string, kind: ControlFlowEdgeKind): string {
    return this.graphKey === undefined ? hash(`${fromBlockId}:${toBlockId}:${kind}`) : stableId("cfg-edge", `${fromBlockId}>${toBlockId}:${kind}`);
  }
  /** A node's id: the digest of its key when keys are known, else its source position (probed for finally copies). */
  private nodeId(origin: string, key: string | undefined): string {
    let id = key === undefined ? hash(origin) : stableId("cfg-node", key);
    for (let attempt = 0; this.statementIds.has(id); attempt++) id = key === undefined ? hash(`${origin}@${this.copyContext}#${attempt}`) : stableId("cfg-node", `${key}#${attempt}`);
    this.statementIds.add(id);
    return id;
  }
  private retag(index: number, edge: ControlFlowEdge): void {
    const old = this.edges[index]!.id;
    const remaining = (this.edgeIds.get(old) ?? 1) - 1;
    if (remaining > 0) this.edgeIds.set(old, remaining); else this.edgeIds.delete(old);
    this.edgeIds.set(edge.id, (this.edgeIds.get(edge.id) ?? 0) + 1);
    this.edges[index] = edge;
  }
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

    const emptyUnreachable = new Set<string>();
    for (const block of this.blocks) {
      if (
        block.id !== entry &&
        block.id !== exit &&
        !reachable.has(block.id) &&
        block.statements.length === 0 &&
        (successorsByBlock.get(block.id)?.length ?? 0) === 0
      ) {
        emptyUnreachable.add(block.id);
      }
    }

    const activeBlocks = emptyUnreachable.size === 0
      ? this.blocks
      : this.blocks.filter((b) => !emptyUnreachable.has(b.id));

    const activeEdges = emptyUnreachable.size === 0
      ? this.edges
      : this.edges.filter((e) => !emptyUnreachable.has(e.fromBlockId) && !emptyUnreachable.has(e.toBlockId));

    if (emptyUnreachable.size > 0) {
      for (const removedId of emptyUnreachable) {
        predecessorsByBlock.delete(removedId);
        successorsByBlock.delete(removedId);
      }
      for (const [id, preds] of predecessorsByBlock.entries()) {
        predecessorsByBlock.set(id, preds.filter((p) => !emptyUnreachable.has(p)));
      }
      for (const [id, succs] of successorsByBlock.entries()) {
        successorsByBlock.set(id, succs.filter((s) => !emptyUnreachable.has(s)));
      }
    }

    const blocks: BasicBlock[] = activeBlocks.map((block) => ({
      id: block.id,
      ...(block.key === undefined ? {} : { key: block.key }),
      statements: block.statements,
      predecessorIds: (predecessorsByBlock.get(block.id) ?? []).sort(),
      successorIds: (successorsByBlock.get(block.id) ?? []).sort(),
      ...(block.terminator === undefined ? {} : { terminator: block.terminator }),
    }));
    const dominators = calculateDominators(entry, blocks, activeEdges, reachable);
    const idomMap = new Map<string, string | undefined>();
    for (const d of dominators) {
      idomMap.set(d.blockId, d.immediateDominatorId);
    }
    const loopHeaders = new Map<string, Set<string>>();
    const dominates = dominatorTreeIndex(idomMap);
    for (const edge of activeEdges) {
      // A back edge out of unreachable code (the dead tail after break/return/continue) closes no natural loop.
      if (!reachable.has(edge.fromBlockId)) continue;
      if (
        edge.kind === "loop-back" ||
        ((edge.kind === "continue" || edge.kind === "true") && dominates(edge.toBlockId, edge.fromBlockId))
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
          ? compareCodePoints(left.blockIds.join(","), right.blockIds.join(","))
          : compareCodePoints(left.headerBlockId, right.headerBlockId),
      );
    const unreachableBlockIds = blocks.filter((block) => !reachable.has(block.id)).map((block) => block.id).sort();
    return createControlFlowGraph({
      id: this.graphKey === undefined ? hash(`cfg:${this.filePath}:${this.scopeName}`) : stableId("cfg", this.graphKey),
      ...(this.graphKey === undefined ? {} : { key: this.graphKey }),
      filePath: this.filePath,
      scopeName: this.scopeName,
      state: [...this.expressionControl].every((node) => this.loweredControl.has(node)) ? "RESOLVED" : "UNSUPPORTED",
      entryBlockId: entry,
      exitBlockId: exit,
      blocks: blocks.sort((left, right) => compareCodePoints(left.id, right.id)),
      edges: activeEdges.sort((left, right) => compareCodePoints(left.id, right.id)),
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
    if (isFunction(node) || isFieldInitializer(node)) {
      const name = isFieldInitializer(node) ? `${functionName(node)}=` : functionName(node);
      const position = node.location === undefined
        ? `anon-${unlocatedSequence++}`
        : `${node.location.start.line}:${node.location.start.column}`;
      functions.push({ name: `${name}@${position}`, node });
    }
    for (const child of node.children) visit(child);
  };
  for (const child of root.children) visit(child);
  return functions.sort((left, right) => compareCodePoints(left.name, right.name));
}
function functionName(node: ASTNode): string {
  if (node.type === "StaticBlock") return "static";
  const key = node.children.find((child) => child.role === "id" || child.role === "key");
  // `#name()`: the key is a PrivateName holding the identifier.
  const name = key?.type === "PrivateName" ? key.children.find((child) => child.role === "id")?.attributes.name : key?.attributes.name;
  return typeof name === "string" ? (key?.type === "PrivateName" ? `#${name}` : name) : node.type === "ClassMethod" ? "method" : "anonymous";
}
function statementChildren(node: ASTNode): readonly ASTNode[] { return node.type === "BlockStatement" || node.type === "Program" ? node.children : [node]; }
function switchCaseStatements(node: ASTNode): readonly ASTNode[] { return node.children.filter((child) => child.role === "consequent"); }
function catchStatements(node: ASTNode): readonly ASTNode[] { const body = node.children.find((child) => child.role === "body"); return body === undefined ? [] : statementChildren(body); }
function labelName(node: ASTNode): string | undefined { const value = node.children.find((child) => child.role === "label")?.attributes.name; return typeof value === "string" && value.length > 0 ? value : undefined; }
function withLabel(labels: ReadonlyMap<string, LabelTarget> | undefined, label: string, target: LabelTarget): ReadonlyMap<string, LabelTarget> { return new Map([...(labels?.entries() ?? []), [label, target]]); }
function resolveBreakTarget(node: ASTNode, control: ControlContext | undefined): string | undefined { const label = labelName(node); return label === undefined ? control?.breakTarget : control?.labels?.get(label)?.breakTarget; }
function resolveContinueTarget(node: ASTNode, control: ControlContext | undefined): string | undefined { const label = labelName(node); return label === undefined ? control?.continueTarget : control?.labels?.get(label)?.continueTarget; }
function resolveBreakFinalizerTarget(node: ASTNode, control: ControlContext | undefined): string | undefined { const label = labelName(node); return label === undefined ? control?.breakFinalizerTarget : control?.labels?.get(label)?.breakFinalizerTarget; }
function resolveContinueFinalizerTarget(node: ASTNode, control: ControlContext | undefined): string | undefined { const label = labelName(node); return label === undefined ? control?.continueFinalizerTarget : control?.labels?.get(label)?.continueFinalizerTarget; }
/** Code that runs as a unit of its own and gets its own graph: functions, methods (private too) and class static blocks. */
function isFunction(node: ASTNode): boolean { return ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassMethod", "ClassPrivateMethod", "ObjectMethod", "StaticBlock"].includes(node.type); }
const FIELD_TYPES = new Set(["ClassProperty", "ClassPrivateProperty", "ClassAccessorProperty", "PropertyDefinition"]);
/** A class field with a non-function initializer: the initializer runs as code of its own (at construction, or at definition if static). */
function isFieldInitializer(node: ASTNode): boolean {
  if (!FIELD_TYPES.has(node.type)) return false;
  const value = node.children.find((child) => child.role === "value");
  return value !== undefined && !isFunction(value);
}
function isPattern(node: ASTNode | undefined): boolean { return node !== undefined && (node.type === "ObjectPattern" || node.type === "ArrayPattern"); }
/** The statements a graph analyses: a function's body (or its expression body), or a static block's statements. */
function graphStatements(node: ASTNode): readonly ASTNode[] {
  if (node.type === "StaticBlock") return node.children;
  if (isFieldInitializer(node)) return node.children.filter((child) => child.role === "value");
  return statementChildren(node.children.find((child) => child.role === "body") ?? node);
}
const EXPRESSION_CONTROL = new Set(["ConditionalExpression", "LogicalExpression", "OptionalCallExpression", "OptionalMemberExpression", "AssignmentPattern"]);
function isLogicalAssignment(node: ASTNode): boolean { return node.type === "AssignmentExpression" && ["&&=", "||=", "??="].includes(String(node.attributes.operator)); }
function isOptionalChain(node: ASTNode): boolean { return node.type === "OptionalCallExpression" || node.type === "OptionalMemberExpression"; }
/** Every expression-control node evaluated by this graph's own code (not inside nested functions). */
function collectExpressionControl(nodes: readonly ASTNode[]): ReadonlySet<ASTNode> {
  const found = new Set<ASTNode>();
  const visit = (node: ASTNode): void => {
    if (isFunction(node) || isFieldInitializer(node)) return;
    if (EXPRESSION_CONTROL.has(node.type) || isLogicalAssignment(node)) found.add(node);
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  return found;
}
/** Statements that evaluate expressions before completing: those expressions (the test, for `if`). */
const LOWERED_STATEMENTS = new Set(["ExpressionStatement", "VariableDeclaration", "ReturnStatement", "ThrowStatement", "ExportNamedDeclaration", "ExportDefaultDeclaration"]);
function loweredExpressions(node: ASTNode): readonly ASTNode[] | undefined {
  if (node.type === "IfStatement") return node.children.filter((child) => child.role === "test");
  if (LOWERED_STATEMENTS.has(node.type)) return node.children;
  // An arrow function's expression body is its only "statement".
  return node.type.endsWith("Statement") || node.type.endsWith("Declaration") || node.type === "SwitchCase" ? undefined : [node];
}
function hasPotentiallyThrowingEvaluation(node: ASTNode): boolean {
  if (isFunction(node) || node.type === "ThrowStatement") return false;
  if (["CallExpression", "NewExpression", "OptionalCallExpression", "MemberExpression"].includes(node.type)) return true;
  if (["Program", "CatchClause", "TryStatement", "LabeledStatement", "SwitchCase"].includes(node.type)) return false;
  if (node.type === "IfStatement") {
    return node.children.filter((child) => child.role === "test").some(hasPotentiallyThrowingEvaluation);
  }
  if (["WhileStatement", "DoWhileStatement", "ForStatement", "ForInStatement", "ForOfStatement"].includes(node.type)) {
    return node.children.filter((child) => child.role !== "body").some(hasPotentiallyThrowingEvaluation);
  }
  if (node.type === "SwitchStatement") {
    return node.children.some((child) => {
      if (child.role === "discriminant") return hasPotentiallyThrowingEvaluation(child);
      if (child.role !== "cases") return false;
      return child.children.filter((candidate) => candidate.role === "test").some(hasPotentiallyThrowingEvaluation);
    });
  }
  return node.children.some(hasPotentiallyThrowingEvaluation);
}
function isTerminator(node: ASTNode): boolean { return node.type === "ReturnStatement" || node.type === "ThrowStatement"; }
function isLoop(node: ASTNode): boolean { return ["WhileStatement", "DoWhileStatement", "ForStatement", "ForInStatement", "ForOfStatement"].includes(node.type); }
function hasLoopHeader(node: ASTNode): boolean { return isLoop(node) && node.type !== "DoWhileStatement"; }
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
function calculateDominators(entry: string, blocks: readonly BasicBlock[], _edges: readonly ControlFlowEdge[], reachable: ReadonlySet<string>): readonly { readonly blockId: string; readonly immediateDominatorId?: string }[] {
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
        // An unreachable predecessor (e.g. the empty tail after break/return) never constrains a reachable block.
        if (reachable.has(b.id) && !reachable.has(predId)) continue;
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

  // The immediate dominator of i is the first strict dominator (in index order) whose own dominator
  // set holds every other strict dominator of i. Such a set is at least as large as i's strict set,
  // so sizes prefilter the candidates before a word-wise subset test (BA-28: the pairwise test was
  // cubic on long functions).
  const sizes = dom.map((bitset) => bitset.reduce((total, word) => total + popcount(word), 0));
  const strict = new Uint32Array(wordsPerBlock);
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

    strict.set(current);
    strict[i >>> 5] = (strict[i >>> 5] ?? 0) & ~(1 << (i & 31));
    const strictSize = (sizes[i] ?? 0) - (((current[i >>> 5] ?? 0) & (1 << (i & 31))) !== 0 ? 1 : 0);
    let immediate: number | undefined;
    for (let w = 0; w < wordsPerBlock && immediate === undefined; w++) {
      for (let bits = strict[w] ?? 0; bits !== 0 && immediate === undefined; bits &= bits - 1) {
        const candidate = (w << 5) + (31 - Math.clz32(bits & -bits));
        const candidateDom = dom[candidate];
        if (candidateDom === undefined || (sizes[candidate] ?? 0) < strictSize) continue;
        let holdsAll = true;
        for (let v = 0; v < wordsPerBlock && holdsAll; v++) {
          // Every other strict dominator must be in the candidate's set (the candidate is in its own).
          const others = (strict[v] ?? 0) & ~(v === w ? (bits & -bits) : 0);
          if ((others & ~(candidateDom[v] ?? 0)) !== 0) holdsAll = false;
        }
        if (holdsAll) immediate = candidate;
      }
    }

    const immediateId = immediate !== undefined ? blockIds[immediate] : undefined;
    result.push({
      blockId,
      ...(immediateId === undefined ? {} : { immediateDominatorId: immediateId }),
    });
  }

  return result.sort((left, right) => compareCodePoints(left.blockId, right.blockId));
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

/**
 * `dominates(a, b)` in O(1): a dominates b when b's interval in a pre/post numbering of the dominator
 * tree lies within a's. A block outside the numbered forest (an idom cycle in unreachable code) falls
 * back to walking the idom chain, as before (BA-28: the walk per edge was quadratic).
 */
function dominatorTreeIndex(idomMap: ReadonlyMap<string, string | undefined>): (ancestorId: string, blockId: string) => boolean {
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const [blockId, idom] of idomMap) {
    if (idom === undefined) roots.push(blockId);
    else children.set(idom, [...(children.get(idom) ?? []), blockId]);
  }
  const pre = new Map<string, number>();
  const post = new Map<string, number>();
  let clock = 0;
  for (const root of roots) {
    const stack: { readonly id: string; next: number }[] = [{ id: root, next: 0 }];
    pre.set(root, clock++);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const next = children.get(frame.id)?.[frame.next++];
      if (next === undefined) { post.set(frame.id, clock++); stack.pop(); continue; }
      if (pre.has(next)) continue;
      pre.set(next, clock++);
      stack.push({ id: next, next: 0 });
    }
  }
  return (ancestorId, blockId) => {
    if (ancestorId === blockId) return true;
    const ancestorPre = pre.get(ancestorId), ancestorPost = post.get(ancestorId), blockPre = pre.get(blockId), blockPost = post.get(blockId);
    if (blockPre === undefined || blockPost === undefined) return isDominator(idomMap, ancestorId, blockId);
    return ancestorPre !== undefined && ancestorPost !== undefined && ancestorPre <= blockPre && blockPost <= ancestorPost;
  };
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

function popcount(word: number): number {
  let value = word - ((word >>> 1) & 0x55555555);
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
