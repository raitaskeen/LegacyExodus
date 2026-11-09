import { createHash } from "node:crypto";
import type { ASTNode, ASTResult } from "@parser/index";
import { stableId } from "@shared/identity";
import { FactKeyer, type CodeSymbol } from "@symbols/index";
import { createDataFlowGraph, createProvenCallTargets, type CallFlowBinding, type DataFlowGraph, type FunctionFlowSummary, type InterproceduralFlow, type ProvenCallTarget, type TaintFlow, type VariableDefinition, type VariableUse } from "./flow-contracts";
import { compareCodePoints, sortByKey } from "@shared/ordering";
import { combineTaint } from "./cfg-dataflow";
import { cfgSinkVerdicts, type SinkVerdict } from "./cfg-taint";
import { propagateTaintPaths, sanitizedSourceId, setTaintPath, unsanitizedSourceId } from "./taint-propagation";
import { DeterministicControlFlowGraphBuilder, type ControlFlowGraphsWithNodes } from "./control-flow-builder";
import { resolveLexicalBindings, type LexicalBindings } from "./lexical-bindings";
import { filePolicy, sanitizerProtects, type FilePolicy } from "./taint-policy";
import { immutable } from "@shared/immutability";

export interface Scope { readonly parent?: Scope; readonly definitions: Map<string, VariableDefinition>; }
export interface FunctionRecord { readonly name: string; readonly parameters: VariableDefinition[][]; readonly returns: VariableDefinition[]; readonly symbolId?: string; }
export interface PendingCall { readonly id: string; readonly targetSymbolId?: string; readonly callee?: FunctionRecord; readonly argumentDefinitionIds: readonly (string | undefined)[]; readonly argumentSourceIds: readonly (string | undefined)[]; readonly receiverDefinitionId?: string; }
export interface TaintTransfer { readonly sourceDefinitionId: string; readonly targetDefinitionId: string; readonly sanitizes?: true }
/** `verdict`: the CFG data-flow taint at this sink (Wave 3b), authoritative for sources of the sink's own function. */
export interface PendingSink { readonly id: string; readonly name: string; readonly argumentDefinitionIds: readonly string[]; readonly verdict?: SinkVerdict; }
export interface JoinInputs { readonly id: string; readonly incoming: readonly (string | undefined)[]; }
export interface FlowState { readonly definitions: VariableDefinition[]; readonly uses: VariableUse[]; readonly taintPaths: Map<string, Map<string, readonly string[]>>; readonly transfers: TaintTransfer[]; readonly sinks: PendingSink[]; readonly functions: Map<ASTNode, FunctionRecord>; readonly resolvableFunctions: Map<string, FunctionRecord>; readonly functionsBySymbolId: Map<string, FunctionRecord>; readonly provenTargets: ReadonlyMap<string, ProvenCallTarget>; readonly hasSemanticResolution: boolean; readonly pendingCalls: CapturedPendingCall[]; readonly interproceduralFlows: InterproceduralFlow[]; readonly joins: Map<string, JoinInputs>; }

/** Per-build evidence for taint flows; joins live here, not in module state (BA-27). */
interface FlowConnectionState {
  readonly transfers: readonly TaintTransfer[];
  readonly taintPaths: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
  readonly sinks: readonly PendingSink[];
  readonly joins: ReadonlyMap<string, JoinInputs>;
  /** This file's own declaration and assignment definitions: a path only through these stays in one file and no call. */
  readonly localDefinitionIds: ReadonlySet<string>;
  /** Fact keys of this file's sources and sinks, by id (ADR-008): a flow is keyed by its source and sink. */
  readonly factKeys?: ReadonlyMap<string, string>;
}

/** Keys each flow `<source key> > <sink key>` when both ends are keyed; the source may be another file's. */
export function keyTaintFlows(flows: readonly TaintFlow[], keys: ReadonlyMap<string, string>): readonly TaintFlow[] {
  return flows.map((flow) => {
    const source = keys.get(flow.sourceId);
    const sink = keys.get(flow.sinkId);
    return source === undefined || sink === undefined ? flow : { key: `${source} > ${sink}`, ...flow };
  });
}

export interface BuildContextResult {
  readonly graph: DataFlowGraph;
  readonly state: FlowConnectionState;
}


type OrderedExpressionValue =
  | { readonly kind: "definition" | "source"; readonly id: string }
  | { readonly kind: "combined"; readonly values: readonly OrderedExpressionValue[] };

// Transient build evidence; public call-binding and graph contracts remain unchanged.
type CapturedPendingCall = PendingCall & {
  readonly argumentValues?: readonly OrderedExpressionValue[];
};
const orderedAssignmentOperators = new Set(["=", "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=", "&=", "|=", "^="]);


export class DeterministicDataFlowGraphBuilder {
  // Private frame metadata keeps ownership out of the public graph/Scope contracts.
  private readonly functionScopes = new WeakSet<Scope>();
  private readonly capturedEntries = new WeakMap<Scope, Map<string, VariableDefinition>>();
  private readonly transferKeys = new WeakMap<readonly TaintTransfer[], Set<string>>();
  /** The taint policy of the file being built (BA-07); builds are synchronous, one file at a time. */
  /**
   * The value of a proven call into another file that no variable receives (`res.send(id(x))`): a
   * definition of its own, so the callee's return reaches it across files like a receiver (NA-03).
   */
  private readonly callResults = new WeakMap<ASTNode, VariableDefinition>();
  /** The value of each sanitizer call read so far (XA-01), see sanitizedResult. */
  private readonly sanitizedResults = new WeakMap<ASTNode, VariableDefinition>();
  /** Symbols of the file being built: a proven target outside them is in another file. */
  private localSymbolIds: ReadonlySet<string> = new Set();
  private readonly parameterSlots = new WeakMap<ASTNode, VariableDefinition[][]>();
  private policy: FilePolicy = filePolicy({ type: "Program", children: [], attributes: {} } as unknown as ASTNode, { keyOf: new Map(), ownerOf: new Map() });

  /**
   * This file's fact identities (ADR-008), by working id: a fact is recognized by its working (position) id, so
   * the CFG engine's repeated evaluation reuses the first key, and its public id is the digest of that key.
   */
  private keyer: FactKeyer | undefined;
  private identities = new Map<string, { readonly id: string; readonly key: string }>();
  /** Keys of this file's sources and sinks by public id: all that cross-file flow keying reads, so all the connection state keeps. */
  private boundaryKeys = new Map<string, string>();
  private identify(workingId: string, kind: string, subject: string, node: ASTNode | undefined, domain: string): { readonly id: string; readonly key?: string } {
    if (this.keyer === undefined) return { id: workingId };
    const known = this.identities.get(workingId);
    if (known !== undefined) return known;
    const key = this.keyer.key(kind, subject, node?.location?.start);
    const identity = { id: stableId(domain, key), key };
    this.identities.set(workingId, identity);
    if (kind === "source" || kind === "sink") this.boundaryKeys.set(identity.id, key);
    return identity;
  }

  /** @param controlFlow - the file's CFGs from `buildAllWithNodes`, when the caller already built them. */
  /**
   * @param symbols - the file's symbols. Given (production always passes them), facts carry keys and ids are digests
   *   of those keys (ADR-008); omitted, ids keep their source-position formula, as the CFG builder does without owners.
   */
  public buildContext(ast: ASTResult, provenCallTargets?: readonly ProvenCallTarget[], symbols?: readonly CodeSymbol[], controlFlow?: ControlFlowGraphsWithNodes): BuildContextResult {
    const functions = collectFunctions(ast.root, symbols ?? []);
    this.localSymbolIds = new Set((symbols ?? []).map((symbol) => symbol.id));
    const targets = provenCallTargets === undefined ? undefined : createProvenCallTargets(provenCallTargets);
    const state: FlowState = { definitions: [], uses: [], taintPaths: new Map(), transfers: [], sinks: [], functions, resolvableFunctions: new Map(), functionsBySymbolId: new Map(), provenTargets: new Map((targets ?? []).map((target) => [callLocationKey(target.sourceFilePath, target.location), target])), hasSemanticResolution: targets !== undefined, pendingCalls: [], interproceduralFlows: [], joins: new Map() };
    const namesakes = new Map<string, number>();
    for (const record of state.functions.values()) namesakes.set(record.name, (namesakes.get(record.name) ?? 0) + 1);
    for (const record of state.functions.values()) if (record.name.length > 0 && namesakes.get(record.name) === 1) state.resolvableFunctions.set(record.name, record);
    for (const record of state.functions.values()) if (record.symbolId !== undefined) state.functionsBySymbolId.set(record.symbolId, record);
    const bindings = resolveLexicalBindings(ast.root);
    this.policy = filePolicy(ast.root, bindings);
    this.keyer = symbols === undefined ? undefined : new FactKeyer(ast.metadata.sourcePath, ast.root, symbols.filter((symbol) => symbol.kind === "function" || symbol.kind === "method" || symbol.kind === "class"));
    this.identities = new Map();
    this.boundaryKeys = new Map();
    this.visit(ast.root, createScope(), ast.metadata.sourcePath, state);
    this.connectCalls(state);
    this.propagateTaint(state);
    this.attachSinkVerdicts(ast, state, controlFlow ?? new DeterministicControlFlowGraphBuilder().buildAllWithNodes(ast), bindings);
    const definitions = state.definitions.sort(byId);
    const uses = state.uses.sort(byId);
    const usesByDefinitionId = new Map<string, string[]>();
    for (let i = 0; i < uses.length; i++) {
      const use = uses[i];
      if (use !== undefined && use.definitionId !== undefined) {
        let list = usesByDefinitionId.get(use.definitionId);
        if (list === undefined) {
          list = [];
          usesByDefinitionId.set(use.definitionId, list);
        }
        list.push(use.id);
      }
    }
    const defUseChains = definitions.map((definition) => ({
      definitionId: definition.id,
      useIds: usesByDefinitionId.get(definition.id) ?? [],
    }));
    const lifetimes = definitions.map((definition) => ({
      name: definition.name,
      filePath: definition.filePath,
      declarationId: definition.id,
      useIds: usesByDefinitionId.get(definition.id) ?? [],
    }));
    const graph = createDataFlowGraph({
      id: hash(`dfg:${ast.metadata.sourcePath}`), filePath: ast.metadata.sourcePath, state: "INFERRED", definitions, uses,
      defUseChains,
      lifetimes,
      taintFlows: this.taintFlows(state),
      interproceduralFlows: state.interproceduralFlows.sort(byId),
      functionSummaries: functionSummaries(state, ast.metadata.sourcePath),
      callBindings: callBindings(state),
    });
    return { graph, state: this.connectionState(state) };
  }

