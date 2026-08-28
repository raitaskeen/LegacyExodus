import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

import { createDiscoveryProjection } from "@contracts/discovery-projection";
import { FileDiscoveryProjectionAdapter } from "@storage/index";
import { StreamingJsonWriter } from "@storage/projections/streaming-json-writer";

describe("Concurrent Projection Safety (F-005)", () => {
  it("1. concurrent projections for different runs on same repository produce coherent, non-interleaved state", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-concurrent-proj-"));
    const adapter = new FileDiscoveryProjectionAdapter();

    const proj1 = createDiscoveryProjection({
      projectPath,
      artifacts: [
        { name: "project.json", payload: { name: "app", version: "1.0.0", run: 1 } },
        {
          name: "files.json",
          payload: Array.from({ length: 200 }, (_, i) => ({ id: `f1_${i}`, path: `src/file_${i}.ts`, language: "typescript", size: i })),
        },
        {
          name: "symbols.json",
          payload: Array.from({ length: 300 }, (_, i) => ({ id: `s1_${i}`, name: `symbol_run1_${i}` })),
        },
      ],
      metadata: {
        projectId: "proj-1",
        analysisRunId: "run-1",
        projectName: "app",
      },
    });

    const proj2 = createDiscoveryProjection({
      projectPath,
      artifacts: [
        { name: "project.json", payload: { name: "app", version: "2.0.0", run: 2 } },
        {
          name: "files.json",
          payload: Array.from({ length: 200 }, (_, i) => ({ id: `f2_${i}`, path: `src/v2_file_${i}.ts`, language: "typescript", size: i * 2 })),
        },
        {
          name: "symbols.json",
          payload: Array.from({ length: 300 }, (_, i) => ({ id: `s2_${i}`, name: `symbol_run2_${i}` })),
        },
      ],
      metadata: {
        projectId: "proj-1",
        analysisRunId: "run-2",
        projectName: "app",
      },
    });

    try {
      // Execute 10 consecutive concurrent races between Run 1 and Run 2
      for (let i = 0; i < 10; i++) {
        const results = await Promise.allSettled([
          adapter.write(proj1),
          adapter.write(proj2),
        ]);

        expect(results.every((r) => r.status === "fulfilled")).toBe(true);

        const manifestRaw = await readFile(join(projectPath, ".discovery", "manifest.json"), "utf8");
        const manifest = JSON.parse(manifestRaw);
        const activeRun = manifest.analysis?.analysisRunId;
        expect(["run-1", "run-2"]).toContain(activeRun);

        const runNum = activeRun.split("-")[1];

        // Ensure files.json matches the winning run
        const filesRaw = await readFile(join(projectPath, ".discovery", "files.json"), "utf8");
        const files = JSON.parse(filesRaw);
        expect(files[0].id).toContain(`f${runNum}_`);

        // Ensure symbols.json matches the winning run
        const symbolsRaw = await readFile(join(projectPath, ".discovery", "symbols.json"), "utf8");
        const symbols = JSON.parse(symbolsRaw);
        expect(symbols[0].name).toContain(`symbol_run${runNum}_`);

        // Ensure manifest checksums match actual disk contents for every artifact
        for (const [artName, artMeta] of Object.entries(manifest.artifacts as Record<string, { sha256: string; bytes: number }>)) {
          const artContent = await readFile(join(projectPath, ".discovery", artName));
          const calculatedSha = createHash("sha256").update(artContent).digest("hex");
          expect(calculatedSha).toBe(artMeta.sha256);
          expect(artContent.length).toBe(artMeta.bytes);
        }
      }
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });

  it("2. concurrent projections across distinct repositories run independently without interference", async () => {
    const projectPathA = await mkdtemp(join(tmpdir(), "legacy-exodus-proj-a-"));
    const projectPathB = await mkdtemp(join(tmpdir(), "legacy-exodus-proj-b-"));
    const adapter = new FileDiscoveryProjectionAdapter();

    const projA = createDiscoveryProjection({
      projectPath: projectPathA,
      artifacts: [
        { name: "project.json", payload: { name: "app-a", repo: "A" } },
        { name: "files.json", payload: [{ id: "fa_1", path: "src/a.ts" }] },
      ],
      metadata: { projectId: "proj-a", analysisRunId: "run-a", projectName: "app-a" },
    });

    const projB = createDiscoveryProjection({
      projectPath: projectPathB,
      artifacts: [
        { name: "project.json", payload: { name: "app-b", repo: "B" } },
        { name: "files.json", payload: [{ id: "fb_1", path: "src/b.ts" }] },
      ],
      metadata: { projectId: "proj-b", analysisRunId: "run-b", projectName: "app-b" },
    });

    try {
      const [resA, resB] = await Promise.allSettled([
        adapter.write(projA),
        adapter.write(projB),
      ]);

      expect(resA.status).toBe("fulfilled");
      expect(resB.status).toBe("fulfilled");

      const manifestA = JSON.parse(await readFile(join(projectPathA, ".discovery", "manifest.json"), "utf8"));
      const manifestB = JSON.parse(await readFile(join(projectPathB, ".discovery", "manifest.json"), "utf8"));

      expect(manifestA.analysis.analysisRunId).toBe("run-a");
      expect(manifestB.analysis.analysisRunId).toBe("run-b");
    } finally {
      await rm(projectPathA, { force: true, recursive: true });
      await rm(projectPathB, { force: true, recursive: true });
    }
  });

  it("3. StreamingJsonWriter writeAtomic uses unique temporary paths preventing temporary file collisions", async () => {
    const testDir = await mkdtemp(join(tmpdir(), "legacy-exodus-writer-test-"));
    const writer = new StreamingJsonWriter();
    const destination = join(testDir, "concurrent-target.json");

    try {
      // 5 concurrent atomic writes to the same destination file
      const writes = Array.from({ length: 5 }, (_, i) =>
        writer.writeAtomic(destination, { index: i, items: Array.from({ length: 100 }, (_, j) => `item_${i}_${j}`) }),
      );

      const results = await Promise.allSettled(writes);
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);

      const content = await readFile(destination, "utf8");
      const parsed = JSON.parse(content);
      expect(parsed).toHaveProperty("index");
      expect(parsed).toHaveProperty("items");
      expect(parsed.items).toHaveLength(100);
    } finally {
      await rm(testDir, { force: true, recursive: true });
    }
  });

  it("4. failed projection task does not deadlock directory queue for subsequent projections", async () => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-deadlock-test-"));
    const adapter = new FileDiscoveryProjectionAdapter();

    const brokenProj: any = {
      projectPath,
      artifacts: [
        {
          name: "project.json",
          // BigInt causes JSON.stringify to throw inside StreamingJsonWriter
          payload: { invalid: BigInt(123) },
        },
      ],
    };

    const validProj = createDiscoveryProjection({
      projectPath,
      artifacts: [
        { name: "project.json", payload: { name: "recovered-app", status: "ok" } },
      ],
    });

    try {
      // First call throws due to unserializable BigInt payload
      await expect(adapter.write(brokenProj)).rejects.toThrow();

      // Second call to the same directory must proceed cleanly without deadlock
      await adapter.write(validProj);

      const content = JSON.parse(await readFile(join(projectPath, ".discovery", "project.json"), "utf8"));
      expect(content.name).toBe("recovered-app");
    } finally {
      await rm(projectPath, { force: true, recursive: true });
    }
  });
});
