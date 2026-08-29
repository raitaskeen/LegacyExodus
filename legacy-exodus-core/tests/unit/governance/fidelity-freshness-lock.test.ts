import { describe, expect, it, spyOn } from "bun:test";
import * as cp from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiscoveryArtifactProvenance, GroundTruthFact } from "@contracts/fidelity";
import { runFidelityValidation } from "../../../benchmarks/fidelity/runner";
import { ensureDiscoveryProjections } from "./test-fidelity-helpers";

describe("Migration Fidelity — Verification Hardening & Evidence Freshness Lock", () => {
  const sampleGT: readonly GroundTruthFact[] = [
    {
      id: "gt-file-1",
      category: "file",
      attributes: { path: "src/index.js", language: "javascript" },
      provenance: "GROUND_TRUTH_SOURCE",
      sourceDescription: "index.js",
      migrationRelevance: "File existence",
    },
    {
      id: "gt-dep-1",
      category: "dependency",
      attributes: { name: "test-lib", version: "1.0.0", kind: "production" },
      provenance: "GROUND_TRUTH_SOURCE",
      sourceDescription: "test-lib dep",
      migrationRelevance: "Dependency",
    },
  ];

  async function createValidDiscoveryFixture(tempDir: string): Promise<DiscoveryArtifactProvenance> {
    const discoveryDir = join(tempDir, ".discovery");
    await mkdir(discoveryDir, { recursive: true });

    const files = [{ path: "src/index.js", language: "javascript" }];
    const deps = [{ name: "test-lib", version: "1.0.0", kind: "production" }];
    const symbols = [{ filePath: "src/index.js", name: "app", kind: "variable", exported: true }];
    const depGraph = { nodes: [], edges: [], cycles: [] };
    const semantic = { calls: [] };
    const controlFlow = { graphs: [] };
    const dataFlow = { graphs: [] };

    const artifactData: Record<string, unknown> = {
      "files.json": files,
      "dependencies.json": deps,
      "symbols.json": symbols,
      "dependency-graph.json": depGraph,
      "semantic.json": semantic,
      "control-flow.json": controlFlow,
      "data-flow.json": dataFlow,
    };

    const artifactHashes: Record<string, { sha256: string; bytes: number }> = {};

    for (const [name, payload] of Object.entries(artifactData)) {
      const serialized = JSON.stringify(payload, null, 2);
      await writeFile(join(discoveryDir, name), serialized, "utf8");
      const sha256 = createHash("sha256").update(Buffer.from(serialized, "utf8")).digest("hex");
      artifactHashes[name] = { sha256, bytes: Buffer.byteLength(serialized, "utf8") };
    }

    const provenance: DiscoveryArtifactProvenance = {
      schemaVersion: 1,
      repository: {
        name: "test-repo",
        path: tempDir,
        packageVersion: "1.2.3",
        commitSha: "a1b2c3d4e5f6071829304152637485960718293a",
      },
      engine: {
        packageVersion: "0.1.0",
        commitSha: "engine-sha-123456",
        bunVersion: "bun-1.3.14",
      },
      analysis: {
        projectId: "00000000-0000-4000-8000-000000000001",
        analysisRunId: "00000000-0000-4000-8000-000000000002",
        generatedAt: "2026-08-23T16:00:00.000Z",
      },
      requiredArtifacts: [
        "files.json",
        "dependencies.json",
        "symbols.json",
        "dependency-graph.json",
        "semantic.json",
        "control-flow.json",
        "data-flow.json",
      ],
      artifacts: artifactHashes,
    };

    await writeFile(
      join(discoveryDir, "manifest.json"),
      JSON.stringify(provenance, null, 2),
      "utf8",
    );

    return provenance;
  }

  // Case A: Fresh valid artifacts
  it("Case A: validates successfully with fresh matching provenance and hashes", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "freshness-a-"));
    try {
      await createValidDiscoveryFixture(tempDir);
      const report = await runFidelityValidation({
        repoPath: tempDir,
        groundTruth: sampleGT,
        closedScopeFilePaths: ["src/index.js"],
        expectedRepositoryName: "test-repo",
        expectedRepositoryRevision: "1.2.3",
        expectedEngineCommitSha: "engine-sha-123456",
        expectedAnalysisRunId: "00000000-0000-4000-8000-000000000002",
      });

      expect(report.freshnessStatus).toBe("FRESH");
      expect(report.provenanceEvidence).toBeDefined();
      expect(report.provenanceEvidence?.repository.name).toBe("test-repo");
      expect(report.overallTruePositives).toBe(2);
      expect(report.overallFalseNegatives).toBe(0);
      expect(report.overallRecall).toBe(1.0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // Case B: Missing provenance manifest
  it("Case B: throws hard error when manifest.json is missing", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "freshness-b-"));
    try {
      await createValidDiscoveryFixture(tempDir);
      await rm(join(tempDir, ".discovery", "manifest.json"));

      await expect(
        runFidelityValidation({
          repoPath: tempDir,
          groundTruth: sampleGT,
        }),
      ).rejects.toThrow(/Missing required discovery manifest/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // Case C: Missing required artifact
  it("Case C: throws hard error when a required artifact listed in manifest is missing on disk", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "freshness-c-"));
    try {
      await createValidDiscoveryFixture(tempDir);
      await rm(join(tempDir, ".discovery", "files.json"));

      await expect(
        runFidelityValidation({
          repoPath: tempDir,
          groundTruth: sampleGT,
          expectedRepositoryName: "test-repo",
        }),
      ).rejects.toThrow(/Missing required discovery artifact/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // Case D: Corrupted artifact (SHA-256 hash mismatch)
  it("Case D: throws hard error when an artifact has been modified/corrupted after manifest generation", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "freshness-d-"));
    try {
      await createValidDiscoveryFixture(tempDir);
      // Tamper with files.json
      await writeFile(
        join(tempDir, ".discovery", "files.json"),
        JSON.stringify([{ path: "src/tampered.js", language: "javascript" }]),
        "utf8",
      );

      await expect(
        runFidelityValidation({
          repoPath: tempDir,
          groundTruth: sampleGT,
          expectedRepositoryName: "test-repo",
        }),
      ).rejects.toThrow(/Artifact integrity failure: SHA-256 hash mismatch for 'files.json'/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // Case E: Repository revision mismatch
  it("Case E: throws hard error when repository revision does not match expected revision", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "freshness-e-"));
    try {
      await createValidDiscoveryFixture(tempDir);

      await expect(
        runFidelityValidation({
          repoPath: tempDir,
          groundTruth: sampleGT,
          expectedRepositoryName: "test-repo",
          expectedRepositoryRevision: "2.0.0-mismatched",
        }),
      ).rejects.toThrow(/Repository revision mismatch: expected '2.0.0-mismatched', found '1.2.3'/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // Case F: Engine identity mismatch
  it("Case F: throws hard error when engine identity does not match expected commit SHA", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "freshness-f-"));
    try {
      await createValidDiscoveryFixture(tempDir);

      await expect(
        runFidelityValidation({
          repoPath: tempDir,
          groundTruth: sampleGT,
          expectedRepositoryName: "test-repo",
          expectedEngineCommitSha: "stale-engine-sha-999",
        }),
      ).rejects.toThrow(/Engine identity mismatch: expected 'stale-engine-sha-999', found 'engine-sha-123456'/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // Case G: Repository identity mismatch
  it("Case G: throws hard error when repository identity belongs to another repository", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "freshness-g-"));
    try {
      await createValidDiscoveryFixture(tempDir);

      await expect(
        runFidelityValidation({
          repoPath: tempDir,
          groundTruth: sampleGT,
          expectedRepositoryName: "unexpected-foreign-repo",
        }),
      ).rejects.toThrow(/Repository identity mismatch: expected 'unexpected-foreign-repo', found 'test-repo'/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // Case H: Deterministic repeated validation
  it("Case H: produces deterministic validation metrics and identical provenance evidence on repeated runs", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "freshness-h-"));
    try {
      await createValidDiscoveryFixture(tempDir);

      const run1 = await runFidelityValidation({
        repoPath: tempDir,
        groundTruth: sampleGT,
        closedScopeFilePaths: ["src/index.js"],
        expectedRepositoryName: "test-repo",
      });

      const run2 = await runFidelityValidation({
        repoPath: tempDir,
        groundTruth: sampleGT,
        closedScopeFilePaths: ["src/index.js"],
        expectedRepositoryName: "test-repo",
      });

      expect(run1.overallPrecision).toBe(run2.overallPrecision);
      expect(run1.overallRecall).toBe(run2.overallRecall);
      expect(run1.overallTruePositives).toBe(run2.overallTruePositives);
      expect(run1.overallFalsePositives).toBe(run2.overallFalsePositives);
      expect(run1.overallFalseNegatives).toBe(run2.overallFalseNegatives);
      expect(run1.provenanceEvidence?.artifacts).toEqual(run2.provenanceEvidence?.artifacts);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // Case J: No false conversion of input errors into empty prediction sets
  it("Case J: ensures corrupted or missing inputs never silently masquerade as 0 predictions / 100% FN", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "freshness-j-"));
    try {
      // Empty directory (no manifest, no artifacts)
      let threw = false;
      try {
        await runFidelityValidation({ repoPath: tempDir, groundTruth: sampleGT });
      } catch (err: any) {
        threw = true;
        expect(err.message).toContain("Missing required discovery manifest");
      }
      expect(threw).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // Case K: Dynamic STALE classification when manifest engine SHA is older than current HEAD
  it("Case K: dynamically classifies freshnessStatus as STALE when manifest engine SHA differs from current HEAD and expectedEngineCommitSha is omitted", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "freshness-k-"));
    try {
      await createValidDiscoveryFixture(tempDir);
      // createValidDiscoveryFixture sets engine.commitSha = "engine-sha-123456"
      const report = await runFidelityValidation({
        repoPath: tempDir,
        groundTruth: sampleGT,
        closedScopeFilePaths: ["src/index.js"],
        expectedRepositoryName: "test-repo",
      });

      expect(report.freshnessStatus).toBe("STALE");
      expect(report.provenanceEvidence?.engine.commitSha).toBe("engine-sha-123456");
      expect(report.overallTruePositives).toBe(2);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // Case L: Dynamic FRESH classification when manifest engine SHA matches current HEAD
  it("Case L: dynamically classifies freshnessStatus as FRESH when manifest engine SHA matches current repository HEAD", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "freshness-l-"));
    try {
      const prov = await createValidDiscoveryFixture(tempDir);
      const { execSync } = await import("node:child_process");
      const currentHead = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

      const updatedProv: DiscoveryArtifactProvenance = {
        ...prov,
        engine: {
          ...prov.engine,
          commitSha: currentHead,
        },
      };

      await writeFile(
        join(tempDir, ".discovery", "manifest.json"),
        JSON.stringify(updatedProv, null, 2),
        "utf8",
      );

      const report = await runFidelityValidation({
        repoPath: tempDir,
        groundTruth: sampleGT,
        closedScopeFilePaths: ["src/index.js"],
        expectedRepositoryName: "test-repo",
      });

      expect(report.freshnessStatus).toBe("FRESH");
      expect(report.provenanceEvidence?.engine.commitSha).toBe(currentHead);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("ensureDiscoveryProjections Helper Provenance Hardening", () => {
  async function createHelperFixture(tempDir: string, manifestSha: unknown): Promise<void> {
    const discoveryDir = join(tempDir, ".discovery");
    await mkdir(join(tempDir, "src"), { recursive: true });
    await mkdir(discoveryDir, { recursive: true });
    await writeFile(join(tempDir, "src", "index.js"), "export const val = 42;", "utf8");
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "test-helper-repo", version: "1.0.0" }),
      "utf8",
    );

    // Initial files.json includes a canary property to verify reuse vs regeneration
    await writeFile(
      join(discoveryDir, "files.json"),
      JSON.stringify([{ path: "src/index.js", canary: "untouched" }]),
      "utf8",
    );

    const manifest = {
      schemaVersion: 1,
      repository: { name: "test-helper-repo", path: tempDir },
      engine: { packageVersion: "0.1.0", commitSha: manifestSha },
      analysis: {
        projectId: "00000000-0000-4000-8000-000000000098",
        analysisRunId: "00000000-0000-4000-8000-000000000099",
        generatedAt: new Date().toISOString(),
      },
    };
    await writeFile(join(discoveryDir, "manifest.json"), JSON.stringify(manifest), "utf8");
  }

  async function isProjectionReused(tempDir: string): Promise<boolean> {
    const raw = await readFile(join(tempDir, ".discovery", "files.json"), "utf8");
    return raw.includes("untouched");
  }

  it("1. Matching SHA + Git available -> reuses existing projection", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "helper-fresh-1-"));
    try {
      const currentHead = cp.execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
      await createHelperFixture(tempDir, currentHead);
      await ensureDiscoveryProjections(tempDir);
      expect(await isProjectionReused(tempDir)).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("2. Mismatched SHA + Git available -> regenerates projection", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "helper-stale-2-"));
    try {
      await createHelperFixture(tempDir, "stale-sha-999999");
      await ensureDiscoveryProjections(tempDir);
      expect(await isProjectionReused(tempDir)).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("3. Valid manifest SHA + Git unavailable -> reuses existing projection", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "helper-nogit-valid-3-"));
    const spy = spyOn(cp, "execSync").mockImplementation(() => {
      throw new Error("git binary not found");
    });
    try {
      await createHelperFixture(tempDir, "valid-cached-sha-123");
      await ensureDiscoveryProjections(tempDir);
      expect(await isProjectionReused(tempDir)).toBe(true);
    } finally {
      spy.mockRestore();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("4. Missing manifest SHA + Git unavailable -> regenerates projection", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "helper-nogit-missing-4-"));
    const spy = spyOn(cp, "execSync").mockImplementation(() => {
      throw new Error("git binary not found");
    });
    try {
      await createHelperFixture(tempDir, undefined);
      await ensureDiscoveryProjections(tempDir);
      expect(await isProjectionReused(tempDir)).toBe(false);
    } finally {
      spy.mockRestore();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("5. Non-string manifest SHA + Git unavailable -> regenerates projection", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "helper-nogit-nonstring-5-"));
    const spy = spyOn(cp, "execSync").mockImplementation(() => {
      throw new Error("git binary not found");
    });
    try {
      await createHelperFixture(tempDir, 123456);
      await ensureDiscoveryProjections(tempDir);
      expect(await isProjectionReused(tempDir)).toBe(false);
    } finally {
      spy.mockRestore();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("6. Whitespace-only manifest SHA + Git unavailable -> regenerates projection", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "helper-nogit-whitespace-6-"));
    const spy = spyOn(cp, "execSync").mockImplementation(() => {
      throw new Error("git binary not found");
    });
    try {
      await createHelperFixture(tempDir, "    ");
      await ensureDiscoveryProjections(tempDir);
      expect(await isProjectionReused(tempDir)).toBe(false);
    } finally {
      spy.mockRestore();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("7. Padded manifest SHA -> trims and reuses projection when matching", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "helper-padded-7-"));
    try {
      const currentHead = cp.execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
      await createHelperFixture(tempDir, `  ${currentHead}  \n`);
      await ensureDiscoveryProjections(tempDir);
      expect(await isProjectionReused(tempDir)).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
