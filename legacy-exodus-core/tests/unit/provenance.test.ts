import { describe, expect, test } from "bun:test";
import { createAnalysisProvenance } from "@contracts/provenance";

describe("AnalysisProvenance", () => {
  test("validates and freezes canonical cross-artifact references", (): void => {
    const value = { analysisRunId: "00000000-0000-4000-8000-000000000001", fileId: "file-a", symbolId: "symbol-a", callId: "call-a" };
    expect(createAnalysisProvenance(value)).toEqual(value);
    expect(Object.isFrozen(createAnalysisProvenance(value))).toBe(true);
    expect(() => createAnalysisProvenance({ analysisRunId: value.analysisRunId })).toThrow();
  });
});