  private connectionState(state: FlowState): FlowConnectionState {
    const receivers = new Set(state.interproceduralFlows.map((flow) => flow.targetDefinitionId));
    return immutable({
      transfers: state.transfers,
      taintPaths: state.taintPaths,
      sinks: state.sinks,
      joins: state.joins,
      factKeys: new Map(this.boundaryKeys),
      localDefinitionIds: new Set(state.definitions.filter((definition) => (definition.kind === "declaration" || definition.kind === "assignment") && !receivers.has(definition.id)).map((definition) => definition.id)),
    });
  }

  /** Runs CFG data flow over the file and attaches each sink's verdict, adding sinks only it found (Wave 3b). */
  private attachSinkVerdicts(ast: ASTResult, state: FlowState, controlFlow: ControlFlowGraphsWithNodes, bindings: LexicalBindings): void {
    const filePath = ast.metadata.sourcePath;
    const sinkNames = new Map<string, string>();
    const verdicts = cfgSinkVerdicts(ast.root, controlFlow, {
      sourceOf: (node) => this.source(node, filePath),
      sourceOfDestructured: (object, keys, at) => {
        const path = this.policy.destructuredSourcePath(object, keys);
        if (path === undefined) return undefined;
        return this.identify(hash(`source:${filePath}:${path}:${at.location === undefined ? "anon" : `${at.location.start.line}:${at.location.start.column}`}`), "source", path, at, "source").id;
      },
      sinkArgumentsOf: (call) => this.policy.sinkArguments(call),
      sinkIdOf: (call) => {
        const name = this.policy.sinkName(call);
        if (name === undefined) return undefined;
        const position = call.location === undefined ? undefined : `${call.location.start.line}:${call.location.start.column}`;
        if (position === undefined) return undefined;
        const sinkId = this.identify(hash(`sink:${filePath}:${name}:${position}`), "sink", name, call, "sink").id;
        sinkNames.set(sinkId, name);
        return sinkId;
      },
      // An unresolved call may return anything derived from its receiver and arguments; a resolved one
      // is followed by the interprocedural transfers instead. A sanitizer's result carries its inputs'
      // sources marked sanitized, which only the sinks it protects ignore (XA-01).
      callValue: (call, callee, args) => {
        if (this.isResolvedCall(call, filePath, state)) return new Map();
        const value = args.reduce((combined, argument) => combineTaint(combined, argument), callee);
        return this.policy.isSanitizer(call) ? new Map([...value].map(([sourceId, must]) => [sanitizedSourceId(sourceId), must])) : value;
      },
    }, bindings);
    const byId = new Map(state.sinks.map((sink, index) => [sink.id, index]));
    for (const [sinkId, verdict] of verdicts) {
      const index = byId.get(sinkId);
      const existing = index === undefined ? undefined : state.sinks[index];
      if (existing !== undefined && index !== undefined) state.sinks[index] = { ...existing, verdict };
      else state.sinks.push({ id: sinkId, name: sinkNames.get(sinkId) ?? "", argumentDefinitionIds: [], verdict });
    }
  }

  private isResolvedCall(call: ASTNode, filePath: string, state: FlowState): boolean {
    const callee = call.children.find((child) => child.role === "callee");
    const name = memberPath(callee) ?? identifierName(callee);
    const proven = call.location === undefined ? undefined : state.provenTargets.get(callLocationKey(filePath, call.location.start));
    const resolved = state.hasSemanticResolution ? (proven === undefined ? undefined : state.functionsBySymbolId.get(proven.targetSymbolId)) : resolveFunction(name, state.resolvableFunctions);
    return resolved !== undefined || proven !== undefined;
  }

  public build(ast: ASTResult, provenCallTargets?: readonly ProvenCallTarget[], symbols?: readonly CodeSymbol[]): DataFlowGraph {
    return this.buildContext(ast, provenCallTargets, symbols).graph;
  }

  /**
   * Taint flows at this state's sinks. The path-based flows come from definition transfers; for a
   * source evaluated in the sink's own function the CFG verdict then decides (Wave 3b): it sets the
   * state, adds the flows the transfers miss, and removes a flow the CFG rules out unless its path
   * crosses a call or another file.
   * @param state.joins - every join any path can reach; across files, the merged joins of all builds.
   */
  public computeTaintFlows(state: Pick<FlowConnectionState, "sinks"> & Partial<Pick<FlowConnectionState, "transfers" | "joins" | "localDefinitionIds" | "factKeys">>, taintPaths: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>): readonly TaintFlow[] {
    const joins = state.joins ?? new Map<string, JoinInputs>();
    const confirmed = new Map<string, Set<string>>();
    const predecessors = new Map<string, string[]>();
    for (const edge of state.transfers ?? []) {
      const inputs = predecessors.get(edge.targetDefinitionId) ?? [];
      inputs.push(edge.sourceDefinitionId);
      predecessors.set(edge.targetDefinitionId, inputs);
    }
    const isConfirmed = (definitionId: string, sourceId: string, active = new Set<string>()): boolean => {
      const path = taintPaths.get(definitionId)?.get(sourceId);
      if (path === undefined || active.has(definitionId)) return false;
      if (confirmed.get(sourceId)?.has(definitionId)) return true;
      active.add(definitionId);
      const join = joins.get(definitionId);
      const certain = join !== undefined
        ? join.incoming.every((id) => id !== undefined && isConfirmed(id, sourceId, active))
        : path.every((id) => !joins.has(id) || isConfirmed(id, sourceId, active))
          || (predecessors.get(definitionId) ?? []).some((id) => isConfirmed(id, sourceId, active));
      active.delete(definitionId);
      if (certain) {
        const definitions = confirmed.get(sourceId) ?? new Set<string>();
        definitions.add(definitionId);
        confirmed.set(sourceId, definitions);
      }
      return certain;
    };
    const flows = state.sinks.flatMap((sink) =>
      sink.argumentDefinitionIds.flatMap((definitionId) =>
        [...(taintPaths.get(definitionId)?.entries() ?? [])].map(([sourceId, path]) => ({
          sourceId,
          sinkId: sink.id,
          path: immutable([...path, sink.name]),
          state: isConfirmed(definitionId, sourceId) ? "CONFIRMED" as const : "INFERRED" as const,
        })),
      ),
    );
    // An unconditional argument path wins over a conditional path to the same sink.
    const unique = new Map<string, TaintFlow>();
    for (const flow of flows) {
      const key = flow.sourceId + ":" + flow.sinkId;
      if (unique.get(key)?.state !== "CONFIRMED") unique.set(key, flow);
    }
    const local = state.localDefinitionIds;
    for (const sink of state.sinks) {
      const verdict = sink.verdict;
      if (verdict === undefined) continue;
      for (const [key, flow] of unique) {
        if (flow.sinkId !== sink.id || !verdict.scopeSourceIds.has(unsanitizedSourceId(flow.sourceId).sourceId)) continue;
        const must = verdict.taint.get(flow.sourceId);
        const crossesCallOrFile = local === undefined || flow.path.slice(1, -1).some((id) => !local.has(id));
        if (must !== undefined) unique.set(key, { ...flow, state: must ? "CONFIRMED" : "INFERRED" });
        else if (!crossesCallOrFile) unique.delete(key);
      }
      for (const [sourceId, must] of verdict.taint) {
        const key = sourceId + ":" + sink.id;
        if (!unique.has(key)) unique.set(key, { sourceId, sinkId: sink.id, path: immutable([sourceId, sink.name]), state: must ? "CONFIRMED" : "INFERRED" });
      }
    }
    // A sanitized source is clean at the sinks its sanitizer protects and still tainted at every other sink (XA-01).
    const sinkNames = new Map(state.sinks.map((sink) => [sink.id, sink.name]));
    const judged = new Map<string, TaintFlow>();
    for (const flow of unique.values()) {
      const { sourceId, sanitized } = unsanitizedSourceId(flow.sourceId);
      if (sanitized && sanitizerProtects(sinkNames.get(flow.sinkId) ?? "")) continue;
      const restored = sanitized ? { ...flow, sourceId, path: immutable([sourceId, ...flow.path.slice(1)]) } : flow;
      const key = sourceId + ":" + flow.sinkId;
      if (judged.get(key)?.state !== "CONFIRMED") judged.set(key, restored);
    }
    const sorted = [...judged.values()].sort((left, right) =>
      compareCodePoints(`${left.sourceId}:${left.sinkId}`, `${right.sourceId}:${right.sinkId}`),
    );
    return immutable(state.factKeys === undefined ? sorted : keyTaintFlows(sorted, state.factKeys));
  }

