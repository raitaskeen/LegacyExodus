import { createHash } from "node:crypto";
import type { ASTNode, ASTResult } from "@parser/index";
import { createDataFlowGraph, type DataFlowGraph, type InterproceduralFlow, type TaintFlow, type VariableDefinition, type VariableUse } from "./flow-contracts";

interface Scope { readonly parent?: Scope; readonly definitions: Map<string, VariableDefinition>; }
interface FunctionRecord { readonly name: string; readonly node: ASTNode; readonly parameters: VariableDefinition[]; readonly returns: VariableDefinition[]; }
interface PendingCall { readonly id: string; readonly callee: FunctionRecord; readonly argumentDefinitionIds: readonly (string | undefined)[]; readonly argumentSourceIds: readonly (string | undefined)[]; readonly receiverDefinitionId?: string; }
interface TaintTransfer { readonly sourceDefinitionId: string; readonly targetDefinitionId: string; }
interface PendingSink { readonly id: string; readonly name: string; readonly argumentDefinitionIds: readonly string[]; }
interface FlowState { readonly definitions: VariableDefinition[]; readonly uses: VariableUse[]; readonly taintPaths: Map<string, Map<string, readonly string[]>>; readonly transfers: TaintTransfer[]; readonly sinks: PendingSink[]; readonly functions: Map<ASTNode, FunctionRecord>; readonly resolvableFunctions: Map<string, FunctionRecord>; readonly pendingCalls: PendingCall[]; readonly interproceduralFlows: InterproceduralFlow[]; }

const sources = new Set(["process.env", "req.body", "req.params", "req.query"]);
const sinks = new Set(["child_process.exec", "exec", "res.send", "res.json", "query", "execute"]);
const sanitizers = new Set(["escape", "sanitize", "validator.escape"]);

export class DeterministicDataFlowGraphBuilder {
  public build(ast: ASTResult): DataFlowGraph {
    const state: FlowState = { definitions: [], uses: [], taintPaths: new Map(), transfers: [], sinks: [], functions: collectFunctions(ast.root), resolvableFunctions: new Map(), pendingCalls: [], interproceduralFlows: [] };
    for (const record of state.functions.values()) if (record.name.length > 0 && [...state.functions.values()].filter((candidate) => candidate.name === record.name).length === 1) state.resolvableFunctions.set(record.name, record);
    this.visit(ast.root, createScope(), ast.metadata.sourcePath, state);
    this.connectCalls(state);
    this.propagateTaint(state);
    const definitions = state.definitions.sort(byId);
    const uses = state.uses.sort(byId);
    return createDataFlowGraph({
      id: hash(`dfg:${ast.metadata.sourcePath}`), filePath: ast.metadata.sourcePath, state: "INFERRED", definitions, uses,
      defUseChains: definitions.map((definition) => ({ definitionId: definition.id, useIds: uses.filter((use) => use.definitionId === definition.id).map((use) => use.id).sort() })),
      lifetimes: definitions.map((definition) => ({ name: definition.name, filePath: definition.filePath, declarationId: definition.id, useIds: uses.filter((use) => use.definitionId === definition.id).map((use) => use.id).sort() })),
      taintFlows: this.taintFlows(state),
      interproceduralFlows: state.interproceduralFlows.sort(byId),
    });
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
    if (node.type === "Identifier") { this.use(identifierName(node), node, scope, filePath, state); return; }
    for (const child of node.children) this.visit(child, scope, filePath, state, currentFunction);
  }

  private declarator(node: ASTNode, scope: Scope, filePath: string, state: FlowState): void {
    const name = identifierName(node.children.find((child) => child.role === "id"));
    if (name === undefined) return;
    const init = node.children.find((child) => child.role === "init");
    const definition = this.define(name, "declaration", node, scope, filePath, state, literalValue(init));
    if (init === undefined) return;
    this.transferTaint(init, definition.id, scope, filePath, state);
    this.visit(init, scope, filePath, state, undefined, definition.id);
  }

  private function(node: ASTNode, scope: Scope, filePath: string, state: FlowState): void {
    const name = identifierName(node.children.find((child) => child.role === "id"));
    if (name !== undefined) this.define(name, "declaration", node, scope, filePath, state, undefined);
    const record = state.functions.get(node);
    const functionScope = createScope(scope);
    for (const parameter of node.children.filter((child) => child.role === "params")) for (const parameterName of names(parameter)) { const definition = this.define(parameterName, "parameter", parameter, functionScope, filePath, state, undefined); record?.parameters.push(definition); }
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
    this.visit(argument, scope, filePath, state, currentFunction, returned.id);
  }
  private assignment(node: ASTNode, scope: Scope, filePath: string, state: FlowState, currentFunction: FunctionRecord | undefined): void {
    const left = node.children.find((child) => child.role === "left"); const right = node.children.find((child) => child.role === "right");
    const name = identifierName(left) ?? memberPath(left); if (name === undefined) return;
    const definition = this.define(name, "assignment", node, scope, filePath, state, literalValue(right));
    if (right !== undefined) this.transferTaint(right, definition.id, scope, filePath, state);
    if (right !== undefined) this.visit(right, scope, filePath, state, currentFunction, definition.id);
  }

