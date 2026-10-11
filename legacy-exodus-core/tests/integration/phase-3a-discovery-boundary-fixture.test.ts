import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";

import { createEngineContext } from "@runtime/composition/services";
import { DiscoveryEngine, FileScanner } from "@discovery/index";
import { Orchestrator } from "@core/orchestration/orchestrator";
import { JavaScriptSymbolExtractor } from "@symbols/index";
import { formatAnalyzeOutput } from "@cli/output/formatter";
import type { AnalyzeProjectReport } from "@cli/commands/analyze";
import { computeFileAccounting, detectContamination, verifyCompleteness } from "../../benchmarks/governance";
import type { AnalysisDisposition } from "../../benchmarks/types";

describe("Phase 3A Discovery Boundary Hardening — Canonical Fixture Suite", () => {
  test("FIX-01: Clean repository discovery establishes baseline accounting and complete status", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-fix-01-"));
    try {
      await mkdir(join(projectPath, "src"));
      await writeFile(join(projectPath, "src", "index.ts"), "export const value = 42;", "utf8");
      await writeFile(join(projectPath, "package.json"), JSON.stringify({ name: "clean-repo" }), "utf8");

      const scanner = new FileScanner();
      const { files, enumerationFailures } = await scanner.scan(projectPath);

      expect(files).toHaveLength(2);
      expect(enumerationFailures).toEqual([]);
      expect(Object.isFrozen(files)).toBe(true);
      expect(Object.isFrozen(enumerationFailures)).toBe(true);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("FIX-02: Directory read failure (EACCES) isolates subtree without crashing sibling traversal", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-fix-02-"));
    try {
      await mkdir(join(projectPath, "readable_sub"));
      await mkdir(join(projectPath, "unreadable_sub"));
      await writeFile(join(projectPath, "readable_sub", "item.js"), "export const ok = 1;", "utf8");

      const scanner = new FileScanner({
        readdir: (async (path: string, options: any) => {
          if (resolve(path).includes("unreadable_sub")) {
            const err = new Error("Permission denied") as any;
            err.code = "EACCES";
            throw err;
          }
          return readdir(path, options);
        }) as typeof readdir,
      });

      const { files, enumerationFailures } = await scanner.scan(projectPath);

      expect(files.map((f) => f.path)).toEqual(["readable_sub/item.js"]);
      expect(enumerationFailures).toHaveLength(1);
      expect(enumerationFailures[0]).toMatchObject({
        path: "unreadable_sub",
        kind: "directory-read",
        code: "EACCES",
      });
      expect(Object.isFrozen(enumerationFailures[0])).toBe(true);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("FIX-03: Per-file stat failure (EPERM) records failure and continues sibling files", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-fix-03-"));
    try {
      await writeFile(join(projectPath, "valid1.js"), "export const v1 = 1;", "utf8");
      await writeFile(join(projectPath, "locked_file.dat"), "secret", "utf8");
      await writeFile(join(projectPath, "valid2.js"), "export const v2 = 2;", "utf8");

      const scanner = new FileScanner({
        stat: (async (path: string) => {
          if (resolve(path).includes("locked_file.dat")) {
            const err = new Error("Operation not permitted") as any;
            err.code = "EPERM";
            throw err;
          }
          return stat(path);
        }) as typeof stat,
      });

      const { files, enumerationFailures } = await scanner.scan(projectPath);

      expect(files.map((f) => f.path)).toEqual(["valid1.js", "valid2.js"]);
      expect(enumerationFailures).toHaveLength(1);
      expect(enumerationFailures[0]).toMatchObject({
        path: "locked_file.dat",
        kind: "entry-stat",
        code: "EPERM",
      });
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("FIX-04: TOCTOU race (ENOENT) records entry-stat failure without crashing traversal", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-fix-04-"));
    try {
      await writeFile(join(projectPath, "stable.js"), "export const s = 1;", "utf8");
      await writeFile(join(projectPath, "disappearing.tmp"), "temp", "utf8");

      const scanner = new FileScanner({
        stat: (async (path: string) => {
          if (resolve(path).includes("disappearing.tmp")) {
            const err = new Error("No such file or directory") as any;
            err.code = "ENOENT";
            throw err;
          }
          return stat(path);
        }) as typeof stat,
      });

      const { files, enumerationFailures } = await scanner.scan(projectPath);

      expect(files.map((f) => f.path)).toEqual(["stable.js"]);
      expect(enumerationFailures).toHaveLength(1);
      expect(enumerationFailures[0]).toMatchObject({
        path: "disappearing.tmp",
        kind: "entry-stat",
        code: "ENOENT",
      });
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("FIX-05: Multiple mixed directory and file failures maintain canonical lexicographic ordering", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-fix-05-"));
    try {
      await mkdir(join(projectPath, "dir_z"));
      await mkdir(join(projectPath, "dir_a"));
      await writeFile(join(projectPath, "file_m.bin"), "m", "utf8");
      await writeFile(join(projectPath, "file_b.bin"), "b", "utf8");
      await writeFile(join(projectPath, "normal.js"), "export const n = 1;", "utf8");

      const scanner = new FileScanner({
        readdir: (async (path: string, options: any) => {
          if (resolve(path).includes("dir_")) {
            const err = new Error("Access error") as any;
            err.code = "EACCES";
            throw err;
          }
          return readdir(path, options);
        }) as typeof readdir,
        stat: (async (path: string) => {
          if (resolve(path).includes("file_")) {
            const err = new Error("I/O error") as any;
            err.code = "EIO";
            throw err;
          }
          return stat(path);
        }) as typeof stat,
      });

      const { files, enumerationFailures } = await scanner.scan(projectPath);

      expect(files.map((f) => f.path)).toEqual(["normal.js"]);
      expect(enumerationFailures).toHaveLength(4);
      expect(enumerationFailures.map((f) => f.path)).toEqual([
        "dir_a",
        "dir_z",
        "file_b.bin",
        "file_m.bin",
      ]);
      expect(enumerationFailures.map((f) => f.kind)).toEqual([
        "directory-read",
        "directory-read",
        "entry-stat",
        "entry-stat",
      ]);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("FIX-06: Symbolic links and junctions are excluded without generating false failures or cycles", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-fix-06-"));
    try {
      await mkdir(join(projectPath, "real_src"));
      await writeFile(join(projectPath, "real_src", "app.ts"), "export const app = 1;", "utf8");

      try {
        await symlink(join(projectPath, "real_src"), join(projectPath, "symlinked_src"), "junction");
      } catch {
        try {
          await symlink(join(projectPath, "real_src"), join(projectPath, "symlinked_src"), "dir");
        } catch {
          // Fallback if environment lacks symlink privilege
        }
      }

      const { files, enumerationFailures } = await new FileScanner().scan(projectPath);

      expect(files.map((f) => f.path)).toEqual(["real_src/app.ts"]);
      expect(enumerationFailures).toEqual([]);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("FIX-07: End-to-end failure propagation from scanner through events, storage, and projections", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-fix-07-"));
    try {
      await mkdir(join(projectPath, "src"));
      await mkdir(join(projectPath, "protected_area"));
      await writeFile(join(projectPath, "src", "index.js"), "export const ok = true;", "utf8");
      await writeFile(join(projectPath, "package.json"), JSON.stringify({ name: "e2e-fixture" }), "utf8");

      let enumerationFault = true;
      const scanner = new FileScanner({
        readdir: (async (path: string, options: any) => {
          if (enumerationFault && resolve(path).includes("protected_area")) {
            const err = new Error("Forbidden") as any;
            err.code = "EACCES";
            throw err;
          }
          return readdir(path, options);
        }) as typeof readdir,
      });

      const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
      const orchestrator = new Orchestrator(
        context.eventStore,
        context.eventBus,
        context.storage,
        new DiscoveryEngine(scanner),
        undefined,
        context.parserManager,
        new JavaScriptSymbolExtractor(),
      );

      const execution = await orchestrator.execute({
        id: "00000000-0000-4000-8000-000000000701",
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: {
          projectId: "00000000-0000-4000-8000-000000000702",
          path: projectPath,
        },
      });

      // 1. Discovery result
      expect(execution.discovery?.files).toHaveLength(2);
      expect(execution.discovery?.enumerationFailures).toHaveLength(1);

      // 2. Domain events
      const failureEvents = context.eventStore.getByType("DiscoveryEnumerationFailure");
      expect(failureEvents).toHaveLength(1);
      expect((failureEvents[0]?.payload as any).path).toBe("protected_area");
      expect((failureEvents[0]?.payload as any).code).toBe("EACCES");

      const completionEvents = context.eventStore.getByType("DiscoveryCompleted");
      expect(completionEvents).toHaveLength(1);
      expect((completionEvents[0]?.payload as any).enumerationFailureCount).toBe(1);

      // 3. AnalysisSummary
      expect(execution.analysis).toMatchObject({
        filesDiscovered: 2,
        filesAnalyzed: 1,
        enumerationFailures: 1,
        discoveryComplete: false,
      });

      // 4. Storage and projection
      const discoveryRecords = await context.storage.findAll("project-discovery");
      expect(discoveryRecords).toHaveLength(1);
      await context.discoveryProjection.project(discoveryRecords[0]!.id);

      const summaryJson = JSON.parse(await readFile(join(projectPath, ".discovery", "summary.json"), "utf8"));
      expect(summaryJson).toMatchObject({
        fileCount: 2,
        enumerationFailureCount: 1,
        discoveryComplete: false,
      });

      const failureJson = JSON.parse(await readFile(join(projectPath, ".discovery", "enumeration-failures.json"), "utf8"));
      expect(failureJson).toEqual([
        { path: "protected_area", kind: "directory-read", code: "EACCES" },
      ]);
      const repeated = await orchestrator.execute({
        id: "00000000-0000-4000-8000-000000000703", type: "AnalyzeProject", createdAt: new Date(),
        payload: { projectId: "00000000-0000-4000-8000-000000000702", path: projectPath },
      });
      expect(repeated.isReused).toBeUndefined();
      expect(repeated.analysis).toMatchObject({
        filesDiscovered: 2, filesAnalyzed: 1, parserFailures: 0, symbolExtractionFailures: 0,
        unsupportedFiles: 0, nonSourceArtifacts: 1, unclassifiedArtifacts: 0, enumerationFailures: 1,
        secondPassFailures: 0, discoveryComplete: false,
      });
      // The same persisted enumeration-degraded snapshot must also be rejected after fault recovery.
      enumerationFault = false;
      const recovered = await orchestrator.execute({
        id: "00000000-0000-4000-8000-000000000704", type: "AnalyzeProject", createdAt: new Date(),
        payload: { projectId: "00000000-0000-4000-8000-000000000702", path: projectPath },
      });
      expect(recovered.isReused).toBeUndefined();
      expect(recovered.analysis).toMatchObject({
        filesDiscovered: 2, filesAnalyzed: 1, parserFailures: 0, symbolExtractionFailures: 0,
        unsupportedFiles: 0, nonSourceArtifacts: 1, unclassifiedArtifacts: 0, enumerationFailures: 0,
        secondPassFailures: 0, discoveryComplete: true,
      });
      for (const result of [execution, repeated, recovered]) {
        expect(computeFileAccounting(result.analysis!)).toMatchObject({ computedTotal: 2, discrepancy: 0, reconciles: true });
      }
      await context.runtime.shutdown();
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("FIX-08: CLI analysis formatter exposes enumeration failure count and completeness state", (): void => {
    const report: AnalyzeProjectReport = {
      projectName: "cli-fixture",
      files: 5,
      filesDiscovered: 5,
      filesAnalyzed: 3,
      parserFailures: 0,
      symbolExtractionFailures: 0,
      unsupportedFiles: 0,
      nonSourceArtifacts: 2,
      unclassifiedArtifacts: 0,
      enumerationFailures: 2,
      discoveryComplete: false,
      durationMs: 45.2,
      languages: ["javascript"],
      frameworks: ["express"],
      dependencies: 1,
    };

    const formatted = formatAnalyzeOutput(report);
    expect(formatted).toContain("Enumeration failures: 2");
    expect(formatted).toContain("Discovery complete: no");
  });

  test("FIX-09: Benchmark completeness gate demotes to NEEDS_REVIEW when enumeration failures occur even if accounting reconciles", (): void => {
    const disposition: AnalysisDisposition = {
      filesDiscovered: 10,
      filesAnalyzed: 8,
      parserFailures: 0,
      symbolExtractionFailures: 0,
      unsupportedFiles: 0,
      nonSourceArtifacts: 2,
      unclassifiedArtifacts: 0,
      enumerationFailures: 1,
      discoveryComplete: false,
      durationMs: 100,
    };

    const accounting = computeFileAccounting(disposition);
    expect(accounting.reconciles).toBe(true);
    expect(accounting.discrepancy).toBe(0);

    const contamination = detectContamination([]);
    const completeness = verifyCompleteness(disposition, accounting, contamination);

    expect(completeness.status).toBe("NEEDS_REVIEW");
    expect(completeness.details.some((d) => d.includes("1 filesystem enumeration failure(s)"))).toBe(true);
  });
});

describe("R01 second-pass completeness", () => {
  test("degradation forces review without entering primary totals or weakening FAIL precedence", () => {
    const disposition: AnalysisDisposition = {
      filesDiscovered: 2, filesAnalyzed: 2, parserFailures: 0, symbolExtractionFailures: 0,
      unsupportedFiles: 0, nonSourceArtifacts: 0, unclassifiedArtifacts: 0,
      enumerationFailures: 0, secondPassFailures: 1, discoveryComplete: true, durationMs: 0,
    };
    const accounting = computeFileAccounting(disposition);
    expect(accounting).toMatchObject({ computedTotal: 2, discrepancy: 0, reconciles: true });
    const completeness = verifyCompleteness(disposition, accounting, detectContamination([]));
    expect(completeness.status).toBe("NEEDS_REVIEW");
    expect(completeness.details).toEqual(["1 second-pass AST restoration failure(s) recorded"]);
    expect(verifyCompleteness(disposition, { ...accounting, reconciles: false }, detectContamination([])).status).toBe("FAIL");
    expect(verifyCompleteness(disposition, accounting, detectContamination([{ path: ".discovery/foreign.json" }])).status).toBe("FAIL");
    const healthy = { ...disposition, secondPassFailures: 0 };
    expect(verifyCompleteness(healthy, computeFileAccounting(healthy), detectContamination([])).status).toBe("PASS");
  });
});
