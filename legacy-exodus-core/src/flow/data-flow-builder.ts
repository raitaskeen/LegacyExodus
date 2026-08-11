import { createHash } from "node:crypto";
import type { ASTNode, ASTResult } from "@parser/index";
import { createDataFlowGraph, type DataFlowGraph, type VariableDefinition, type VariableUse } from "./flow-contracts";

export class DeterministicDataFlowGraphBuilder {
  public build(ast: ASTResult): DataFlowGraph {
    const definitions: VariableDefinition[] = [];
    const uses: VariableUse[] = [];
    const activeDefinitions = new Map<string, string>();
    const visit = (node: ASTNode): void => {
      if (node.type === "VariableDeclarator") {
        const name = identifier(node.children.find((child) => child.role === "id"));
        if (name !== undefined) {
          const definition = createDefinition(ast.metadata.sourcePath, name, "declaration", node, literalValue(node.children.find((child) => child.role === "init")));
          definitions.push(definition); activeDefinitions.set(name, definition.id);
          const initializer = node.children.find((child) => child.role === "init"); if (initializer !== undefined) visitUseNodes(initializer, ast.metadata.sourcePath, activeDefinitions, uses);
          return;
        }
      }
      if (node.type === "AssignmentExpression") {
        const name = identifier(node.children.find((child) => child.role === "left"));
        if (name !== undefined) { const definition = createDefinition(ast.metadata.sourcePath, name, "assignment", node, literalValue(node.children.find((child) => child.role === "right"))); definitions.push(definition); activeDefinitions.set(name, definition.id); }
        const right = node.children.find((child) => child.role === "right"); if (right !== undefined) visitUseNodes(right, ast.metadata.sourcePath, activeDefinitions, uses);
        return;
      }
      if (node.type === "CallExpression") {
        for (const argument of node.children.filter((child) => child.role === "arguments")) visitUseNodes(argument, ast.metadata.sourcePath, activeDefinitions, uses);
        return;
      }
      for (const child of node.children) visit(child);
    };
    visit(ast.root);
    const chains = definitions.map((definition) => ({ definitionId: definition.id, useIds: uses.filter((use) => use.definitionId === definition.id).map((use) => use.id).sort() }));
    const lifetimes = definitions.map((definition) => ({ name: definition.name, filePath: definition.filePath, declarationId: definition.id, useIds: uses.filter((use) => use.definitionId === definition.id).map((use) => use.id).sort() }));
    return createDataFlowGraph({ id: hash(`dfg:${ast.metadata.sourcePath}`), filePath: ast.metadata.sourcePath, definitions, uses, defUseChains: chains, lifetimes, taintFlows: [] });
  }
}

function visitUseNodes(node: ASTNode, filePath: string, activeDefinitions: ReadonlyMap<string, string>, uses: VariableUse[]): void {
  if (node.type === "Identifier") { const name = identifier(node); if (name !== undefined) { const definitionId = activeDefinitions.get(name); uses.push({ id: hash(`use:${filePath}:${name}:${node.location?.start.line ?? 0}:${node.location?.start.column ?? 0}`), filePath, name, ...(definitionId === undefined ? {} : { definitionId }) }); } return; }
  for (const child of node.children) visitUseNodes(child, filePath, activeDefinitions, uses);
}
function createDefinition(filePath: string, name: string, kind: "declaration" | "assignment", node: ASTNode, constantValue: string | number | boolean | null | undefined): VariableDefinition { return { id: hash(`definition:${filePath}:${name}:${kind}:${node.location?.start.line ?? 0}:${node.location?.start.column ?? 0}`), filePath, name, kind, ...(constantValue === undefined ? {} : { constantValue }) }; }
function identifier(node: ASTNode | undefined): string | undefined { const value = node?.attributes.name; return typeof value === "string" ? value : undefined; }
function literalValue(node: ASTNode | undefined): string | number | boolean | null | undefined { const value = node?.attributes.value; return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null ? value : undefined; }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
