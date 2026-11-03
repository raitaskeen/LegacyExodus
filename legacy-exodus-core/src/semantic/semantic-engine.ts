import { createHash } from "node:crypto";

import type { ASTNode } from "@parser/index";

import { canonicalizePath, ModuleResolver, type DependencyGraph } from "@graph/index";
import { createLexicalScopeId, type SymbolTable } from "@symbols/index";

import { DeterministicCallGraphBuilder } from "./call-graph-builder";
import { createSemanticAnalysis, type DeadCodeFinding, type ExpressRoute, type MiddlewareChain, type ScopeAnalysis, type SemanticAnalysis, type SemanticCall, type SemanticEntryPoint, type SymbolReference } from "./semantic-contracts";
import type { SemanticContext } from "./semantic-context";
import { compareCodePoints } from "@shared/ordering";

export class DeterministicSemanticAnalysisEngine {
  public constructor(public readonly callGraphBuilder: DeterministicCallGraphBuilder = new DeterministicCallGraphBuilder()) {}

  public analyze(context: SemanticContext): SemanticAnalysis {
    const callGraph = this.callGraphBuilder.build(context.astResults, context.symbolTables, context.dependencyGraph);
    const symbolTablesByPath = new Map(context.symbolTables.map((table) => [table.filePath, table]));
    const httpCalls = context.astResults.map((ast) =>
      findHttpCalls(ast.root, ast.metadata.sourcePath, symbolTablesByPath.get(ast.metadata.sourcePath)),
    );
    return this.synthesize({
      calls: callGraph.calls,
      references: callGraph.references,
      symbolTables: context.symbolTables,
      dependencyGraph: context.dependencyGraph,
      filePaths: context.astResults.map((ast) => ast.metadata.sourcePath),
      httpCalls,
    });
  }

  public synthesize(params: {
    readonly calls: readonly SemanticCall[];
    readonly references: readonly SymbolReference[];
    readonly symbolTables: readonly SymbolTable[];
    readonly dependencyGraph: DependencyGraph;
    readonly filePaths: readonly string[];
    readonly httpCalls: readonly { readonly routes: readonly ExpressRoute[]; readonly middlewareChains: readonly MiddlewareChain[] }[];
  }): SemanticAnalysis {
    const referencedSymbolIds = new Set(params.references.flatMap((reference) => reference.resolvedSymbolId === undefined ? [] : [reference.resolvedSymbolId]));
    const exportedIds = new Set([
      ...params.dependencyGraph.edges.map((edge) => edge.targetExportSymbolId),
      ...referencedSymbolIds,
      ...namespaceExposedExportIds(params.symbolTables, params.dependencyGraph, this.callGraphBuilder.resolver),
    ]);
    // One pass groups references by file; filtering all references per file was files × references (BA-17).
    const referencedNamesByFile = new Map<string, string[]>();
    for (const reference of params.references) {
      const names = referencedNamesByFile.get(reference.filePath);
      if (names === undefined) referencedNamesByFile.set(reference.filePath, [reference.name]);
      else names.push(reference.name);
    }
    const scopes = params.symbolTables.map((table) => createScope(table.filePath, table.symbols.map((symbol) => symbol.name), referencedNamesByFile.get(table.filePath) ?? []));
    const unusedImports = params.symbolTables.flatMap((table) => table.symbols.filter((symbol) => isLexicalImportBinding(symbol) && !referencedSymbolIds.has(symbol.id)).map((symbol) => finding(symbol.id, symbol.filePath, symbol.name, "unused-import")));
    // A computed `import(name)` or `require(name)` can load any module, so no export is provably unused (BA-10).
    const exportState = params.symbolTables.some((table) => (table.unresolvedModuleReferences?.length ?? 0) > 0) ? "REQUIRES_REVIEW" : "INFERRED";
    const unusedExports = params.symbolTables.flatMap((table) => table.symbols.filter((symbol) => symbol.kind === "export" && !exportedIds.has(symbol.id)).map((symbol) => finding(symbol.id, symbol.filePath, symbol.name, "unused-export", exportState)));
    const deadCode = params.symbolTables.flatMap((table) => table.symbols.filter((symbol) => ["function", "method", "class", "variable"].includes(symbol.kind) && symbol.expression !== true && !symbol.exported && !referencedSymbolIds.has(symbol.id)).map((symbol) => finding(symbol.id, symbol.filePath, symbol.name, "unreferenced-local-symbol")));

    return createSemanticAnalysis({
      calls: params.calls,
      references: params.references,
      scopes,
      deadCode,
      unusedImports,
      unusedExports,
      entryPoints: entryPoints(params.filePaths, params.calls),
      routes: params.httpCalls.flatMap((analysis) => analysis.routes),
      middlewareChains: params.httpCalls.flatMap((analysis) => analysis.middlewareChains),
    });
  }
}

