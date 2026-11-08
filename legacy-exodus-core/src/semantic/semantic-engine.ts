import { createHash } from "node:crypto";

import type { ASTNode } from "@parser/index";

import { canonicalizePath, ModuleResolver, type DependencyGraph } from "@graph/index";
import { stableId } from "@shared/identity";
import { createLexicalScopeId, FactKeyer, numberRepeats, type SymbolTable } from "@symbols/index";

import { DeterministicCallGraphBuilder } from "./call-graph-builder";
import { createSemanticAnalysis, type DeadCodeFinding, type ExpressRoute, type MiddlewareChain, type ScopeAnalysis, type SemanticAnalysis, type SemanticCall, type SemanticEntryPoint, type SymbolReference } from "./semantic-contracts";
import type { SemanticContext } from "./semantic-context";
import { compareCodePoints } from "@shared/ordering";
import { immutable } from "@shared/immutability";

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

  public synthesize(params: SynthesisInput & {
    readonly calls: readonly SemanticCall[];
    readonly references: readonly SymbolReference[];
  }): SemanticAnalysis {
    const usage = new FactUsage();
    usage.add(params.calls, params.references);
    return createSemanticAnalysis({ calls: params.calls, references: params.references, ...this.findings(params, usage) });
  }

  /**
   * `synthesize` for a run whose calls and references were written away file by file (ADR-009 step 3): it needs
   * only what `usage` gathered of them, and its analysis carries no calls or references; the caller holds those.
   */
  public synthesizeFromUsage(params: SynthesisInput & { readonly usage: FactUsage }): Omit<SemanticAnalysis, "calls" | "references"> {
    const { calls: _calls, references: _references, ...analysis } = createSemanticAnalysis({ calls: [], references: [], ...this.findings(params, params.usage) });
    return analysis;
  }

  private findings(params: SynthesisInput, usage: FactUsage): Omit<SemanticAnalysis, "calls" | "references"> {
    const referencedSymbolIds = usage.referencedSymbolIds;
    const modules = moduleTargets(params.symbolTables, params.dependencyGraph, this.callGraphBuilder.resolver);
    const exportedIds = new Set([
      ...params.dependencyGraph.edges.map((edge) => edge.targetExportSymbolId),
      ...referencedSymbolIds,
      ...namespaceExposedExportIds(params.symbolTables, modules),
      ...reexportChainIds(params.symbolTables, modules),
    ]);
    const publicModules = params.publicModules ?? new Set<string>();
    const referencedNamesByFile = usage.referencedNamesByFile;
    // Scopes and dead code read every symbol of a table: from `fullTables`, one at a time, when tables wait on disk.
    const scopes: ScopeAnalysis[] = [];
    const deadCode: DeadCodeFinding[] = [];
    for (const table of params.fullTables?.() ?? params.symbolTables) {
      scopes.push(createScope(table.filePath, table.symbols.map((symbol) => symbol.name), referencedNamesByFile.get(table.filePath) ?? []));
      // A local is a lexical binding: object-literal keys, class members and `x.y =` members are
      // properties, read through objects the references cannot follow, so they are never "unreferenced locals". A leading `_`
      // marks a binding unused on purpose, as `tsc --noUnusedLocals` treats it (BA-11). A parameter before a used one
      // holds a position callers fill, so only parameters after the last used one are dead (ESLint `after-used`).
      const positional = requiredParameterIds(table.symbols, referencedSymbolIds);
      deadCode.push(...table.symbols.filter((symbol) => ["function", "method", "class", "variable"].includes(symbol.kind) && symbol.expression !== true && !symbol.exported && symbol.member !== true && !symbol.name.startsWith("_") && !referencedSymbolIds.has(symbol.id) && !positional.has(symbol.id)
        // Only a function declaration can be the hidden target of an unresolved call by its name (duplicate sloppy
        // declarations, Annex B); a parameter or variable of the same name elsewhere in the file is not (NA-09).
        && (symbol.kind !== "function" || usage.unresolvedCallNamesByFile.get(table.filePath)?.has(symbol.name) !== true)).map((symbol) => finding(symbol.id, symbol.filePath, symbol.name, "unreferenced-local-symbol")));
    }
    const unusedImports = params.symbolTables.flatMap((table) => table.symbols.filter((symbol) => isLexicalImportBinding(symbol) && !referencedSymbolIds.has(symbol.id)).map((symbol) => finding(symbol.id, symbol.filePath, symbol.name, "unused-import")));
    // A computed `import(name)` or `require(name)` can load any module, so no export is provably unused (BA-10).
    const exportState = params.symbolTables.some((table) => (table.unresolvedModuleReferences?.length ?? 0) > 0) ? "REQUIRES_REVIEW" : "INFERRED";
    const unusedExports = params.symbolTables.filter((table) => !publicModules.has(canonicalizePath(table.filePath))).flatMap((table) => table.symbols.filter((symbol) => symbol.kind === "export" && !exportedIds.has(symbol.id)).map((symbol) => finding(symbol.id, symbol.filePath, symbol.name, "unused-export", exportState)));

    return {
      scopes,
      deadCode,
      unusedImports,
      unusedExports,
      entryPoints: entryPoints(params.filePaths, usage.listenerFiles),
      routes: params.httpCalls.flatMap((analysis) => analysis.routes),
      middlewareChains: params.httpCalls.flatMap((analysis) => analysis.middlewareChains),
    };
  }
}

