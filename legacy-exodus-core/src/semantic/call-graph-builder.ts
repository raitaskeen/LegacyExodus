import { createHash } from "node:crypto";

import type { ASTNode, ASTResult } from "@parser/index";
import { canonicalizePath, ModuleResolver, type DependencyGraph } from "@graph/index";
import type { SymbolTable } from "@symbols/index";
import { createLexicalScopeId, type CodeSymbol } from "@symbols/index";

import type { SemanticCall, SymbolReference } from "./semantic-contracts";

export class DeterministicCallGraphBuilder {
  private readonly resolver = new ModuleResolver();

  public build(astResults: readonly ASTResult[], symbolTables: readonly SymbolTable[], dependencyGraph: DependencyGraph): { readonly calls: readonly SemanticCall[]; readonly references: readonly SymbolReference[] } {
    const tablesByPath = new Map(symbolTables.map((table) => [table.filePath, table]));
    const importsByFile = new Map(symbolTables.map((table) => [table.filePath, table.symbols.filter((symbol) => symbol.kind === "import")]));
    const targetByImportId = new Map(dependencyGraph.edges.map((edge) => [edge.importSymbolId, edge.targetExportSymbolId]));
    const calls: SemanticCall[] = [];
    const references: SymbolReference[] = [];

    for (const ast of [...astResults].sort((left, right) => left.metadata.sourcePath.localeCompare(right.metadata.sourcePath))) {
      this.buildForFile(ast, tablesByPath, importsByFile, targetByImportId, calls, references);
    }

    return Object.freeze({ calls: Object.freeze(calls), references: Object.freeze(references) });
  }

  public buildForFile(
    ast: ASTResult,
    tablesByPath: ReadonlyMap<string, SymbolTable>,
    importsByFile: ReadonlyMap<string, readonly { readonly id: string; readonly name: string }[]>,
    targetByImportId: ReadonlyMap<string, string>,
    calls: SemanticCall[],
    references: SymbolReference[],
  ): void {
    const initialContext: ResolutionContext = {
      callerName: "module",
      scope: createScope("scope:module"),
      receiverTypes: new Map(),
      constantBindings: new Map(),
    };
    predeclareScopeBindings(ast.root, initialContext);
    const boundCallees = new Set<ASTNode>();
    this.visit(ast.root, ast, initialContext, tablesByPath, importsByFile, targetByImportId, calls, references, boundCallees);
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
    boundCallees: Set<ASTNode>,
  ): void {
    const table = tablesByPath.get(ast.metadata.sourcePath);
    const nextContext = childContext(node, context, table);
    if (nextContext.scope !== context.scope) {
      predeclareScopeBindings(node, nextContext);
    }
    if (isCallable(node) || node.type === "CatchClause") {
      recordParamReceiverTypes(node, nextContext);
      recordParamConstantBindings(node, nextContext);
    }
    if (node.type === "VariableDeclarator") {
      recordReceiverType(node, nextContext, table);
      recordConstantBinding(node, nextContext, table);
    }
    if (node.type === "AssignmentExpression") {
      recordAssignmentReceiverType(node, nextContext, table);
      recordAssignmentConstantBinding(node, nextContext, table);
    }
    if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
      const declName = nodeName(node);
      if (declName !== undefined) {
        (nextContext.receiverTypes as Map<string, string | null>).set(receiverKey(context.scope, declName), null);
        (nextContext.constantBindings as Map<string, string | null>).set(bindingKey(context.scope, declName), null);
      }
    }
    if (node.type === "CallExpression" || node.type === "OptionalCallExpression" || node.type === "NewExpression") {
      if (!boundCallees.has(node)) {
        const calleeName = callName(node, nextContext, boundCallees);
        if (calleeName !== undefined) {
          const imported = importsByFile.get(ast.metadata.sourcePath)?.find((symbol) => symbol.name === calleeName);
          const targetSymbolId = imported === undefined
            ? resolveLocalCall(tablesByPath.get(ast.metadata.sourcePath), calleeName, nextContext, tablesByPath, this.resolver)
            : targetByImportId.get(imported.id);
          const id = hash(`${ast.metadata.sourcePath}:${nextContext.callerName}:${calleeName}:${node.location?.start.line ?? 0}:${node.location?.start.column ?? 0}`);
          const resolutionState = targetSymbolId === undefined ? "UNRESOLVED" as const : "RESOLVED" as const;
          const reference: SymbolReference = { id: hash(`reference:${id}`), filePath: ast.metadata.sourcePath, name: calleeName, kind: "call", resolutionState, ...(targetSymbolId === undefined ? {} : { resolvedSymbolId: targetSymbolId }) };
          references.push(reference);
          calls.push({ id, sourceFilePath: ast.metadata.sourcePath, callerName: nextContext.callerName, calleeName, resolutionState, ...(targetSymbolId === undefined ? {} : { targetSymbolId }), ...(node.location === undefined ? {} : { location: node.location.start }) });
        }
      }
    }