/**
 * Exports reachable through a module namespace object (`import * as ns`, `export * as ns from`),
 * following `export *` chains. References carry no member-access context, and a namespace object can
 * escape (`use(ns)`, `ns[key]`), so every export it exposes may be read (BA-09).
 */
function namespaceExposedExportIds(symbolTables: readonly SymbolTable[], dependencyGraph: DependencyGraph, resolver: ModuleResolver): readonly string[] {
  const tablesByPath = new Map(symbolTables.map((table) => [canonicalizePath(table.filePath), table]));
  const knownPaths = new Set(tablesByPath.keys());
  const edgeTargetsByReference = new Map<string, string[]>();
  for (const edge of dependencyGraph.moduleGraph?.edges ?? []) {
    const key = JSON.stringify([edge.sourceFilePath, edge.moduleSpecifier]);
    edgeTargetsByReference.set(key, [...(edgeTargetsByReference.get(key) ?? []), edge.targetFilePath]);
  }
  const targetsOf = (filePath: string, moduleSpecifier: string): readonly string[] => {
    const source = canonicalizePath(filePath);
    // Imports carry module edges resolved with the project's tsconfig; re-exports do not, so they
    // fall back to the default resolver.
    const edgeTargets = edgeTargetsByReference.get(JSON.stringify([source, moduleSpecifier]));
    if (edgeTargets !== undefined) return edgeTargets;
    const resolved = resolver.resolve(source, moduleSpecifier, knownPaths).resolvedPath;
    return resolved === null ? [] : [resolved];
  };
  const pending = symbolTables.flatMap((table) => [
    ...table.symbols.flatMap((symbol) =>
      symbol.moduleSpecifier !== undefined && symbol.sourceSymbolName === "*" && !symbol.defaultExport
        && (symbol.kind === "import" || symbol.kind === "export")
        ? targetsOf(table.filePath, symbol.moduleSpecifier)
        : []),
    // `import("x")` evaluates to x's namespace object (BA-10).
    ...(table.moduleReferences ?? []).flatMap((reference) => reference.form === "dynamic-import" ? targetsOf(table.filePath, reference.moduleSpecifier) : []),
  ]);
  const visited = new Set<string>();
  const exposed: string[] = [];
  while (pending.length > 0) {
    const filePath = pending.pop() as string;
    if (visited.has(filePath)) continue;
    visited.add(filePath);
    const table = tablesByPath.get(filePath);
    if (table === undefined) continue;
    for (const symbol of table.symbols) {
      if (symbol.kind !== "export") continue;
      exposed.push(symbol.id);
      if (symbol.name === "*" && symbol.moduleSpecifier !== undefined) pending.push(...targetsOf(table.filePath, symbol.moduleSpecifier));
    }
  }
  return exposed;
}

function isLexicalImportBinding(symbol: SymbolTable["symbols"][number]): boolean {
  return symbol.kind === "import"
    && (symbol.defaultExport || symbol.sourceSymbolName !== undefined || symbol.name !== symbol.moduleSpecifier);
}

function createScope(filePath: string, declaredSymbols: readonly string[], referencedNames: readonly string[]): ScopeAnalysis {
  return { id: hash(`scope:${filePath}:module`), filePath, name: "module", declaredSymbols: uniqueSorted(declaredSymbols), referencedNames: uniqueSorted(referencedNames) };
}

function finding(symbolId: string, filePath: string, name: string, reason: DeadCodeFinding["reason"], state: DeadCodeFinding["state"] = "INFERRED"): DeadCodeFinding {
  return { symbolId, filePath, name, reason, state };
}

