import { parse } from "@babel/parser";

import type { ASTNode } from "@parser/contracts/ast-node";
import type { ParserError } from "@parser/contracts/parser-errors";
import type { Parser } from "@parser/contracts/parser";
import type { ParseRequest } from "@parser/models/parse-request";
import type { ParseResponse } from "@parser/models/parse-response";

import { mapJavaScriptNode } from "./javascript-node-mapper";
import { javascriptParserOptionsFor } from "./javascript-parser-options";

interface BabelParseError {
  readonly code?: string;
  readonly message: string;
  readonly reasonCode?: string;
  readonly loc?: {
    readonly line: number;
    readonly column: number;
  };
}

export class JavaScriptParser implements Parser {
  public readonly id = "javascript-parser";
  public readonly name = "JavaScript Parser";
  public readonly version = "1.0.0";
  public readonly supportedLanguages = Object.freeze(["javascript", "typescript"]);
  public readonly capabilities = Object.freeze(["ast", "comments", "exports", "imports", "locations"] as const);

  public canHandle(request: ParseRequest): boolean {
    return ["javascript", "typescript"].includes(request.file.language.toLowerCase());
  }

  public async parse(request: ParseRequest): Promise<ParseResponse> {
    const startedAt = performance.now();
    try {
      const parsedFile = parse(request.source, {
        ...javascriptParserOptionsFor(request.file.path),
        sourceFilename: request.file.path,
      });
      const mapping = mapJavaScriptNode(parsedFile.program);

      return {
        result: {
          metadata: {
            parserId: this.id,
            language: request.file.language.toLowerCase(),
            sourcePath: request.file.path,
          },
          root: mapping.node,
          statistics: {
            durationMs: performance.now() - startedAt,
            nodeCount: mapping.nodeCount,
          },
          warnings: [],
          errors: Object.freeze(parsedFile.errors.map(mapSyntaxError)),
        },
      };
    } catch (error: unknown) {
      return {
        result: {
          metadata: {
            parserId: this.id,
            language: request.file.language.toLowerCase(),
            sourcePath: request.file.path,
          },
          root: createEmptyProgram(),
          statistics: {
            durationMs: performance.now() - startedAt,
            nodeCount: 1,
          },
          warnings: [],
          errors: Object.freeze([mapSyntaxError(error)]),
        },
      };
    }
  }
}

function createEmptyProgram(): ASTNode {
  return {
    type: "Program",
    attributes: {},
    children: [],
  };
}

function mapSyntaxError(error: unknown): ParserError {
  const parseError = error as BabelParseError;

  return {
    code: parseError.reasonCode ?? parseError.code ?? "JAVASCRIPT_SYNTAX_ERROR",
    message: parseError.message,
    location:
      parseError.loc === undefined
        ? undefined
        : {
            line: parseError.loc.line,
            column: parseError.loc.column,
          },
  };
}