    for (const child of node.children) {
      this.visit(child, ast, nextContext, tablesByPath, importsByFile, targetByImportId, calls, references, boundCallees);
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
  readonly containerName?: string;
  readonly receiverTypes: ReadonlyMap<string, string | null>;
  readonly constantBindings: ReadonlyMap<string, string | null>;
}

function createScope(id: string, parent?: ScopeFrame): ScopeFrame {
  return Object.freeze(parent === undefined ? { id } : { id, parent });
}

function extractMemberContainerAndMethod(node: ASTNode, context: ResolutionContext): { containerName?: string; methodName?: string } {
  const left = node.children.find((child) => child.role === "left");
  if (left === undefined) return {};
  if (left.type === "MemberExpression" || left.type === "OptionalMemberExpression") {
    const obj = left.children.find((c) => c.role === "object");
    const prop = left.children.find((c) => c.role === "property");
    const containerName = obj === undefined ? undefined : memberName(obj, context);
    let methodName: string | undefined;
    if (left.attributes.computed === true) {
      methodName = resolvePropertyKey(prop, context);
    } else {
      methodName = prop === undefined ? undefined : (identifier(prop) ?? memberName(prop, context));
    }
    return { containerName, methodName };
  }
  return {};
}

function childContext(node: ASTNode, context: ResolutionContext, table: SymbolTable | undefined): ResolutionContext {
  let scope = context.scope;
  let callerName = context.callerName;
  let containerId = context.containerId;
  let containerName = context.containerName;
  if (node.type === "BlockStatement" || isCallable(node) || node.type === "CatchClause" || isLoop(node)) {
    scope = createScope(createLexicalScopeId(node.type, node.location), context.scope);
  }
  if (isCallable(node)) callerName = nodeName(node) ?? callerName;
  if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
    containerId = findClassSymbolId(node, context.scope, table);
    containerName = nodeName(node) ?? containerName;
  }
  if (node.type === "ClassMethod" || node.type === "ClassPrivateMethod") {
    // Class members are always visited directly below their ClassDeclaration.
    containerId = context.containerId;
    containerName = context.containerName;
  } else if (node.type === "AssignmentExpression") {
    const { containerName: cName, methodName: mName } = extractMemberContainerAndMethod(node, context);
    if (cName !== undefined) {
      containerName = cName;
      containerId = undefined;
    }
    if (mName !== undefined) {
      callerName = mName;
    }
  } else if (node.type === "VariableDeclarator") {
    const binding = node.children.find((c) => c.role === "id");
    const init = node.children.find((c) => c.role === "init");
    if (binding?.type === "Identifier" && init?.type === "ObjectExpression") {
      containerName = identifier(binding);
      containerId = undefined;
    }
  } else if (node.type === "ObjectProperty") {
    const key = node.children.find((c) => c.role === "key");
    const keyName = key === undefined ? undefined : (identifier(key) ?? memberName(key, context));
    if (keyName !== undefined) {
      callerName = keyName;
    }
  } else if (node.type === "ObjectMethod") {
    containerId = undefined;
  } else if (node.type === "FunctionDeclaration") {
    containerId = undefined;
    containerName = undefined;
  } else if (node.type === "FunctionExpression") {
    if (node.role !== "right" && node.role !== "value") {
      containerId = undefined;
      containerName = undefined;
    }
  }
  return {
    callerName,
    scope,
    ...(containerId === undefined ? {} : { containerId }),
    ...(containerName === undefined ? {} : { containerName }),
    receiverTypes: context.receiverTypes,
    constantBindings: context.constantBindings,
  };
}

