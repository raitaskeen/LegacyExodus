import { createHash } from "node:crypto";

import type { ASTNode, ASTResult } from "@parser/index";
import type { DependencyGraph } from "@graph/index";
import type { SymbolTable } from "@symbols/index";
import { createLexicalScopeId, type CodeSymbol } from "@symbols/index";

import type { SemanticCall, SymbolReference } from "./semantic-contracts";

export class DeterministicCallGraphBuilder {
  public build(astResults: readonly ASTResult[], symbolTables: readonly SymbolTable[], dependencyGraph: DependencyGraph): { readonly calls: readonly SemanticCall[]; readonly references: readonly SymbolReference[] } {
    const tablesByPath = new Map(symbolTables.map((table) => [table.filePath, table]));
    const importsByFile = new Map(symbolTables.map((table) => [table.filePath, table.symbols.filter((symbol) => symbol.kind === "import")]));
    const targetByImportId = new Map(dependencyGraph.edges.map((edge) => [edge.importSymbolId, edge.targetExportSymbolId]));
    const calls: SemanticCall[] = [];
    const references: SymbolReference[] = [];

    for (const ast of [...astResults].sort((left, right) => left.metadata.sourcePath.localeCompare(right.metadata.sourcePath))) {
      this.visit(ast.root, ast, { callerName: "module", scope: createScope("scope:module"), receiverTypes: new Map() }, tablesByPath, importsByFile, targetByImportId, calls, references);
    }

    return Object.freeze({ calls: Object.freeze(calls), references: Object.freeze(references) });
  }

  private visit(
    node: ASTNode,
    ast: ASTResult,
    context: ResolutionContext,
    tablesByPath: ReadonlyMap<string, SymbolTable>,
    importsByFile: ReadonlyMap<string, readonly { readonly id: string; readonly name: string }[]>,
    targetByImportId: ReadonlyMap<string, string>,
    calls: SemanticCall[],
    references: SymbolReference[],
  ): void {
    const table = tablesByPath.get(ast.metadata.sourcePath);
    const nextContext = childContext(node, context, table);
    if (node.type === "VariableDeclarator") recordReceiverType(node, nextContext, table);
    if (node.type === "CallExpression") {
      const calleeName = callName(node);
      if (calleeName !== undefined) {
        const imported = importsByFile.get(ast.metadata.sourcePath)?.find((symbol) => symbol.name === calleeName);
        const targetSymbolId = imported === undefined
          ? resolveLocalCall(tablesByPath.get(ast.metadata.sourcePath), calleeName, context)
          : targetByImportId.get(imported.id);
        const id = hash(`${ast.metadata.sourcePath}:${context.callerName}:${calleeName}:${node.location?.start.line ?? 0}:${node.location?.start.column ?? 0}`);
        const resolutionState = targetSymbolId === undefined ? "UNRESOLVED" as const : "RESOLVED" as const;
        const reference: SymbolReference = { id: hash(`reference:${id}`), filePath: ast.metadata.sourcePath, name: calleeName, kind: "call", resolutionState, ...(targetSymbolId === undefined ? {} : { resolvedSymbolId: targetSymbolId }) };
        references.push(reference);
        calls.push({ id, sourceFilePath: ast.metadata.sourcePath, callerName: context.callerName, calleeName, resolutionState, ...(targetSymbolId === undefined ? {} : { targetSymbolId }), ...(node.location === undefined ? {} : { location: node.location.start }) });
      }
    }

    for (const child of node.children) {
      this.visit(child, ast, nextContext, tablesByPath, importsByFile, targetByImportId, calls, references);
    }
  }
}

interface ScopeFrame {
  readonly id: string;
  readonly parent?: ScopeFrame;
}

interface ResolutionContext {
  readonly callerName: string;
  readonly scope: ScopeFrame;
  readonly containerId?: string;
  readonly receiverTypes: ReadonlyMap<string, string>;
}

function createScope(id: string, parent?: ScopeFrame): ScopeFrame {
  return Object.freeze(parent === undefined ? { id } : { id, parent });
}

function childContext(node: ASTNode, context: ResolutionContext, table: SymbolTable | undefined): ResolutionContext {
  let scope = context.scope;
  let callerName = context.callerName;
  let containerId = context.containerId;
  if (node.type === "BlockStatement" || isCallable(node)) scope = createScope(createLexicalScopeId(node.type, node.location), context.scope);
  if (isCallable(node)) callerName = nodeName(node) ?? callerName;
  if (node.type === "ClassDeclaration") containerId = findClassSymbolId(node, context.scope, table);
  if (node.type === "ClassMethod" || node.type === "ClassPrivateMethod") {
    // Class members are always visited directly below their ClassDeclaration.
    containerId = context.containerId;
  }
  return { callerName, scope, ...(containerId === undefined ? {} : { containerId }), receiverTypes: context.receiverTypes };
}