function entryPoints(paths: readonly string[], calls: readonly { readonly sourceFilePath: string; readonly calleeName: string }[]): readonly SemanticEntryPoint[] {
  const conventional = paths.filter((path) => /(^|\/)(index|main|server|app)\.[cm]?[jt]sx?$/.test(path)).map((filePath) => ({ filePath, reason: "conventional-file" as const }));
  const listeners = calls.filter((call) => call.calleeName.endsWith(".listen")).map((call) => ({ filePath: call.sourceFilePath, reason: "http-listener" as const }));
  return uniqueByKey([...conventional, ...listeners], (entry) => `${entry.filePath}:${entry.reason}`);
}

const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "all", "options", "head"]);

interface UseEvent { readonly order: number; readonly path: string | undefined; readonly middleware: readonly string[]; readonly routers: readonly string[] }
interface RouteEvent { readonly order: number; readonly node: ASTNode; readonly method: string; readonly path: string; readonly middleware: readonly string[]; readonly handlerName: string | undefined }

/**
 * Express routes and middleware per proven receiver (BA-08):
 * - each app or router keeps its own middleware stack, in registration order, and a route gets the
 *   middleware its receiver registered before it, then its own route-level middleware;
 * - the handler is the last argument;
 * - `get(name)` with one argument reads a setting and is not a route;
 * - `parent.use(path?, router)` mounts a router: its routes are reported under the joined path, after
 *   the parent's middleware registered before the mount; a router mounted nowhere in this file keeps
 *   its own paths (it may be mounted from another file);
 * - middleware is named by its expression (`auth`, `express.json()`); an inline function is
 *   `<anonymous>`, so none is dropped.
 * Routes stay INFERRED: mounts from other files and middleware that ends the request are not modelled.
 */
export function findHttpCalls(root: ASTNode, filePath: string, symbolTable: SymbolTable | undefined): { readonly routes: readonly ExpressRoute[]; readonly middlewareChains: readonly MiddlewareChain[] } {
  const receivers = expressReceivers(root, symbolTable);
  const uses = new Map<string, UseEvent[]>();
  const registrations = new Map<string, RouteEvent[]>();
  const receiverOrder: string[] = [];
  let order = 0;
  const receiverAt = (name: string | undefined, scopeChain: readonly string[]): string | undefined => {
    if (name === undefined) return undefined;
    const scope = scopeChain.find((scopeId) => receivers.declarations.get(name)?.has(scopeId) === true);
    return scope !== undefined && receivers.proven.get(name)?.has(scope) === true ? `${name}@${scope}` : undefined;
  };
  const note = (receiver: string): void => { if (!uses.has(receiver)) { uses.set(receiver, []); registrations.set(receiver, []); receiverOrder.push(receiver); } };
  const visit = (node: ASTNode, scopeChain: readonly string[]): void => {
    if (node.type === "CallExpression") {
      const callee = node.children.find((child) => child.role === "callee");
      const object = callee?.type === "MemberExpression" && callee.attributes.computed !== true ? callee.children.find((child) => child.role === "object") : undefined;
      const method = callee === undefined || object === undefined ? undefined : readName(callee.children.find((child) => child.role === "property") ?? callee)?.toLowerCase();
      const receiver = object?.type === "Identifier" ? receiverAt(readName(object), scopeChain) : undefined;
      const args = node.children.filter((child) => child.role === "arguments");
      if (receiver !== undefined && method === "use") {
        note(receiver);
        const path = args[0] === undefined ? undefined : readString(args[0]);
        const rest = path === undefined ? args : args.slice(1);
        const routers = rest.flatMap((argument) => { const mounted = argument.type === "Identifier" ? receiverAt(readName(argument), scopeChain) : undefined; return mounted === undefined ? [] : [mounted]; });
        const middleware = rest.filter((argument) => !(argument.type === "Identifier" && receiverAt(readName(argument), scopeChain) !== undefined)).map(middlewareName);
        uses.get(receiver)!.push({ order: order++, path, middleware, routers });
      } else if (receiver !== undefined && method !== undefined && ROUTE_METHODS.has(method) && !(method === "get" && args.length === 1)) {
        note(receiver);
        const path = args[0] === undefined ? undefined : readString(args[0]);
        const functions = path === undefined ? args : args.slice(1);
        const last = functions.at(-1);
        const handlerName = last === undefined ? undefined : readName(last);
        registrations.get(receiver)!.push({ order: order++, node, method, path: path ?? "<dynamic>", middleware: functions.slice(0, -1).map(middlewareName), handlerName: handlerName === undefined || handlerName.trim().length === 0 ? undefined : handlerName });
      }
    }
    const nestedScope = createsLexicalScope(node)
      ? [createLexicalScopeId(node.type, node.location), ...scopeChain]
      : scopeChain;
    for (const child of node.children) visit(child, nestedScope);
  };
  visit(root, ["scope:module"]);

  // Where each router is mounted: parent, joined prefix, and the parent's middleware before the mount.
  const mounts = new Map<string, { readonly parent: string; readonly path: string; readonly order: number }[]>();
  for (const [parent, events] of uses) {
    for (const event of events) for (const child of event.routers) mounts.set(child, [...(mounts.get(child) ?? []), { parent, path: event.path ?? "/", order: event.order }]);
  }
  const stackBefore = (receiver: string, before: number): readonly string[] => (uses.get(receiver) ?? []).filter((event) => event.order < before).flatMap((event) => event.middleware);
  /** Every way a request reaches `receiver`: the path prefix and middleware it passes on the way. */
  const entries = (receiver: string, before: number, seen: ReadonlySet<string>): readonly { readonly prefix: string; readonly middleware: readonly string[] }[] => {
    const own = stackBefore(receiver, before);
    const via = mounts.get(receiver) ?? [];
    if (via.length === 0 || seen.has(receiver)) return [{ prefix: "", middleware: own }];
    const next = new Set([...seen, receiver]);
    return via.flatMap((mount) => entries(mount.parent, mount.order, next).map((outer) => ({ prefix: joinRoutePath(outer.prefix, mount.path), middleware: [...outer.middleware, ...own] })));
  };

  const routes: ExpressRoute[] = [];
  for (const receiver of receiverOrder) {
    for (const route of registrations.get(receiver) ?? []) {
      for (const entry of entries(receiver, route.order, new Set())) {
        const path = route.path === "<dynamic>" ? route.path : joinRoutePath(entry.prefix, route.path);
        routes.push({
          id: hash(`route:${filePath}:${route.method}:${path}:${route.node.location?.start.line ?? 0}`),
          filePath, method: route.method.toUpperCase(), path,
          ...(route.handlerName === undefined ? {} : { handlerName: route.handlerName }),
          middleware: Object.freeze([...entry.middleware, ...route.middleware]), state: "INFERRED",
        });
      }
    }
  }
  const middlewareChains = receiverOrder.flatMap((receiver) => {
    const middleware = (uses.get(receiver) ?? []).flatMap((event) => event.middleware);
    return middleware.length === 0 ? [] : [{ filePath, middleware: Object.freeze(middleware) }];
  });
  return { routes, middlewareChains };
}