function findClassSymbolId(node: ASTNode, scope: ScopeFrame, table: SymbolTable | undefined): string | undefined {
  const className = nodeName(node);
  if (className !== undefined) {
    const candidates = table?.symbols.filter((symbol) => symbol.kind === "class" && symbol.name === className && isInScope(symbol, scope)) ?? [];
    if (candidates.length === 1) return candidates[0]?.id;
  }
  const loc = node.location;
  if (loc !== undefined && table !== undefined) {
    const candidate = table.symbols.find(
      (symbol) => symbol.kind === "class" &&
        symbol.location !== undefined &&
        symbol.location.start.line === loc.start.line &&
        symbol.location.start.column === loc.start.column,
    );
    if (candidate !== undefined) return candidate.id;
  }
  return undefined;
}

function isCallable(node: ASTNode): boolean {
  return ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ClassMethod", "ClassPrivateMethod", "ObjectMethod"].includes(node.type);
}

function isLoop(node: ASTNode): boolean {
  return ["ForStatement", "ForInStatement", "ForOfStatement"].includes(node.type);
}

function nodeName(node: ASTNode): string | undefined {
  return identifier(node.children.find((child) => child.role === "id" || child.role === "key")) ?? identifier(node);
}

function isBoundCall(node: ASTNode, context?: ResolutionContext): boolean {
  if (node.type !== "CallExpression" && node.type !== "OptionalCallExpression") return false;
  const callee = node.children.find((child) => child.role === "callee");
  if (callee === undefined) return false;
  if (callee.type !== "MemberExpression" && callee.type !== "OptionalMemberExpression") return false;
  const property = callee.children.find((child) => child.role === "property");
  if (callee.attributes.computed === true) {
    if (context === undefined) return false;
    return resolvePropertyKey(property, context) === "bind";
  }
  return identifier(property) === "bind";
}

function collectBoundCalleeChain(calleeNode: ASTNode, context?: ResolutionContext, boundCallees?: Set<ASTNode>): ASTNode {
  let current = calleeNode;
  while (isBoundCall(current, context)) {
    boundCallees?.add(current);
    const callee = current.children.find((child) => child.role === "callee");
    const object = callee?.children.find((child) => child.role === "object");
    if (object === undefined) break;
    current = object;
  }
  return current;
}

function callName(node: ASTNode, context: ResolutionContext, boundCallees?: Set<ASTNode>): string | undefined {
  const callee = node.children.find((child) => child.role === "callee");
  if (callee === undefined) return undefined;
  const effectiveCallee = collectBoundCalleeChain(callee, context, boundCallees);
  return memberName(effectiveCallee, context, boundCallees);
}

function memberName(node: ASTNode, context?: ResolutionContext, boundCallees?: Set<ASTNode>): string | undefined {
  if (node.type === "Identifier") return identifier(node);
  if (node.type === "PrivateName") {
    const name = identifier(node);
    return name !== undefined ? `#${name}` : undefined;
  }
  if (node.type === "ThisExpression") return "this";
  if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") return undefined;

  const object = node.children.find((child) => child.role === "object");
  const property = node.children.find((child) => child.role === "property");
  const effectiveObject = object === undefined ? undefined : collectBoundCalleeChain(object, context, boundCallees);
  const objectName = effectiveObject === undefined ? undefined : memberName(effectiveObject, context, boundCallees);

  let propertyName: string | undefined;
  if (node.attributes.computed === true) {
    if (context === undefined) return undefined;
    propertyName = resolvePropertyKey(property, context);
  } else {
    propertyName = property === undefined ? undefined : memberName(property, context, boundCallees);
  }

  if (objectName === undefined || propertyName === undefined) return undefined;

  // Unwrap .apply / .call invocations: e.g. server.listen.apply -> server.listen
  if ((propertyName === "apply" || propertyName === "call") && objectName !== "this") {
    return objectName;
  }

  return `${objectName}.${propertyName}`;
}

