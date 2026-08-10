import { createHash } from "node:crypto";

import type { FileArtifact } from "@contracts/discovery";
import type { SymbolTable } from "@symbols/index";
import type { CodeSymbol } from "@symbols/index";

import { validateDependencyGraph, type DependencyGraph } from "./dependency-graph-contracts";
import { ModuleResolver } from "./module-resolver";

export class DeterministicDependencyGraphBuilder {
  public constructor(private readonly resolver: ModuleResolver = new ModuleResolver()) {}

  public build(symbolTables: readonly SymbolTable[], files: readonly FileArtifact[]): DependencyGraph {
    const tablesByPath = new Map(symbolTables.map((table) => [table.filePath, table]));
    const nodes = symbolTables.flatMap((table) =>
      table.symbols.map((symbol) => ({ id: `symbol:${symbol.id}`, filePath: table.filePath, symbolId: symbol.id })),
    );
    const edges = symbolTables.flatMap((table) =>
      table.symbols
        .filter((symbol) => symbol.kind === "import" && symbol.moduleSpecifier !== undefined)
        .flatMap((symbol) => {
          const resolved = this.resolver.resolve(table.filePath, symbol.moduleSpecifier ?? "", files);
          const target = resolved.resolvedPath === null ? undefined : tablesByPath.get(resolved.resolvedPath);
          const exported = target === undefined ? undefined : this.resolveExport(target, symbol.defaultExport ? "default" : symbol.name, files, tablesByPath, new Set());
          if (target === undefined || exported === undefined) return [];
          return [{
            id: createHash("sha256").update(`${symbol.id}:${exported.id}`).digest("hex"),
            sourceFilePath: table.filePath,
            targetFilePath: target.filePath,
            importSymbolId: symbol.id,
            targetExportSymbolId: exported.id,
            moduleSpecifier: symbol.moduleSpecifier ?? "",
          }];
        }),
    );

    return validateDependencyGraph({ nodes, edges, cycles: findCycles(edges) });
  }

  private resolveExport(table: SymbolTable, name: string, files: readonly FileArtifact[], tables: ReadonlyMap<string, SymbolTable>, visited: Set<string>): CodeSymbol | undefined {
    if (visited.has(table.filePath)) return undefined;
    visited.add(table.filePath);
    const direct = table.symbols.find((symbol) => symbol.kind === "export" && (name === "default" ? symbol.defaultExport : symbol.name === name));
    if (direct?.moduleSpecifier === undefined) return direct;
    const resolved = this.resolver.resolve(table.filePath, direct.moduleSpecifier, files).resolvedPath;
    const target = resolved === null ? undefined : tables.get(resolved);
    return target === undefined ? direct : this.resolveExport(target, name === "*" ? "*" : name, files, tables, visited);
  }
}

function findCycles(edges: readonly { readonly sourceFilePath: string; readonly targetFilePath: string }[]): readonly (readonly string[])[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) adjacency.set(edge.sourceFilePath, [...(adjacency.get(edge.sourceFilePath) ?? []), edge.targetFilePath]);
  const cycles: string[][] = [];
  const visit = (path: string[], current: string): void => {
    const index = path.indexOf(current);
    if (index >= 0) { cycles.push([...path.slice(index), current]); return; }
    for (const next of adjacency.get(current) ?? []) visit([...path, current], next);
  };
  for (const source of [...adjacency.keys()].sort()) visit([], source);
  return cycles;
}
