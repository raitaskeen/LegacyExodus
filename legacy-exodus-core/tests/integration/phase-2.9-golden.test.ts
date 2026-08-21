import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import { createLegacyExodusEngine } from "@runtime/composition/services";

describe("Phase 2.9 controlled golden fixture", () => {
  test("preserves stable facts across modules, flow, taint, cycles, and an isolated parser failure", async (): Promise<void> => {
    const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-phase-2-9-"));
    const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });

    try {
      await writeGoldenProject(projectPath);
      await engine.initialize();
      const result = await engine.execute({
        id: "00000000-0000-4000-8000-000000000290",
        type: "AnalyzeProject",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        payload: { projectId: "00000000-0000-4000-8000-000000000291", path: projectPath },
      });

      expect(result.type).toBe("AnalyzeProject");
      if (result.type !== "AnalyzeProject") return;
      expect(result.analysis).toMatchObject({
        filesDiscovered: 9,
        filesAnalyzed: 6,
        parserFailures: 1,
        symbolExtractionFailures: 0,
        unsupportedFiles: 0,
        nonSourceArtifacts: 2,
        unclassifiedArtifacts: 0,
      });
      expect(result.analysis.durationMs).toBeGreaterThanOrEqual(0);

      const dependencyGraph = JSON.parse(await readFile(join(projectPath, ".discovery", "dependency-graph.json"), "utf8")) as {
        readonly cycles: readonly (readonly string[])[];
      };
      const dataFlow = JSON.parse(await readFile(join(projectPath, ".discovery", "data-flow.json"), "utf8")) as {
        readonly graphs: readonly { readonly filePath: string; readonly taintFlows: readonly { readonly path: readonly string[]; readonly state: string }[] }[];
      };
      const semantic = JSON.parse(await readFile(join(projectPath, ".discovery", "semantic.json"), "utf8")) as {
        readonly calls: readonly { readonly calleeName: string; readonly resolutionState: string }[];
      };

      expect(dependencyGraph.cycles).toHaveLength(1);
      expect(semantic.calls.find((call) => call.calleeName === "this.handle")?.resolutionState).toBe("RESOLVED");
      expect(semantic.calls.find((call) => call.calleeName === "service.run")?.resolutionState).toBe("UNRESOLVED");
      const consumerFlow = dataFlow.graphs.find((graph) => graph.filePath === "src/consumer.js");
      expect(consumerFlow?.taintFlows.map((flow) => flow.path.at(-1))).toEqual(["child_process.exec"]);
      expect(consumerFlow?.taintFlows.every((flow) => flow.state === "CONFIRMED")).toBe(true);
    } finally {
      await engine.shutdown();
      await rm(projectPath, { force: true, recursive: true });
    }
  });
});

async function writeGoldenProject(projectPath: string): Promise<void> {
  await mkdir(join(projectPath, "src"), { recursive: true });
  await writeFile(join(projectPath, "package.json"), JSON.stringify({ name: "phase-2-9-golden", dependencies: { express: "4.0.0" } }), "utf8");
  await writeFile(join(projectPath, "notes.json"), "{}", "utf8");
  await writeFile(join(projectPath, "src", "service.js"), "export class Service { handle(input) { return input; } run(input) { return this.handle(input); } } export function sanitize(value) { return validator.escape(value); } export { sanitize as clean };", "utf8");
  await writeFile(join(projectPath, "src", "consumer.js"), "import { Service } from './service'; const service = new Service(); const input = req.body.name; const clean = validator.escape(input); const result = service.run(clean); pattern.exec(input); child_process.exec(input); if (false) { unreachable(); }", "utf8");
  await writeFile(join(projectPath, "src", "common.js"), "function helper(value) { return value; } module.exports = helper;", "utf8");
  await writeFile(join(projectPath, "src", "common-consumer.js"), "const helper = require('./common'); const result = helper(req.query.id);", "utf8");
  await writeFile(join(projectPath, "src", "cycle-a.js"), "import { b } from './cycle-b'; export const a = b;", "utf8");
  await writeFile(join(projectPath, "src", "cycle-b.js"), "import { a } from './cycle-a'; export const b = a;", "utf8");
  await writeFile(join(projectPath, "src", "broken.js"), "export const = ;", "utf8");
}
