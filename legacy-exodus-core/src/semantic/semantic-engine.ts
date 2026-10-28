import { createHash } from "node:crypto";

import type { ASTNode } from "@parser/index";

import type { DependencyGraph } from "@graph/index";
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
    const exportedIds = new Set(params.dependencyGraph.edges.map((edge) => edge.targetExportSymbolId));
    const scopes = params.symbolTables.map((table) => createScope(table.filePath, table.symbols.map((symbol) => symbol.name), params.references.filter((reference) => reference.filePath === table.filePath).map((reference) => reference.name)));
    const unusedImports = params.symbolTables.flatMap((table) => table.symbols.filter((symbol) => isLexicalImportBinding(symbol) && !referencedSymbolIds.has(symbol.id)).map((symbol) => finding(symbol.id, symbol.filePath, symbol.name, "unused-import")));
    const unusedExports = params.symbolTables.flatMap((table) => table.symbols.filter((symbol) => symbol.kind === "export" && !exportedIds.has(symbol.id)).map((symbol) => finding(symbol.id, symbol.filePath, symbol.name, "unused-export")));
    const deadCode = params.symbolTables.flatMap((table) => table.symbols.filter((symbol) => ["function", "method", "class", "variable"].includes(symbol.kind) && !symbol.exported && !referencedSymbolIds.has(symbol.id)).map((symbol) => finding(symbol.id, symbol.filePath, symbol.name, "unreferenced-local-symbol")));

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

function isLexicalImportBinding(symbol: SymbolTable["symbols"][number]): boolean {
  return symbol.kind === "import"
    && (symbol.defaultExport || symbol.sourceSymbolName !== undefined || symbol.name !== symbol.moduleSpecifier);
}

function createScope(filePath: string, declaredSymbols: readonly string[], referencedNames: readonly string[]): ScopeAnalysis {
  return { id: hash(`scope:${filePath}:module`), filePath, name: "module", declaredSymbols: uniqueSorted(declaredSymbols), referencedNames: uniqueSorted(referencedNames) };
}

function finding(symbolId: string, filePath: string, name: string, reason: DeadCodeFinding["reason"]): DeadCodeFinding {
  return { symbolId, filePath, name, reason, state: "INFERRED" };
}

function entryPoints(paths: readonly string[], calls: readonly { readonly sourceFilePath: string; readonly calleeName: string }[]): readonly SemanticEntryPoint[] {
  const conventional = paths.filter((path) => /(^|\/)(index|main|server|app)\.[cm]?[jt]sx?$/.test(path)).map((filePath) => ({ filePath, reason: "conventional-file" as const }));
  const listeners = calls.filter((call) => call.calleeName.endsWith(".listen")).map((call) => ({ filePath: call.sourceFilePath, reason: "http-listener" as const }));
  return uniqueByKey([...conventional, ...listeners], (entry) => `${entry.filePath}:${entry.reason}`);
}

export function findHttpCalls(root: ASTNode, filePath: string, symbolTable: SymbolTable | undefined): { readonly routes: readonly ExpressRoute[]; readonly middlewareChains: readonly MiddlewareChain[] } {
  const receivers = expressReceivers(root, symbolTable);
  const middleware: string[] = [];
  const routes: ExpressRoute[] = [];
  const visit = (node: ASTNode, scopeChain: readonly string[]): void => {
    if (node.type === "CallExpression") {
      const callee = readCallee(node);
      const method = callee?.split(".").at(-1)?.toLowerCase();
      const argumentsNodes = node.children.filter((child) => child.role === "arguments");
      const receiver = callee?.split(".")[0];
      const declarationScope = receiver === undefined
        ? undefined
        : scopeChain.find((scopeId) => receivers.declarations.get(receiver)?.has(scopeId) === true);
      const isExpressReceiver = receiver !== undefined
        && declarationScope !== undefined
        && receivers.proven.get(receiver)?.has(declarationScope) === true;
      if (method === "use" && isExpressReceiver) {
        const names = argumentsNodes.map(readName).filter((name): name is string => name !== undefined && name.trim().length > 0 && !name.startsWith("/"));
        middleware.push(...names);
      }
      if (isExpressReceiver && method !== undefined && ["get", "post", "put", "patch", "delete", "all"].includes(method)) {
        const path = argumentsNodes.map(readString).find((value): value is string => value !== undefined) ?? "/";
        const handlerName = argumentsNodes.map(readName).find((name): name is string => name !== undefined && name.trim().length > 0 && name !== path);
        // The receiver is proven Express, but middleware, handler and mount path are not yet modelled
        // per router (BA-08), so the route fact as a whole is inferred.
        routes.push({ id: hash(`route:${filePath}:${method}:${path}:${node.location?.start.line ?? 0}`), filePath, method: method.toUpperCase(), path, ...(handlerName === undefined ? {} : { handlerName }), middleware: uniqueSorted(middleware), state: "INFERRED" });
      }
    }
    const nestedScope = createsLexicalScope(node)
      ? [createLexicalScopeId(node.type, node.location), ...scopeChain]
      : scopeChain;
    for (const child of node.children) visit(child, nestedScope);
  };
  visit(root, ["scope:module"]);
  return { routes, middlewareChains: middleware.length === 0 ? [] : [{ filePath, middleware: uniqueSorted(middleware) }] };
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