function identifier(node: ASTNode | undefined): string | undefined {
  if (node === undefined) return undefined;
  const value = node.attributes.name;
  if (typeof value === "string") return value;
  const idChild = node.children.find((child) => child.role === "id" || child.role === "key");
  if (idChild !== undefined) {
    const childVal = idChild.attributes.name;
    if (typeof childVal === "string") return childVal;
  }
  return undefined;
}

function extractBoundNames(node: ASTNode | undefined): string[] {
  if (node === undefined) return [];
  if (node.type === "Identifier") {
    const name = identifier(node);
    return name === undefined ? [] : [name];
  }
  if (node.type === "AssignmentPattern") {
    const left = node.children.find((child) => child.role === "left");
    return extractBoundNames(left);
  }
  if (node.type === "RestElement") {
    const argument = node.children.find((child) => child.role === "argument");
    return extractBoundNames(argument);
  }
  if (node.type === "ObjectPattern") {
    const names: string[] = [];
    for (const child of node.children) {
      if (child.type === "ObjectProperty") {
        const val = child.children.find((c) => c.role === "value") ?? child.children.find((c) => c.role === "key");
        names.push(...extractBoundNames(val));
      } else if (child.type === "RestElement") {
        names.push(...extractBoundNames(child));
      }
    }
    return names;
  }
  if (node.type === "ArrayPattern") {
    const names: string[] = [];
    for (const child of node.children) {
      names.push(...extractBoundNames(child));
    }
    return names;
  }
  return [];
}

function targetScopeForDeclaration(node: ASTNode, name: string, scope: ScopeFrame, table: SymbolTable | undefined): ScopeFrame {
  if (table !== undefined) {
    const symbol = table.symbols.find(
      (s) => s.name === name && (
        (node.location !== undefined && s.location !== undefined &&
         s.location.start.line === node.location.start.line &&
         s.location.start.column === node.location.start.column) ||
        (s.scopeId === scope.id)
      ),
    );
    if (symbol !== undefined && symbol.declarationKind === "var") {
      for (let current: ScopeFrame | undefined = scope; current !== undefined; current = current.parent) {
        if (current.id === symbol.scopeId) {
          return current;
        }
      }
    }
  }
  return scope;
}

function recordReceiverType(node: ASTNode, context: ResolutionContext, table: SymbolTable | undefined): void {
  const binding = node.children.find((child) => child.role === "id");
  const initializer = node.children.find((child) => child.role === "init");
  const boundNames = extractBoundNames(binding);
  if (boundNames.length === 0) return;

  if (boundNames.length === 1 && binding?.type === "Identifier" && initializer?.type === "NewExpression") {
    const callee = initializer.children.find((child) => child.role === "callee");
    const className = callee === undefined ? undefined : identifier(callee);
    if (className !== undefined) {
      const candidates = table?.symbols.filter((symbol) => symbol.kind === "class" && symbol.name === className && isInScope(symbol, context.scope)) ?? [];
      if (candidates.length === 1 && candidates[0] !== undefined) {
        const targetScope = targetScopeForDeclaration(node, boundNames[0]!, context.scope, table);
        (context.receiverTypes as Map<string, string | null>).set(receiverKey(targetScope, boundNames[0]!), candidates[0].id);
        return;
      }
    }
  }

  for (const name of boundNames) {
    const targetScope = targetScopeForDeclaration(node, name, context.scope, table);
    (context.receiverTypes as Map<string, string | null>).set(receiverKey(targetScope, name), null);
  }
}

function targetScopeForAssignment(name: string, scope: ScopeFrame, table: SymbolTable | undefined): ScopeFrame {
  if (table !== undefined) {
    for (let current: ScopeFrame | undefined = scope; current !== undefined; current = current.parent) {
      const symbol = table.symbols.find((s) => s.name === name && s.scopeId === current?.id);
      if (symbol !== undefined) {
        return current;
      }
    }
  }
  return scope;
}

