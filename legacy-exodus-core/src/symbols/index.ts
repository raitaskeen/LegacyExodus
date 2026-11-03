export { JavaScriptSymbolExtractor } from "./javascript-symbol-extractor";
export type { SymbolExtractor } from "./symbol-extractor";
export type { CodeSymbol, SymbolKind, SymbolSummary, SymbolTable } from "./symbol-contracts";
export { codeSymbolSchema, createLexicalScopeId, createSelfScopeId, validateCodeSymbols, validateSymbolTable } from "./symbol-contracts";
export { SymbolExtractionError, UnsupportedSymbolLanguageError } from "./symbol-errors";
export { FactKeyer } from "./symbol-keys";