  private call(node: ASTNode, scope: Scope, filePath: string, state: FlowState, receiverDefinitionId?: string): void {
    const callee = node.children.find((child) => child.role === "callee"); const name = memberPath(callee) ?? identifierName(callee);
    const argumentsNodes = node.children.filter((child) => child.role === "arguments"); for (const argument of argumentsNodes) this.visit(argument, scope, filePath, state);
    const resolved = resolveFunction(name, state.resolvableFunctions);
    if (resolved !== undefined) state.pendingCalls.push({ id: hash(`call:${filePath}:${name}:${node.location?.start.line ?? 0}:${node.location?.start.column ?? 0}`), callee: resolved, argumentDefinitionIds: argumentsNodes.map((argument) => this.definitionFor(argument, scope)?.id), argumentSourceIds: argumentsNodes.map((argument) => this.source(argument, filePath)), ...(receiverDefinitionId === undefined ? {} : { receiverDefinitionId }) });
    if (name === undefined || !sinks.has(name)) return;
    state.sinks.push({ id: hash(`sink:${filePath}:${name}:${node.location?.start.line ?? 0}:${node.location?.start.column ?? 0}`), name, argumentDefinitionIds: argumentsNodes.flatMap((argument) => { const definition = this.definitionFor(argument, scope); return definition === undefined ? [] : [definition.id]; }) });
  }

  private definitionFor(node: ASTNode, scope: Scope): VariableDefinition | undefined { for (const name of [identifierName(node), memberPath(node), memberBase(node)]) { if (name === undefined) continue; const definition = resolve(scope, name); if (definition !== undefined) return definition; } for (const child of node.children) { const definition = this.definitionFor(child, scope); if (definition !== undefined) return definition; } return undefined; }
  private connectCalls(state: FlowState): void {
    for (const call of state.pendingCalls.sort(byId)) {
      for (const [index, argumentDefinitionId] of call.argumentDefinitionIds.entries()) {
        const parameter = call.callee.parameters[index];
        if (argumentDefinitionId !== undefined && parameter !== undefined) this.addInterproceduralFlow(state, call.id, "argument-to-parameter", argumentDefinitionId, parameter.id);
        const sourceId = call.argumentSourceIds[index];
        if (sourceId !== undefined && parameter !== undefined) this.setTaintPath(state, parameter.id, sourceId, [sourceId, parameter.id]);
      }
      if (call.receiverDefinitionId !== undefined) for (const returned of call.callee.returns) this.addInterproceduralFlow(state, call.id, "return-to-receiver", returned.id, call.receiverDefinitionId);
    }
    for (const flow of state.interproceduralFlows) state.transfers.push({ sourceDefinitionId: flow.sourceDefinitionId, targetDefinitionId: flow.targetDefinitionId });
  }
  private addInterproceduralFlow(state: FlowState, callId: string, kind: InterproceduralFlow["kind"], sourceDefinitionId: string, targetDefinitionId: string): void { state.interproceduralFlows.push({ id: hash(`interprocedural:${callId}:${kind}:${sourceDefinitionId}:${targetDefinitionId}`), callId, kind, sourceDefinitionId, targetDefinitionId }); }

  private transferTaint(node: ASTNode, targetDefinitionId: string, scope: Scope, filePath: string, state: FlowState): void {
    if (sanitized(node)) return;
    if (node.type === "CallExpression") return;
    const sourceId = this.source(node, filePath);
    if (sourceId !== undefined) { this.setTaintPath(state, targetDefinitionId, sourceId, [sourceId, targetDefinitionId]); return; }
    const sourceDefinition = this.definitionFor(node, scope);
    if (sourceDefinition !== undefined) state.transfers.push({ sourceDefinitionId: sourceDefinition.id, targetDefinitionId });
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
    const paths = state.taintPaths.get(definitionId) ?? new Map<string, readonly string[]>();
    const existing = paths.get(sourceId);
    if (existing !== undefined && existing.join(":") <= path.join(":")) return false;
    paths.set(sourceId, Object.freeze([...path]));
    state.taintPaths.set(definitionId, paths);
    return true;
  }