function recordAssignmentReceiverType(node: ASTNode, context: ResolutionContext, table: SymbolTable | undefined): void {
  const left = node.children.find((child) => child.role === "left");
  const right = node.children.find((child) => child.role === "right");
  const boundNames = extractBoundNames(left);
  if (boundNames.length === 0) return;

  const operator = node.attributes.operator;
  if (operator === "=" && boundNames.length === 1 && left?.type === "Identifier" && right?.type === "NewExpression") {
    const callee = right.children.find((child) => child.role === "callee");
    const className = callee === undefined ? undefined : identifier(callee);
    if (className !== undefined) {
      const candidates = table?.symbols.filter((symbol) => symbol.kind === "class" && symbol.name === className && isInScope(symbol, context.scope)) ?? [];
      if (candidates.length === 1 && candidates[0] !== undefined) {
        const targetScope = targetScopeForAssignment(boundNames[0]!, context.scope, table);
        (context.receiverTypes as Map<string, string | null>).set(receiverKey(targetScope, boundNames[0]!), candidates[0].id);
        return;
      }
    }
  }

  for (const name of boundNames) {
    const targetScope = targetScopeForAssignment(name, context.scope, table);
    (context.receiverTypes as Map<string, string | null>).set(receiverKey(targetScope, name), null);
  }
}

function predeclareScopeBindings(node: ASTNode, context: ResolutionContext): void {
  for (const child of node.children) {
    if (child.type === "FunctionDeclaration" || child.type === "ClassDeclaration") {
      const declName = nodeName(child);
      if (declName !== undefined) {
        (context.receiverTypes as Map<string, string | null>).set(receiverKey(context.scope, declName), null);
        (context.constantBindings as Map<string, string | null>).set(bindingKey(context.scope, declName), null);
      }
    }
  }
}

function recordParamReceiverTypes(node: ASTNode, context: ResolutionContext): void {
  for (const child of node.children.filter((c) => c.role === "param" || c.role === "params")) {
    const paramNames = extractBoundNames(child);
    for (const name of paramNames) {
      (context.receiverTypes as Map<string, string | null>).set(receiverKey(context.scope, name), null);
    }
  }
}

function recordParamConstantBindings(node: ASTNode, context: ResolutionContext): void {
  for (const child of node.children.filter((c) => c.role === "param" || c.role === "params")) {
    const paramNames = extractBoundNames(child);
    for (const name of paramNames) {
      (context.constantBindings as Map<string, string | null>).set(bindingKey(context.scope, name), null);
    }
  }
}

function recordConstantBinding(node: ASTNode, context: ResolutionContext, table: SymbolTable | undefined): void {
  const binding = node.children.find((child) => child.role === "id");
  const initializer = node.children.find((child) => child.role === "init");
  const boundNames = extractBoundNames(binding);
  if (boundNames.length === 0) return;

  let isConst = false;
  if (table !== undefined && boundNames.length === 1) {
    const symbol = table.symbols.find(
      (s) => s.name === boundNames[0] && (
        (node.location !== undefined && s.location !== undefined &&
         s.location.start.line === node.location.start.line &&
         s.location.start.column === node.location.start.column) ||
        (s.scopeId === context.scope.id)
      ),
    );
    if (symbol?.declarationKind === "const") {
      isConst = true;
    }
  }

  if (isConst && boundNames.length === 1 && binding?.type === "Identifier") {
    const stringVal = extractStaticString(initializer);
    const targetScope = targetScopeForDeclaration(node, boundNames[0]!, context.scope, table);
    (context.constantBindings as Map<string, string | null>).set(
      bindingKey(targetScope, boundNames[0]!),
      stringVal ?? null,
    );
    return;
  }

  for (const name of boundNames) {
    const targetScope = targetScopeForDeclaration(node, name, context.scope, table);
    (context.constantBindings as Map<string, string | null>).set(bindingKey(targetScope, name), null);
  }
}

