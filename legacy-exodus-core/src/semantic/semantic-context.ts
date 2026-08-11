import type { DependencyGraph } from "@graph/index";
import type { ASTResult } from "@parser/index";
import type { SymbolTable } from "@symbols/index";

export interface SemanticContext {
  readonly astResults: readonly ASTResult[];
  readonly dependencyGraph: DependencyGraph;
  readonly symbolTables: readonly SymbolTable[];
}
