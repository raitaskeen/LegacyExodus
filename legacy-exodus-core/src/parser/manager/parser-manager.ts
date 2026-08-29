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
