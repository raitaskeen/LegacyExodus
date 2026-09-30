import { createHash } from "node:crypto";

import type { CodeSymbol, SymbolTable } from "@symbols/index";

import { validateCurrentDependencyGraph, type CurrentDependencyGraph, type DependencyGraphEdge, type ModuleDependencyEdge } from "./dependency-graph-contracts";
import { canonicalizePath, type KnownPathLookup, ModuleResolver } from "./module-resolver";

export class DeterministicDependencyGraphBuilder {
  public constructor(private readonly resolver: ModuleResolver = new ModuleResolver()) {}

  public build(symbolTables: readonly SymbolTable[], files: KnownPathLookup): CurrentDependencyGraph {
    const orderedTables = [...symbolTables].sort((left, right) =>
      canonicalizePath(left.filePath).localeCompare(canonicalizePath(right.filePath)),
    );
    const tablesByPath = new Map(orderedTables.map((table) => [canonicalizePath(table.filePath), table]));
    const nodes = orderedTables.flatMap((table) =>
      table.symbols.map((symbol) => ({
        id: `symbol:${symbol.id}`,
        filePath: canonicalizePath(table.filePath),
        symbolId: symbol.id,
      })),
    );
    const edges: DependencyGraphEdge[] = [];
    const moduleEdges: ModuleDependencyEdge[] = [];
    for (const table of orderedTables) {
      const sourceFilePath = canonicalizePath(table.filePath);
      if (table.moduleReferences === undefined && table.symbols.some((symbol) => symbol.kind === "import")) {
        throw new Error(`Current import relationships require module reference evidence: ${sourceFilePath}`);
      }
      const symbolsById = new Map(table.symbols.map((symbol) => [symbol.id, symbol]));
      const associatedIds = new Set<string>();
      for (const reference of table.moduleReferences ?? []) {
        for (const id of new Set(reference.importSymbolIds)) {
          const symbol = symbolsById.get(id);
          if (associatedIds.has(id) || symbol?.kind !== "import" || symbol.moduleSpecifier !== reference.moduleSpecifier) {
            throw new Error(`Invalid module reference binding: ${id}`);
          }
          associatedIds.add(id);
        }
      }
      if (table.symbols.some((symbol) => symbol.kind === "import" && !associatedIds.has(symbol.id))) {
        throw new Error(`Current import relationships require complete module reference evidence: ${sourceFilePath}`);
      }
      for (const reference of table.moduleReferences ?? []) {
        const resolved = this.resolver.resolve(sourceFilePath, reference.moduleSpecifier, files);
        if (resolved.resolvedPath === null) continue;
        if (reference.sourceAnchor === undefined) {
          throw new Error(`Resolved import lacks source anchor: ${sourceFilePath} -> ${reference.moduleSpecifier}`);
        }
        const targetFilePath = canonicalizePath(resolved.resolvedPath);
        const anchor = reference.sourceAnchor;
        const taggedAnchor = anchor.kind === "offset" ? ["offset", anchor.start, anchor.end]
          : ["location", anchor.start.line, anchor.start.column, anchor.end.line, anchor.end.column];
        moduleEdges.push({
          id: createHash("sha256").update(JSON.stringify([
            "f07-module-edge-v1", sourceFilePath, reference.form, taggedAnchor, reference.moduleSpecifier, targetFilePath,
          ])).digest("hex"),
          sourceFilePath, targetFilePath, moduleSpecifier: reference.moduleSpecifier,
          sourceAnchor: anchor, form: reference.form,
          ...(reference.sourcePhase === undefined ? {} : { sourcePhase: reference.sourcePhase }),
        });
        if (reference.form === "esm-side-effect") continue;
        const target = tablesByPath.get(targetFilePath);
        for (const importSymbolId of reference.importSymbolIds) {
          const symbol = symbolsById.get(importSymbolId);
          if (symbol === undefined || symbol.kind !== "import" || symbol.moduleSpecifier !== reference.moduleSpecifier) {
            throw new Error(`Invalid module reference binding: ${importSymbolId}`);
          }
          const exported = target === undefined ? undefined
            : this.resolveExport(target, symbol.defaultExport ? "default" : (symbol.sourceSymbolName ?? symbol.name), files, tablesByPath, new Set());
          if (exported === undefined) continue;
          edges.push({
            id: createHash("sha256").update(`${symbol.id}:${exported.id}`).digest("hex"),
            sourceFilePath, targetFilePath: canonicalizePath(exported.filePath),
            importSymbolId: symbol.id, targetExportSymbolId: exported.id,
            moduleSpecifier: symbol.moduleSpecifier ?? "",
          });
        }
      }
    }

    return validateCurrentDependencyGraph({
      nodes: [...nodes].sort((left, right) => left.id.localeCompare(right.id)),
      edges: [...edges].sort((left, right) => left.id.localeCompare(right.id)),
      cycles: findCycles(moduleEdges),
      moduleGraph: { contract: "f07-import-relations-v1", edges: moduleEdges.sort((left, right) => left.id.localeCompare(right.id)) },
    });
  }
  private resolveExport(
    table: SymbolTable,
    name: string,
    files: KnownPathLookup,
    tables: ReadonlyMap<string, SymbolTable>,
    visited: ReadonlySet<string>,
  ): CodeSymbol | undefined {
    const tableCanonicalPath = canonicalizePath(table.filePath);
    if (visited.has(tableCanonicalPath)) {
      const direct = this.findDirectExport(table, name);
      return direct?.moduleSpecifier === undefined ? direct : undefined;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(tableCanonicalPath);

    const direct = this.findDirectExport(table, name);
    if (direct !== undefined) {
      if (direct.moduleSpecifier === undefined) {
        return direct;
      }

      const resolved = this.resolver.resolve(tableCanonicalPath, direct.moduleSpecifier, files).resolvedPath;
      const target = resolved === null ? undefined : tables.get(resolved);
      const forwardedName = direct.sourceSymbolName ?? name;
      return target === undefined ? undefined : this.resolveExport(target, forwardedName, files, tables, nextVisited);
    }

    if (name === "default" || name === "*") {
      return undefined;
    }

    const wildcardExports = table.symbols
      .filter((symbol) => symbol.kind === "export" && symbol.name === "*" && symbol.moduleSpecifier !== undefined)
      .sort((left, right) => (left.moduleSpecifier ?? "").localeCompare(right.moduleSpecifier ?? "") || left.id.localeCompare(right.id));

    const matches: CodeSymbol[] = [];
    for (const wildcard of wildcardExports) {
      if (wildcard.moduleSpecifier === undefined) continue;
      const resolved = this.resolver.resolve(tableCanonicalPath, wildcard.moduleSpecifier, files).resolvedPath;
      if (resolved === null) continue;
      const target = tables.get(resolved);
      if (target === undefined || nextVisited.has(canonicalizePath(target.filePath))) continue;

      const found = this.resolveExport(target, name, files, tables, nextVisited);
      if (found !== undefined && !matches.some((m) => m.id === found.id)) {
        matches.push(found);
      }
    }

    if (matches.length === 1) {
      return matches[0];
    }

    return undefined;
  }

  private findDirectExport(table: SymbolTable, name: string): CodeSymbol | undefined {
    const exports = table.symbols.filter((symbol) => symbol.kind === "export");
    const exact = exports.find((symbol) => (name === "default" ? symbol.defaultExport : symbol.name === name));
    if (exact !== undefined) {
      return exact;
    }

    if (name === "*") {
      return exports.find((symbol) => symbol.moduleSpecifier === undefined);
    }

    return undefined;
  }
}

function findCycles(edges: readonly { readonly sourceFilePath: string; readonly targetFilePath: string }[]): readonly (readonly string[])[] {
  const adjacency = new Map<string, readonly string[]>();
  for (const edge of edges) {
    const targets = adjacency.get(edge.sourceFilePath) ?? [];
    adjacency.set(edge.sourceFilePath, Array.from(new Set([...targets, edge.targetFilePath])).sort());
    if (!adjacency.has(edge.targetFilePath)) {
      adjacency.set(edge.targetFilePath, []);
    }
  }

  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  let index = 0;

  const visit = (node: string): void => {
    indexes.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const target of adjacency.get(node) ?? []) {
      if (!indexes.has(target)) {
        visit(target);
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, lowLinks.get(target) ?? 0));
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, indexes.get(target) ?? 0));
      }
    }

    if (lowLinks.get(node) !== indexes.get(node)) {
      return;
    }

    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (member !== undefined) {
        onStack.delete(member);
        component.push(member);
      }
    } while (member !== node);
    components.push(component.sort());
  };

  for (const node of [...adjacency.keys()].sort()) {
    if (!indexes.has(node)) {
      visit(node);
    }
  }

  return components
    .filter((component) => component.length > 1 || (adjacency.get(component[0] ?? "") ?? []).includes(component[0] ?? ""))
    .map((component) => findCycleInComponent(component, adjacency))
    .sort((left, right) => left.join("\u0000").localeCompare(right.join("\u0000")));
}