  private visit(node: ASTNode, scope: Scope, filePath: string, state: FlowState, currentFunction?: FunctionRecord, receiverDefinitionId?: string): void {
    if (node.type === "ExpressionStatement") {
      const expression = node.children.find((child) => child.role === "expression");
      // Classify the entire entry before any effects; rejection keeps the legacy path.
      if (this.orderedChildCount(node) === 1 && expression?.type === "AssignmentExpression" && this.isOrderedExpression(expression)) {
        this.evaluateOrderedExpression(expression, scope, filePath, state);
        return;
      }
      if (this.orderedChildCount(node) === 1 && expression?.type === "AssignmentExpression"
        && this.isStagedCallAssignment(expression)) {
        const left = expression.children.find((child) => child.role === "left")!;
        const right = expression.children.find((child) => child.role === "right")!;
        const name = identifierName(left)!;
        const receiver = this.define(name, "assignment", expression, scope, filePath, state, undefined, false);
        this.call(right, scope, filePath, state, receiver.id, true);
        this.publishDefinition(scope, receiver);
        return;
      }
      if (this.orderedChildCount(node) === 1 && expression?.type === "AssignmentExpression"
        && expression.attributes.operator === "=" && this.orderedChildCount(expression) === 2) {
        const left = expression.children.find((child) => child.role === "left");
        const right = expression.children.find((child) => child.role === "right");
        if (left !== undefined && (left.type === "ArrayPattern" || left.type === "ObjectPattern")
          && right !== undefined && this.isStagedLiteral(right) && this.isStagedPattern(left, right)) {
          const captures = new Map<ASTNode, OrderedExpressionValue>();
          this.captureStagedLiteral(right, scope, filePath, state, captures);
          this.bindDestructuringPattern(left, right, "assignment", expression, scope, filePath, state, captures);
          return;
        }
      }
    }
    if (node.type === "IfStatement") { this.conditional(node, scope, filePath, state, currentFunction); return; }
    if (node.type === "Program") { for (const child of node.children) this.visit(child, scope, filePath, state, currentFunction); return; }
    if (node.type === "BlockStatement") { const childScope = createScope(scope); for (const child of node.children) this.visit(child, childScope, filePath, state, currentFunction); return; }
    if (node.type === "ForOfStatement" || node.type === "ForInStatement") { this.iteration(node, scope, filePath, state, currentFunction); return; }
    if (node.type === "VariableDeclaration") { for (const child of node.children.filter((candidate) => candidate.role === "declarations")) this.declarator(child, scope, filePath, state, node.attributes.kind); return; }
    if (isFunction(node)) { this.function(node, scope, filePath, state); return; }
    if (node.type === "ReturnStatement") { this.returnValue(node, scope, filePath, state, currentFunction); return; }
    if (node.type === "AssignmentExpression") { this.assignment(node, scope, filePath, state, currentFunction); return; }
    if (node.type === "CallExpression") { this.call(node, scope, filePath, state, receiverDefinitionId); return; }
    if (node.type === "MemberExpression") {
      this.memberUse(node, scope, filePath, state);
      // A chain rooted in a call (`wrap(x).inner`) still evaluates that call: its arguments reach the callee and
      // its return reaches this read (NA-03c). A chain rooted in a name is a plain read, already recorded above.
      const root = memberRoot(node);
      if (root !== undefined && root.type !== "Identifier" && root.type !== "ThisExpression" && root.type !== "Super") this.visit(root, scope, filePath, state, currentFunction);
      return;
    }
    if (node.type === "ObjectProperty") {
      const computed = node.attributes.computed === true;
      const key = node.children.find((child) => child.role === "key");
      if (computed && key !== undefined) this.visit(key, scope, filePath, state, currentFunction);
      const value = node.children.find((child) => child.role === "value");
      if (value !== undefined) this.visit(value, scope, filePath, state, currentFunction);
      return;
    }
    if (node.type === "Identifier") { this.use(identifierName(node), node, scope, filePath, state); return; }
    for (const child of node.children) this.visit(child, scope, filePath, state, currentFunction);
  }

  private conditional(node: ASTNode, scope: Scope, filePath: string, state: FlowState, currentFunction?: FunctionRecord): void {
    const test = node.children.find((child) => child.role === "test");
    if (test !== undefined) this.visit(test, scope, filePath, state, currentFunction);
    const frames: Scope[] = [];
    for (let frame: Scope | undefined = scope; frame !== undefined; frame = frame.parent) frames.push(frame);
    const fork = (): Scope[] => {
      const copies: Scope[] = [];
      for (let index = frames.length - 1; index >= 0; index--) {
        const original = frames[index]!;
        const copy: Scope = { parent: copies[index + 1], definitions: new BranchDefinitions(original.definitions) };
        if (this.functionScopes.has(original)) this.functionScopes.add(copy);
        const captured = this.capturedEntries.get(original);
        if (captured !== undefined) this.capturedEntries.set(copy, new Map(captured));
        copies[index] = copy;
      }
      return copies;
    };
    const consequent = fork();
    const alternate = fork();
    const thenNode = node.children.find((child) => child.role === "consequent");
    const elseNode = node.children.find((child) => child.role === "alternate");
    if (thenNode !== undefined) this.visit(thenNode, consequent[0]!, filePath, state, currentFunction);
    if (elseNode !== undefined) this.visit(elseNode, alternate[0]!, filePath, state, currentFunction);
    const position = node.location === undefined ? "anon-" + state.definitions.length : node.location.start.line + ":" + node.location.start.column;
    for (const [index, owner] of frames.entries()) {
      const thenDefinitions = consequent[index]!.definitions;
      const elseDefinitions = alternate[index]!.definitions;
      const names = [...new Set([...thenDefinitions.keys(), ...elseDefinitions.keys()])].sort();
      for (const name of names) {
        const captured = this.capturedEntries.get(consequent[index]!)?.get(name)
          ?? this.capturedEntries.get(alternate[index]!)?.get(name);
        const entry = owner.definitions.get(name) ?? captured;
        const incoming = [thenDefinitions.get(name)?.id ?? entry?.id, elseDefinitions.get(name)?.id ?? entry?.id];
        if (incoming[0] === incoming[1]) continue;
        const identity = this.identify(hash("join:" + filePath + ":" + name + ":" + position + ":" + index + ":" + incoming.map((value) => value ?? "unbound").join(":")), "join", `${name}/${index}`, node, "definition");
        const id = identity.id;
        const definition: VariableDefinition = { ...identity, filePath, name, kind: "assignment" };
        state.joins.set(id, state.joins.get(id) ?? { id, incoming: immutable(incoming) });
        state.definitions.push(definition);
        for (const input of incoming) if (input !== undefined) this.addTransfer(state, input, id);
        // These are the original owner frames, never the transient branch scopes.
        if (captured !== undefined && !owner.definitions.has(name)) {
          const entries = this.capturedEntries.get(owner) ?? new Map<string, VariableDefinition>();
          entries.set(name, captured);
          this.capturedEntries.set(owner, entries);
        }
        owner.definitions.set(name, definition);
      }
    }
  }

  private *orderedChildren(node: ASTNode): IterableIterator<ASTNode> {
    for (const child of node.children) {
      if ((child.type === "CommentLine" || child.type === "CommentBlock")
        && (child.role === "leadingComments" || child.role === "trailingComments" || child.role === "innerComments")
        && child.children.length === 0) continue;
      yield child;
    }
  }

  private orderedChildCount(node: ASTNode): number {
    let count = 0;
    for (const _child of this.orderedChildren(node)) count++;
    return count;
  }

  private isOrderedExpression(node: ASTNode): boolean {
    switch (node.type) {
      case "Identifier":
        return identifierName(node) !== undefined && this.orderedChildCount(node) === 0;
      case "StringLiteral":
      case "NumericLiteral":
      case "BooleanLiteral":
      case "NullLiteral":
        return this.orderedChildCount(node) === 0;
      case "MemberExpression": {
        const object = node.children.find((child) => child.role === "object");
        const property = node.children.find((child) => child.role === "property");
        return node.attributes.computed !== true && this.orderedChildCount(node) === 2
          && object !== undefined && (object.type === "Identifier" || object.type === "MemberExpression")
          && property?.type === "Identifier"
          && this.isOrderedExpression(object) && this.isOrderedExpression(property);
      }
      case "BinaryExpression":
      case "AssignmentExpression": {
        const left = node.children.find((child) => child.role === "left");
        const right = node.children.find((child) => child.role === "right");
        if (this.orderedChildCount(node) !== 2 || left === undefined || right === undefined) return false;
        if (node.type === "AssignmentExpression"
          && (left.type !== "Identifier" || typeof node.attributes.operator !== "string"
            || !orderedAssignmentOperators.has(node.attributes.operator))) return false;
        return this.isOrderedExpression(left) && this.isOrderedExpression(right);
      }
      case "SequenceExpression": {
        let hasExpression = false;
        for (const child of this.orderedChildren(node)) {
          if (child.role !== "expressions" || !this.isOrderedExpression(child)) return false;
          hasExpression = true;
        }
        return hasExpression;
      }
      case "ArrayExpression":
        for (const child of this.orderedChildren(node)) {
          if (child.role !== "elements"
            || !(child.type === "ArrayHole" ? this.orderedChildCount(child) === 0 : this.isOrderedExpression(child))) return false;
        }
        return true;
      default:
        return false;
    }
  }

  // This entry handles plain literal destructuring only. Defaults, rest, computed
  // keys, repeated targets and unsupported values retain the whole legacy entry.
  private isStagedLiteral(node: ASTNode): boolean {
    if (node.type === "ArrayExpression") return [...this.orderedChildren(node)].every((child) =>
      child.role === "elements" && (child.type === "ArrayHole" ? this.orderedChildCount(child) === 0 : this.isStagedLiteral(child)));
    if (node.type !== "ObjectExpression") return this.isOrderedExpression(node);
    const keys = new Set<string>();
    return [...this.orderedChildren(node)].every((property) => {
      const key = this.stagedPropertyKey(property);
      const value = property.children.find((child) => child.role === "value");
      if (key === undefined || keys.has(key) || value === undefined || !this.isStagedLiteral(value)) return false;
      keys.add(key);
      return true;
    });
  }

  private stagedPropertyKey(property: ASTNode): string | undefined {
    const key = property.children.find((child) => child.role === "key");
    if (property.type !== "ObjectProperty" || property.role !== "properties"
      || property.attributes.computed === true || this.orderedChildCount(property) !== 2
      || key === undefined || this.orderedChildCount(key) !== 0) return undefined;
    return key.type === "Identifier" ? identifierName(key) : key.type === "StringLiteral" ? stringValue(key) : undefined;
  }

  private isStagedPattern(pattern: ASTNode, init: ASTNode | undefined, names = new Set<string>()): boolean {
    if (pattern.type === "Identifier") {
      const name = identifierName(pattern);
      if (name === undefined || names.has(name) || !this.isOrderedExpression(pattern)) return false;
      names.add(name);
      return true;
    }
    if (pattern.type === "ArrayPattern" && init?.type === "ArrayExpression") {
      const elements = init.children.filter((child) => child.role === "elements");
      return [...this.orderedChildren(pattern)].every((child, index) =>
        child.role === "elements" && (child.type === "ArrayHole" ? this.orderedChildCount(child) === 0 : this.isStagedPattern(child, elements[index], names)));
    }
    if (pattern.type === "ObjectPattern" && init?.type === "ObjectExpression") {
      return [...this.orderedChildren(pattern)].every((property) => {
        const key = this.stagedPropertyKey(property);
        const value = property.children.find((child) => child.role === "value");
        if (key === undefined || value === undefined) return false;
        const matched = init.children.find((child) => this.stagedPropertyKey(child) === key);
        return this.isStagedPattern(value, matched?.children.find((child) => child.role === "value"), names);
      });
    }
    return false;
  }

