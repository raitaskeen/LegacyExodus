import { z } from "zod";
import { toFactArray, type FactArray, type FactArrayWriter, type FactStore } from "@shared/fact-array";
import { compareCodePoints, sortByKey } from "@shared/ordering";
import { immutable } from "@shared/immutability";

export interface SemanticCall {
  readonly id: string;
  /** Edit-stable key: enclosing owners, callee and ordinal (ADR-008). */
  readonly key?: string;
  readonly sourceFilePath: string;
  readonly callerName: string;
  readonly calleeName: string;
  readonly resolutionState: "RESOLVED" | "UNRESOLVED";
  readonly targetSymbolId?: string;
  /** Why an UNRESOLVED call is not proven (A1); absent on a RESOLVED call. */
  readonly reason?: UnresolvedReason;
  readonly location?: { readonly line: number; readonly column: number };
}

/**
 * Why a call is UNRESOLVED (A1). The first five name the check that blocked resolution; the rest describe the callee
 * when no proof was found for it. A package import is outside the repository, never followed into `node_modules`.
 */
export const UNRESOLVED_REASONS = [
  "computed-callee",     // no name denotes the callee: obj[k](), (a || b)(), f()()
  "call-result-member",  // a method of a call result: f().g(), promise.then(), expect(x).toBe()
  "eval-or-with",        // a direct eval in the file or an enclosing `with` may rebind the name
  "invoker-written",     // f.call/apply/bind while the file writes that property
  "runs-before-binding", // the call runs before its binding is defined (TDZ, require order)
  "import-unstable",     // the import is rebound, or its export is reassigned by its module
  "import-unresolved",   // a relative import that leads to no analysed export
  "package-import",      // the callee, or the object it is read from, is an import of a package or Node module
  "module-load",         // require(…) itself
  "unbound-name",        // no declaration or import binds the name here: a global, or a missing binding
  "parameter-callee",    // the callee is a parameter: its value comes from each caller (a callback)
  "local-not-proven",    // a local binding exists, but it is not proven to hold one function at this call
  "this-open",           // this.m(): the class may be extended outside, or the method replaced or borrowed
  "global-member",       // a member of an unbound name: console.log, JSON.parse, process.exit
  "import-member",       // a member of a repository import that is not proven
  "parameter-member",    // a member of a parameter: opts.run(), res.json() in a handler
  "receiver-not-proven", // a member of a local binding whose value at this call is not proven
  "member-chain",        // a member of a member: a.b.c()
] as const;
export type UnresolvedReason = (typeof UNRESOLVED_REASONS)[number];

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
  /** Edit-stable key: file, method and full path (ADR-008). */
  readonly key?: string;
  readonly filePath: string;
  readonly method: string;
  readonly path: string;
  readonly handlerName?: string;
  readonly middleware: readonly string[];
  readonly state: "CONFIRMED" | "INFERRED" | "UNRESOLVED" | "UNSUPPORTED" | "REQUIRES_REVIEW";
}