function recordAssignmentConstantBinding(node: ASTNode, context: ResolutionContext, table: SymbolTable | undefined): void {
  const left = node.children.find((child) => child.role === "left");
  const boundNames = extractBoundNames(left);
  for (const name of boundNames) {
    const targetScope = targetScopeForAssignment(name, context.scope, table);
    (context.constantBindings as Map<string, string | null>).set(bindingKey(targetScope, name), null);
  }
}

function extractStaticString(node: ASTNode | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (node.type === "StringLiteral") {
    return typeof node.attributes.value === "string" ? node.attributes.value : undefined;
  }
  if (node.type === "TemplateLiteral") {
    const hasExpressions = node.children.some((c) => c.role === "expressions");
    if (hasExpressions) return undefined;
    const quasi = node.children.find((c) => c.role === "quasis" || c.type === "TemplateElement");
    if (quasi !== undefined && typeof quasi.attributes.value === "string") {
      return quasi.attributes.value;
    }
    return "";
  }
  return undefined;
}

function resolvePropertyKey(node: ASTNode | undefined, context: ResolutionContext): string | undefined {
  if (node === undefined) return undefined;
  if (node.type === "StringLiteral") {
    return typeof node.attributes.value === "string" ? node.attributes.value : undefined;
  }
  if (node.type === "TemplateLiteral") {
    return extractStaticString(node);
  }
  if (node.type === "Identifier") {
    const id = identifier(node);
    if (id === undefined) return undefined;
    return lookupConstant(id, context.scope, context.constantBindings);
  }
  return undefined;
}

function lookupConstant(name: string, scope: ScopeFrame, bindings: ReadonlyMap<string, string | null>): string | undefined {
  for (let current: ScopeFrame | undefined = scope; current !== undefined; current = current.parent) {
    const entry = bindings.get(bindingKey(current, name));
    if (entry !== undefined) {
      return entry === null ? undefined : entry;
    }
  }
  return undefined;
}

function bindingKey(scope: ScopeFrame, name: string): string {
  return `${scope.id}:${name}`;
}

function resolveNamespaceCall(
  table: SymbolTable,
  receiver: string,
  methodName: string,
  tablesByPath: ReadonlyMap<string, SymbolTable>,
  resolver: ModuleResolver,
): string | undefined {
  const importSymbol = table.symbols.find((s) => s.kind === "import" && s.name === receiver);
  if (importSymbol?.moduleSpecifier === undefined) return undefined;
  if (importSymbol.sourceSymbolName !== "*" && !importSymbol.defaultExport) {
    return undefined;
  }

  const knownPaths = new Set(Array.from(tablesByPath.keys()).map((p) => canonicalizePath(p)));
  const canonicalImporter = canonicalizePath(table.filePath);
  const resolved = resolver.resolve(canonicalImporter, importSymbol.moduleSpecifier, knownPaths);
  if (resolved.resolvedPath === null) return undefined;

  let targetTable = tablesByPath.get(resolved.resolvedPath);
  if (targetTable === undefined) {
    for (const [path, t] of tablesByPath.entries()) {
      if (canonicalizePath(path) === resolved.resolvedPath) {
        targetTable = t;
        break;
      }
    }
  }
  if (targetTable === undefined) return undefined;

  const exportSymbol = targetTable.symbols.find((s) => s.kind === "export" && s.name === methodName);
  if (exportSymbol !== undefined) {
    return exportSymbol.id;
  }
  const directSymbol = targetTable.symbols.find(
    (s) => (s.kind === "function" || s.kind === "class" || s.kind === "variable") && s.exported && s.name === methodName,
  );
  return directSymbol?.id;
}

function containerMatches(symbolContainer: string | undefined, contextContainer: string | undefined): boolean {
  if (symbolContainer === undefined || contextContainer === undefined) return false;
  if (symbolContainer === contextContainer) return true;
  if (
    (symbolContainer === "module.exports" && contextContainer === "exports") ||
    (symbolContainer === "exports" && contextContainer === "module.exports")
  ) {
    return true;
  }
  return false;
}