/** A middleware argument's name: its identifier or member path, `call()` for a call, `<anonymous>` otherwise. */
function middlewareName(node: ASTNode): string {
  const name = readName(node);
  if (name !== undefined && name.trim().length > 0) return name;
  if (node.type === "CallExpression") {
    const callee = readCallee(node);
    return callee === undefined ? "<anonymous>" : `${callee}()`;
  }
  return "<anonymous>";
}

/** `/admin` + `/secret` → `/admin/secret`; one slash between parts, a leading slash, no trailing one. */
function joinRoutePath(prefix: string, path: string): string {
  const joined = `${prefix}/${path}`.replace(/\/{2,}/g, "/");
  const trimmed = joined.length > 1 ? joined.replace(/\/+$/, "") : joined;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function expressReceivers(root: ASTNode, symbolTable: SymbolTable | undefined): {
  readonly declarations: ReadonlyMap<string, ReadonlySet<string>>;
  readonly proven: ReadonlyMap<string, ReadonlySet<string>>;
} {
  const imports = symbolTable?.symbols.filter(
    (symbol) =>
      symbol.kind === "import"
      && symbol.moduleSpecifier === "express",
  ) ?? [];
  const defaultFactories = new Set(imports.filter((symbol) => symbol.defaultExport).map((symbol) => symbol.name));
  const routerFactories = new Set(
    imports.filter((symbol) => symbol.sourceSymbolName === "Router").map((symbol) => symbol.name),
  );
  const namespaceBindings = new Set(
    imports.filter((symbol) => symbol.sourceSymbolName === "*").map((symbol) => symbol.name),
  );
  const shadowingScopesByName = new Map<string, Set<string>>();
  const declarationScopesByName = new Map<string, Set<string>>();
  for (const symbol of symbolTable?.symbols ?? []) {
    if (symbol.scopeId === undefined) continue;
    const declarations = declarationScopesByName.get(symbol.name) ?? new Set<string>();
    declarations.add(symbol.scopeId);
    declarationScopesByName.set(symbol.name, declarations);
    const isImportBackedBinding = symbol.kind === "variable" && imports.some(
      (imported) =>
        imported.name === symbol.name
        && imported.location?.start.line === symbol.location?.start.line
        && imported.location?.start.column === symbol.location?.start.column,
    );
    if (!["class", "function", "variable"].includes(symbol.kind) || isImportBackedBinding) continue;
    const scopes = shadowingScopesByName.get(symbol.name) ?? new Set<string>();
    scopes.add(symbol.scopeId);
    shadowingScopesByName.set(symbol.name, scopes);
  }
  const receivers = new Map<string, Set<string>>();
  const visit = (node: ASTNode, scopeChain: readonly string[]): void => {
    if (node.type === "VariableDeclarator") {
      const name = readName(node.children.find((child) => child.role === "id") ?? node);
      const init = node.children.find((child) => child.role === "init");
      const initCallee = init?.type === "CallExpression" ? readCallee(init) : undefined;
      const [factoryReceiver, factoryMethod] = initCallee?.split(".") ?? [];
      const factoryBinding = factoryMethod === "Router" ? factoryReceiver : initCallee;
      const isShadowed = factoryBinding !== undefined
        && scopeChain.some((scopeId) => shadowingScopesByName.get(factoryBinding)?.has(scopeId) === true);
      const isProvenFactory = initCallee !== undefined && (
        defaultFactories.has(initCallee)
        || routerFactories.has(initCallee)
        || (factoryMethod === "Router"
          && factoryReceiver !== undefined
          && (defaultFactories.has(factoryReceiver) || namespaceBindings.has(factoryReceiver)))
      ) && !isShadowed;
      if (name !== undefined && isProvenFactory) {
        const declarationScope = symbolTable?.symbols.find(
          (symbol) =>
            symbol.kind === "variable"
            && symbol.name === name
            && symbol.location?.start.line === node.location?.start.line
            && symbol.location?.start.column === node.location?.start.column,
        )?.scopeId ?? scopeChain[0];
        if (declarationScope !== undefined) {
          const scopes = receivers.get(name) ?? new Set<string>();
          scopes.add(declarationScope);
          receivers.set(name, scopes);
        }
      }
    }
    const nestedScope = createsLexicalScope(node)
      ? [createLexicalScopeId(node.type, node.location), ...scopeChain]
      : scopeChain;
    for (const child of node.children) visit(child, nestedScope);
  };
  visit(root, ["scope:module"]);
  return { declarations: declarationScopesByName, proven: receivers };
}

function createsLexicalScope(node: ASTNode): boolean {
  return [
    "ArrowFunctionExpression",
    "BlockStatement",
    "CatchClause",
    "ClassMethod",
    "ClassPrivateMethod",
    "ForInStatement",
    "ForOfStatement",
    "ForStatement",
    "FunctionDeclaration",
    "FunctionExpression",
    "ObjectMethod",
    "StaticBlock",
    "SwitchStatement",
    "TSModuleDeclaration",
  ].includes(node.type);
}

function readCallee(node: ASTNode): string | undefined {
  const callee = node.children.find((child) => child.role === "callee");
  return callee === undefined ? undefined : readName(callee);
}

function readName(node: ASTNode): string | undefined {
  if (node.type === "Identifier" && typeof node.attributes.name === "string") return node.attributes.name;
  if (node.type === "StringLiteral" && typeof node.attributes.value === "string") return node.attributes.value;
  if (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") {
    const object = node.children.find((child) => child.role === "object");
    const property = node.children.find((child) => child.role === "property");
    const objectName = object === undefined ? undefined : readName(object);
    const propertyName = property === undefined ? undefined : readName(property);
    return objectName === undefined || propertyName === undefined ? undefined : `${objectName}.${propertyName}`;
  }
  return undefined;
}

function readString(node: ASTNode): string | undefined {
  return node.type === "StringLiteral" && typeof node.attributes.value === "string" ? node.attributes.value : undefined;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function uniqueByKey<T>(items: readonly T[], key: (item: T) => string): readonly T[] {
  const unique = new Map<string, T>();
  for (const item of items) unique.set(key(item), item);
  return [...unique.values()].sort((left, right) => compareCodePoints(key(left), key(right)));
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
