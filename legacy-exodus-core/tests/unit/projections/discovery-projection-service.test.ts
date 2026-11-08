import { writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { createEngineContext } from "@runtime/composition/services";
import { analysisRunPayloadSchema, discoveryPayloadSchema } from "@contracts/discovery-storage";
import { createAnalysisDisposition, validateAnalysisDisposition, type AnalysisFileDisposition } from "@contracts/discovery-projection";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import {
  createStorageRecord,
  DiscoveryProjectionService,
  FileDiscoveryProjectionAdapter,
  MemoryStorageProvider,
  StorageManager,
} from "@storage/index";

describe("DiscoveryProjectionService", () => {
  test("projects a stored discovery record through the storage boundary", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-stored-discovery-"));
    const storage = new StorageManager(new MemoryStorageProvider());
    const record = createStorageRecord("project-discovery", {
      projectId: "00000000-0000-4000-8000-000000000040",
      projectName: "library-system",
      projectPath,
      files: [{ id: "file-1", path: "src/index.js", language: "javascript", size: 20 }],
      dependencies: [{ name: "express", version: "4.0.0", kind: "production" }],
      frameworks: [{ name: "express", evidence: "package.json dependency" }],
      languages: ["javascript"],
      discoveredAt: "2026-08-08T00:00:00.000Z",
    });
    const service = new DiscoveryProjectionService(storage, new FileDiscoveryProjectionAdapter());

    try {
      await storage.save(record);
      const projection = await service.project(record.id);

      expect(projection.artifacts).toHaveLength(5);
      expect(JSON.parse(await readFile(join(projectPath, ".discovery", "summary.json"), "utf8"))).toEqual({
        projectName: "library-system",
        fileCount: 1,
        dependencyCount: 1,
        frameworkCount: 1,
        languages: ["javascript"],
        enumerationFailureCount: 0,
        discoveryComplete: true,
      });
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("projects graph, knowledge, and symbols from only the active analysis run", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-run-scoped-projection-"));
    const storage = new StorageManager(new MemoryStorageProvider());
    const projectId = "00000000-0000-4000-8000-000000000050";
    const staleRunId = "00000000-0000-4000-8000-000000000051";
    const activeRunId = "00000000-0000-4000-8000-000000000052";
    const discovery = createStorageRecord("project-discovery", {
      projectId,
      analysisRunId: activeRunId,
      projectName: "library-system",
      projectPath,
      files: [{ id: "file-1", path: "src/index.js", language: "javascript", size: 20 }],
      dependencies: [], frameworks: [], languages: ["javascript"], discoveredAt: "2026-08-08T00:00:00.000Z",
    });
    const graph = (analysisRunId: string, id: string) => createStorageRecord("dependency-graph", {
      projectId, analysisRunId, nodes: [], edges: [], cycles: [[id, id]],
    });
    const symbols = (analysisRunId: string, name: string) => createStorageRecord("symbol-table", {
      projectId, analysisRunId, path: "src/index.js", symbols: [{
        id: name, kind: "export", name, filePath: "src/index.js", exported: true, defaultExport: false,
        language: "javascript", async: false, anonymous: false, visibility: "public", parameters: [],
        ...(name === "signIn" ? { sourceSymbolName: "login" } : {}),
      }],
    });
    const knowledge = (analysisRunId: string, id: string) => createStorageRecord("knowledge-graph", {
      projectId, analysisRunId, nodes: [{ id, kind: "symbol", name: id, filePath: "src/index.js" }], edges: [],
    });

    try {
      await storage.save(discovery);
      await storage.save(graph(staleRunId, "stale"));
      await storage.save(graph(activeRunId, "active"));
      await storage.save(symbols(staleRunId, "stale"));
      await storage.save(symbols(activeRunId, "signIn"));
      await storage.save(knowledge(staleRunId, "stale"));
      await storage.save(knowledge(activeRunId, "active"));
      await new DiscoveryProjectionService(storage, new FileDiscoveryProjectionAdapter()).project(discovery.id);

      expect(JSON.parse(await readFile(join(projectPath, ".discovery", "symbols.json"), "utf8"))).toEqual([{
        id: "signIn", kind: "export", name: "signIn", filePath: "src/index.js", exported: true, defaultExport: false,
        language: "javascript", async: false, anonymous: false, visibility: "public", parameters: [],
        sourceSymbolName: "login",
      }]);
      // Facts only in the artifact; the active run is named by the manifest (ADR-010).
      expect(JSON.parse(await readFile(join(projectPath, ".discovery", "knowledge.json"), "utf8"))).toEqual({
        nodes: [{ id: "active", kind: "symbol", name: "active", filePath: "src/index.js" }], edges: [],
      });
      const manifest = JSON.parse(await readFile(join(projectPath, ".discovery", "manifest.json"), "utf8"));
      expect({ projectId: manifest.analysis.projectId, analysisRunId: manifest.analysis.analysisRunId }).toEqual({ projectId, analysisRunId: activeRunId });
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("projects enumeration-failures.json when enumeration failures are recorded in discovery record", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-fail-projection-"));
    const storage = new StorageManager(new MemoryStorageProvider());
    const record = createStorageRecord("project-discovery", {
      projectId: "00000000-0000-4000-8000-000000000070",
      projectName: "partial-project",
      projectPath,
      files: [{ id: "file-1", path: "src/index.js", language: "javascript", size: 20 }],
      dependencies: [],
      frameworks: [],
      languages: ["javascript"],
      enumerationFailures: [
        { path: "secret_dir", kind: "directory-read", code: "EACCES" },
      ],
      discoveredAt: "2026-08-08T00:00:00.000Z",
    });
    const service = new DiscoveryProjectionService(storage, new FileDiscoveryProjectionAdapter());

    try {
      await storage.save(record);
      const projection = await service.project(record.id);

      expect(projection.artifacts.some((a) => a.name === "enumeration-failures.json")).toBe(true);
      expect(JSON.parse(await readFile(join(projectPath, ".discovery", "summary.json"), "utf8"))).toEqual({
        projectName: "partial-project",
        fileCount: 1,
        dependencyCount: 0,
        frameworkCount: 0,
        languages: ["javascript"],
        enumerationFailureCount: 1,
        discoveryComplete: false,
      });
      expect(JSON.parse(await readFile(join(projectPath, ".discovery", "enumeration-failures.json"), "utf8"))).toEqual([
        { path: "secret_dir", kind: "directory-read", code: "EACCES" },
      ]);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("P0.3: projects canonical control-flow.json without emitting duplicate cfg.json", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-flow-projection-"));
    const storage = new StorageManager(new MemoryStorageProvider());
    const projectId = "00000000-0000-4000-8000-000000000080";
    const analysisRunId = "00000000-0000-4000-8000-000000000081";
    const discovery = createStorageRecord("project-discovery", {
      projectId,
      analysisRunId,
      projectName: "flow-project",
      projectPath,
      files: [{ id: "file-1", path: "src/index.js", language: "javascript", size: 20 }],
      dependencies: [],
      frameworks: [],
      languages: ["javascript"],
      discoveredAt: "2026-08-08T00:00:00.000Z",
    });
    const graph = createStorageRecord("dependency-graph", {
      projectId,
      analysisRunId,
      nodes: [],
      edges: [],
      cycles: [],
    });
    const controlFlow = createStorageRecord("control-flow-analysis", {
      projectId,
      analysisRunId,
      graphs: [
        {
          id: "cfg-1",
          filePath: "src/index.js",
          scopeName: "login",
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
    });
    const service = new DiscoveryProjectionService(storage, new FileDiscoveryProjectionAdapter());

    try {
      await storage.save(discovery);
      await storage.save(graph);
      await storage.save(controlFlow);
      const projection = await service.project(discovery.id);

      expect(projection.artifacts.some((a) => a.name === "control-flow.json")).toBe(true);
      expect(projection.artifacts.some((a) => a.name === "cfg.json")).toBe(false);

      const writtenControlFlow = JSON.parse(
        await readFile(join(projectPath, ".discovery", "control-flow.json"), "utf8"),
      ) as { readonly projectId?: string; readonly graphs: readonly { readonly scopeName: string }[] };

      // Run identity is in the manifest, not in the fact artifact (ADR-010).
      expect(writtenControlFlow.projectId).toBeUndefined();
      expect(JSON.parse(await readFile(join(projectPath, ".discovery", "manifest.json"), "utf8")).analysis.projectId).toBe(projectId);
      expect(writtenControlFlow.graphs).toHaveLength(1);
      expect(writtenControlFlow.graphs[0]!.scopeName).toBe("login");
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });
});


describe("R01 projection evidence", () => {
  for (const mode of ["empty", "missing-table", "duplicate-table", "failed-table", "wrong-file-id", "summary-mismatch", "ambiguous-run", "foreign-run", "duplicate-discovery-path"] as const) {
    test(`R01 projection ${mode} validates actual matching table/run evidence`, async () => {
      const projectPath = await mkdtemp(join(tmpdir(), "r01-projection-"));
      const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
      try {
        await writeFile(join(projectPath, "empty.js"), "");
        if (mode === "failed-table") await writeFile(join(projectPath, "bad.js"), "function broken( {");
        const execution = await context.orchestrator.execute({
          id: randomUUID(), type: "AnalyzeProject", createdAt: new Date(), payload: { projectId: randomUUID(), path: projectPath },
        });
        const discovery = execution.records.find((record) => record.type === "project-discovery")!;
        const run = execution.records.find((record) => record.type === "analysis-run")!;
        const table = execution.records.find((record) => record.type === "symbol-table")!;
        const runPayload = analysisRunPayloadSchema.parse(run.payload);
        let discoveryId = discovery.id;
        switch (mode) {
          case "missing-table": await context.storage.delete(table.id); break;
          case "duplicate-table": await context.storage.save(createStorageRecord("symbol-table", { ...(table.payload as object), duplicateRecord: true })); break;
          case "failed-table": await context.storage.save(createStorageRecord("symbol-table", {
            ...(table.payload as object), fileId: execution.discovery!.files.find((file) => file.path === "bad.js")!.id, path: "bad.js",
          })); break;
          case "wrong-file-id": await context.storage.delete(table.id); await context.storage.save(createStorageRecord("symbol-table", { ...(table.payload as object), fileId: "wrong" })); break;
          case "summary-mismatch": {
            // B6: reject a contradictory stored run before authorizing projection.
            expect(runPayload.summary?.filesAnalyzed).toBe(1);
            const contradictoryRun = { ...runPayload, summary: { ...runPayload.summary, filesAnalyzed: 999 } };
            expect(analysisRunPayloadSchema.safeParse(contradictoryRun).success).toBe(false);
            await context.storage.delete(run.id);
            await context.storage.save(createStorageRecord("analysis-run", contradictoryRun));
            break;
          }
          case "ambiguous-run": await context.storage.save(createStorageRecord("analysis-run", { ...runPayload, completedAt: "2026-01-01T00:00:00.000Z" })); break;
          case "foreign-run":
            await context.storage.save(createStorageRecord("symbol-table", { ...(table.payload as object), analysisRunId: randomUUID(), path: "foreign.js", fileId: "foreign" }));
            await context.storage.save(createStorageRecord("analysis-run", { ...runPayload, analysisRunId: randomUUID(), analysisDisposition: { contract: "invalid", files: [] } }));
            break;
          case "duplicate-discovery-path": {
            const payload = discoveryPayloadSchema.parse(discovery.payload);
            const altered = createStorageRecord("project-discovery", { ...payload, files: [...payload.files, { ...payload.files[0]!, id: "other" }] });
            await context.storage.save(altered);
            discoveryId = altered.id;
            break;
          }
        }
        if (mode === "empty" || mode === "foreign-run") {
          const projection = await context.discoveryProjection.project(discoveryId);
          const summary = projection.artifacts.find((artifact) => artifact.name === "summary.json")!.payload as Record<string, unknown>;
          expect(summary.analysisDisposition).toEqual(runPayload.analysisDisposition);
          expect(Object.keys(summary).sort()).toEqual([
            "analysisDisposition", "dependencyCount", "discoveryComplete", "enumerationFailureCount",
            "fileCount", "frameworkCount", "languages", "projectName",
          ]);
          for (const counter of ["filesDiscovered", "filesAnalyzed", "parserFailures", "symbolExtractionFailures",
            "unsupportedFiles", "nonSourceArtifacts", "unclassifiedArtifacts", "enumerationFailures", "secondPassFailures"]) {
            expect(Object.hasOwn(summary, counter)).toBe(false);
          }
          expect(JSON.parse(await readFile(join(projectPath, ".discovery", "symbols.json"), "utf8"))).toEqual([]);
          expect(runPayload.analysisDisposition!.files[0]).toMatchObject({ path: "empty.js", kind: "analyzed", symbolCount: 0 });
        } else {
          await expect(context.discoveryProjection.project(discoveryId)).rejects.toThrow();
          expect(await exists(join(projectPath, ".discovery", "summary.json"))).toBe(false);
        }
      } finally { await context.runtime.shutdown(); await rm(projectPath, { recursive: true, force: true }); }
    });
  }

  test("R01 preserves distinct validated path spellings and rejects forged identity", () => {
    const paths = ["./src/a.js", "src/a.js", "src\\a.js", "SRC/a.js"];
    const files = paths.map((path, index) => ({ id: `file-${index}`, path, language: "javascript", fileKind: "source" }));
    const entries: AnalysisFileDisposition[] = files.map((file) => ({ fileId: file.id, path: file.path, kind: "analyzed", symbolCount: 0 }));
    const summary = { filesDiscovered: 4, filesAnalyzed: 4, parserFailures: 0, symbolExtractionFailures: 0,
      unsupportedFiles: 0, nonSourceArtifacts: 0, unclassifiedArtifacts: 0, enumerationFailures: 0,
      secondPassFailures: 0, discoveryComplete: true };
    const evidence = { files, symbols: [], tables: files.map((file) => ({ fileId: file.id, path: file.path, symbols: [] })),
      summary, enumerationFailures: 0, manifestFailures: 0 };
    const validated = validateAnalysisDisposition(createAnalysisDisposition(entries), evidence);
    expect(validated.files).toHaveLength(4);
    for (const file of files) expect(validated.files.find((entry) => entry.fileId === file.id)?.path).toBe(file.path);
    for (const forgedPath of ["other.js", "../escape.js", "/absolute.js", "C:\\escape.js", "\\\\server\\share\\a.js"]) {
      expect(() => validateAnalysisDisposition(createAnalysisDisposition([
        { ...entries[0]!, path: forgedPath }, ...entries.slice(1),
      ]), evidence)).toThrow();
    }
    expect(() => validateAnalysisDisposition(createAnalysisDisposition([
      { ...entries[0]!, path: "src/a.js" }, ...entries.slice(1),
    ]), evidence)).toThrow();
  });

  test("R01 disposition bytes and hashes match across three record/property permutations", () => {
    const entries: AnalysisFileDisposition[] = [
      { fileId: "lower", path: "a.js", kind: "analyzed", symbolCount: 0 },
      { kind: "initial-parser-failure", path: "z.js", code: "PARSE_FAILED", fileId: "last" },
      { secondPassFailure: { code: "AST_RESTORE_INJECTED" }, symbolCount: 2, kind: "analyzed", path: "Z.js", fileId: "upper" },
    ];
    const permutations = [entries, [entries[2]!, entries[0]!, entries[1]!], [...entries].reverse()];
    const bytes = permutations.map((files) => JSON.stringify(createAnalysisDisposition(files)));
    expect(new Set(bytes).size).toBe(1);
    expect(new Set(bytes.map((value) => createHash("sha256").update(value).digest("hex"))).size).toBe(1);
    expect(JSON.parse(bytes[0]!).files.map((file: { path: string }) => file.path)).toEqual(["Z.js", "a.js", "z.js"]);
    expect(bytes[0]).toStartWith('{"contract":"r01-analysis-disposition-v1","files":[{"fileId":"upper","path":"Z.js","kind":"analyzed","symbolCount":2,"secondPassFailure":{"code":"AST_RESTORE_INJECTED"}}');
  });
});

async function exists(path: string): Promise<boolean> {
  try { await readFile(path); return true; } catch { return false; }
}