  private captureStagedLiteral(node: ASTNode, scope: Scope, filePath: string, state: FlowState, captures: Map<ASTNode, OrderedExpressionValue>): OrderedExpressionValue {
    let value: OrderedExpressionValue;
    if (node.type === "ObjectExpression") {
      value = { kind: "combined", values: [...this.orderedChildren(node)].map((property) =>
        this.captureStagedLiteral(property.children.find((child) => child.role === "value")!, scope, filePath, state, captures)) };
    } else if (node.type === "ArrayExpression") {
      value = { kind: "combined", values: [...this.orderedChildren(node)].map((child) =>
        this.captureStagedLiteral(child, scope, filePath, state, captures)) };
    } else value = this.evaluateOrderedExpression(node, scope, filePath, state);
    captures.set(node, value);
    return value;
  }


  private isStagedCallAssignment(node: ASTNode): boolean {
    const left = node.children.find((child) => child.role === "left");
    const right = node.children.find((child) => child.role === "right");
    if (node.attributes.operator !== "=" || this.orderedChildCount(node) !== 2
      || left?.type !== "Identifier" || !this.isOrderedExpression(left)
      || right?.type !== "CallExpression" || right.attributes.optional === true) return false;
    const callee = right.children.find((child) => child.role === "callee");
    if (callee === undefined || (callee.type !== "Identifier" && callee.type !== "MemberExpression")
      || !this.isOrderedExpression(callee)) return false;
    return [...this.orderedChildren(right)].every((child) =>
      child === callee || child.role === "arguments" && this.isOrderedExpression(child));
  }

