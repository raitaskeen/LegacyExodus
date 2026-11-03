import { z } from "zod";

import { LegacyExodusError } from "@shared/errors";
import {
  moduleReferenceSchema, freezeModuleReference, unresolvedModuleReferenceSchema, freezeUnresolvedModuleReference,
  type ModuleReference, type UnresolvedModuleReference,
} from "./module-reference-contracts";

/**
 * `enum` and `namespace` declare runtime bindings; `interface` and `type-alias` are type-only and declare
 * none. Members of enums, interfaces and type aliases are not symbols.
 */
export type SymbolKind =
  | "class"
  | "enum"
  | "export"
  | "function"
  | "import"
  | "interface"
  | "method"
  | "namespace"
  | "type-alias"
  | "variable";

export interface CodeSymbol {
  readonly id: string;
  readonly kind: SymbolKind;
  readonly name: string;
  readonly filePath: string;
  readonly language: string;
  readonly exported: boolean;
  readonly defaultExport: boolean;
  readonly async: boolean;
  /** True when a syntax construct has no stable declared name. */
  readonly anonymous: boolean;
  readonly visibility: "public";
  readonly parameters: readonly string[];
  readonly declarationKind?: "const" | "let" | "var" | "param";
  /** True for a class created by a class expression: it exists because it is used as a value, so it is never dead code. */
  readonly expression?: true;
  /**
   * True for a property, not a lexical binding: an object-literal key, a class member, or a member
   * assigned as `x.y = …`. It is read through its object, never by its bare name.
   */
  readonly member?: true;
  readonly value?: string | number | boolean | null;
  readonly moduleSpecifier?: string;
  /** Original exported name when this symbol is a named re-export. */
  readonly sourceSymbolName?: string;
  /** Lexical declaration scope, derived deterministically from the normalized AST. */
  readonly scopeId?: string;
  readonly containerName?: string;
  /** Canonical class symbol identity for members declared by that class. */
  readonly containerId?: string;
  readonly location?: {
    readonly start: { readonly line: number; readonly column: number };
    readonly end: { readonly line: number; readonly column: number };
  };
}

export interface SymbolSummary {
  readonly classes: number;
  readonly exports: number;
  readonly functions: number;
  readonly imports: number;
  readonly methods: number;
  readonly variables: number;
}

export interface SymbolTable {
  readonly filePath: string;
  readonly language: string;
  readonly symbols: readonly CodeSymbol[];
  readonly summary: SymbolSummary;
  readonly moduleReferences?: readonly ModuleReference[];
  readonly unresolvedModuleReferences?: readonly UnresolvedModuleReference[];
}

const symbolKindSchema = z.enum([
  "class", "enum", "export", "function", "import", "interface", "method", "namespace", "type-alias", "variable",
]);
const positionSchema = z.object({ line: z.number().int().positive(), column: z.number().int().nonnegative() });

export const codeSymbolSchema = z.object({
  id: z.string().min(1),
  kind: symbolKindSchema,
  name: z.string().min(1),
  filePath: z.string().min(1),
  language: z.string().min(1),
  exported: z.boolean(),
  defaultExport: z.boolean(),
  async: z.boolean(),
  anonymous: z.boolean(),
  visibility: z.literal("public"),
  parameters: z.array(z.string().min(1)),
  declarationKind: z.enum(["const", "let", "var", "param"]).optional(),
  expression: z.literal(true).optional(),
  member: z.literal(true).optional(),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  moduleSpecifier: z.string().min(1).optional(),
  sourceSymbolName: z.string().min(1).optional(),
  scopeId: z.string().min(1).optional(),
  containerName: z.string().min(1).optional(),
  containerId: z.string().min(1).optional(),
  location: z.object({ start: positionSchema, end: positionSchema }).optional(),
});