interface SynthesisInput {
  /** Tables with at least each file's imports and exports (all that module and export findings read). */
  readonly symbolTables: readonly SymbolTable[];
  /** Every table in full, in `symbolTables` order, read once (ADR-009 step 2); by default `symbolTables`. */
  readonly fullTables?: () => Iterable<SymbolTable>;
  readonly dependencyGraph: DependencyGraph;
  readonly filePaths: readonly string[];
  readonly httpCalls: readonly { readonly routes: readonly ExpressRoute[]; readonly middlewareChains: readonly MiddlewareChain[] }[];
  /** Package entry modules (main, exports, bin): their exports are public API, used outside the project (BA-11). */
  readonly publicModules?: ReadonlySet<string>;
}

/** An identifier, not a member path or a synthetic name like `mk().run` (NA-01). */
const PLAIN_NAME = /^[A-Za-z_$][\w$]*$/;

/** What synthesis needs of a run's calls and references, gathered one file at a time (ADR-009 step 3). */
export class FactUsage {
  public readonly referencedSymbolIds = new Set<string>();
  /** Referenced names by file, in reference order: one pass, not files × references (BA-17). */
  public readonly referencedNamesByFile = new Map<string, string[]>();
  /** Files of `*.listen` calls, in call order. */
  public readonly listenerFiles: string[] = [];
  /**
   * Plain names of calls the call graph could not resolve, by file (NA-09): the name may still denote a local
   * function declaration (duplicate sloppy declarations, an Annex B block function, a direct `eval`), so no
   * function declaration of that name is claimed unreferenced.
   */
  public readonly unresolvedCallNamesByFile = new Map<string, Set<string>>();

  public add(calls: Iterable<{ readonly sourceFilePath: string; readonly calleeName: string }>, references: Iterable<SymbolReference>): void {
    for (const call of calls) if (call.calleeName.endsWith(".listen")) this.listenerFiles.push(call.sourceFilePath);
    for (const reference of references) {
      if (reference.resolvedSymbolId !== undefined) this.referencedSymbolIds.add(reference.resolvedSymbolId);
      else if (reference.kind === "call" && PLAIN_NAME.test(reference.name)) {
        const names = this.unresolvedCallNamesByFile.get(reference.filePath) ?? new Set<string>();
        names.add(reference.name);
        this.unresolvedCallNamesByFile.set(reference.filePath, names);
      }
      const names = this.referencedNamesByFile.get(reference.filePath);
      if (names === undefined) this.referencedNamesByFile.set(reference.filePath, [reference.name]);
      else names.push(reference.name);
    }
  }
}

/**
 * Exports reachable through a module namespace object (`import * as ns`, `export * as ns from`),
 * following `export *` chains. References carry no member-access context, and a namespace object can
 * escape (`use(ns)`, `ns[key]`), so every export it exposes may be read (BA-09).
 */
