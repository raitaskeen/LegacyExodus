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
