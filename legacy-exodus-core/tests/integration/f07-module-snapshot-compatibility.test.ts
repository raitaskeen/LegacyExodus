import { describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLegacyExodusEngine } from "@runtime/composition/services";
import { DiscoveryValidator } from "@discovery/discovery-validator";
import { DiscoveryQueryService } from "@discovery/discovery-query-service";
import { computeManifestMac, manifestKeyId, MANIFEST_MAC_ALGORITHM, MANIFEST_SCHEMA_VERSION, SnapshotKeyStore } from "@discovery/index";
import { StorageManager } from "@storage/index";
import { SqliteStorageProvider } from "@storage/adapters/sqlite-storage";
import { validateCurrentDependencyGraph } from "@graph/index";

describe("F07 checksum-valid snapshot graph capability", () => {
  for (const mode of ["current", "historical", "null", "unknown", "malformed-edge"] as const) {
    test(`T8 ${mode} snapshot eligibility survives projection and independent engine runs`, async () => {
      const scratchPath = await mkdtemp(join(tmpdir(), "lx-f07-snapshot-"));
      const projectPath = join(scratchPath, "workspace");
      await mkdir(projectPath);
      const databasePath = join(scratchPath, "state.sqlite");
      const projectId = randomUUID();
      const environment = { LOG_LEVEL: "silent", NODE_ENV: "test", LEGACY_EXODUS_STORAGE_DRIVER: "sqlite", LEGACY_EXODUS_STORAGE_DB_PATH: databasePath };
      const analyze = async () => {
        const engine = createLegacyExodusEngine(environment);
        await engine.initialize();
        try {
          const analysisRunId = randomUUID();
          const result = await engine.execute({ id: analysisRunId, type: "AnalyzeProject", createdAt: new Date(), payload: { projectId, path: projectPath } });
          if (result.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject");
          return { result, analysisRunId };
        } finally { await engine.shutdown(); }
      };
      let storage: StorageManager | undefined;
      try {
        await writeFile(join(projectPath, "package.json"), JSON.stringify({ name: "f07-snapshot", version: "1.0.0" }));
        await writeFile(join(projectPath, "a.ts"), 'import "./b"; export const a = 1;');
        await writeFile(join(projectPath, "b.ts"), 'import "./a"; export const b = 1;');
        const first = await analyze();
        expect(first.result.isReused).toBeUndefined();
        expect(first.result.analysis.filesAnalyzed).toBe(2);
        const graphPath = join(projectPath, ".discovery", "dependency-graph.json");
        const original = validateCurrentDependencyGraph(JSON.parse(await readFile(graphPath, "utf8")));
        expect(original.moduleGraph.edges).toHaveLength(2);
        expect(original.cycles).toEqual([["a.ts", "b.ts", "a.ts"]]);
        if (mode !== "current") {
          const { moduleGraph, ...historical } = original;
          const altered = mode === "historical" ? historical : { ...historical, moduleGraph: mode === "null" ? null
            : mode === "unknown" ? { contract: "future-import-relations", edges: [] }
            : { contract: "f07-import-relations-v1", edges: [{ id: "no-source-anchor" }] } };
          const bytes = JSON.stringify(altered, null, 2) + "\n";
          await writeFile(graphPath, bytes);
          const manifestPath = join(projectPath, ".discovery", "manifest.json");
          const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
          manifest.artifacts["dependency-graph.json"] = { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: Buffer.byteLength(bytes) };
          // F-001: re-authenticate as this machine's analyzer would, so rejection below comes from the graph contract.
          const key = await new SnapshotKeyStore().readKey();
          if (key === undefined) throw new Error("Expected the fresh run to create a local snapshot key.");
          manifest.integrity = { algorithm: MANIFEST_MAC_ALGORITHM, keyId: manifestKeyId(key), mac: computeManifestMac(manifest, key) };
          await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
        }
        const validation = await new DiscoveryValidator().validate({ projectPath, verifyFreshness: true, authorizeReuse: true });
        expect(validation.valid).toBe(true);
        const second = await analyze();
        expect(second.result.isReused).toBe(mode === "current" ? true : undefined);
        expect(second.result.analysis.filesAnalyzed).toBe(2);
        const restored = validateCurrentDependencyGraph(JSON.parse(await readFile(graphPath, "utf8")));
        expect(restored.moduleGraph).toEqual(original.moduleGraph);
        expect(restored.cycles).toEqual(original.cycles);
        expect(restored.edges).toEqual(original.edges);
        storage = new StorageManager(new SqliteStorageProvider({ databasePath }));
        const queried = await new DiscoveryQueryService(storage).getDependencyGraph(projectId, second.analysisRunId);
        expect(validateCurrentDependencyGraph(queried).moduleGraph).toEqual(original.moduleGraph);
        const manifest = JSON.parse(await readFile(join(projectPath, ".discovery", "manifest.json"), "utf8"));
        expect(manifest.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
      } finally {
        await storage?.close();
        await rm(scratchPath, { recursive: true, force: true });
      }
    });
  }
});
