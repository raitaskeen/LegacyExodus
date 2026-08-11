import { z } from "zod";

import type { FileArtifact } from "@contracts/discovery";
import { LegacyExodusError } from "@shared/errors";

export interface ParseRequest {
  readonly file: FileArtifact;
  readonly source: string;
}

const parseRequestSchema = z.object({
  file: z.object({
    id: z.string().min(1),
    path: z.string().min(1),
    language: z.string().min(1),
    size: z.number().nonnegative(),
  }),
  source: z.string(),
});

export function validateParseRequest(request: unknown): ParseRequest {
  const parsedRequest = parseRequestSchema.safeParse(request);

  if (!parsedRequest.success) {
    throw new LegacyExodusError({
      code: "PARSE_REQUEST_INVALID",
      message: "Parse request is invalid.",
      metadata: { issues: parsedRequest.error.issues },
    });
  }

  return Object.freeze({
    file: Object.freeze({ ...parsedRequest.data.file }),
    source: parsedRequest.data.source,
  });
}