function namespaceExposedExportIds(symbolTables: readonly SymbolTable[], modules: ModuleTargets): readonly string[] {
  const { tablesByPath, targetsOf } = modules;
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

/**
 * Re-exports an import passes through (BA-11): `import { a } from "./index"` with
 * `export { a } from "./a"` in the barrel uses that re-export too, and an `export *` the name is
 * found through. The dependency edge targets only the terminal export, so barrels looked unused.
 */
function reexportChainIds(symbolTables: readonly SymbolTable[], modules: ModuleTargets): readonly string[] {
  const { tablesByPath, targetsOf } = modules;
  const used: string[] = [];
  const follow = (filePath: string, name: string, seen: Set<string>): boolean => {
    const key = `${filePath}\u0000${name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const table = tablesByPath.get(filePath);
    if (table === undefined) return false;
    const direct = table.symbols.find((symbol) => symbol.kind === "export" && (name === "default" ? symbol.defaultExport : symbol.name === name && name !== "*"));
    if (direct !== undefined) {
      used.push(direct.id);
      const forwarded = direct.sourceSymbolName ?? name;
      if (direct.moduleSpecifier !== undefined && forwarded !== "*") {
        for (const target of targetsOf(table.filePath, direct.moduleSpecifier)) follow(target, forwarded, seen);
      }
      return true;
    }
    if (name === "default") return false;
    let found = false;
    for (const star of table.symbols) {
      if (star.kind !== "export" || star.name !== "*" || star.moduleSpecifier === undefined) continue;
      for (const target of targetsOf(table.filePath, star.moduleSpecifier)) {
        if (follow(target, name, seen)) { used.push(star.id); found = true; }
      }
    }
    return found;
  };
  for (const table of symbolTables) {
    for (const symbol of table.symbols) {
      if (symbol.kind !== "import" || symbol.moduleSpecifier === undefined || (symbol.sourceSymbolName === "*" && !symbol.defaultExport)) continue;
      const name = symbol.defaultExport ? "default" : symbol.sourceSymbolName ?? symbol.name;
      for (const target of targetsOf(table.filePath, symbol.moduleSpecifier)) follow(target, name, new Set());
    }
  }
  return used;
}

interface ModuleTargets {
  readonly tablesByPath: ReadonlyMap<string, SymbolTable>;
  /** Files `moduleSpecifier` names from `filePath`: its module edges, else the run's resolver. */
  readonly targetsOf: (filePath: string, moduleSpecifier: string) => readonly string[];
}

function moduleTargets(symbolTables: readonly SymbolTable[], dependencyGraph: DependencyGraph, resolver: ModuleResolver): ModuleTargets {
  const tablesByPath = new Map(symbolTables.map((table) => [canonicalizePath(table.filePath), table]));
  const knownPaths = new Set(tablesByPath.keys());
  const edgeTargetsByReference = new Map<string, string[]>();
  for (const edge of dependencyGraph.moduleGraph?.edges ?? []) {
    const key = JSON.stringify([edge.sourceFilePath, edge.moduleSpecifier]);
    edgeTargetsByReference.set(key, [...(edgeTargetsByReference.get(key) ?? []), edge.targetFilePath]);
  }
  const targetsOf = (filePath: string, moduleSpecifier: string): readonly string[] => {
    const origin = canonicalizePath(filePath);
    // Imports carry module edges resolved with the project's tsconfig; re-exports do not, so they
    // fall back to the run's resolver.
    const edgeTargets = edgeTargetsByReference.get(JSON.stringify([origin, moduleSpecifier]));
    if (edgeTargets !== undefined) return edgeTargets;
    const resolved = resolver.resolve(origin, moduleSpecifier, knownPaths).resolvedPath;
    return resolved === null ? [] : [resolved];
  };
  return { tablesByPath, targetsOf };
}

/** Unused parameters that precede a used parameter of the same function: they keep later ones in place. */
function requiredParameterIds(symbols: SymbolTable["symbols"], referenced: ReadonlySet<string>): ReadonlySet<string> {
  const byFunction = new Map<string, SymbolTable["symbols"][number][]>();
  for (const symbol of symbols) {
    if (symbol.declarationKind !== "param" || symbol.scopeId === undefined) continue;
    byFunction.set(symbol.scopeId, [...(byFunction.get(symbol.scopeId) ?? []), symbol]);
  }
  const required = new Set<string>();
  for (const parameters of byFunction.values()) {
    const ordered = [...parameters].sort((left, right) => (left.location?.start.line ?? 0) - (right.location?.start.line ?? 0) || (left.location?.start.column ?? 0) - (right.location?.start.column ?? 0));
    const lastUsed = ordered.map((parameter) => referenced.has(parameter.id)).lastIndexOf(true);
    for (const parameter of ordered.slice(0, Math.max(lastUsed, 0))) required.add(parameter.id);
  }
  return required;
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

function entryPoints(paths: readonly string[], listenerFiles: readonly string[]): readonly SemanticEntryPoint[] {
  const conventional = paths.filter((path) => /(^|\/)(index|main|server|app)\.[cm]?[jt]sx?$/.test(path)).map((filePath) => ({ filePath, reason: "conventional-file" as const }));
  const listeners = listenerFiles.map((filePath) => ({ filePath, reason: "http-listener" as const }));
  return uniqueByKey([...conventional, ...listeners], (entry) => `${entry.filePath}:${entry.reason}`);
}

const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "all", "options", "head"]);

interface UseEvent { readonly order: number; readonly paths: readonly string[] | undefined; readonly middleware: readonly string[]; readonly routers: readonly string[] }
interface RouteEvent { readonly order: number; readonly node: ASTNode; readonly method: string; readonly paths: readonly string[]; readonly middleware: readonly string[]; readonly handlerName: string | undefined }

/**
 * Express routes and middleware per proven receiver (BA-08):
 * - each app or router keeps its own middleware stack, in registration order, and a route gets the
 *   middleware its receiver registered before it, then its own route-level middleware;
 * - the handler is the last argument; a path array registers the route (or mount) at each of its
 *   paths, and a path that is not a literal (regex, template, array of non-literals) is `<dynamic>`;
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
        const paths = args[0] === undefined ? undefined : routePaths(args[0]);
        const rest = paths === undefined ? args : args.slice(1);
        const routers = rest.flatMap((argument) => { const mounted = argument.type === "Identifier" ? receiverAt(readName(argument), scopeChain) : undefined; return mounted === undefined ? [] : [mounted]; });
        const middleware = rest.filter((argument) => !(argument.type === "Identifier" && receiverAt(readName(argument), scopeChain) !== undefined)).map(middlewareName);
        uses.get(receiver)!.push({ order: order++, paths, middleware, routers });
      } else if (receiver !== undefined && method !== undefined && ROUTE_METHODS.has(method) && !(method === "get" && args.length === 1)) {
        note(receiver);
        const paths = args[0] === undefined ? undefined : routePaths(args[0]);
        const functions = paths === undefined ? args : args.slice(1);
        const last = functions.at(-1);
        const handlerName = last === undefined ? undefined : readName(last);
        registrations.get(receiver)!.push({ order: order++, node, method, paths: paths ?? [DYNAMIC_PATH], middleware: functions.slice(0, -1).map(middlewareName), handlerName: handlerName === undefined || handlerName.trim().length === 0 ? undefined : handlerName });
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
    for (const event of events) {
      for (const child of event.routers) {
        for (const path of event.paths ?? ["/"]) mounts.set(child, [...(mounts.get(child) ?? []), { parent, path, order: event.order }]);
      }
    }
  }
  const stackBefore = (receiver: string, before: number): readonly string[] => (uses.get(receiver) ?? []).filter((event) => event.order < before).flatMap((event) => event.middleware);
  /** Every way a request reaches `receiver`: the path prefix and middleware it passes on the way. */
  const entries = (receiver: string, before: number, seen: ReadonlySet<string>): readonly { readonly prefix: string; readonly middleware: readonly string[] }[] => {
    const own = stackBefore(receiver, before);
    const via = mounts.get(receiver) ?? [];
    if (via.length === 0 || seen.has(receiver)) return [{ prefix: "", middleware: own }];
    const next = new Set([...seen, receiver]);
    return via.flatMap((mount) => entries(mount.parent, mount.order, next).map((outer) => ({
      prefix: outer.prefix === DYNAMIC_PATH || mount.path === DYNAMIC_PATH ? DYNAMIC_PATH : joinRoutePath(outer.prefix, mount.path),
      middleware: [...outer.middleware, ...own],
    })));
  };

  // Edit-stable keys (ADR-008): a route by the owners of the code that registers it, its method and full path; a
  // middleware chain by the owners of the scope declaring its receiver, and the receiver's name.
  const keyer = new FactKeyer(filePath, root, (symbolTable?.symbols ?? []).filter((symbol) => symbol.kind === "function" || symbol.kind === "method" || symbol.kind === "class"));
  const unkeyed: Omit<ExpressRoute, "key">[] = [];
  const routeBases: string[] = [];
  for (const receiver of receiverOrder) {
    for (const route of registrations.get(receiver) ?? []) {
      for (const entry of entries(receiver, route.order, new Set())) for (const routePath of route.paths) {
        const path = routePath === DYNAMIC_PATH || entry.prefix === DYNAMIC_PATH ? DYNAMIC_PATH : joinRoutePath(entry.prefix, routePath);
        routeBases.push(`${keyer.ownerKey(route.node.location?.start)}route:${route.method.toUpperCase()} ${path}`);
        unkeyed.push({
          id: hash(`route:${filePath}:${route.method}:${path}:${route.node.location?.start.line ?? 0}`),
          filePath, method: route.method.toUpperCase(), path,
          ...(route.handlerName === undefined ? {} : { handlerName: route.handlerName }),
          middleware: immutable([...entry.middleware, ...route.middleware]), state: "INFERRED",
        });
      }
    }
  }
  const routeKeys = numberRepeats(routeBases);
  const routes: ExpressRoute[] = unkeyed.map((route, index) => ({ ...route, id: stableId("route", routeKeys[index]!), key: routeKeys[index]! }));
  const chained = receiverOrder.flatMap((receiver) => {
    const middleware = (uses.get(receiver) ?? []).flatMap((event) => event.middleware);
    const at = receiver.indexOf("@");
    return middleware.length === 0 ? [] : [{ base: `${keyer.scopeKey(receiver.slice(at + 1))}middleware:${receiver.slice(0, at)}`, middleware: immutable(middleware) }];
  });
  const chainKeys = numberRepeats(chained.map((chain) => chain.base));
  const middlewareChains = chained.map((chain, index) => ({ key: chainKeys[index]!, filePath, middleware: chain.middleware }));
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

const DYNAMIC_PATH = "<dynamic>";

/**
 * The paths a route or mount argument names: a string literal, or each element of an array of them.
 * A regex, template or computed path is one `<dynamic>` path. Anything else (an identifier, a call)
 * may be middleware, so it is not a path.
 */
function routePaths(node: ASTNode): readonly string[] | undefined {
  const literal = readString(node);
  if (literal !== undefined) return [literal];
  if (node.type === "ArrayExpression") {
    const elements = node.children.filter((child) => child.role === "elements").map(readString);
    return elements.length > 0 && elements.every((path) => path !== undefined) ? elements as string[] : [DYNAMIC_PATH];
  }
  return node.type === "RegExpLiteral" || node.type === "TemplateLiteral" || node.type === "BinaryExpression" ? [DYNAMIC_PATH] : undefined;
}

/**
 * `/admin` + `/secret` → `/admin/secret`: one slash between parts and a leading slash. The route's
 * own trailing slash is kept (it matters under strict routing); a mounted `/` is the mount path itself.
 */
function joinRoutePath(prefix: string, path: string): string {
  const head = prefix.replace(/\/+$/, "");
  const joined = head.length > 0 && path === "/" ? head : `${head}/${path}`.replace(/\/{2,}/g, "/");
  return joined.startsWith("/") ? joined : `/${joined}`;
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
  return immutable([...new Set(values)].sort());
}

function uniqueByKey<T>(items: readonly T[], key: (item: T) => string): readonly T[] {
  const unique = new Map<string, T>();
  for (const item of items) unique.set(key(item), item);
  return [...unique.values()].sort((left, right) => compareCodePoints(key(left), key(right)));
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