function findCycleInComponent(component: readonly string[], adjacency: ReadonlyMap<string, readonly string[]>): readonly string[] {
  const members = new Set(component);
  const start = component[0];
  if (start === undefined) {
    return Object.freeze([]);
  }

  const path: string[] = [];
  const visiting = new Set<string>();
  const visit = (node: string): readonly string[] | undefined => {
    visiting.add(node);
    path.push(node);
    for (const target of adjacency.get(node) ?? []) {
      if (!members.has(target)) {
        continue;
      }
      const cycleIndex = path.indexOf(target);
      if (cycleIndex >= 0) {
        return canonicalizeCycle([...path.slice(cycleIndex), target]);
      }
      if (!visiting.has(target)) {
        const cycle = visit(target);
        if (cycle !== undefined) {
          return cycle;
        }
      }
    }
    path.pop();
    visiting.delete(node);
    return undefined;
  };

  return visit(start) ?? Object.freeze([start, start]);
}

function canonicalizeCycle(cycle: readonly string[]): readonly string[] {
  const body = cycle.slice(0, -1);
  const rotations = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)]);
  const canonical = rotations.sort((left, right) => left.join("\u0000").localeCompare(right.join("\u0000")))[0] ?? [];
  return Object.freeze([...canonical, canonical[0] ?? ""]);
}
