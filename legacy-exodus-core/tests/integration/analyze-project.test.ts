import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import { createEngineContext, createLegacyExodusEngine } from "@runtime/composition/services";
import { DiscoveryEngine, FileScanner } from "@discovery/index";
import { Orchestrator } from "@core/orchestration/orchestrator";
import { JavaScriptSymbolExtractor } from "@symbols/index";

describe("analyze project integration", () => {
  test("runs deterministic discovery through the engine facade", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-analyze-"));

    try {
      await mkdir(join(projectPath, "src", "components"), { recursive: true });
      await writeFile(join(projectPath, "src", "components", "Books.jsx"), "export const Books = {};", "utf8");
      await writeFile(join(projectPath, "src", "legacy.rs"), "fn main() {}", "utf8");
      await writeFile(join(projectPath, "styles.css"), "body {}", "utf8");
      await writeFile(join(projectPath, "README.md"), "# Library", "utf8");
      await writeFile(
        join(projectPath, "package.json"),
        JSON.stringify({
          name: "library-management-system",
          dependencies: { express: "4.0.0", mongodb: "6.0.0", react: "18.0.0" },
        }),
        "utf8",
      );
      const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });

      await engine.initialize();
      const result = await engine.execute({
        id: "00000000-0000-4000-8000-000000000030",
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: {
          projectId: "00000000-0000-4000-8000-000000000031",
          path: projectPath,
        },
      });

      expect(result.type).toBe("AnalyzeProject");

      if (result.type === "AnalyzeProject") {
        expect(result.discovery.projectName).toBe("library-management-system");
        expect(result.discovery.frameworks.map((framework) => framework.name)).toEqual([
          "express",
          "mongodb",
          "react",
        ]);
        expect(result.analysis).toMatchObject({
          filesDiscovered: 5,
          filesAnalyzed: 1,
          parserFailures: 0,
          symbolExtractionFailures: 0,
          unsupportedFiles: 1,
          nonSourceArtifacts: 3,
          unclassifiedArtifacts: 0,
        });
        expect(result.analysis.durationMs).toBeGreaterThanOrEqual(0);
      }

      expect(JSON.parse(await readFile(join(projectPath, ".discovery", "summary.json"), "utf8"))).toEqual({
        projectName: "library-management-system",
        fileCount: 5,
        dependencyCount: 3,
        frameworkCount: 3,
        languages: ["css", "javascript", "json", "markdown", "rust"],
        enumerationFailureCount: 0,
        discoveryComplete: true,
      });
      const knowledge = JSON.parse(await readFile(join(projectPath, ".discovery", "knowledge.json"), "utf8")) as {
        readonly nodes: readonly { readonly kind: string }[];
        readonly edges: readonly { readonly relationship: string }[];
      };
      expect(knowledge.nodes.some((node) => node.kind === "file")).toBe(true);
      expect(knowledge.edges.some((edge) => edge.relationship === "contains")).toBe(true);
      const semantic = JSON.parse(await readFile(join(projectPath, ".discovery", "semantic.json"), "utf8")) as {
        readonly calls: readonly unknown[];
        readonly scopes: readonly unknown[];
      };
      expect(Array.isArray(semantic.calls)).toBe(true);
      expect(Array.isArray(semantic.scopes)).toBe(true);
      const controlFlow = JSON.parse(await readFile(join(projectPath, ".discovery", "control-flow.json"), "utf8")) as { readonly graphs: readonly unknown[] };
      const dataFlow = JSON.parse(await readFile(join(projectPath, ".discovery", "data-flow.json"), "utf8")) as { readonly graphs: readonly unknown[] };
      expect(controlFlow.graphs.length).toBeGreaterThan(0);
      expect(dataFlow.graphs.length).toBeGreaterThan(0);

      await engine.shutdown();
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("chains discovery, JavaScript parsing, and symbol extraction", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-pipeline-"));

    try {
      await mkdir(join(projectPath, "src"), { recursive: true });
      await writeFile(
        join(projectPath, "src", "billing.js"),
        "export class BillingService { processPayment(amount) { return amount; } }",
        "utf8",
      );
      await writeFile(join(projectPath, "src", "types.ts"), "export interface BillingRecord { id: string; }", "utf8");
      await writeFile(join(projectPath, "src", "empty-module.js"), 'import ""; export const valid = true;', "utf8");
      const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });

      await context.orchestrator.execute({
        id: "00000000-0000-4000-8000-000000000040",
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: {
          projectId: "00000000-0000-4000-8000-000000000041",
          path: projectPath,
        },
      });

      expect(context.eventStore.getByType("FileParsed")).toHaveLength(3);
      expect(context.eventStore.getByType("SymbolsExtracted")).toHaveLength(3);
      expect(context.eventStore.getByType("SymbolsExtractionFailure")).toHaveLength(0);
      expect(await context.storage.findAll("ast-result")).toHaveLength(3);
      expect(await context.storage.findAll("symbol-table")).toHaveLength(3);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("continues with valid source files after a recovered parser failure", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-file-isolation-"));
    try {
      await writeFile(join(projectPath, "first.js"), "export const first = 1;", "utf8");
      await writeFile(join(projectPath, "broken.js"), "export const = ;", "utf8");
      await writeFile(join(projectPath, "last.ts"), "export const last: number = 2;", "utf8");
      const context = createEngineContext({ LOG_LEVEL: "silent", NODE_ENV: "test" });
      const execution = await context.orchestrator.execute({ id: "00000000-0000-4000-8000-000000000042", type: "AnalyzeProject", createdAt: new Date(), payload: { projectId: "00000000-0000-4000-8000-000000000043", path: projectPath } });

      expect(context.eventStore.getByType("ParserFailure")[0]).toMatchObject({ payload: { path: "broken.js", code: expect.any(String) } });
      expect(context.eventStore.getByType("SymbolsExtracted").map((event) => (event.payload as { readonly path: string }).path)).toEqual(["first.js", "last.ts"]);
      expect(await context.storage.findAll("symbol-table")).toHaveLength(2);
      expect(execution.analysis).toMatchObject({
        filesDiscovered: 3,
        filesAnalyzed: 2,
        parserFailures: 1,
        symbolExtractionFailures: 0,
        unsupportedFiles: 0,
        nonSourceArtifacts: 0,
        unclassifiedArtifacts: 0,
      });
      expect(execution.analysis?.durationMs).toBeGreaterThanOrEqual(0);
    } finally { await rm(projectPath, { force: true, recursive: true }); }
  });

  test("accurately partitions supported source, unsupported source, non-source, and unclassified artifacts", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-taxonomy-"));
    try {
      // 2 Supported JS/TS sources
      await writeFile(join(projectPath, "app.js"), "export const a = 1;", "utf8");
      await writeFile(join(projectPath, "main.ts"), "export const b: number = 2;", "utf8");

      // 4 Unsupported sources across diverse language ecosystems
      await writeFile(join(projectPath, "Service.kt"), "class Service", "utf8");
      await writeFile(join(projectPath, "Widget.swift"), "struct Widget {}", "utf8");
      await writeFile(join(projectPath, "App.vue"), "<template></template>", "utf8");
      await writeFile(join(projectPath, "main.rs"), "fn main() {}", "utf8");

      // 3 Genuine non-source artifacts (docs, stylesheet, manifest)
      await writeFile(join(projectPath, "README.md"), "# Title", "utf8");
      await writeFile(join(projectPath, "theme.css"), "body {}", "utf8");
      await writeFile(join(projectPath, "package.json"), "{}", "utf8");

      // 1 Unclassified file
      await writeFile(join(projectPath, "custom.data"), "raw-bytes", "utf8");

      const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
      await engine.initialize();
      const result = await engine.execute({
        id: "00000000-0000-4000-8000-000000000050",
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: {
          projectId: "00000000-0000-4000-8000-000000000051",
          path: projectPath,
        },
      });

      if (result.type !== "AnalyzeProject") throw new Error("Expected AnalyzeProject result.");

      expect(result.analysis).toMatchObject({
        filesDiscovered: 10,
        filesAnalyzed: 2,
        parserFailures: 0,
        symbolExtractionFailures: 0,
        unsupportedFiles: 4,     // Service.kt, Widget.swift, App.vue, main.rs
        nonSourceArtifacts: 3,   // README.md, theme.css, package.json
        unclassifiedArtifacts: 1, // custom.data
      });
      expect(result.analysis.filesDiscovered).toBe(
        result.analysis.filesAnalyzed +
        result.analysis.parserFailures +
        result.analysis.symbolExtractionFailures +
        result.analysis.unsupportedFiles +
        result.analysis.nonSourceArtifacts +
        result.analysis.unclassifiedArtifacts
      );
      expect(result.discovery.languages).toEqual(expect.arrayContaining(["javascript", "kotlin", "markdown", "rust", "swift", "typescript", "vue"]));
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  test("isolates discovery enumeration failures end-to-end without aborting pipeline analysis of valid files", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-adv-integration-"));
    try {
      await mkdir(join(projectPath, "src"));
      await mkdir(join(projectPath, "restricted_dir"));
      await writeFile(join(projectPath, "src", "index.js"), "export const ok = true;", "utf8");
      await writeFile(join(projectPath, "package.json"), JSON.stringify({ name: "adv-test" }), "utf8");

      const scanner = new FileScanner({
        readdir: (async (path: string, options: any) => {
          if (resolve(path).includes("restricted_dir")) {
            const err = new Error("Access denied") as any;
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
        id: "00000000-0000-4000-8000-000000000060",
        type: "AnalyzeProject",
        createdAt: new Date(),
        payload: {
          projectId: "00000000-0000-4000-8000-000000000061",
          path: projectPath,
        },
      });

      expect(execution.analysis).toMatchObject({
        filesDiscovered: 2,
        filesAnalyzed: 1,
        enumerationFailures: 1,
        discoveryComplete: false,
      });

      // Internal file accounting remains strictly exact
      expect(execution.analysis?.filesDiscovered).toBe(
        (execution.analysis?.filesAnalyzed ?? 0) +
        (execution.analysis?.parserFailures ?? 0) +
        (execution.analysis?.symbolExtractionFailures ?? 0) +
        (execution.analysis?.unsupportedFiles ?? 0) +
        (execution.analysis?.nonSourceArtifacts ?? 0) +
        (execution.analysis?.unclassifiedArtifacts ?? 0)
      );

      const discoveryRecord = (await context.storage.findAll("project-discovery"))[0];
      expect(discoveryRecord).toBeDefined();

      // Project storage artifacts to disk
      await context.discoveryProjection.project(discoveryRecord!.id);

      const summary = JSON.parse(await readFile(join(projectPath, ".discovery", "summary.json"), "utf8"));
      expect(summary).toMatchObject({
        fileCount: 2,
        enumerationFailureCount: 1,
        discoveryComplete: false,
      });

      const failures = JSON.parse(await readFile(join(projectPath, ".discovery", "enumeration-failures.json"), "utf8"));
      expect(failures).toEqual([
        { path: "restricted_dir", kind: "directory-read", code: "EACCES" },
      ]);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });
});
