import { createHash } from "node:crypto";
import type { ASTNode, ASTResult } from "@parser/index";
import type { CodeSymbol } from "@symbols/index";
import { createDataFlowGraph, createProvenCallTargets, type CallFlowBinding, type DataFlowGraph, type FunctionFlowSummary, type InterproceduralFlow, type ProvenCallTarget, type TaintFlow, type VariableDefinition, type VariableUse } from "./flow-contracts";

export interface Scope { readonly parent?: Scope; readonly definitions: Map<string, VariableDefinition>; }
export interface FunctionRecord { readonly name: string; readonly node: ASTNode; readonly parameters: VariableDefinition[][]; readonly returns: VariableDefinition[]; readonly symbolId?: string; }
export interface PendingCall { readonly id: string; readonly targetSymbolId?: string; readonly callee?: FunctionRecord; readonly argumentDefinitionIds: readonly (string | undefined)[]; readonly argumentSourceIds: readonly (string | undefined)[]; readonly receiverDefinitionId?: string; }
export interface TaintTransfer { readonly sourceDefinitionId: string; readonly targetDefinitionId: string; }
export interface PendingSink { readonly id: string; readonly name: string; readonly argumentDefinitionIds: readonly string[]; }
export interface FlowState { readonly definitions: VariableDefinition[]; readonly uses: VariableUse[]; readonly taintPaths: Map<string, Map<string, readonly string[]>>; readonly transfers: TaintTransfer[]; readonly sinks: PendingSink[]; readonly functions: Map<ASTNode, FunctionRecord>; readonly resolvableFunctions: Map<string, FunctionRecord>; readonly functionsBySymbolId: Map<string, FunctionRecord>; readonly provenTargets: ReadonlyMap<string, ProvenCallTarget>; readonly hasSemanticResolution: boolean; readonly pendingCalls: PendingCall[]; readonly interproceduralFlows: InterproceduralFlow[]; }

export interface BuildContextResult {
  readonly graph: DataFlowGraph;
  readonly state: FlowState;
}

const sources = new Set(["process.env", "req.body", "req.params", "req.query"]);
const sinks = new Set(["child_process.exec", "res.send", "res.json"]);
const sanitizers = new Set(["validator.escape", "sanitize"]);

export class DeterministicDataFlowGraphBuilder {
  public buildContext(ast: ASTResult, provenCallTargets?: readonly ProvenCallTarget[], symbols: readonly CodeSymbol[] = []): BuildContextResult {
    const functions = collectFunctions(ast.root, symbols);
    const targets = provenCallTargets === undefined ? undefined : createProvenCallTargets(provenCallTargets);
    const state: FlowState = { definitions: [], uses: [], taintPaths: new Map(), transfers: [], sinks: [], functions, resolvableFunctions: new Map(), functionsBySymbolId: new Map(), provenTargets: new Map((targets ?? []).map((target) => [callLocationKey(target.sourceFilePath, target.location), target])), hasSemanticResolution: targets !== undefined, pendingCalls: [], interproceduralFlows: [] };
    for (const record of state.functions.values()) if (record.name.length > 0 && [...state.functions.values()].filter((candidate) => candidate.name === record.name).length === 1) state.resolvableFunctions.set(record.name, record);
    for (const record of state.functions.values()) if (record.symbolId !== undefined) state.functionsBySymbolId.set(record.symbolId, record);
    this.visit(ast.root, createScope(), ast.metadata.sourcePath, state);
    this.connectCalls(state);
    this.propagateTaint(state);
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
    return { graph, state };
  }

  public build(ast: ASTResult, provenCallTargets?: readonly ProvenCallTarget[], symbols: readonly CodeSymbol[] = []): DataFlowGraph {
    return this.buildContext(ast, provenCallTargets, symbols).graph;
  }

  public computeTaintFlows(state: FlowState, taintPaths: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>): readonly TaintFlow[] {
    const flows = state.sinks.flatMap((sink) =>
      sink.argumentDefinitionIds.flatMap((definitionId) =>
        [...(taintPaths.get(definitionId)?.entries() ?? [])].map(([sourceId, path]) => ({
          sourceId,
          sinkId: sink.id,
          path: Object.freeze([...path, sink.name]),
          state: "CONFIRMED" as const,
        })),
      ),
    );
    return Object.freeze(
      [...new Map(flows.map((flow) => [`${flow.sourceId}:${flow.sinkId}`, flow])).values()].sort((left, right) =>
        `${left.sourceId}:${left.sinkId}`.localeCompare(`${right.sourceId}:${right.sinkId}`),
      ),
    );
  }

