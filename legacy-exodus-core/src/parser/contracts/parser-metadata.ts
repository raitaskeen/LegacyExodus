import { z } from "zod";

import { ParserRegistrationError } from "@parser/registry/parser-registry-errors";

import type { ParserCapability } from "./parser-capability";
import { immutable } from "@shared/immutability";

export interface ParserMetadata {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly supportedLanguages: readonly string[];
  readonly capabilities: readonly ParserCapability[];
}

const parserCapabilitySchema = z.enum(["ast", "comments", "exports", "imports", "locations"]);

const parserMetadataSchema = z.object({
  id: z.string().trim().min(1).regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(1),
  version: z.string().trim().min(1),
  supportedLanguages: z.array(z.string().trim().min(1)).min(1),
  capabilities: z.array(parserCapabilitySchema).min(1),
});

export function validateParserMetadata(metadata: unknown): ParserMetadata {
  const parsedMetadata = parserMetadataSchema.safeParse(metadata);

  if (!parsedMetadata.success) {
    throw new ParserRegistrationError("invalid-parser", "Parser metadata is invalid.", {
      issues: parsedMetadata.error.issues,
    });
  }

  if (new Set(parsedMetadata.data.supportedLanguages).size !== parsedMetadata.data.supportedLanguages.length) {
    throw new ParserRegistrationError(
      parsedMetadata.data.id,
      "Parser metadata contains duplicate supported languages.",
    );
  }

  if (new Set(parsedMetadata.data.capabilities).size !== parsedMetadata.data.capabilities.length) {
    throw new ParserRegistrationError(
      parsedMetadata.data.id,
      "Parser metadata contains duplicate capabilities.",
    );
  }

  return immutable({
    ...parsedMetadata.data,
    supportedLanguages: immutable([...parsedMetadata.data.supportedLanguages]),
    capabilities: immutable([...parsedMetadata.data.capabilities]),
  });
}