  private taintFlows(state: FlowState): readonly TaintFlow[] {
    const flows = state.sinks.flatMap((sink) => sink.argumentDefinitionIds.flatMap((definitionId) => [...(state.taintPaths.get(definitionId)?.entries() ?? [])].map(([sourceId, path]) => ({ sourceId, sinkId: sink.id, path: Object.freeze([...path, sink.name]) }))));
    return Object.freeze([...new Map(flows.map((flow) => [`${flow.sourceId}:${flow.sinkId}`, flow])).values()].sort((left, right) => `${left.sourceId}:${left.sinkId}`.localeCompare(`${right.sourceId}:${right.sinkId}`)));
  }

  private memberUse(node: ASTNode, scope: Scope, filePath: string, state: FlowState): void { const path = memberPath(node); if (path !== undefined) this.use(path, node, scope, filePath, state); const base = memberBase(node); if (base !== undefined && base !== path) this.use(base, node, scope, filePath, state); }
  private use(name: string | undefined, node: ASTNode, scope: Scope, filePath: string, state: FlowState): void { if (name === undefined) return; const definition = resolve(scope, name); state.uses.push({ id: hash(`use:${filePath}:${name}:${node.location?.start.line ?? 0}:${node.location?.start.column ?? 0}`), filePath, name, ...(definition === undefined ? {} : { definitionId: definition.id }) }); }
  private define(name: string, kind: VariableDefinition["kind"], node: ASTNode, scope: Scope, filePath: string, state: FlowState, constantValue: string | number | boolean | null | undefined): VariableDefinition { const definition: VariableDefinition = { id: hash(`definition:${filePath}:${name}:${kind}:${node.location?.start.line ?? 0}:${node.location?.start.column ?? 0}`), filePath, name, kind, ...(constantValue === undefined ? {} : { constantValue }) }; scope.definitions.set(name, definition); state.definitions.push(definition); return definition; }
  private source(node: ASTNode, filePath: string): string | undefined { const path = memberPath(node); return path !== undefined && [...sources].some((source) => path === source || path.startsWith(`${source}.`)) ? hash(`source:${filePath}:${path}:${node.location?.start.line ?? 0}:${node.location?.start.column ?? 0}`) : undefined; }
}

function createScope(parent?: Scope): Scope { return { parent, definitions: new Map() }; }
function collectFunctions(root: ASTNode): Map<ASTNode, FunctionRecord> { const records = new Map<ASTNode, FunctionRecord>(); const visit = (node: ASTNode): void => { if (isFunction(node)) { const name = functionName(node); if (name !== undefined) records.set(node, { name, node, parameters: [], returns: [] }); } for (const child of node.children) visit(child); }; visit(root); return records; }
function resolveFunction(name: string | undefined, functions: ReadonlyMap<string, FunctionRecord>): FunctionRecord | undefined { if (name === undefined) return undefined; const direct = functions.get(name); if (direct !== undefined) return direct; const property = name.split(".").at(-1); return property === undefined ? undefined : functions.get(property); }
function resolve(scope: Scope | undefined, name: string): VariableDefinition | undefined { for (let current = scope; current !== undefined; current = current.parent) { const definition = current.definitions.get(name); if (definition !== undefined) return definition; } return undefined; }
function isFunction(node: ASTNode): boolean { return ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassMethod", "ObjectMethod"].includes(node.type); }
function functionName(node: ASTNode): string | undefined { return identifierName(node.children.find((child) => child.role === "id" || child.role === "key")); }
function identifierName(node: ASTNode | undefined): string | undefined { const value = node?.attributes.name; return typeof value === "string" && value.length > 0 ? value : undefined; }
function names(node: ASTNode): readonly string[] { const name = identifierName(node); return name === undefined ? node.children.flatMap(names) : [name]; }
function memberPath(node: ASTNode | undefined): string | undefined { if (node?.type !== "MemberExpression") return undefined; const object = memberPath(node.children.find((child) => child.role === "object")) ?? identifierName(node.children.find((child) => child.role === "object")); const property = identifierName(node.children.find((child) => child.role === "property")) ?? stringValue(node.children.find((child) => child.role === "property")); return object === undefined || property === undefined ? undefined : `${object}.${property}`; }
function memberBase(node: ASTNode | undefined): string | undefined { if (node?.type !== "MemberExpression") return undefined; const object = node.children.find((child) => child.role === "object"); return identifierName(object) ?? memberBase(object); }
function literalValue(node: ASTNode | undefined): string | number | boolean | null | undefined { const value = node?.attributes.value; return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null ? value : undefined; }
function stringValue(node: ASTNode | undefined): string | undefined { return typeof node?.attributes.value === "string" ? node.attributes.value : undefined; }
function sanitized(node: ASTNode): boolean { if (node.type !== "CallExpression") return false; const callee = node.children.find((child) => child.role === "callee"); const name = memberPath(callee) ?? identifierName(callee); return name !== undefined && sanitizers.has(name); }
function byId<T extends { readonly id: string }>(left: T, right: T): number { return left.id.localeCompare(right.id); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
