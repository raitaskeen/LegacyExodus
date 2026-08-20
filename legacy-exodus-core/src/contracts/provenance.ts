import { z } from "zod";

/** Stable references linking analysis artifacts without duplicating their payloads. */
export interface AnalysisProvenance {
  readonly analysisRunId: string;
  readonly fileId?: string;
  readonly moduleId?: string;
  readonly symbolId?: string;
  readonly scopeId?: string;
  readonly callId?: string;
  readonly findingId?: string;
}

const schema = z.object({
  analysisRunId: z.string().uuid(), fileId: z.string().min(1).optional(), moduleId: z.string().min(1).optional(),
  symbolId: z.string().min(1).optional(), scopeId: z.string().min(1).optional(), callId: z.string().min(1).optional(), findingId: z.string().min(1).optional(),
}).refine((value) => Object.keys(value).length > 1, "Provenance must reference at least one canonical entity.");

export function createAnalysisProvenance(value: AnalysisProvenance): AnalysisProvenance {
  return Object.freeze({ ...schema.parse(value) });
}
