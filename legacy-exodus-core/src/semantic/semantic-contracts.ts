import { z } from "zod";
import { sortByKey } from "@shared/ordering";

export interface SemanticCall {
  readonly id: string;
  /** Edit-stable key: enclosing owners, callee and ordinal (ADR-008). */
  readonly key?: string;
  readonly sourceFilePath: string;
  readonly callerName: string;
  readonly calleeName: string;
  readonly resolutionState: "RESOLVED" | "UNRESOLVED";
  readonly targetSymbolId?: string;
  readonly location?: { readonly line: number; readonly column: number };
}

export interface SymbolReference {
  readonly id: string;
  /** Edit-stable key: enclosing owners, name and ordinal (ADR-008). */
  readonly key?: string;
  readonly filePath: string;
  readonly name: string;
  readonly kind: "call" | "identifier";
  readonly resolutionState: "RESOLVED" | "UNRESOLVED";
  readonly resolvedSymbolId?: string;
}

export interface ScopeAnalysis {
  readonly id: string;
  readonly filePath: string;
  readonly name: string;
  readonly declaredSymbols: readonly string[];
  readonly referencedNames: readonly string[];
}

export interface DeadCodeFinding {
  readonly symbolId: string;
  readonly filePath: string;
  readonly name: string;
  readonly reason: "unreferenced-local-symbol" | "unused-import" | "unused-export";
  readonly state: "CONFIRMED" | "INFERRED" | "UNRESOLVED" | "UNSUPPORTED" | "REQUIRES_REVIEW";
}

export interface SemanticEntryPoint {
  readonly filePath: string;
  readonly reason: "conventional-file" | "http-listener";
}

export interface ExpressRoute {
  readonly id: string;
  readonly filePath: string;
  readonly method: string;
  readonly path: string;
  readonly handlerName?: string;
  readonly middleware: readonly string[];
  readonly state: "CONFIRMED" | "INFERRED" | "UNRESOLVED" | "UNSUPPORTED" | "REQUIRES_REVIEW";
}

export interface MiddlewareChain {
  readonly filePath: string;
  readonly middleware: readonly string[];
}

export interface SemanticAnalysis {
  readonly calls: readonly SemanticCall[];
  readonly references: readonly SymbolReference[];
  readonly scopes: readonly ScopeAnalysis[];
  readonly deadCode: readonly DeadCodeFinding[];
  readonly unusedImports: readonly DeadCodeFinding[];
  readonly unusedExports: readonly DeadCodeFinding[];
  readonly entryPoints: readonly SemanticEntryPoint[];
  readonly routes: readonly ExpressRoute[];
  readonly middlewareChains: readonly MiddlewareChain[];
}

const locationSchema = z.object({ line: z.number().int().positive(), column: z.number().int().nonnegative() });
const resolutionStateSchema = z.enum(["RESOLVED", "UNRESOLVED"]);
const callSchema = z.object({ id: z.string().min(1), key: z.string().min(1).optional(), sourceFilePath: z.string().min(1), callerName: z.string().min(1), calleeName: z.string().min(1), resolutionState: resolutionStateSchema, targetSymbolId: z.string().min(1).optional(), location: locationSchema.optional() });
const referenceSchema = z.object({ id: z.string().min(1), key: z.string().min(1).optional(), filePath: z.string().min(1), name: z.string().min(1), kind: z.enum(["call", "identifier"]), resolutionState: resolutionStateSchema, resolvedSymbolId: z.string().min(1).optional() });
const scopeSchema = z.object({ id: z.string().min(1), filePath: z.string().min(1), name: z.string().min(1), declaredSymbols: z.array(z.string().min(1)), referencedNames: z.array(z.string().min(1)) });
const evidenceStateSchema = z.enum(["CONFIRMED", "INFERRED", "UNRESOLVED", "UNSUPPORTED", "REQUIRES_REVIEW"]);
const findingSchema = z.object({ symbolId: z.string().min(1), filePath: z.string().min(1), name: z.string().min(1), reason: z.enum(["unreferenced-local-symbol", "unused-import", "unused-export"]), state: evidenceStateSchema });
const entryPointSchema = z.object({ filePath: z.string().min(1), reason: z.enum(["conventional-file", "http-listener"]) });
const routeSchema = z.object({ id: z.string().min(1), filePath: z.string().min(1), method: z.string().min(1), path: z.string().min(1), handlerName: z.string().min(1).optional(), middleware: z.array(z.string().min(1)), state: evidenceStateSchema });
const middlewareSchema = z.object({ filePath: z.string().min(1), middleware: z.array(z.string().min(1)) });
export const semanticAnalysisSchema = z.object({ calls: z.array(callSchema), references: z.array(referenceSchema), scopes: z.array(scopeSchema), deadCode: z.array(findingSchema), unusedImports: z.array(findingSchema), unusedExports: z.array(findingSchema), entryPoints: z.array(entryPointSchema), routes: z.array(routeSchema), middlewareChains: z.array(middlewareSchema) });

export function createSemanticAnalysis(analysis: SemanticAnalysis): SemanticAnalysis {
  const parsed = semanticAnalysisSchema.parse(analysis);
  return Object.freeze({
    calls: freezeSorted(parsed.calls), references: freezeSorted(parsed.references), scopes: freezeSorted(parsed.scopes),
    deadCode: freezeSorted(parsed.deadCode), unusedImports: freezeSorted(parsed.unusedImports), unusedExports: freezeSorted(parsed.unusedExports),
    entryPoints: freezeSorted(parsed.entryPoints), routes: freezeSorted(parsed.routes), middlewareChains: freezeSorted(parsed.middlewareChains),
  });
}

/** `items` are fresh from the schema parse, so they are frozen in place rather than copied again (BA-17). */
function freezeSorted<T extends { readonly id?: string; readonly filePath?: string; readonly name?: string }>(items: readonly T[]): readonly T[] {
  return Object.freeze(sortByKey(items, stableKey).map((item) => Object.freeze(item)));
}

function stableKey(item: { readonly id?: string; readonly filePath?: string; readonly name?: string }): string {
  return `${item.id ?? ""}:${item.filePath ?? ""}:${item.name ?? ""}`;
}
