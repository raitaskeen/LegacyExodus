import { z } from "zod";

import { LegacyExodusError } from "@shared/errors";

import { astNodeSchema, validateASTNode, type ASTNode } from "./ast-node";
import type { ParserError, ParserWarning } from "./parser-errors";
import { validateParserStatistics, type ParserStatistics } from "@parser/models/parser-statistics";

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

export function validateASTResult(result: unknown): ASTResult {
  const parsedResult = astResultSchema.safeParse(result);

  if (!parsedResult.success) {
    throw new LegacyExodusError({
      code: "AST_RESULT_INVALID",
      message: "Parser AST result is invalid.",
      metadata: { issues: parsedResult.error.issues },
    });
  }

  return Object.freeze({
    metadata: Object.freeze({ ...parsedResult.data.metadata }),
    root: validateASTNode(parsedResult.data.root),
    statistics: validateParserStatistics(parsedResult.data.statistics),
    warnings: Object.freeze(
      parsedResult.data.warnings.map((warning) =>
        Object.freeze({
          ...warning,
          location:
            warning.location === undefined ? undefined : Object.freeze({ ...warning.location }),
        }),
      ),
    ),
    errors: Object.freeze(
      parsedResult.data.errors.map((error) =>
        Object.freeze({
          ...error,
          location: error.location === undefined ? undefined : Object.freeze({ ...error.location }),
        }),
      ),
    ),
  });
}
