// One analysis in a fresh process. usage: bun probe-f001.ts <core root> <project> [refresh]
// Prints whether the engine reused a snapshot and how `this.h` is resolved in the projection.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const [root, project, mode] = process.argv.slice(2) as [string, string, string | undefined];
const { createLegacyExodusEngine } = await import(join(root, "src/runtime/composition/services.ts"));
const engine = createLegacyExodusEngine({ ...process.env, LOG_LEVEL: "silent", LEGACY_EXODUS_STORAGE_DRIVER: "memory" });
await engine.initialize();
try {
  const result = await engine.execute({
    id: crypto.randomUUID(),
    type: "AnalyzeProject",
    createdAt: new Date(),
    payload: { projectId: crypto.randomUUID(), path: project, ...(mode === "refresh" ? { refresh: true } : {}) },
  });
  const semantic = JSON.parse(await readFile(join(project, ".discovery", "semantic.json"), "utf8"));
  const call = semantic.calls.find((entry: { calleeName: string }) => entry.calleeName === "this.h");
  console.log(JSON.stringify({ reused: result.isReused === true, thisH: call?.resolutionState }));
} catch (error) {
  console.log(JSON.stringify({ error: (error as Error).message }));
} finally {
  await engine.shutdown();
}