  private visit(node: ASTNode, scope: Scope, filePath: string, state: FlowState, currentFunction?: FunctionRecord, receiverDefinitionId?: string): void {
    if (node.type === "Program") { for (const child of node.children) this.visit(child, scope, filePath, state, currentFunction); return; }
    if (node.type === "BlockStatement") { const childScope = createScope(scope); for (const child of node.children) this.visit(child, childScope, filePath, state, currentFunction); return; }
    if (node.type === "VariableDeclaration") { for (const child of node.children.filter((candidate) => candidate.role === "declarations")) this.declarator(child, scope, filePath, state); return; }
    if (isFunction(node)) { this.function(node, scope, filePath, state); return; }
    if (node.type === "ReturnStatement") { this.returnValue(node, scope, filePath, state, currentFunction); return; }
    if (node.type === "AssignmentExpression") { this.assignment(node, scope, filePath, state, currentFunction); return; }
    if (node.type === "CallExpression") { this.call(node, scope, filePath, state, receiverDefinitionId); return; }
    if (node.type === "MemberExpression") { this.memberUse(node, scope, filePath, state); return; }
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

  private declarator(node: ASTNode, scope: Scope, filePath: string, state: FlowState): void {
    const id = node.children.find((child) => child.role === "id");
    const singleName = identifierName(id);
    const boundNames = singleName !== undefined ? [singleName] : extractBoundNames(id);
    if (boundNames.length === 0) return;
    const init = node.children.find((child) => child.role === "init");
    const initVal = singleName !== undefined ? literalValue(init) : undefined;
    if (singleName !== undefined) {
      const definition = this.define(singleName, "declaration", node, scope, filePath, state, initVal);
      if (init !== undefined) this.transferTaint(init, definition.id, scope, filePath, state);
    } else if (id !== undefined) {
      this.bindDestructuringPattern(id, init, "declaration", node, scope, filePath, state);
    }
    if (init !== undefined) {
      const primaryDefId = boundNames.length === 1 ? scope.definitions.get(boundNames[0]!)?.id : undefined;
      this.visit(init, scope, filePath, state, undefined, primaryDefId);
    }
    for (const { boundNames: defaultBoundNames, defaultNode } of extractPatternDefaults(id)) {
      const primaryDefId = defaultBoundNames.length === 1 ? scope.definitions.get(defaultBoundNames[0]!)?.id : undefined;
      this.visit(defaultNode, scope, filePath, state, undefined, primaryDefId);
    }
  }

  private function(node: ASTNode, scope: Scope, filePath: string, state: FlowState): void {
    const name = identifierName(node.children.find((child) => child.role === "id"));
    if (name !== undefined) this.define(name, "declaration", node, scope, filePath, state, undefined);
    const record = state.functions.get(node);
    const functionScope = createScope(scope);
    for (const parameter of node.children.filter((child) => child.role === "params")) {
      const paramNames = extractBoundNames(parameter);
      const slotDefinitions: VariableDefinition[] = [];
      for (const parameterName of paramNames) {
        const definition = this.define(parameterName, "parameter", parameter, functionScope, filePath, state, undefined);
        slotDefinitions.push(definition);
      }
      record?.parameters.push(slotDefinitions);
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
      const primaryDefId = boundNames.length === 1 ? scope.definitions.get(boundNames[0]!)?.id : undefined;
      this.visit(right, scope, filePath, state, currentFunction, primaryDefId);
    }
    for (const { boundNames: defaultBoundNames, defaultNode } of extractPatternDefaults(left)) {
      const primaryDefId = defaultBoundNames.length === 1 ? scope.definitions.get(defaultBoundNames[0]!)?.id : undefined;
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
  ): void {
    if (pattern.type === "Identifier") {
      const name = identifierName(pattern);
      if (name === undefined) return;
      const constVal = init !== undefined && init.type !== "ArrayHole" ? literalValue(init) : undefined;
      const definition = this.define(name, kind, declarationOrAssignmentNode, scope, filePath, state, constVal);
      if (init !== undefined && init.type !== "ArrayHole") {
        this.transferTaint(init, definition.id, scope, filePath, state);
      }
      return;
    }

    if (pattern.type === "MemberExpression") {
      const path = memberPath(pattern);
      if (path === undefined) return;
      const constVal = init !== undefined && init.type !== "ArrayHole" ? literalValue(init) : undefined;
      const definition = this.define(path, kind, declarationOrAssignmentNode, scope, filePath, state, constVal);
      if (init !== undefined && init.type !== "ArrayHole") {
        this.transferTaint(init, definition.id, scope, filePath, state);
      }
      return;
    }

    if (pattern.type === "AssignmentPattern") {
      const left = pattern.children.find((c) => c.role === "left");
      const right = pattern.children.find((c) => c.role === "right");
      if (left === undefined) return;
      if (init !== undefined && init.type !== "ArrayHole") {
        if (isStaticallyDefinedLiteral(init)) {
          this.bindDestructuringPattern(left, init, kind, declarationOrAssignmentNode, scope, filePath, state);
        } else {
          this.bindDestructuringPattern(left, init, kind, declarationOrAssignmentNode, scope, filePath, state);
          if (right !== undefined) {
            const boundNames = extractBoundNames(left);
            for (const name of boundNames) {
              const def = scope.definitions.get(name);
              if (def !== undefined) this.transferTaint(right, def.id, scope, filePath, state);
            }
          }
        }
      } else {
        this.bindDestructuringPattern(left, right, kind, declarationOrAssignmentNode, scope, filePath, state);
      }
      return;
    }

    if (pattern.type === "RestElement") {
      const argument = pattern.children.find((c) => c.role === "argument");
      if (argument !== undefined) {
        this.bindDestructuringPattern(argument, init, kind, declarationOrAssignmentNode, scope, filePath, state);
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
              this.bindDestructuringPattern(valNode, initValNode, kind, declarationOrAssignmentNode, scope, filePath, state);
            }
          } else {
            const spreadChild = init.children.find((initChild) => initChild.type === "SpreadElement");
            const spreadSource = spreadChild?.children.find((c) => c.role === "argument") ?? spreadChild;
            if (valNode !== undefined) {
              this.bindDestructuringPattern(valNode, spreadSource, kind, declarationOrAssignmentNode, scope, filePath, state);
            }
          }
        }

        if (restElement !== undefined) {
          const restArg = restElement.children.find((c) => c.role === "argument");
          const restName = identifierName(restArg) ?? memberPath(restArg);
          if (restName !== undefined) {
            const restDef = this.define(restName, kind, declarationOrAssignmentNode, scope, filePath, state, undefined);
            for (const initChild of init.children) {
              if (initChild.type === "ObjectProperty" || initChild.role === "properties") {
                const initKeyNode = initChild.children.find((c) => c.role === "key") ?? initChild.children.find((c) => c.type === "Identifier");
                const initKey = identifierName(initKeyNode) ?? stringValue(initKeyNode);
                if (initKey === undefined || !matchedKeys.has(initKey)) {
                  const initValNode = initChild.children.find((c) => c.role === "value");
                  if (initValNode !== undefined) {
                    this.transferTaint(initValNode, restDef.id, scope, filePath, state);
                  }
                }
              } else if (initChild.type === "SpreadElement") {
                const spreadArg = initChild.children.find((c) => c.role === "argument") ?? initChild;
                this.transferTaint(spreadArg, restDef.id, scope, filePath, state);
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
              this.bindDestructuringPattern(target, init, kind, declarationOrAssignmentNode, scope, filePath, state);
            }
          } else if (child.type === "RestElement") {
            this.bindDestructuringPattern(child, init, kind, declarationOrAssignmentNode, scope, filePath, state);
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
              const restDef = this.define(restName, kind, declarationOrAssignmentNode, scope, filePath, state, undefined);
              for (let j = i; j < initElements.length; j++) {
                const initElem = initElements[j]!;
                if (initElem.type !== "ArrayHole") {
                  this.transferTaint(initElem, restDef.id, scope, filePath, state);
                }
              }
            }
            break;
          }
          const matchedInit = initElements[i];
          this.bindDestructuringPattern(elem, matchedInit, kind, declarationOrAssignmentNode, scope, filePath, state);
        }
      } else {
        for (const elem of patternElements) {
          if (elem.type === "ArrayHole") continue;
          this.bindDestructuringPattern(elem, init, kind, declarationOrAssignmentNode, scope, filePath, state);
        }
      }
      return;
    }
  }

  private call(node: ASTNode, scope: Scope, filePath: string, state: FlowState, receiverDefinitionId?: string): void {
    const callee = node.children.find((child) => child.role === "callee"); const name = memberPath(callee) ?? identifierName(callee);
    const argumentsNodes = node.children.filter((child) => child.role === "arguments"); for (const argument of argumentsNodes) this.visit(argument, scope, filePath, state);
    const proven = node.location === undefined ? undefined : state.provenTargets.get(callLocationKey(filePath, node.location.start));
    const resolved = state.hasSemanticResolution ? (proven === undefined ? undefined : state.functionsBySymbolId.get(proven.targetSymbolId)) : resolveFunction(name, state.resolvableFunctions);
    const callPosition = node.location === undefined ? `anon-${state.pendingCalls.length}` : `${node.location.start.line}:${node.location.start.column}`;
    if (resolved !== undefined || proven !== undefined) state.pendingCalls.push({ id: proven?.callId ?? hash(`call:${filePath}:${name}:${callPosition}`), ...(proven === undefined ? {} : { targetSymbolId: proven.targetSymbolId }), ...(resolved === undefined ? {} : { callee: resolved }), argumentDefinitionIds: argumentsNodes.map((argument) => this.definitionFor(argument, scope)?.id), argumentSourceIds: argumentsNodes.map((argument) => this.source(argument, filePath)), ...(receiverDefinitionId === undefined ? {} : { receiverDefinitionId }) });
    if (name === undefined || !sinks.has(name)) return;
    const sinkPosition = node.location === undefined ? `anon-${state.sinks.length}` : `${node.location.start.line}:${node.location.start.column}`;
    state.sinks.push({ id: hash(`sink:${filePath}:${name}:${sinkPosition}`), name, argumentDefinitionIds: argumentsNodes.flatMap((argument) => this.collectDefinitions(argument, scope, filePath, state).map((definition) => definition.id)) });
  }

  private definitionFor(node: ASTNode, scope: Scope): VariableDefinition | undefined {
    if (node.type === "ObjectExpression" || node.type === "ArrayExpression") return undefined;
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
            if (argumentDefinitionId !== undefined) this.addInterproceduralFlow(state, call.id, "argument-to-parameter", argumentDefinitionId, parameter.id);
            const sourceId = call.argumentSourceIds[index];
            if (sourceId !== undefined) this.setTaintPath(state, parameter.id, sourceId, [sourceId, parameter.id]);
          }
        }
      }
      if (call.receiverDefinitionId !== undefined) for (const returned of call.callee?.returns ?? []) this.addInterproceduralFlow(state, call.id, "return-to-receiver", returned.id, call.receiverDefinitionId);
    }
    for (const flow of state.interproceduralFlows) this.addTransfer(state, flow.sourceDefinitionId, flow.targetDefinitionId);
  }
  private addInterproceduralFlow(state: FlowState, callId: string, kind: InterproceduralFlow["kind"], sourceDefinitionId: string, targetDefinitionId: string): void { state.interproceduralFlows.push({ id: hash(`interprocedural:${callId}:${kind}:${sourceDefinitionId}:${targetDefinitionId}`), callId, kind, sourceDefinitionId, targetDefinitionId }); }
  private addTransfer(state: FlowState, sourceDefinitionId: string, targetDefinitionId: string): void {
    if (sourceDefinitionId === targetDefinitionId) return;
    if (state.transfers.some((transfer) => transfer.sourceDefinitionId === sourceDefinitionId && transfer.targetDefinitionId === targetDefinitionId)) return;
    state.transfers.push({ sourceDefinitionId, targetDefinitionId });
  }

  private transferTaint(node: ASTNode, targetDefinitionId: string, scope: Scope, filePath: string, state: FlowState): void {
    if (sanitized(node)) return;
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
      if (sanitized(current)) return;
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
    return Object.freeze([...new Set(results)].sort());
  }

  private collectDefinitions(node: ASTNode, scope: Scope, filePath: string, state: FlowState): readonly VariableDefinition[] {
    const definitions: VariableDefinition[] = [];
    const visit = (current: ASTNode): void => {
      if (sanitized(current)) return;
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
    return Object.freeze(unique.sort(byId));
  }

  private propagateTaint(state: FlowState): void {
    const transfers = state.transfers.sort((left, right) => `${left.sourceDefinitionId}:${left.targetDefinitionId}`.localeCompare(`${right.sourceDefinitionId}:${right.targetDefinitionId}`));
    for (let changed = true; changed;) {
      changed = false;
      for (const transfer of transfers) for (const [sourceId, path] of state.taintPaths.get(transfer.sourceDefinitionId) ?? []) {
        if (this.setTaintPath(state, transfer.targetDefinitionId, sourceId, [...path, transfer.targetDefinitionId])) changed = true;
      }
    }
  }

  private setTaintPath(state: FlowState, definitionId: string, sourceId: string, path: readonly string[]): boolean {
    if (path.slice(0, -1).includes(definitionId)) return false;
    const paths = state.taintPaths.get(definitionId) ?? new Map<string, readonly string[]>();
    const existing = paths.get(sourceId);
    if (existing !== undefined && (existing.length <= path.length || existing.join(":") <= path.join(":"))) return false;
    paths.set(sourceId, Object.freeze([...path]));
    state.taintPaths.set(definitionId, paths);
    return true;
  }

  private taintFlows(state: FlowState): readonly TaintFlow[] {
    const flows = state.sinks.flatMap((sink) => sink.argumentDefinitionIds.flatMap((definitionId) => [...(state.taintPaths.get(definitionId)?.entries() ?? [])].map(([sourceId, path]) => ({ sourceId, sinkId: sink.id, path: Object.freeze([...path, sink.name]), state: "CONFIRMED" as const }))));
    return Object.freeze([...new Map(flows.map((flow) => [`${flow.sourceId}:${flow.sinkId}`, flow])).values()].sort((left, right) => `${left.sourceId}:${left.sinkId}`.localeCompare(`${right.sourceId}:${right.sinkId}`)));
  }

  private memberUse(node: ASTNode, scope: Scope, filePath: string, state: FlowState): void { const path = memberPath(node); if (path !== undefined) this.use(path, node, scope, filePath, state); const base = memberBase(node); if (base !== undefined && base !== path) this.use(base, node, scope, filePath, state); }
  private use(name: string | undefined, node: ASTNode, scope: Scope, filePath: string, state: FlowState): void { if (name === undefined) return; const definition = resolve(scope, name); const position = node.location === undefined ? `anon-${state.uses.length}` : `${node.location.start.line}:${node.location.start.column}`; state.uses.push({ id: hash(`use:${filePath}:${name}:${position}`), filePath, name, ...(definition === undefined ? {} : { definitionId: definition.id }) }); }
  private define(name: string, kind: VariableDefinition["kind"], node: ASTNode, scope: Scope, filePath: string, state: FlowState, constantValue: string | number | boolean | null | undefined): VariableDefinition { const position = node.location === undefined ? `anon-${state.definitions.length}` : `${node.location.start.line}:${node.location.start.column}`; const definition: VariableDefinition = { id: hash(`definition:${filePath}:${name}:${kind}:${position}`), filePath, name, kind, ...(constantValue === undefined ? {} : { constantValue }) }; scope.definitions.set(name, definition); state.definitions.push(definition); return definition; }
  private source(node: ASTNode, filePath: string): string | undefined { const path = memberPath(node); if (path === undefined || ![...sources].some((source) => path === source || path.startsWith(`${source}.`))) return undefined; const position = node.location === undefined ? "anon" : `${node.location.start.line}:${node.location.start.column}`; return hash(`source:${filePath}:${path}:${position}`); }
}

