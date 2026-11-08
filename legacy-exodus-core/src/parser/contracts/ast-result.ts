import { z } from "zod";

import { LegacyExodusError } from "@shared/errors";

import { astNodeSchema, validateASTNode, type ASTNode } from "./ast-node";
import type { ParserError, ParserWarning } from "./parser-errors";
import { validateParserStatistics, type ParserStatistics } from "@parser/models/parser-statistics";
import { immutable, isImmutable } from "@shared/immutability";

export interface ASTMetadata {
  readonly parserId: string;
  readonly language: string;
  readonly sourcePath: string;
}

export interface ASTResult {
  readonly metadata: ASTMetadata;
  readonly root: ASTNode;
  readonly statistics: ParserStatistics;
  readonly warnings: readonly ParserWarning[];
  readonly errors: readonly ParserError[];
}

const diagnosticLocationSchema = z.object({
  line: z.number().int().positive(),
  column: z.number().int().nonnegative(),
});

const parserDiagnosticSchema = z.object({
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
  location: diagnosticLocationSchema.optional(),
});

const astResultSchema = z.object({
  metadata: z.object({
    parserId: z.string().trim().min(1),
    language: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1),
  }),
  root: astNodeSchema,
  statistics: z.object({
    durationMs: z.number().nonnegative(),
    nodeCount: z.number().int().nonnegative(),
  }),
  warnings: z.array(parserDiagnosticSchema),
  errors: z.array(parserDiagnosticSchema),
});

const validatedASTResults = new WeakSet<object>();

export function validateASTResult(result: unknown): ASTResult {
  if (
    typeof result === "object" &&
    result !== null &&
    isDeeplyFrozenASTResult(result) &&
    validatedASTResults.has(result)
  ) {
    return result as ASTResult;
  }

  const parsedResult = astResultSchema.safeParse(result);

  if (!parsedResult.success) {
    throw new LegacyExodusError({
      code: "AST_RESULT_INVALID",
      message: "Parser AST result is invalid.",
      metadata: { issues: parsedResult.error.issues },
    });
  }

  const frozenResult: ASTResult = immutable({
    metadata: immutable({ ...parsedResult.data.metadata }),
    root: validateASTNode(parsedResult.data.root),
    statistics: validateParserStatistics(parsedResult.data.statistics),
    warnings: immutable(
      parsedResult.data.warnings.map((warning) =>
        immutable({
          ...warning,
          location:
            warning.location === undefined ? undefined : immutable({ ...warning.location }),
        }),
      ),
    ),
    errors: immutable(
      parsedResult.data.errors.map((error) =>
        immutable({
          ...error,
          location: error.location === undefined ? undefined : immutable({ ...error.location }),
        }),
      ),
    ),
  });

  validatedASTResults.add(frozenResult);
  return frozenResult;
}

function isDeeplyFrozenASTResult(value: unknown): value is ASTResult {
  return (
    typeof value === "object" &&
    value !== null &&
    isImmutable(value) &&
    "metadata" in value &&
    isImmutable((value as ASTResult).metadata) &&
    "root" in value &&
    isImmutable((value as ASTResult).root) &&
    "statistics" in value &&
    isImmutable((value as ASTResult).statistics) &&
    "warnings" in value &&
    isImmutable((value as ASTResult).warnings) &&
    "errors" in value &&
    isImmutable((value as ASTResult).errors)
  );
}
