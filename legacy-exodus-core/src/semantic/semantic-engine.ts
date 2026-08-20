import { createHash } from "node:crypto";

import type { ASTNode } from "@parser/index";

import { DeterministicCallGraphBuilder } from "./call-graph-builder";
import { createSemanticAnalysis, type DeadCodeFinding, type ExpressRoute, type MiddlewareChain, type ScopeAnalysis, type SemanticAnalysis, type SemanticEntryPoint } from "./semantic-contracts";
import type { SemanticContext } from "./semantic-context";

export class DeterministicSemanticAnalysisEngine {
  public constructor(private readonly callGraphBuilder: DeterministicCallGraphBuilder = new DeterministicCallGraphBuilder()) {}

  public analyze(context: SemanticContext): SemanticAnalysis {
    const callGraph = this.callGraphBuilder.build(context.astResults, context.symbolTables, context.dependencyGraph);
    const referencedSymbolIds = new Set(callGraph.references.flatMap((reference) => reference.resolvedSymbolId === undefined ? [] : [reference.resolvedSymbolId]));
    const importedIds = new Set(context.dependencyGraph.edges.map((edge) => edge.importSymbolId));
    const exportedIds = new Set(context.dependencyGraph.edges.map((edge) => edge.targetExportSymbolId));
    const scopes = context.symbolTables.map((table) => createScope(table.filePath, table.symbols.map((symbol) => symbol.name), callGraph.references.filter((reference) => reference.filePath === table.filePath).map((reference) => reference.name)));
    const unusedImports = context.symbolTables.flatMap((table) => table.symbols.filter((symbol) => symbol.kind === "import" && !importedIds.has(symbol.id)).map((symbol) => finding(symbol.id, symbol.filePath, symbol.name, "unused-import")));
    const unusedExports = context.symbolTables.flatMap((table) => table.symbols.filter((symbol) => symbol.kind === "export" && !exportedIds.has(symbol.id)).map((symbol) => finding(symbol.id, symbol.filePath, symbol.name, "unused-export")));
    const deadCode = context.symbolTables.flatMap((table) => table.symbols.filter((symbol) => ["function", "method", "class", "variable"].includes(symbol.kind) && !symbol.exported && !referencedSymbolIds.has(symbol.id)).map((symbol) => finding(symbol.id, symbol.filePath, symbol.name, "unreferenced-local-symbol")));
    const httpCalls = context.astResults.map((ast) => findHttpCalls(ast.root, ast.metadata.sourcePath));

    return createSemanticAnalysis({
      calls: callGraph.calls,
      references: callGraph.references,
      scopes,
      deadCode,
      unusedImports,
      unusedExports,
      entryPoints: entryPoints(context.astResults.map((ast) => ast.metadata.sourcePath), callGraph.calls),
      routes: httpCalls.flatMap((analysis) => analysis.routes),
      middlewareChains: httpCalls.flatMap((analysis) => analysis.middlewareChains),
    });
  }
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

function findHttpCalls(root: ASTNode, filePath: string): { readonly routes: readonly ExpressRoute[]; readonly middlewareChains: readonly MiddlewareChain[] } {
  const receivers = expressReceivers(root);
  const middleware: string[] = [];
  const routes: ExpressRoute[] = [];
  const visit = (node: ASTNode): void => {
    if (node.type === "CallExpression") {
      const callee = readCallee(node);
      const method = callee?.split(".").at(-1)?.toLowerCase();
      const argumentsNodes = node.children.filter((child) => child.role === "arguments");
      const receiver = callee?.split(".")[0];
      const isExpressReceiver = receiver !== undefined && receivers.has(receiver);
      if (method === "use" && isExpressReceiver) {
        const names = argumentsNodes.map(readName).filter((name): name is string => name !== undefined && !name.startsWith("/"));
        middleware.push(...names);
      }
      if (isExpressReceiver && method !== undefined && ["get", "post", "put", "patch", "delete", "all"].includes(method)) {
        const path = argumentsNodes.map(readString).find((value): value is string => value !== undefined) ?? "/";
        const handlerName = argumentsNodes.map(readName).find((name): name is string => name !== undefined && name !== path);
        routes.push({ id: hash(`route:${filePath}:${method}:${path}:${node.location?.start.line ?? 0}`), filePath, method: method.toUpperCase(), path, ...(handlerName === undefined ? {} : { handlerName }), middleware: uniqueSorted(middleware), state: "CONFIRMED" });
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return { routes, middlewareChains: middleware.length === 0 ? [] : [{ filePath, middleware: uniqueSorted(middleware) }] };
}

function expressReceivers(root: ASTNode): ReadonlySet<string> {
  const receivers = new Set<string>();
  const visit = (node: ASTNode): void => {
    if (node.type === "VariableDeclarator") {
      const name = readName(node.children.find((child) => child.role === "id") ?? node);
      const init = node.children.find((child) => child.role === "init");
      const initCallee = init?.type === "CallExpression" ? readCallee(init) : undefined;
      if (name !== undefined && (initCallee === "express" || initCallee === "Router" || initCallee === "express.Router")) receivers.add(name);
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return receivers;
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
  return [...unique.values()].sort((left, right) => key(left).localeCompare(key(right)));
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
