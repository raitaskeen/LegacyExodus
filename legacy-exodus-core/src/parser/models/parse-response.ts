import { z } from "zod";

import { LegacyExodusError } from "@shared/errors";

import { validateASTResult, type ASTResult } from "@parser/contracts/ast-result";
import { immutable, isImmutable } from "@shared/immutability";

export interface ParseResponse {
  readonly result: ASTResult;
}

const parseResponseSchema = z.object({ result: z.unknown() });
const validatedParseResponses = new WeakSet<object>();

export function validateParseResponse(response: unknown): ParseResponse {
  if (
    typeof response === "object" &&
    response !== null &&
    isImmutable(response) &&
    validatedParseResponses.has(response) &&
    "result" in response &&
    typeof (response as ParseResponse).result === "object" &&
    (response as ParseResponse).result !== null &&
    isImmutable((response as ParseResponse).result)
  ) {
    return response as ParseResponse;
  }

  const parsedResponse = parseResponseSchema.safeParse(response);

  if (!parsedResponse.success) {
    throw new LegacyExodusError({
      code: "PARSE_RESPONSE_INVALID",
      message: "Parse response is invalid.",
      metadata: { issues: parsedResponse.error.issues },
    });
  }

  const frozenResponse: ParseResponse = immutable({
    result: validateASTResult(parsedResponse.data.result),
  });

  validatedParseResponses.add(frozenResponse);
  return frozenResponse;
}
