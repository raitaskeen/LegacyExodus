import { z } from "zod";

import { LegacyExodusError } from "@shared/errors";
import { immutable } from "@shared/immutability";

export interface ParserStatistics {
  readonly durationMs: number;
  readonly nodeCount: number;
}

const parserStatisticsSchema = z.object({
  durationMs: z.number().nonnegative(),
  nodeCount: z.number().int().nonnegative(),
});

export function validateParserStatistics(statistics: unknown): ParserStatistics {
  const parsedStatistics = parserStatisticsSchema.safeParse(statistics);

  if (!parsedStatistics.success) {
    throw new LegacyExodusError({
      code: "PARSER_STATISTICS_INVALID",
      message: "Parser statistics are invalid.",
      metadata: { issues: parsedStatistics.error.issues },
    });
  }

  return immutable({ ...parsedStatistics.data });
}
