import { z } from "zod";

import { LegacyExodusError } from "@shared/errors";

import { validateASTResult, type ASTResult } from "@parser/contracts/ast-result";

export interface ParseResponse {
  readonly result: ASTResult;
}

const parseResponseSchema = z.object({ result: z.unknown() });

export function validateParseResponse(response: unknown): ParseResponse {
  if (
    typeof response === "object" &&
    response !== null &&
    Object.isFrozen(response) &&
    "result" in response &&
    typeof (response as ParseResponse).result === "object" &&
    (response as ParseResponse).result !== null &&
    Object.isFrozen((response as ParseResponse).result)
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

  return Object.freeze({ result: validateASTResult(parsedResponse.data.result) });
}
