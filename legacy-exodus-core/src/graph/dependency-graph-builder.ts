import { createHash } from "node:crypto";

import type { FileArtifact } from "@contracts/discovery";
import type { SymbolTable } from "@symbols/index";
import type { CodeSymbol } from "@symbols/index";

import { validateDependencyGraph, type DependencyGraph } from "./dependency-graph-contracts";
import { ModuleResolver } from "./module-resolver";

export class DeterministicDependencyGraphBuilder {
  public constructor(private readonly resolver: ModuleResolver = new ModuleResolver()) {}

  public build(symbolTables: readonly SymbolTable[], files: readonly FileArtifact[]): DependencyGraph {
    const orderedTables = [...symbolTables].sort((left, right) => left.filePath.localeCompare(right.filePath));
    const tablesByPath = new Map(orderedTables.map((table) => [table.filePath, table]));
    const nodes = orderedTables.flatMap((table) =>
      table.symbols.map((symbol) => ({ id: `symbol:${symbol.id}`, filePath: table.filePath, symbolId: symbol.id })),
    );
    const edges = orderedTables.flatMap((table) =>
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
            targetFilePath: exported.filePath,
            importSymbolId: symbol.id,
            targetExportSymbolId: exported.id,
            moduleSpecifier: symbol.moduleSpecifier ?? "",
          }];
        }),
    );

    return validateDependencyGraph({
      nodes: [...nodes].sort((left, right) => left.id.localeCompare(right.id)),
      edges: [...edges].sort((left, right) => left.id.localeCompare(right.id)),
      cycles: findCycles(edges),
    });
  }

  private resolveExport(table: SymbolTable, name: string, files: readonly FileArtifact[], tables: ReadonlyMap<string, SymbolTable>, visited: Set<string>): CodeSymbol | undefined {
    if (visited.has(table.filePath)) {
      return this.findDirectExport(table, name);
    }
    visited.add(table.filePath);
    const direct = this.findDirectExport(table, name);
    if (direct?.moduleSpecifier === undefined) return direct;
    const resolved = this.resolver.resolve(table.filePath, direct.moduleSpecifier, files).resolvedPath;
    const target = resolved === null ? undefined : tables.get(resolved);
    const forwardedName = direct.sourceSymbolName ?? (name === "*" ? "*" : name);
    return target === undefined ? direct : this.resolveExport(target, forwardedName, files, tables, visited);
  }

  private findDirectExport(table: SymbolTable, name: string): CodeSymbol | undefined {
    const exports = table.symbols.filter((symbol) => symbol.kind === "export");
    if (name === "*") {
      return exports.find((symbol) => symbol.name === "*" && symbol.moduleSpecifier !== undefined)
        ?? exports.find((symbol) => symbol.moduleSpecifier === undefined);
    }

    return exports.find((symbol) => (name === "default" ? symbol.defaultExport : symbol.name === name))
      ?? exports.find((symbol) => symbol.name === "*" && symbol.moduleSpecifier !== undefined)
      ?? exports.find((symbol) => symbol.moduleSpecifier !== undefined);
  }
}

function findCycles(edges: readonly { readonly sourceFilePath: string; readonly targetFilePath: string }[]): readonly (readonly string[])[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) adjacency.set(edge.sourceFilePath, [...(adjacency.get(edge.sourceFilePath) ?? []), edge.targetFilePath].sort());
  const cycles = new Map<string, readonly string[]>();
  const visit = (path: string[], current: string): void => {
    const index = path.indexOf(current);
    if (index >= 0) {
      const cycle = [...path.slice(index), current];
      const canonical = canonicalizeCycle(cycle);
      cycles.set(canonical.join("\u0000"), canonical);
      return;
    }
    for (const next of adjacency.get(current) ?? []) visit([...path, current], next);
  };
  for (const source of [...adjacency.keys()].sort()) visit([], source);
  return [...cycles.values()].sort((left, right) => left.join("\u0000").localeCompare(right.join("\u0000")));
}

function canonicalizeCycle(cycle: readonly string[]): readonly string[] {
  const body = cycle.slice(0, -1);
  const rotations = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)]);
  const canonical = rotations.sort((left, right) => left.join("\u0000").localeCompare(right.join("\u0000")))[0] ?? [];
  return Object.freeze([...canonical, canonical[0] ?? ""]);
}