  private orderedValueIds(value: OrderedExpressionValue, kind: "definition" | "source"): string[] {
    const ids = new Set<string>();
    const pending = [value];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current.kind === "combined") {
        for (let index = current.values.length - 1; index >= 0; index--) pending.push(current.values[index]!);
      } else if (current.kind === kind) ids.add(current.id);
    }
    return [...ids];
  }


  private evaluateOrderedExpression(node: ASTNode, scope: Scope, filePath: string, state: FlowState): OrderedExpressionValue {
    switch (node.type) {
      case "Identifier": {
        const name = identifierName(node);
        const definition = name === undefined ? undefined : resolve(scope, name);
        this.use(name, node, scope, filePath, state);
        const sourceId = this.source(node, filePath);
        if (sourceId !== undefined) return { kind: "source", id: sourceId };
        return definition === undefined ? { kind: "combined", values: [] } : { kind: "definition", id: definition.id };
      }
      case "MemberExpression": {
        this.memberUse(node, scope, filePath, state);
        const sourceId = this.source(node, filePath);
        if (sourceId !== undefined) return { kind: "source", id: sourceId };
        // Preserve the legacy full-path/base preference, including inner-path fallback.
        for (let current: ASTNode | undefined = node; current !== undefined; current = current.children.find((child) => child.role === "object")) {
          for (const name of [identifierName(current), memberPath(current), memberBase(current)]) {
            if (name === undefined) continue;
            const definition = resolve(scope, name);
            if (definition !== undefined) return { kind: "definition", id: definition.id };
          }
        }
        return { kind: "combined", values: [] };
      }
      case "AssignmentExpression":
        return this.evaluateOrderedAssignment(node, scope, filePath, state);
      case "BinaryExpression": {
        const left = node.children.find((child) => child.role === "left")!;
        const right = node.children.find((child) => child.role === "right")!;
        return { kind: "combined", values: [
          this.evaluateOrderedExpression(left, scope, filePath, state),
          this.evaluateOrderedExpression(right, scope, filePath, state),
        ] };
      }
      case "SequenceExpression": {
        let value: OrderedExpressionValue = { kind: "combined", values: [] };
        for (const child of this.orderedChildren(node)) value = this.evaluateOrderedExpression(child, scope, filePath, state);
        return value;
      }
      case "ArrayExpression": {
        const values: OrderedExpressionValue[] = [];
        for (const child of this.orderedChildren(node)) values.push(this.evaluateOrderedExpression(child, scope, filePath, state));
        return { kind: "combined", values };
      }
      case "StringLiteral":
      case "NumericLiteral":
      case "BooleanLiteral":
      case "NullLiteral":
      case "ArrayHole":
        return { kind: "combined", values: [] };
      default:
        throw new Error(`Ineligible ordered expression: ${node.type}`);
    }
  }

  private evaluateOrderedAssignment(node: ASTNode, scope: Scope, filePath: string, state: FlowState): OrderedExpressionValue {
    const left = node.children.find((child) => child.role === "left")!;
    const right = node.children.find((child) => child.role === "right")!;
    const name = identifierName(left)!;
    const compound = node.attributes.operator !== "=";
    // Reserve in legacy allocation order for anonymous IDs, without exposing the binding.
    const definition = this.define(name, "assignment", node, scope, filePath, state,
      compound ? undefined : literalValue(right), false);
    const incoming = compound ? this.evaluateOrderedExpression(left, scope, filePath, state) : undefined;
    const value = this.evaluateOrderedExpression(right, scope, filePath, state);
    this.materializeOrderedValue(incoming === undefined ? value : { kind: "combined", values: [incoming, value] }, definition.id, state);
    this.publishDefinition(scope, definition);
    return { kind: "definition", id: definition.id };
  }

  private materializeOrderedValue(value: OrderedExpressionValue, targetDefinitionId: string, state: FlowState, sanitizes = false): void {
    // A value tree avoids copying growing dependency sets at each binary ancestor.
    const pending = [value];
    const definitions = new Set<string>();
    const sourceIds = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current.kind === "combined") {
        for (let index = current.values.length - 1; index >= 0; index--) pending.push(current.values[index]!);
      } else if (current.kind === "definition") {
        if (!definitions.has(current.id)) {
          definitions.add(current.id);
          this.addTransfer(state, current.id, targetDefinitionId, sanitizes);
        }
      } else if (!sourceIds.has(current.id)) {
        sourceIds.add(current.id);
        const sourceId = sanitizes ? sanitizedSourceId(current.id) : current.id;
        this.setTaintPath(state, targetDefinitionId, sourceId, [sourceId, targetDefinitionId]);
      }
    }
  }

  private declarator(node: ASTNode, scope: Scope, filePath: string, state: FlowState, declarationKind?: unknown): void {
    const owner = this.declarationOwner(scope, declarationKind);
    const id = node.children.find((child) => child.role === "id");
    const singleName = identifierName(id);
    const boundNames = singleName !== undefined ? [singleName] : extractBoundNames(id);
    if (boundNames.length === 0) return;
    const init = node.children.find((child) => child.role === "init");
    const initVal = singleName !== undefined ? literalValue(init) : undefined;
    if (singleName !== undefined) {
      const definition = this.define(singleName, "declaration", node, scope, filePath, state, initVal, true, owner);
      if (init !== undefined) this.transferTaint(init, definition.id, scope, filePath, state);
    } else if (id !== undefined) {
      this.bindDestructuringPattern(id, init, "declaration", node, scope, filePath, state, undefined, owner);
    }
    if (init !== undefined) {
      const primaryDefId = boundNames.length === 1 ? owner.definitions.get(boundNames[0]!)?.id : undefined;
      this.visit(init, scope, filePath, state, undefined, primaryDefId);
    }
    for (const { boundNames: defaultBoundNames, defaultNode } of extractPatternDefaults(id)) {
      const primaryDefId = defaultBoundNames.length === 1 ? owner.definitions.get(defaultBoundNames[0]!)?.id : undefined;
      this.visit(defaultNode, scope, filePath, state, undefined, primaryDefId);
    }
  }

  private iteration(node: ASTNode, scope: Scope, filePath: string, state: FlowState, currentFunction: FunctionRecord | undefined): void {
    const left = node.children.find((child) => child.role === "left");
    const right = node.children.find((child) => child.role === "right");
    const body = node.children.find((child) => child.role === "body");
    const loopScope = createScope(scope);
    const sourceIds = node.type === "ForOfStatement" && right !== undefined ? this.collectSources(right, filePath, state) : [];
    const sourceDefinitions = node.type === "ForOfStatement" && right !== undefined ? this.collectDefinitions(right, scope, filePath, state) : [];

    if (right !== undefined) this.visit(right, scope, filePath, state, currentFunction);

    const targetDefinitions: VariableDefinition[] = [];
    if (left?.type === "VariableDeclaration") {
      for (const declarator of left.children.filter((candidate) => candidate.role === "declarations")) {
        this.declarator(declarator, loopScope, filePath, state, left.attributes.kind);
        const id = declarator.children.find((child) => child.role === "id");
        const name = identifierName(id);
        const definition = name === undefined ? undefined : resolve(loopScope, name);
        if (definition !== undefined) targetDefinitions.push(definition);
      }
    } else {
      const name = identifierName(left) ?? memberPath(left);
      if (name !== undefined && left !== undefined) {
        targetDefinitions.push(this.define(name, "assignment", left, scope, filePath, state, undefined));
      } else if (left !== undefined) {
        this.visit(left, loopScope, filePath, state, currentFunction);
      }
    }

    for (const target of targetDefinitions) {
      for (const sourceId of sourceIds) this.setTaintPath(state, target.id, sourceId, [sourceId, target.id]);
      for (const sourceDefinition of sourceDefinitions) this.addTransfer(state, sourceDefinition.id, target.id);
    }

    if (body !== undefined) this.visit(body, loopScope, filePath, state, currentFunction);
  }

  private function(node: ASTNode, scope: Scope, filePath: string, state: FlowState): void {
    const name = identifierName(node.children.find((child) => child.role === "id"));
    if (name !== undefined) this.define(name, "declaration", node, scope, filePath, state, undefined);
    const record = state.functions.get(node);
    const functionScope = createScope(scope);
    this.functionScopes.add(functionScope);
    // Every function's parameters by position, symbol or not (an inline callback has no symbol record).
    const parameterSlots: VariableDefinition[][] = [];
    this.parameterSlots.set(node, parameterSlots);
    for (const parameter of node.children.filter((child) => child.role === "params")) {
      const paramNames = extractBoundNames(parameter);
      const slotDefinitions: VariableDefinition[] = [];
      for (const parameterName of paramNames) {
        const definition = this.define(parameterName, "parameter", parameter, functionScope, filePath, state, undefined);
        slotDefinitions.push(definition);
      }
      record?.parameters.push(slotDefinitions);
      parameterSlots.push(slotDefinitions);
      for (const { boundNames: defaultBoundNames, defaultNode } of extractPatternDefaults(parameter)) {
        for (const paramName of defaultBoundNames) {
          const definition = functionScope.definitions.get(paramName);
          if (definition !== undefined) this.transferTaint(defaultNode, definition.id, functionScope, filePath, state);
        }
        const primaryDefId = defaultBoundNames.length === 1 ? functionScope.definitions.get(defaultBoundNames[0]!)?.id : undefined;
        this.visit(defaultNode, functionScope, filePath, state, record, primaryDefId);
      }
    }
    const body = node.children.find((child) => child.role === "body");
    if (body !== undefined) this.visit(body, functionScope, filePath, state, record);
  }

  private returnValue(node: ASTNode, scope: Scope, filePath: string, state: FlowState, currentFunction: FunctionRecord | undefined): void {
    const argument = node.children.find((child) => child.role === "argument");
    if (argument === undefined || currentFunction === undefined) { if (argument !== undefined) this.visit(argument, scope, filePath, state, currentFunction); return; }
    const returned = this.define(`${currentFunction.name}:return`, "return", node, scope, filePath, state, undefined);
    currentFunction.returns.push(returned);
    const callee = argument.children.find((child) => child.role === "callee");
    const source = argument.type === "CallExpression" && callee?.type !== "MemberExpression" ? undefined : this.definitionFor(argument, scope);
    if (source !== undefined) this.addInterproceduralFlow(state, hash(`return:${returned.id}:${source.id}`), "return-value", source.id, returned.id);
    this.transferTaint(argument, returned.id, scope, filePath, state);
    this.visit(argument, scope, filePath, state, currentFunction, returned.id);
  }

  private assignment(node: ASTNode, scope: Scope, filePath: string, state: FlowState, currentFunction: FunctionRecord | undefined): void {
    const left = node.children.find((child) => child.role === "left");
    const right = node.children.find((child) => child.role === "right");
    const singleName = identifierName(left) ?? memberPath(left);
    const boundNames = singleName !== undefined ? [singleName] : extractBoundNames(left);
    if (boundNames.length === 0) return;
    const rightVal = singleName !== undefined ? literalValue(right) : undefined;
    if (singleName !== undefined) {
      const definition = this.define(singleName, "assignment", node, scope, filePath, state, rightVal);
      if (right !== undefined) this.transferTaint(right, definition.id, scope, filePath, state);
    } else if (left !== undefined) {
      this.bindDestructuringPattern(left, right, "assignment", node, scope, filePath, state);
    }
    if (right !== undefined) {
      const primaryDefId = boundNames.length === 1 ? resolve(scope, boundNames[0]!)?.id : undefined;
      this.visit(right, scope, filePath, state, currentFunction, primaryDefId);
    }
    for (const { boundNames: defaultBoundNames, defaultNode } of extractPatternDefaults(left)) {
      const primaryDefId = defaultBoundNames.length === 1 ? resolve(scope, defaultBoundNames[0]!)?.id : undefined;
      this.visit(defaultNode, scope, filePath, state, currentFunction, primaryDefId);
    }
  }

  private bindDestructuringPattern(
    pattern: ASTNode,
    init: ASTNode | undefined,
    kind: VariableDefinition["kind"],
    declarationOrAssignmentNode: ASTNode,
    scope: Scope,
    filePath: string,
    state: FlowState,
    captures?: ReadonlyMap<ASTNode, OrderedExpressionValue>,
    declarationOwner: Scope = scope,
  ): void {
    if (pattern.type === "Identifier") {
      const name = identifierName(pattern);
      if (name === undefined) return;
      const constVal = init !== undefined && init.type !== "ArrayHole" ? literalValue(init) : undefined;
      const definition = this.define(name, kind, declarationOrAssignmentNode, scope, filePath, state, constVal, true, declarationOwner);
      if (init !== undefined && init.type !== "ArrayHole") {
        this.transferTaint(init, definition.id, scope, filePath, state, captures);
      }
      return;
    }

    if (pattern.type === "MemberExpression") {
      const path = memberPath(pattern);
      if (path === undefined) return;
      const constVal = init !== undefined && init.type !== "ArrayHole" ? literalValue(init) : undefined;
      const definition = this.define(path, kind, declarationOrAssignmentNode, scope, filePath, state, constVal, true, declarationOwner);
      if (init !== undefined && init.type !== "ArrayHole") {
        this.transferTaint(init, definition.id, scope, filePath, state, captures);
      }
      return;
    }

    if (pattern.type === "AssignmentPattern") {
      const left = pattern.children.find((c) => c.role === "left");
      const right = pattern.children.find((c) => c.role === "right");
      if (left === undefined) return;
      if (init !== undefined && init.type !== "ArrayHole") {
        if (isStaticallyDefinedLiteral(init)) {
          this.bindDestructuringPattern(left, init, kind, declarationOrAssignmentNode, scope, filePath, state, captures, declarationOwner);
        } else {
          this.bindDestructuringPattern(left, init, kind, declarationOrAssignmentNode, scope, filePath, state, captures, declarationOwner);
          if (right !== undefined) {
            const boundNames = extractBoundNames(left);
            for (const name of boundNames) {
              const def = resolve(scope, name);
              if (def !== undefined) this.transferTaint(right, def.id, scope, filePath, state, captures);
            }
          }
        }
      } else {
        this.bindDestructuringPattern(left, right, kind, declarationOrAssignmentNode, scope, filePath, state, captures, declarationOwner);
      }
      return;
    }

    if (pattern.type === "RestElement") {
      const argument = pattern.children.find((c) => c.role === "argument");
      if (argument !== undefined) {
        this.bindDestructuringPattern(argument, init, kind, declarationOrAssignmentNode, scope, filePath, state, captures, declarationOwner);
      }
      return;
    }

    if (pattern.type === "ObjectPattern") {
      if (init !== undefined && init.type === "ObjectExpression") {
        const patternProps = pattern.children.filter((c) => c.type === "ObjectProperty" || c.role === "properties");
        const restElement = pattern.children.find((c) => c.type === "RestElement");
        const matchedKeys = new Set<string>();

        for (const child of patternProps) {
          if (child.type === "RestElement") continue;
          const keyNode = child.children.find((c) => c.role === "key") ?? child.children.find((c) => c.type === "Identifier");
          const propKey = identifierName(keyNode) ?? stringValue(keyNode);
          const valNode = child.children.find((c) => c.role === "value") ?? keyNode;
          if (propKey !== undefined) matchedKeys.add(propKey);

          const matchedProp = propKey !== undefined
            ? init.children.find((initChild) => {
                if (initChild.type !== "ObjectProperty" && initChild.role !== "properties") return false;
                const initKeyNode = initChild.children.find((c) => c.role === "key") ?? initChild.children.find((c) => c.type === "Identifier");
                return (identifierName(initKeyNode) ?? stringValue(initKeyNode)) === propKey;
              })
            : undefined;

          if (matchedProp !== undefined) {
            const initValNode = matchedProp.children.find((c) => c.role === "value");
            if (valNode !== undefined) {
              this.bindDestructuringPattern(valNode, initValNode, kind, declarationOrAssignmentNode, scope, filePath, state, captures, declarationOwner);
            }
          } else {
            const spreadChild = init.children.find((initChild) => initChild.type === "SpreadElement");
            const spreadSource = spreadChild?.children.find((c) => c.role === "argument") ?? spreadChild;
            if (valNode !== undefined) {
              this.bindDestructuringPattern(valNode, spreadSource, kind, declarationOrAssignmentNode, scope, filePath, state, captures, declarationOwner);
            }
          }
        }

        if (restElement !== undefined) {
          const restArg = restElement.children.find((c) => c.role === "argument");
          const restName = identifierName(restArg) ?? memberPath(restArg);
          if (restName !== undefined) {
            const restDef = this.define(restName, kind, declarationOrAssignmentNode, scope, filePath, state, undefined, true, declarationOwner);
            for (const initChild of init.children) {
              if (initChild.type === "ObjectProperty" || initChild.role === "properties") {
                const initKeyNode = initChild.children.find((c) => c.role === "key") ?? initChild.children.find((c) => c.type === "Identifier");
                const initKey = identifierName(initKeyNode) ?? stringValue(initKeyNode);
                if (initKey === undefined || !matchedKeys.has(initKey)) {
                  const initValNode = initChild.children.find((c) => c.role === "value");
                  if (initValNode !== undefined) {
                    this.transferTaint(initValNode, restDef.id, scope, filePath, state, captures);
                  }
                }
              } else if (initChild.type === "SpreadElement") {
                const spreadArg = initChild.children.find((c) => c.role === "argument") ?? initChild;
                this.transferTaint(spreadArg, restDef.id, scope, filePath, state, captures);
              }
            }
          }
        }
      } else {
        for (const child of pattern.children) {
          if (child.type === "ObjectProperty" || child.role === "properties") {
            const valChild = child.children.find((c) => c.role === "value");
            const keyChild = child.children.find((c) => c.role === "key") ?? child.children.find((c) => c.type === "Identifier");
            const target = valChild ?? keyChild;
            if (target !== undefined) {
              this.bindDestructuringPattern(target, init, kind, declarationOrAssignmentNode, scope, filePath, state, captures, declarationOwner);
            }
          } else if (child.type === "RestElement") {
            this.bindDestructuringPattern(child, init, kind, declarationOrAssignmentNode, scope, filePath, state, captures, declarationOwner);
          }
        }
      }
      return;
    }

    if (pattern.type === "ArrayPattern") {
      const patternElements = pattern.children.filter((c) => c.role === "elements");
      if (init !== undefined && init.type === "ArrayExpression") {
        const initElements = init.children.filter((c) => c.role === "elements");
        for (let i = 0; i < patternElements.length; i++) {
          const elem = patternElements[i]!;
          if (elem.type === "ArrayHole") continue;
          if (elem.type === "RestElement") {
            const restArg = elem.children.find((c) => c.role === "argument");
            const restName = identifierName(restArg) ?? memberPath(restArg);
            if (restName !== undefined) {
              const restDef = this.define(restName, kind, declarationOrAssignmentNode, scope, filePath, state, undefined, true, declarationOwner);
              for (let j = i; j < initElements.length; j++) {
                const initElem = initElements[j]!;
                if (initElem.type !== "ArrayHole") {
                  this.transferTaint(initElem, restDef.id, scope, filePath, state, captures);
                }
              }
            }
            break;
          }
          const matchedInit = initElements[i];
          this.bindDestructuringPattern(elem, matchedInit, kind, declarationOrAssignmentNode, scope, filePath, state, captures, declarationOwner);
        }
      } else {
        for (const elem of patternElements) {
          if (elem.type === "ArrayHole") continue;
          this.bindDestructuringPattern(elem, init, kind, declarationOrAssignmentNode, scope, filePath, state, captures, declarationOwner);
        }
      }
      return;
    }
  }

  private call(node: ASTNode, scope: Scope, filePath: string, state: FlowState, receiverDefinitionId?: string, staged = false): void {
    const callee = node.children.find((child) => child.role === "callee"); const name = memberPath(callee) ?? identifierName(callee);
    const argumentsNodes = node.children.filter((child) => child.role === "arguments");
    // Capture the member receiver before argument side effects. This is the existing
    // conservative unknown-call dependency policy, not a use of the method name.
    const object = callee?.type === "MemberExpression" ? callee.children.find((child) => child.role === "object") : undefined;
    const receiverValue: OrderedExpressionValue = { kind: "combined", values: staged && object !== undefined ? [
      ...this.collectDefinitions(object, scope, filePath, state).map((definition): OrderedExpressionValue => ({ kind: "definition", id: definition.id })),
      ...this.collectSources(object, filePath, state).map((id): OrderedExpressionValue => ({ kind: "source", id })),
    ] : [] };
    const values: OrderedExpressionValue[] = [];
    for (const argument of argumentsNodes) {
      if (staged) values.push(this.evaluateOrderedExpression(argument, scope, filePath, state));
      else this.visit(argument, scope, filePath, state);
    }
    this.bindArrayCallback(callee, argumentsNodes, scope, filePath, state);
    const proven = node.location === undefined ? undefined : state.provenTargets.get(callLocationKey(filePath, node.location.start));
    const resolved = state.hasSemanticResolution ? (proven === undefined ? undefined : state.functionsBySymbolId.get(proven.targetSymbolId)) : resolveFunction(name, state.resolvableFunctions);
    const callPosition = node.location === undefined ? `anon-${state.pendingCalls.length}` : `${node.location.start.line}:${node.location.start.column}`;
    const cut = staged && this.policy.isSanitizer(node);
    // A proven target in another file returns its value only through a receiver; connectDataFlow wires it.
    let receiver = receiverDefinitionId;
    if (receiver === undefined && !cut && proven !== undefined && resolved === undefined && state.hasSemanticResolution
      && !this.localSymbolIds.has(proven.targetSymbolId) && valueIsUsed(node)) {
      const result = this.define(`<result:${name ?? "<computed>"}>`, "call-result", node, scope, filePath, state, undefined, false);
      this.callResults.set(node, result);
      receiver = result.id;
    }
    if (resolved !== undefined || proven !== undefined) state.pendingCalls.push({ id: proven?.callId ?? this.identify(hash(`call:${filePath}:${name}:${callPosition}`), "call", name ?? "<computed>", node, "flow-call").id, ...(proven === undefined ? {} : { targetSymbolId: proven.targetSymbolId }), ...(resolved === undefined ? {} : { callee: resolved }), argumentDefinitionIds: staged ? values.map((value) => this.orderedValueIds(value, "definition")[0]) : argumentsNodes.map((argument) => this.definitionFor(argument, scope)?.id), argumentSourceIds: staged ? values.map((value) => this.orderedValueIds(value, "source")[0]) : argumentsNodes.map((argument) => this.source(argument, filePath)), ...(receiver === undefined || cut ? {} : { receiverDefinitionId: receiver }), ...(staged ? { argumentValues: values } : {}) });
    // A sanitizer's result carries its inputs, marked sanitized (XA-01).
    if (staged && receiverDefinitionId !== undefined && cut) this.materializeOrderedValue({ kind: "combined", values: [receiverValue, ...values] }, receiverDefinitionId, state, true);
    if (staged && receiverDefinitionId !== undefined && !cut) {
      const calleeSource = callee === undefined ? undefined : this.source(callee, filePath);
      if (calleeSource !== undefined) this.materializeOrderedValue({ kind: "source", id: calleeSource }, receiverDefinitionId, state);
      else if (resolved === undefined && proven === undefined) this.materializeOrderedValue({ kind: "combined", values: [receiverValue, ...values] }, receiverDefinitionId, state);
      // Resolved return-to-receiver evidence is attached by connectCalls().
    }
    const sinkName = this.policy.sinkName(node);
    if (sinkName === undefined) return;
    const sinkPosition = node.location === undefined ? `anon-${state.sinks.length}` : `${node.location.start.line}:${node.location.start.column}`;
    const sinkId = this.identify(hash(`sink:${filePath}:${sinkName}:${sinkPosition}`), "sink", sinkName, node, "sink").id;
    // A sink judged on some arguments only (a file call on its path, a request on its URL) ignores the rest (NA-03b).
    const judged = this.policy.sinkArguments(node);
    const counts = (index: number): boolean => judged === undefined || judged.includes(index);
    state.sinks.push({ id: sinkId, name: sinkName, argumentDefinitionIds: staged
      ? values.flatMap((value, index) => (counts(index) ? this.orderedValueIds(value, "definition") : []))
      : argumentsNodes.flatMap((argument, index) => (counts(index) ? this.collectDefinitions(argument, scope, filePath, state).map((definition) => definition.id) : [])) });
  }

  /**
   * `xs.forEach((v) => …)` and the other Array callback methods pass the receiver's elements to an inline callback:
   * the receiver's values flow into the element parameter (NA-03d). Only these builtin method names, and only an
   * inline function, so no user function is assumed to behave like one.
   */
  private bindArrayCallback(callee: ASTNode | undefined, argumentsNodes: readonly ASTNode[], scope: Scope, filePath: string, state: FlowState): void {
    if (callee?.type !== "MemberExpression" || callee.attributes.computed === true) return;
    const slot = ARRAY_CALLBACK_ELEMENT_SLOT.get(identifierName(callee.children.find((child) => child.role === "property")) ?? "");
    const receiver = callee.children.find((child) => child.role === "object");
    const callback = argumentsNodes[0];
    if (slot === undefined || receiver === undefined || callback === undefined) return;
    if (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression") return;
    for (const parameter of this.parameterSlots.get(callback)?.[slot] ?? []) this.transferTaint(receiver, parameter.id, scope, filePath, state);
  }

  private definitionFor(node: ASTNode, scope: Scope): VariableDefinition | undefined {
    if (node.type === "ObjectExpression" || node.type === "ArrayExpression") return undefined;
    // Only a cross-file call result has its own definition; other calls keep the name-based lookup below.
    const callResult = node.type === "CallExpression" ? this.callResults.get(node) : undefined;
    if (callResult !== undefined) return callResult;
    if (node.type === "ObjectProperty") {
      const value = node.children.find((child) => child.role === "value");
      return value !== undefined ? this.definitionFor(value, scope) : undefined;
    }
    for (const name of [identifierName(node), memberPath(node), memberBase(node)]) {
      if (name === undefined) continue;
      const definition = resolve(scope, name);
      if (definition !== undefined) return definition;
    }
    for (const child of node.children) {
      const definition = this.definitionFor(child, scope);
      if (definition !== undefined) return definition;
    }
    return undefined;
  }
  private connectCalls(state: FlowState): void {
    for (const call of state.pendingCalls.sort(byId)) {
      for (const [index, argumentDefinitionId] of call.argumentDefinitionIds.entries()) {
        const slot = call.callee?.parameters[index];
        if (slot !== undefined) {
          for (const parameter of slot) {
            const captured = call.argumentValues?.[index];
            if (captured !== undefined) {
              for (const definitionId of this.orderedValueIds(captured, "definition")) {
                this.addInterproceduralFlow(state, call.id, "argument-to-parameter", definitionId, parameter.id);
              }
              for (const sourceId of this.orderedValueIds(captured, "source")) {
                this.setTaintPath(state, parameter.id, sourceId, [sourceId, parameter.id]);
              }
            } else {
              if (argumentDefinitionId !== undefined) this.addInterproceduralFlow(state, call.id, "argument-to-parameter", argumentDefinitionId, parameter.id);
              const sourceId = call.argumentSourceIds[index];
              if (sourceId !== undefined) this.setTaintPath(state, parameter.id, sourceId, [sourceId, parameter.id]);
            }
          }
        }
      }
      if (call.receiverDefinitionId !== undefined) for (const returned of call.callee?.returns ?? []) this.addInterproceduralFlow(state, call.id, "return-to-receiver", returned.id, call.receiverDefinitionId);
    }
    for (const flow of state.interproceduralFlows) this.addTransfer(state, flow.sourceDefinitionId, flow.targetDefinitionId);
  }
  private addInterproceduralFlow(state: FlowState, callId: string, kind: InterproceduralFlow["kind"], sourceDefinitionId: string, targetDefinitionId: string): void { state.interproceduralFlows.push({ id: hash(`interprocedural:${callId}:${kind}:${sourceDefinitionId}:${targetDefinitionId}`), callId, kind, sourceDefinitionId, targetDefinitionId }); }
  private addTransfer(state: FlowState, sourceDefinitionId: string, targetDefinitionId: string, sanitizes = false): void {
    if (sourceDefinitionId === targetDefinitionId) return;
    // Constant-time dedupe per build; a linear scan made the stage quadratic (BA-28).
    let keys = this.transferKeys.get(state.transfers);
    if (keys === undefined) {
      keys = new Set(state.transfers.map((transfer) => `${transfer.sourceDefinitionId}\u0000${transfer.targetDefinitionId}${transfer.sanitizes === true ? "\u0000s" : ""}`));
      this.transferKeys.set(state.transfers, keys);
    }
    const key = `${sourceDefinitionId}\u0000${targetDefinitionId}${sanitizes ? "\u0000s" : ""}`;
    if (keys.has(key)) return;
    keys.add(key);
    state.transfers.push(sanitizes ? { sourceDefinitionId, targetDefinitionId, sanitizes: true } : { sourceDefinitionId, targetDefinitionId });
  }

  private transferTaint(node: ASTNode, targetDefinitionId: string, scope: Scope, filePath: string, state: FlowState, captures?: ReadonlyMap<ASTNode, OrderedExpressionValue>): void {
    const captured = captures?.get(node);
    if (captured !== undefined) {
      this.materializeOrderedValue(captured, targetDefinitionId, state);
      return;
    }
    const sources = this.collectSources(node, filePath, state);
    for (const sourceId of sources) {
      this.setTaintPath(state, targetDefinitionId, sourceId, [sourceId, targetDefinitionId]);
    }
    const definitions = this.collectDefinitions(node, scope, filePath, state);
    for (const definition of definitions) {
      this.addTransfer(state, definition.id, targetDefinitionId);
    }
  }

  private collectSources(node: ASTNode, filePath: string, state: FlowState): readonly string[] {
    const results: string[] = [];
    const visit = (current: ASTNode): void => {
      if (this.policy.isSanitizer(current)) return;
      const direct = this.source(current, filePath);
      if (direct !== undefined) {
        results.push(direct);
        return;
      }
      if (current.type === "ObjectProperty") {
        const computed = current.attributes.computed === true;
        const key = current.children.find((child) => child.role === "key");
        if (computed && key !== undefined) visit(key);
        const value = current.children.find((child) => child.role === "value");
        if (value !== undefined) visit(value);
        return;
      }
      if (current.type === "CallExpression") {
        const callee = current.children.find((child) => child.role === "callee");
        if (callee !== undefined) {
          const calleeSource = this.source(callee, filePath);
          if (calleeSource !== undefined) {
            results.push(calleeSource);
            return;
          }
        }
        const name = memberPath(callee) ?? identifierName(callee);
        const proven = current.location === undefined ? undefined : state.provenTargets.get(callLocationKey(filePath, current.location.start));
        const resolved = state.hasSemanticResolution ? (proven === undefined ? undefined : state.functionsBySymbolId.get(proven.targetSymbolId)) : resolveFunction(name, state.resolvableFunctions);
        if (resolved !== undefined || proven !== undefined) {
          return;
        }
        if (callee?.type === "MemberExpression") {
          const objectNode = callee.children.find((child) => child.role === "object");
          if (objectNode !== undefined) visit(objectNode);
        }
        for (const argument of current.children.filter((child) => child.role === "arguments")) {
          visit(argument);
        }
        return;
      }
      for (const child of current.children) {
        visit(child);
      }
    };
    visit(node);
    return immutable([...new Set(results)].sort());
  }

  /**
   * The value of a sanitizer call (XA-01): one definition per call that holds its inputs' sources and
   * definitions marked sanitized, so the taint still reaches every sink the sanitizer does not protect.
   * It is wired the first time the call's value is read, where the inputs' bindings are the ones in force.
   */
  private sanitizedResult(node: ASTNode, scope: Scope, filePath: string, state: FlowState): VariableDefinition {
    const existing = this.sanitizedResults.get(node);
    if (existing !== undefined) return existing;
    const callee = node.children.find((child) => child.role === "callee");
    const result = this.define(`<sanitized:${memberPath(callee) ?? identifierName(callee) ?? "<computed>"}>`, "call-result", node, scope, filePath, state, undefined, false);
    this.sanitizedResults.set(node, result);
    const inputs = [
      ...(callee?.type === "MemberExpression" ? callee.children.filter((child) => child.role === "object") : []),
      ...node.children.filter((child) => child.role === "arguments"),
    ];
    for (const input of inputs) {
      for (const sourceId of this.collectSources(input, filePath, state)) {
        const marked = sanitizedSourceId(sourceId);
        this.setTaintPath(state, result.id, marked, [marked, result.id]);
      }
      for (const definition of this.collectDefinitions(input, scope, filePath, state)) this.addTransfer(state, definition.id, result.id, true);
    }
    return result;
  }

  private collectDefinitions(node: ASTNode, scope: Scope, filePath: string, state: FlowState): readonly VariableDefinition[] {
    const definitions: VariableDefinition[] = [];
    const visit = (current: ASTNode): void => {
      if (this.policy.isSanitizer(current)) {
        definitions.push(this.sanitizedResult(current, scope, filePath, state));
        return;
      }
      if (this.source(current, filePath) !== undefined) return;
      if (current.type === "ObjectProperty") {
        const computed = current.attributes.computed === true;
        const key = current.children.find((child) => child.role === "key");
        if (computed && key !== undefined) visit(key);
        const value = current.children.find((child) => child.role === "value");
        if (value !== undefined) visit(value);
        return;
      }
      if (current.type === "CallExpression") {
        const callee = current.children.find((child) => child.role === "callee");
        if (callee !== undefined && this.source(callee, filePath) !== undefined) return;
        const name = memberPath(callee) ?? identifierName(callee);
        const proven = current.location === undefined ? undefined : state.provenTargets.get(callLocationKey(filePath, current.location.start));
        const resolved = state.hasSemanticResolution ? (proven === undefined ? undefined : state.functionsBySymbolId.get(proven.targetSymbolId)) : resolveFunction(name, state.resolvableFunctions);
        if (resolved !== undefined || proven !== undefined) {
          const targetRecord = state.hasSemanticResolution && proven !== undefined ? state.functionsBySymbolId.get(proven.targetSymbolId) : resolved;
          for (const returned of targetRecord?.returns ?? []) {
            definitions.push(returned);
          }
          const result = this.callResults.get(current);
          if (result !== undefined) definitions.push(result);
          return;
        }
        if (callee?.type === "MemberExpression") {
          const objectNode = callee.children.find((child) => child.role === "object");
          if (objectNode !== undefined) visit(objectNode);
        }
        for (const argument of current.children.filter((child) => child.role === "arguments")) {
          visit(argument);
        }
        return;
      }
      for (const name of [identifierName(current), memberPath(current), memberBase(current)]) {
        if (name === undefined) continue;
        const definition = resolve(scope, name);
        if (definition !== undefined) {
          definitions.push(definition);
          return;
        }
      }
      for (const child of current.children) {
        visit(child);
      }
    };
    visit(node);
    const seen = new Set<string>();
    const unique: VariableDefinition[] = [];
    for (const def of definitions) {
      if (!seen.has(def.id)) {
        seen.add(def.id);
        unique.push(def);
      }
    }
    return immutable(unique.sort(byId));
  }

  private propagateTaint(state: FlowState): void {
    // The connection state exposes transfers in this order.
    const sorted = sortByKey(state.transfers, (transfer) => `${transfer.sourceDefinitionId}:${transfer.targetDefinitionId}`);
    for (const [index, transfer] of sorted.entries()) state.transfers[index] = transfer;
    propagateTaintPaths(state.transfers, state.taintPaths);
  }

  private setTaintPath(state: FlowState, definitionId: string, sourceId: string, path: readonly string[]): boolean {
    return setTaintPath(state.taintPaths, definitionId, sourceId, path);
  }

  private taintFlows(state: FlowState): readonly TaintFlow[] {
    return this.computeTaintFlows(this.connectionState(state), state.taintPaths);
  }

  private memberUse(node: ASTNode, scope: Scope, filePath: string, state: FlowState): void { const path = memberPath(node); if (path !== undefined) this.use(path, node, scope, filePath, state); const base = memberBase(node); if (base !== undefined && base !== path) this.use(base, node, scope, filePath, state); }
  private use(name: string | undefined, node: ASTNode, scope: Scope, filePath: string, state: FlowState): void { if (name === undefined) return; const definition = resolve(scope, name); const position = node.location === undefined ? `anon-${state.uses.length}` : `${node.location.start.line}:${node.location.start.column}`; state.uses.push({ ...this.identify(hash(`use:${filePath}:${name}:${position}`), "use", name, node, "use"), filePath, name, ...(definition === undefined ? {} : { definitionId: definition.id }) }); }
  private declarationOwner(scope: Scope, kind: unknown): Scope {
    if (kind !== "var") return scope;
    let owner = scope;
    while (owner.parent !== undefined && !this.functionScopes.has(owner)) owner = owner.parent;
    return owner;
  }

  private publishDefinition(scope: Scope, definition: VariableDefinition, declarationOwner: Scope = scope): void {
    let owner = declarationOwner;
    if (definition.kind === "assignment") {
      // Unresolved writes retain the local fallback; reads still resolve lexically.
      owner = bindingOwner(scope, definition.name) ?? scope;
      const executionOwner = this.declarationOwner(scope, "var");
      if (this.declarationOwner(owner, "var") !== executionOwner) {
        // Analyzing a function is not executing it. Keep captured-binding writes
        // in this function's environment, without changing the ancestor's live map.
        const entry = owner.definitions.get(definition.name);
        if (entry !== undefined) {
          const entries = this.capturedEntries.get(executionOwner) ?? new Map<string, VariableDefinition>();
          entries.set(definition.name, entry);
          this.capturedEntries.set(executionOwner, entries);
        }
        owner = executionOwner;
      }
    }
    owner.definitions.set(definition.name, definition);
  }

  private define(name: string, kind: VariableDefinition["kind"], node: ASTNode, scope: Scope, filePath: string, state: FlowState, constantValue: string | number | boolean | null | undefined, publish = true, declarationOwner: Scope = scope): VariableDefinition { const position = node.location === undefined ? `anon-${state.definitions.length}` : `${node.location.start.line}:${node.location.start.column}`; const definition: VariableDefinition = { ...this.identify(hash(`definition:${filePath}:${name}:${kind}:${position}`), "def", `${name}:${kind}`, node, "definition"), filePath, name, kind, ...(constantValue === undefined ? {} : { constantValue }) }; if (publish) this.publishDefinition(scope, definition, declarationOwner); state.definitions.push(definition); return definition; }
  /** Source id of a source the file policy recognizes; the written path stays in the id, so existing ids are stable. */
  private source(node: ASTNode, filePath: string): string | undefined {
    const canonical = this.policy.sourcePath(node);
    if (canonical === undefined) return undefined;
    const written = node.type === "CallExpression" ? `${memberPath(node.children.find((child) => child.role === "callee")) ?? canonical}()` : memberPath(node) ?? canonical;
    const position = node.location === undefined ? "anon" : `${node.location.start.line}:${node.location.start.column}`;
    return this.identify(hash(`source:${filePath}:${written}:${position}`), "source", written, node, "source").id;
  }
}