function resolveLocalCall(
  table: SymbolTable | undefined,
  name: string,
  context: ResolutionContext,
  tablesByPath?: ReadonlyMap<string, SymbolTable>,
  resolver?: ModuleResolver,
): string | undefined {
  if (table === undefined) return undefined;
  const pieces = name.split(".");
  if (pieces.length === 1) return nearestScoped(table.symbols, name, context)?.id;
  if (pieces.length !== 2) return undefined;
  const [receiver, methodName] = pieces;
  if (receiver === undefined || methodName === undefined) return undefined;

  // 1. Class instance / constructor receiver
  const classId = receiver === "this" ? context.containerId : receiverType(context.receiverTypes, context.scope, receiver);
  if (classId !== undefined) {
    const candidates = table.symbols.filter((symbol) => symbol.kind === "method" && symbol.name === methodName && symbol.containerId === classId);
    if (candidates.length === 1) return candidates[0]?.id;
  }

  // 2. Exact receiver-matched method / property on object (e.g. app.init when app.init is declared, proto.handle when proto.handle is declared)
  if (receiver !== "this") {
    const candidates = table.symbols.filter(
      (symbol) => (symbol.kind === "method" || symbol.kind === "function") &&
        symbol.name === methodName &&
        symbol.containerName === receiver,
    );
    if (candidates.length === 1) return candidates[0]?.id;
  }

  // 3. Prototypal / contextual this receiver (e.g. this.defaultConfiguration inside application.js, this.set inside response.js)
  if (receiver === "this" && context.containerId === undefined && context.containerName !== undefined) {
    const candidates = table.symbols.filter(
      (symbol) => (symbol.kind === "method" || symbol.kind === "function" || (symbol.kind === "variable" && (symbol.containerName === "module.exports" || symbol.containerName === "exports"))) &&
        symbol.name === methodName &&
        containerMatches(symbol.containerName, context.containerName) &&
        symbol.containerId === undefined,
    );
    if (candidates.length === 1) return candidates[0]?.id;
  }

  // 4. Imported namespace receiver (e.g. import * as api from "./api"; api.ping() or api["ping"]())
  if (receiver !== "this" && tablesByPath !== undefined && resolver !== undefined) {
    const namespaceTarget = resolveNamespaceCall(table, receiver, methodName, tablesByPath, resolver);
    if (namespaceTarget !== undefined) return namespaceTarget;
  }

  return undefined;
}

function nearestScoped(symbols: readonly CodeSymbol[], name: string, context: ResolutionContext): CodeSymbol | undefined {
  for (let current: ScopeFrame | undefined = context.scope; current !== undefined; current = current.parent) {
    const matchingSymbols = symbols.filter((symbol) => symbol.name === name && symbol.scopeId === current.id);
    const callableSymbols = matchingSymbols.filter((symbol) => symbol.kind === "function" || symbol.kind === "class");
    const nonCallableSymbols = matchingSymbols.filter((symbol) => symbol.kind !== "function" && symbol.kind !== "class");
    if (callableSymbols.length === 1) return callableSymbols[0];
    if (callableSymbols.length > 1) return undefined;
    if (nonCallableSymbols.length > 0) return undefined;
    if (context.receiverTypes.has(receiverKey(current, name))) return undefined;
  }
  return undefined;
}

function isInScope(symbol: CodeSymbol, scope: ScopeFrame): boolean {
  for (let current: ScopeFrame | undefined = scope; current !== undefined; current = current.parent) if (symbol.scopeId === current.id) return true;
  return false;
}

function receiverType(receiverTypes: ReadonlyMap<string, string | null>, scope: ScopeFrame, name: string): string | undefined {
  for (let current: ScopeFrame | undefined = scope; current !== undefined; current = current.parent) {
    const entry = receiverTypes.get(receiverKey(current, name));
    if (entry !== undefined) {
      return entry === null ? undefined : entry;
    }
  }
  return undefined;
}

function receiverKey(scope: ScopeFrame, name: string): string {
  return `${scope.id}:${name}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