export interface MiddlewareChain {
  /** Edit-stable key: owners of the receiver's scope and its name (ADR-008). */
  readonly key?: string;
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
export const callSchema = z.object({ id: z.string().min(1), key: z.string().min(1).optional(), sourceFilePath: z.string().min(1), callerName: z.string().min(1), calleeName: z.string().min(1), resolutionState: resolutionStateSchema, targetSymbolId: z.string().min(1).optional(), reason: z.enum(UNRESOLVED_REASONS).optional(), location: locationSchema.optional() });
export const referenceSchema = z.object({ id: z.string().min(1), key: z.string().min(1).optional(), filePath: z.string().min(1), name: z.string().min(1), kind: z.enum(["call", "identifier"]), resolutionState: resolutionStateSchema, resolvedSymbolId: z.string().min(1).optional() });
export const scopeSchema = z.object({ id: z.string().min(1), filePath: z.string().min(1), name: z.string().min(1), declaredSymbols: z.array(z.string().min(1)), referencedNames: z.array(z.string().min(1)) });
const evidenceStateSchema = z.enum(["CONFIRMED", "INFERRED", "UNRESOLVED", "UNSUPPORTED", "REQUIRES_REVIEW"]);
const findingSchema = z.object({ symbolId: z.string().min(1), filePath: z.string().min(1), name: z.string().min(1), reason: z.enum(["unreferenced-local-symbol", "unused-import", "unused-export"]), state: evidenceStateSchema });
const entryPointSchema = z.object({ filePath: z.string().min(1), reason: z.enum(["conventional-file", "http-listener"]) });
const routeSchema = z.object({ id: z.string().min(1), key: z.string().min(1).optional(), filePath: z.string().min(1), method: z.string().min(1), path: z.string().min(1), handlerName: z.string().min(1).optional(), middleware: z.array(z.string().min(1)), state: evidenceStateSchema });
const middlewareSchema = z.object({ key: z.string().min(1).optional(), filePath: z.string().min(1), middleware: z.array(z.string().min(1)) });
export const semanticAnalysisSchema = z.object({ calls: z.array(callSchema), references: z.array(referenceSchema), scopes: z.array(scopeSchema), deadCode: z.array(findingSchema), unusedImports: z.array(findingSchema), unusedExports: z.array(findingSchema), entryPoints: z.array(entryPointSchema), routes: z.array(routeSchema), middlewareChains: z.array(middlewareSchema) });

export function createSemanticAnalysis(analysis: SemanticAnalysis): SemanticAnalysis {
  const parsed = semanticAnalysisSchema.parse(analysis);
  return immutable({
    calls: freezeSorted(parsed.calls), references: freezeSorted(parsed.references), scopes: freezeSorted(parsed.scopes),
    deadCode: freezeSorted(parsed.deadCode), unusedImports: freezeSorted(parsed.unusedImports), unusedExports: freezeSorted(parsed.unusedExports),
    entryPoints: freezeSorted(parsed.entryPoints), routes: freezeSorted(parsed.routes), middlewareChains: freezeSorted(parsed.middlewareChains),
  });
}

/** `items` are fresh from the schema parse, so they are frozen in place rather than copied again (BA-17). */
function freezeSorted<T extends { readonly id?: string; readonly key?: string; readonly filePath?: string; readonly name?: string }>(items: readonly T[]): readonly T[] {
  return immutable(sortByKey(items, stableKey).map((item) => immutable(item)));
}

// By structural key where a fact has one (ADR-008): file, owners, kind and ordinal, so the order is meaningful
// and survives edits elsewhere; ids are digests and order nothing.
function stableKey(item: { readonly id?: string; readonly key?: string; readonly filePath?: string; readonly name?: string }): string {
  return `${item.key ?? item.id ?? ""}:${item.filePath ?? ""}:${item.name ?? ""}`;
}

/**
 * Calls or references written to disk one file at a time, in the order `createSemanticAnalysis` gives them
 * (ADR-009 step 3). Keys begin with the file path, so files taken in path order, each sorted, are already in
 * order end to end; should a file's facts start before the previous file's ended (no key, or a path that sorts
 * differently with its `#`), the list is sorted once, in full, when sealed.
 */
export class SortedFactList<T extends { readonly id?: string; readonly key?: string; readonly filePath?: string; readonly name?: string }> {
  readonly #writer: FactArrayWriter<T>;
  #last: string | undefined;
  #ordered = true;

  public constructor(private readonly store: FactStore, private readonly schema: z.ZodType<T>) {
    this.#writer = store.writer<T>();
  }

  public appendFile(items: readonly unknown[]): void {
    for (const item of sortByKey(items.map((candidate) => this.schema.parse(candidate)), stableKey)) {
      const key = stableKey(item);
      if (this.#last !== undefined && compareCodePoints(key, this.#last) < 0) this.#ordered = false;
      this.#last = key;
      this.#writer.append(item);
    }
  }

  public seal(): FactArray<T> {
    const list = this.#writer.seal();
    return this.#ordered ? list : toFactArray(this.store, sortByKey([...list], stableKey));
  }
}
