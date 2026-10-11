import { analysisRunPayloadSchema } from "@contracts/discovery-storage";
import { createStorageRecord, MemoryStorageProvider, StorageManager } from "@storage/index";
import { describe, expect, it } from "bun:test";

import {
  controlFlowPayloadSchema,
  dataFlowPayloadSchema,
  semanticAnalysisPayloadSchema,
} from "@contracts/discovery-storage";

const projectId = "aaaaaaaa-0000-4000-8000-000000000001";
const analysisRunId = "11111111-0000-4000-8000-000000000001";

describe("SCHEMA-001: persisted analysis contracts", () => {
  it("rejects malformed nested semantic and flow state at the persistence boundary", () => {
    expect(
      semanticAnalysisPayloadSchema.safeParse({
        projectId,
        analysisRunId,
        calls: [{ id: "call-without-required-structure" }],
        references: [],
        scopes: [],
        deadCode: [],
        unusedImports: [],
        unusedExports: [],
        entryPoints: [],
        routes: [],
        middlewareChains: [],
      }).success,
    ).toBe(false);

    expect(
      controlFlowPayloadSchema.safeParse({
        projectId,
        analysisRunId,
        graphs: [{ id: "cfg-without-required-structure" }],
      }).success,
    ).toBe(false);

    expect(
      dataFlowPayloadSchema.safeParse({
        projectId,
        analysisRunId,
        graphs: [{ id: "dfg-without-required-structure" }],
      }).success,
    ).toBe(false);
  });

  it("accepts canonical semantic and flow state including durable null call arguments", () => {
    expect(
      semanticAnalysisPayloadSchema.safeParse({
        projectId,
        analysisRunId,
        calls: [],
        references: [],
        scopes: [],
        deadCode: [],
        unusedImports: [],
        unusedExports: [],
        entryPoints: [],
        routes: [],
        middlewareChains: [],
      }).success,
    ).toBe(true);

    expect(
      controlFlowPayloadSchema.safeParse({
        projectId,
        analysisRunId,
        graphs: [
          {
            id: "cfg-1",
            filePath: "src/index.ts",
            scopeName: "module",
            state: "RESOLVED",
            entryBlockId: "entry",
            exitBlockId: "exit",
            blocks: [
              { id: "entry", statements: [], predecessorIds: [], successorIds: ["exit"] },
              { id: "exit", statements: [], predecessorIds: ["entry"], successorIds: [] },
            ],
            edges: [{ id: "edge-1", fromBlockId: "entry", toBlockId: "exit", kind: "next" }],
            dominators: [
              { blockId: "entry" },
              { blockId: "exit", immediateDominatorId: "entry" },
            ],
            loops: [],
            unreachableBlockIds: [],
            deadCodeNodeIds: [],
          },
        ],
      }).success,
    ).toBe(true);

    expect(
      dataFlowPayloadSchema.safeParse({
        projectId,
        analysisRunId,
        graphs: [
          {
            id: "dfg-1",
            filePath: "src/index.ts",
            state: "RESOLVED",
            definitions: [],
            uses: [],
            defUseChains: [],
            lifetimes: [],
            taintFlows: [],
            interproceduralFlows: [],
            functionSummaries: [],
            callBindings: [
              {
                callId: "call-1",
                targetSymbolId: "symbol-1",
                argumentDefinitionIds: ["definition-1", null],
              },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });
});


describe("R01 durable run capability", () => {
  const summary = { filesDiscovered: 2, filesAnalyzed: 1, parserFailures: 0, symbolExtractionFailures: 0,
    unsupportedFiles: 0, nonSourceArtifacts: 1, unclassifiedArtifacts: 0, enumerationFailures: 0,
    secondPassFailures: 1, discoveryComplete: true, durationMs: 1 };
  const capability = { contract: "r01-analysis-disposition-v1", files: [
    { fileId: "a", path: "empty.js", kind: "analyzed", symbolCount: 0, secondPassFailure: { code: "AST_RESTORE_INJECTED" } },
  ] };
  const run = { projectId, analysisRunId, status: "completed", startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.000Z", summary, analysisDisposition: capability };

  it("preserves capability and second-pass failure in serialized storage round trip", async () => {
    const storage = new StorageManager(new MemoryStorageProvider());
    const record = createStorageRecord("analysis-run", JSON.parse(JSON.stringify(run)));
    try {
      await storage.save(record);
      const stored = await storage.findById(record.id);
      const parsed = analysisRunPayloadSchema.parse(stored!.payload);
      expect(JSON.stringify(parsed.analysisDisposition)).toBe(JSON.stringify(capability));
      expect(parsed.summary?.secondPassFailures).toBe(1);
      expect(Object.hasOwn(stored!.payload as object, "isReused")).toBe(false);
    } finally { await storage.close(); }
  });

  it("reads historical run records without disposition or second-pass metadata without upgrading them", () => {
    const { secondPassFailures: _failure, ...historicalSummary } = summary;
    const parsed = analysisRunPayloadSchema.parse({ projectId, analysisRunId, status: "completed",
      startedAt: run.startedAt, summary: historicalSummary });
    expect(Object.hasOwn(parsed, "analysisDisposition")).toBe(false);
    expect(Object.hasOwn(parsed.summary!, "secondPassFailures")).toBe(false);
  });

  for (const [name, altered] of [
    ["unknown-marker", { ...capability, contract: "unknown" }],
    ["null", null],
    ["extra-field", { ...capability, timestamp: run.startedAt }],
    ["duplicate", { ...capability, files: [...capability.files, ...capability.files] }],
    ["unknown-kind", { ...capability, files: [{ ...capability.files[0], kind: "unknown" }] }],
    ["null-second-pass", { ...capability, files: [{ ...capability.files[0], secondPassFailure: null }] }],
  ] as const) {
    it(`rejects malformed durable ${name} capability`, () => {
      expect(analysisRunPayloadSchema.safeParse({ ...run, analysisDisposition: altered }).success).toBe(false);
    });
  }

  it("rejects capability/summary mismatches while preserving historical optionality", () => {
    for (const altered of [{ ...summary, filesAnalyzed: 2 }, { ...summary, secondPassFailures: 0 }, { ...summary, filesDiscovered: 3 }]) {
      expect(analysisRunPayloadSchema.safeParse({ ...run, summary: altered }).success).toBe(false);
    }
    const { secondPassFailures: _failure, ...missingCounter } = summary;
    expect(analysisRunPayloadSchema.safeParse({ ...run, summary: missingCounter }).success).toBe(false);
  });
});