function findClassSymbolId(node: ASTNode, scope: ScopeFrame, table: SymbolTable | undefined): string | undefined {
  const className = nodeName(node);
  if (className === undefined) return undefined;
  const candidates = table?.symbols.filter((symbol) => symbol.kind === "class" && symbol.name === className && isInScope(symbol, scope)) ?? [];
  return candidates.length === 1 ? candidates[0]?.id : undefined;
}

function isCallable(node: ASTNode): boolean {
  return ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassMethod", "ObjectMethod"].includes(node.type);
}

function nodeName(node: ASTNode): string | undefined {
  return identifier(node.children.find((child) => child.role === "id" || child.role === "key")) ?? identifier(node);
}

function callName(node: ASTNode): string | undefined {
  const callee = node.children.find((child) => child.role === "callee");
  return callee === undefined ? undefined : memberName(callee);
}

function memberName(node: ASTNode): string | undefined {
  if (node.type === "Identifier") return identifier(node);
  if (node.type === "ThisExpression") return "this";
  if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") return undefined;
  if (node.attributes.computed === true) return undefined;
  const object = node.children.find((child) => child.role === "object");
  const property = node.children.find((child) => child.role === "property");
  const objectName = object === undefined ? undefined : memberName(object);
  const propertyName = property === undefined ? undefined : memberName(property);
  return objectName === undefined || propertyName === undefined ? undefined : `${objectName}.${propertyName}`;
}

function identifier(node: ASTNode | undefined): string | undefined {
  const value = node?.attributes.name;
  return typeof value === "string" ? value : undefined;
}

function recordReceiverType(node: ASTNode, context: ResolutionContext, table: SymbolTable | undefined): void {
  const binding = node.children.find((child) => child.role === "id");
  const initializer = node.children.find((child) => child.role === "init");
  const bindingName = identifier(binding);
  if (bindingName === undefined || initializer?.type !== "NewExpression") return;
  const callee = initializer.children.find((child) => child.role === "callee");
  const className = callee === undefined ? undefined : identifier(callee);
  if (className === undefined) return;
  const candidates = table?.symbols.filter((symbol) => symbol.kind === "class" && symbol.name === className && isInScope(symbol, context.scope)) ?? [];
  if (candidates.length !== 1 || candidates[0] === undefined) return;
  (context.receiverTypes as Map<string, string>).set(receiverKey(context.scope, bindingName), candidates[0].id);
}

function resolveLocalCall(table: SymbolTable | undefined, name: string, context: ResolutionContext): string | undefined {
  if (table === undefined) return undefined;
  const pieces = name.split(".");
  if (pieces.length === 1) return nearestScoped(table.symbols, name, context.scope)?.id;
  if (pieces.length !== 2) return undefined;
  const [receiver, methodName] = pieces;
  if (receiver === undefined || methodName === undefined) return undefined;
  const classId = receiver === "this" ? context.containerId : receiverType(context.receiverTypes, context.scope, receiver);
  if (classId === undefined) return undefined;
  const candidates = table.symbols.filter((symbol) => symbol.kind === "method" && symbol.name === methodName && symbol.containerId === classId);
  return candidates.length === 1 ? candidates[0]?.id : undefined;
}

function nearestScoped(symbols: readonly CodeSymbol[], name: string, scope: ScopeFrame): CodeSymbol | undefined {
  for (let current: ScopeFrame | undefined = scope; current !== undefined; current = current.parent) {
    const candidates = symbols.filter((symbol) => symbol.name === name && symbol.kind === "function" && symbol.scopeId === current.id);
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) return undefined;
  }
  return undefined;
}

function isInScope(symbol: CodeSymbol, scope: ScopeFrame): boolean {
  for (let current: ScopeFrame | undefined = scope; current !== undefined; current = current.parent) if (symbol.scopeId === current.id) return true;
  return false;
}

function receiverType(receiverTypes: ReadonlyMap<string, string>, scope: ScopeFrame, name: string): string | undefined {
  for (let current: ScopeFrame | undefined = scope; current !== undefined; current = current.parent) {
    const classId = receiverTypes.get(receiverKey(current, name));
    if (classId !== undefined) return classId;
  }
  return undefined;
}

function receiverKey(scope: ScopeFrame, name: string): string {
  return `${scope.id}:${name}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
