import { z } from "zod";

import { LegacyExodusError } from "@shared/errors";

export type SymbolKind = "class" | "export" | "function" | "import" | "method" | "variable";

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
}

const symbolKindSchema = z.enum(["class", "export", "function", "import", "method", "variable"]);
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
  summary: z.object({
    classes: z.number().int().nonnegative(),
    exports: z.number().int().nonnegative(),
    functions: z.number().int().nonnegative(),
    imports: z.number().int().nonnegative(),
    methods: z.number().int().nonnegative(),
    variables: z.number().int().nonnegative(),
  }),
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