function createScope(parent?: Scope): Scope { return { parent, definitions: new Map() }; }
function collectFunctions(root: ASTNode, symbols: readonly CodeSymbol[]): Map<ASTNode, FunctionRecord> { const records = new Map<ASTNode, FunctionRecord>(); const visit = (node: ASTNode): void => { if (isFunction(node)) { const name = functionName(node); if (name !== undefined) { const symbol = symbols.filter((candidate) => (candidate.kind === "function" || candidate.kind === "method") && candidate.name === name && sameLocation(candidate.location, node.location)); records.set(node, { name, node, parameters: [], returns: [], ...(symbol.length === 1 && symbol[0] !== undefined ? { symbolId: symbol[0].id } : {}) }); } } for (const child of node.children) visit(child); }; visit(root); return records; }
function resolveFunction(name: string | undefined, functions: ReadonlyMap<string, FunctionRecord>): FunctionRecord | undefined { if (name === undefined) return undefined; const direct = functions.get(name); if (direct !== undefined) return direct; const property = name.split(".").at(-1); return property === undefined ? undefined : functions.get(property); }
function resolve(scope: Scope | undefined, name: string): VariableDefinition | undefined { for (let current = scope; current !== undefined; current = current.parent) { const definition = current.definitions.get(name); if (definition !== undefined) return definition; } return undefined; }
function isFunction(node: ASTNode): boolean { return ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassMethod", "ObjectMethod"].includes(node.type); }
function functionName(node: ASTNode): string | undefined { return identifierName(node.children.find((child) => child.role === "id" || child.role === "key")); }
function identifierName(node: ASTNode | undefined): string | undefined { const value = node?.attributes.name; return typeof value === "string" && value.length > 0 ? value : undefined; }
function memberPath(node: ASTNode | undefined): string | undefined { if (node?.type !== "MemberExpression") return undefined; const object = memberPath(node.children.find((child) => child.role === "object")) ?? identifierName(node.children.find((child) => child.role === "object")); const property = identifierName(node.children.find((child) => child.role === "property")) ?? stringValue(node.children.find((child) => child.role === "property")); return object === undefined || property === undefined ? undefined : `${object}.${property}`; }
function memberBase(node: ASTNode | undefined): string | undefined { if (node?.type !== "MemberExpression") return undefined; const object = node.children.find((child) => child.role === "object"); return identifierName(object) ?? memberBase(object); }
function literalValue(node: ASTNode | undefined): string | number | boolean | null | undefined { const value = node?.attributes.value; return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null ? value : undefined; }
function stringValue(node: ASTNode | undefined): string | undefined { return typeof node?.attributes.value === "string" ? node.attributes.value : undefined; }
function sanitized(node: ASTNode): boolean { if (node.type !== "CallExpression") return false; const callee = node.children.find((child) => child.role === "callee"); const name = memberPath(callee) ?? identifierName(callee); return name !== undefined && sanitizers.has(name); }
function byId<T extends { readonly id: string }>(left: T, right: T): number { return left.id.localeCompare(right.id); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function callLocationKey(filePath: string, location: { readonly line: number; readonly column: number }): string { return `${filePath}:${location.line}:${location.column}`; }
function sameLocation(symbolLocation: CodeSymbol["location"] | undefined, nodeLocation: ASTNode["location"] | undefined): boolean { return symbolLocation !== undefined && nodeLocation !== undefined && symbolLocation.start.line === nodeLocation.start.line && symbolLocation.start.column === nodeLocation.start.column; }
function functionSummaries(state: FlowState, filePath: string): readonly FunctionFlowSummary[] { return [...state.functions.values()].flatMap((record) => record.symbolId === undefined ? [] : [{ symbolId: record.symbolId, filePath, parameterDefinitionIds: record.parameters.map((slot) => slot.map((definition) => definition.id)), returnDefinitionIds: record.returns.map((definition) => definition.id) }]).sort((left, right) => left.symbolId.localeCompare(right.symbolId)); }
function callBindings(state: FlowState): readonly CallFlowBinding[] { return state.pendingCalls.flatMap((call) => call.targetSymbolId === undefined ? [] : [{ callId: call.id, targetSymbolId: call.targetSymbolId, argumentDefinitionIds: call.argumentDefinitionIds, ...(call.receiverDefinitionId === undefined ? {} : { receiverDefinitionId: call.receiverDefinitionId }) }]).sort((left, right) => left.callId.localeCompare(right.callId)); }

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
