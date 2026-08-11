import type { ASTResult } from "@parser/index";

import type { SymbolTable } from "./symbol-contracts";

export interface SymbolExtractor {
  extract(ast: ASTResult): SymbolTable;
}
