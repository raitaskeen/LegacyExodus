import type { ASTResult } from "@parser/contracts/ast-result";
import type { ParseRequest } from "@parser/models/parse-request";
import { validateParseRequest } from "@parser/models/parse-request";
import { validateParseResponse } from "@parser/models/parse-response";
import { ParserRegistry } from "@parser/registry/parser-registry";
import {
  InvalidParserResultError,
  ParserExecutionError,
  UnsupportedLanguageError,
} from "@parser/registry/parser-registry-errors";
import { LegacyExodusError } from "@shared/errors";

/**
 * A file whose tree is too deep to check (a 6,000-term expression parses, then the response check runs out of call
 * stack): reported as PARSER_RESOURCE_LIMIT with an empty program, as a parser overflow is, never analysed from an
 * unchecked tree (XA-06).
 */
function resourceLimitResult(parserId: string, request: ParseRequest, error: RangeError): ASTResult {
  return validateParseResponse({
    result: {
      metadata: { parserId, language: request.file.language.toLowerCase(), sourcePath: request.file.path },
      root: { type: "Program", attributes: {}, children: [] },
      statistics: { durationMs: 0, nodeCount: 1 },
      warnings: [],
      errors: [{
        code: "PARSER_RESOURCE_LIMIT",
        message: `The parsed tree is too deep to check on the call stack (very deep nesting or a very long expression), so the file is not analysed. This is not a syntax error. (${error.message})`,
      }],
    },
  }).result;
}

export class ParserManager {
  public constructor(private readonly registry: ParserRegistry) {}

  public async parse(request: ParseRequest): Promise<ASTResult> {
    const validatedRequest = validateParseRequest(request);
    const parser = this.registry.findByLanguage(validatedRequest.file.language);

    if (parser === null || !parser.canHandle(validatedRequest)) {
      throw new UnsupportedLanguageError(validatedRequest.file.language);
    }

    try {
      const response = await parser.parse(validatedRequest);

      return validateParseResponse(response).result;
    } catch (error: unknown) {
      if (error instanceof InvalidParserResultError) {
        throw error;
      }

      // The adapter catches its own stack overflow (NA-10); one here comes from checking a tree too deep for the
      // call stack (XA-06). It is the same resource limit, not an execution failure.
      if (error instanceof RangeError) {
        return resourceLimitResult(parser.id, validatedRequest, error);
      }

      if (
        error instanceof LegacyExodusError &&
        [
          "AST_NODE_INVALID",
          "AST_RESULT_INVALID",
          "PARSER_STATISTICS_INVALID",
          "PARSE_RESPONSE_INVALID",
        ].includes(error.code)
      ) {
        throw new InvalidParserResultError(parser.id, error);
      }

      throw new ParserExecutionError(parser.id, error);
    }
  }
}