/**
 * A branch's view of a scope frame: reads fall through to the frame, writes stay in the branch, and
 * its own keys are exactly the names the branch defined. Replaces a full copy of every frame (the
 * whole module scope included) at each `if`, which made the stage quadratic (BA-28).
 */
class BranchDefinitions extends Map<string, VariableDefinition> {
  public constructor(private readonly base: ReadonlyMap<string, VariableDefinition>) { super(); }
  public override get(name: string): VariableDefinition | undefined { return super.has(name) ? super.get(name) : this.base.get(name); }
  public override has(name: string): boolean { return super.has(name) || this.base.has(name); }
}

function createScope(parent?: Scope): Scope { return { parent, definitions: new Map() }; }
function collectFunctions(root: ASTNode, symbols: readonly CodeSymbol[]): Map<ASTNode, FunctionRecord> { const records = new Map<ASTNode, FunctionRecord>(); const callables = new Map<string, CodeSymbol[]>(); for (const candidate of symbols) if (candidate.kind === "function" || candidate.kind === "method") callables.set(candidate.name, [...(callables.get(candidate.name) ?? []), candidate]); const visit = (node: ASTNode): void => { if (isFunction(node)) { const name = functionName(node); if (name !== undefined) { const symbol = (callables.get(name) ?? []).filter((candidate) => sameLocation(candidate.location, node.location)); records.set(node, { name, parameters: [], returns: [], ...(symbol.length === 1 && symbol[0] !== undefined ? { symbolId: symbol[0].id } : {}) }); } } for (const child of node.children) visit(child); }; visit(root); return records; }
function resolveFunction(name: string | undefined, functions: ReadonlyMap<string, FunctionRecord>): FunctionRecord | undefined { if (name === undefined) return undefined; const direct = functions.get(name); if (direct !== undefined) return direct; const property = name.split(".").at(-1); return property === undefined ? undefined : functions.get(property); }
function bindingOwner(scope: Scope | undefined, name: string): Scope | undefined {
  for (let current = scope; current !== undefined; current = current.parent) {
    if (current.definitions.has(name)) return current;
  }
  return undefined;
}
function resolve(scope: Scope | undefined, name: string): VariableDefinition | undefined { return bindingOwner(scope, name)?.definitions.get(name); }
function isFunction(node: ASTNode): boolean { return ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassMethod", "ClassPrivateMethod", "ObjectMethod"].includes(node.type); }
function functionName(node: ASTNode): string | undefined { return identifierName(node.children.find((child) => child.role === "id" || child.role === "key")); }
function identifierName(node: ASTNode | undefined): string | undefined { const value = node?.attributes.name; return typeof value === "string" && value.length > 0 ? value : undefined; }
function memberPath(node: ASTNode | undefined): string | undefined { if (node?.type !== "MemberExpression") return undefined; const object = memberPath(node.children.find((child) => child.role === "object")) ?? identifierName(node.children.find((child) => child.role === "object")); const property = identifierName(node.children.find((child) => child.role === "property")) ?? stringValue(node.children.find((child) => child.role === "property")); return object === undefined || property === undefined ? undefined : `${object}.${property}`; }
function memberBase(node: ASTNode | undefined): string | undefined { if (node?.type !== "MemberExpression") return undefined; const object = node.children.find((child) => child.role === "object"); return identifierName(object) ?? memberBase(object); }
function literalValue(node: ASTNode | undefined): string | number | boolean | null | undefined { const value = node?.attributes.value; return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null ? value : undefined; }
function stringValue(node: ASTNode | undefined): string | undefined { return typeof node?.attributes.value === "string" ? node.attributes.value : undefined; }
function byId<T extends { readonly id: string }>(left: T, right: T): number { return compareCodePoints(left.id, right.id); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function callLocationKey(filePath: string, location: { readonly line: number; readonly column: number }): string { return `${filePath}:${location.line}:${location.column}`; }
function sameLocation(symbolLocation: CodeSymbol["location"] | undefined, nodeLocation: ASTNode["location"] | undefined): boolean { return symbolLocation !== undefined && nodeLocation !== undefined && symbolLocation.start.line === nodeLocation.start.line && symbolLocation.start.column === nodeLocation.start.column; }
function functionSummaries(state: FlowState, filePath: string): readonly FunctionFlowSummary[] { return [...state.functions.values()].flatMap((record) => record.symbolId === undefined ? [] : [{ symbolId: record.symbolId, filePath, parameterDefinitionIds: record.parameters.map((slot) => slot.map((definition) => definition.id)), returnDefinitionIds: record.returns.map((definition) => definition.id) }]).sort((left, right) => compareCodePoints(left.symbolId, right.symbolId)); }
function callBindings(state: FlowState): readonly CallFlowBinding[] { return state.pendingCalls.flatMap((call) => call.targetSymbolId === undefined ? [] : [{ callId: call.id, targetSymbolId: call.targetSymbolId, argumentDefinitionIds: call.argumentDefinitionIds, ...(call.receiverDefinitionId === undefined ? {} : { receiverDefinitionId: call.receiverDefinitionId }), ...(call.argumentSourceIds.some((sourceId) => sourceId !== undefined) ? { argumentSourceIds: call.argumentSourceIds } : {}) }]).sort((left, right) => compareCodePoints(left.callId, right.callId)); }

function extractBoundNames(node: ASTNode | undefined): readonly string[] {
  if (!node) return [];
  switch (node.type) {
    case "Identifier": {
      const name = identifierName(node);
      return name !== undefined ? [name] : [];
    }
    case "MemberExpression": {
      const path = memberPath(node);
      return path !== undefined ? [path] : [];
    }
    case "AssignmentPattern": {
      const left = node.children.find((c) => c.role === "left");
      return extractBoundNames(left);
    }
    case "RestElement": {
      const argument = node.children.find((c) => c.role === "argument");
      return extractBoundNames(argument);
    }
    case "ObjectPattern": {
      return node.children.flatMap((child) => {
        if (child.type === "ObjectProperty" || child.role === "properties") {
          const valChild = child.children.find((c) => c.role === "value");
          if (valChild !== undefined) {
            return extractBoundNames(valChild);
          }
          const keyChild = child.children.find((c) => c.role === "key") ?? child.children.find((c) => c.type === "Identifier");
          return extractBoundNames(keyChild);
        }
        if (child.type === "RestElement") {
          return extractBoundNames(child);
        }
        return [];
      });
    }
    case "ArrayPattern": {
      return node.children.filter((c) => c.role === "elements").flatMap(extractBoundNames);
    }
    default:
      return [];
  }
}

interface PatternDefault {
  readonly boundNames: readonly string[];
  readonly defaultNode: ASTNode;
}

function extractPatternDefaults(node: ASTNode | undefined): readonly PatternDefault[] {
  if (!node) return [];
  const results: PatternDefault[] = [];

  const visit = (current: ASTNode): void => {
    if (current.type === "AssignmentPattern") {
      const left = current.children.find((c) => c.role === "left");
      const right = current.children.find((c) => c.role === "right");
      const boundNames = extractBoundNames(left);
      if (right !== undefined && boundNames.length > 0) {
        results.push({ boundNames, defaultNode: right });
      }
      if (left !== undefined) {
        visit(left);
      }
      return;
    }

    if (current.type === "ObjectPattern") {
      for (const child of current.children) {
        if (child.type === "ObjectProperty" || child.role === "properties") {
          const valChild = child.children.find((c) => c.role === "value");
          if (valChild !== undefined) {
            visit(valChild);
          } else {
            const keyChild = child.children.find((c) => c.role === "key") ?? child.children.find((c) => c.type === "Identifier");
            if (keyChild !== undefined) visit(keyChild);
          }
        } else if (child.type === "RestElement") {
          visit(child);
        }
      }
      return;
    }

    if (current.type === "ArrayPattern") {
      for (const child of current.children.filter((c) => c.role === "elements")) {
        visit(child);
      }
      return;
    }

    if (current.type === "RestElement") {
      const argument = current.children.find((c) => c.role === "argument");
      if (argument !== undefined) visit(argument);
      return;
    }
  };

  visit(node);
  return results;
}

function isStaticallyDefinedLiteral(node: ASTNode | undefined): boolean {
  if (node === undefined) return false;
  if (node.type === "ArrayHole") return false;
  if (node.type === "Identifier" && node.attributes.name === "undefined") return false;
  return (
    [
      "StringLiteral",
      "NumericLiteral",
      "BooleanLiteral",
      "NullLiteral",
      "ObjectExpression",
      "ArrayExpression",
      "RegExpLiteral",
      "TemplateLiteral",
    ].includes(node.type) ||
    (literalValue(node) !== undefined && literalValue(node) !== null)
  );
}

/** The call's value is consumed: an argument, a member's object, or returned, awaited or spread (NA-03). */
function valueIsUsed(node: ASTNode): boolean {
  return node.role === "arguments" || node.role === "object" || node.role === "argument";
}

/** Array methods whose first argument is called with each element, and that element's parameter position (NA-03d). */
const ARRAY_CALLBACK_ELEMENT_SLOT: ReadonlyMap<string, number> = new Map([
  ...["forEach", "map", "filter", "find", "findIndex", "findLast", "findLastIndex", "some", "every", "flatMap"].map((name) => [name, 0] as const),
  ["reduce", 1], ["reduceRight", 1],
]);

/** The innermost object of a member chain (`f()` in `f().a.b`). */
function memberRoot(node: ASTNode): ASTNode | undefined {
  let current: ASTNode | undefined = node;
  while (current?.type === "MemberExpression" || current?.type === "OptionalMemberExpression") current = current.children.find((child) => child.role === "object");
  return current;
}