const symbolTableSchema = z.object({
  filePath: z.string().min(1),
  language: z.string().min(1),
  symbols: z.array(codeSymbolSchema),
  moduleReferences: z.array(moduleReferenceSchema).optional(),
  unresolvedModuleReferences: z.array(unresolvedModuleReferenceSchema).optional(),
  summary: z.object({
    classes: z.number().int().nonnegative(),
    exports: z.number().int().nonnegative(),
    functions: z.number().int().nonnegative(),
    imports: z.number().int().nonnegative(),
    methods: z.number().int().nonnegative(),
    variables: z.number().int().nonnegative(),
  }),
}).superRefine((table, context) => {
  if (table.moduleReferences === undefined) return;
  const symbols = new Map(table.symbols.map((symbol) => [symbol.id, symbol]));
  const associated = new Set<string>();
  for (const reference of table.moduleReferences) {
    for (const id of new Set(reference.importSymbolIds)) {
      const symbol = symbols.get(id);
      if (associated.has(id) || symbol?.kind !== "import" || symbol.moduleSpecifier !== reference.moduleSpecifier) {
        context.addIssue({ code: "custom", message: "Invalid module reference symbol association." });
      }
      associated.add(id);
    }
  }
  if (table.symbols.some((symbol) => symbol.kind === "import" && !associated.has(symbol.id))) {
    context.addIssue({ code: "custom", message: "Module references must cover extracted imports." });
  }
});

export function validateSymbolTable(table: unknown): SymbolTable {
  const parsedTable = symbolTableSchema.safeParse(table);

  if (!parsedTable.success) {
    throw new LegacyExodusError({
      code: "SYMBOL_TABLE_INVALID",
      message: "Symbol table is invalid.",
      metadata: { issues: parsedTable.error.issues },
    });
  }

  return Object.freeze({
    filePath: parsedTable.data.filePath,
    language: parsedTable.data.language,
    symbols: Object.freeze(parsedTable.data.symbols.map(freezeCodeSymbol)),
    summary: Object.freeze({ ...parsedTable.data.summary }),
    ...(parsedTable.data.moduleReferences === undefined ? {} : { moduleReferences: Object.freeze(parsedTable.data.moduleReferences.map(freezeModuleReference)) }),
    ...(parsedTable.data.unresolvedModuleReferences === undefined ? {} : { unresolvedModuleReferences: Object.freeze(parsedTable.data.unresolvedModuleReferences.map(freezeUnresolvedModuleReference)) }),
  });
}

export function validateCodeSymbols(symbols: unknown): readonly CodeSymbol[] {
  const parsedSymbols = z.array(codeSymbolSchema).safeParse(symbols);

  if (!parsedSymbols.success) {
    throw new LegacyExodusError({
      code: "SYMBOL_TABLE_INVALID",
      message: "Symbol table is invalid.",
      metadata: { issues: parsedSymbols.error.issues },
    });
  }

  return Object.freeze(parsedSymbols.data.map(freezeCodeSymbol));
}

export function createLexicalScopeId(
  type: string,
  location: CodeSymbol["location"] | undefined,
): string {
  if (location === undefined) return `scope:${type}:unknown`;
  return `scope:${type}:${location.start.line}:${location.start.column}`;
}

/**
 * Scope in which a named function or class expression binds its own name, visible only inside it.
 * It sits between the enclosing scope and the expression's own scope.
 */
export function createSelfScopeId(
  type: string,
  location: CodeSymbol["location"] | undefined,
): string {
  return `self:${type}:${location?.start.line ?? 0}:${location?.start.column ?? 0}`;
}

function freezeCodeSymbol(symbol: CodeSymbol): CodeSymbol {
  return Object.freeze({
    ...symbol,
    parameters: Object.freeze([...symbol.parameters]),
    location:
      symbol.location === undefined
        ? undefined
        : Object.freeze({
            start: Object.freeze({ ...symbol.location.start }),
            end: Object.freeze({ ...symbol.location.end }),
          }),
  });
}
