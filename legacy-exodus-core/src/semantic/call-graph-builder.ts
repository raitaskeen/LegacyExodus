import { createHash } from "node:crypto";

import type { ASTNode, ASTResult } from "@parser/index";
import type { DependencyGraph } from "@graph/index";
import type { SymbolTable } from "@symbols/index";

import type { SemanticCall, SymbolReference } from "./semantic-contracts";

export class DeterministicCallGraphBuilder {
  public build(astResults: readonly ASTResult[], symbolTables: readonly SymbolTable[], dependencyGraph: DependencyGraph): { readonly calls: readonly SemanticCall[]; readonly references: readonly SymbolReference[] } {
    const tablesByPath = new Map(symbolTables.map((table) => [table.filePath, table]));
    const importsByFile = new Map(symbolTables.map((table) => [table.filePath, table.symbols.filter((symbol) => symbol.kind === "import")]));
    const targetByImportId = new Map(dependencyGraph.edges.map((edge) => [edge.importSymbolId, edge.targetExportSymbolId]));
    const calls: SemanticCall[] = [];
    const references: SymbolReference[] = [];

    for (const ast of [...astResults].sort((left, right) => left.metadata.sourcePath.localeCompare(right.metadata.sourcePath))) {
      this.visit(ast.root, ast, "module", tablesByPath, importsByFile, targetByImportId, calls, references);
    }

    return Object.freeze({ calls: Object.freeze(calls), references: Object.freeze(references) });
  }

  private visit(
    node: ASTNode,
    ast: ASTResult,
    callerName: string,
    tablesByPath: ReadonlyMap<string, SymbolTable>,
    importsByFile: ReadonlyMap<string, readonly { readonly id: string; readonly name: string }[]>,
    targetByImportId: ReadonlyMap<string, string>,
    calls: SemanticCall[],
    references: SymbolReference[],
  ): void {
    const nextCaller = isCallable(node) ? nodeName(node) ?? callerName : callerName;
    if (node.type === "CallExpression") {
      const calleeName = callName(node);
      if (calleeName !== undefined) {
        const imported = importsByFile.get(ast.metadata.sourcePath)?.find((symbol) => symbol.name === calleeName);
        const targetSymbolId = imported === undefined ? findLocalSymbol(tablesByPath.get(ast.metadata.sourcePath), calleeName) : targetByImportId.get(imported.id);
        const id = hash(`${ast.metadata.sourcePath}:${callerName}:${calleeName}:${node.location?.start.line ?? 0}:${node.location?.start.column ?? 0}`);
        const reference: SymbolReference = { id: hash(`reference:${id}`), filePath: ast.metadata.sourcePath, name: calleeName, kind: "call", ...(targetSymbolId === undefined ? {} : { resolvedSymbolId: targetSymbolId }) };
        references.push(reference);
        calls.push({ id, sourceFilePath: ast.metadata.sourcePath, callerName, calleeName, ...(targetSymbolId === undefined ? {} : { targetSymbolId }), ...(node.location === undefined ? {} : { location: node.location.start }) });
      }
    }

    for (const child of node.children) {
      this.visit(child, ast, nextCaller, tablesByPath, importsByFile, targetByImportId, calls, references);
    }
  }
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
  if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") return undefined;
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

function findLocalSymbol(table: SymbolTable | undefined, name: string): string | undefined {
  return table?.symbols.find((symbol) => symbol.name === name && ["function", "method", "class", "variable"].includes(symbol.kind))?.id;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
