import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import { createEngineContext, createLegacyExodusEngine } from "@runtime/composition/services";

describe("analyze project integration", () => {
  test("runs deterministic discovery through the engine facade", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-analyze-"));

    try {
      await mkdir(join(projectPath, "src", "components"), { recursive: true });
      await writeFile(join(projectPath, "src", "components", "Books.jsx"), "export {};", "utf8");
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
      }

      expect(JSON.parse(await readFile(join(projectPath, ".discovery", "summary.json"), "utf8"))).toEqual({
        projectName: "library-management-system",
        fileCount: 2,
        dependencyCount: 3,
        frameworkCount: 3,
        languages: ["javascript"],
      });
      const knowledge = JSON.parse(await readFile(join(projectPath, ".discovery", "knowledge.json"), "utf8")) as {
        readonly nodes: readonly { readonly kind: string }[];
        readonly edges: readonly { readonly relationship: string }[];
      };
      expect(knowledge.nodes.some((node) => node.kind === "file")).toBe(true);
      expect(knowledge.edges.some((edge) => edge.relationship === "contains")).toBe(true);

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

      expect(context.eventStore.getByType("FileParsed")).toHaveLength(1);
      expect(context.eventStore.getByType("SymbolsExtracted")).toHaveLength(1);
      expect(await context.storage.findAll("ast-result")).toHaveLength(1);
      expect(await context.storage.findAll("symbol-table")).toHaveLength(1);
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });
});
