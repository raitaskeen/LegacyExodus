// Full engine run with refresh on <project>; prints call-resolution, dead-code and flow counts.
// usage: bun impact.ts <core root> <project>
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const [root, project] = process.argv.slice(2) as [string, string];
const { createLegacyExodusEngine } = await import(join(root, "src/runtime/composition/services.ts"));
const engine = createLegacyExodusEngine({ ...process.env, LOG_LEVEL: "silent", LEGACY_EXODUS_STORAGE_DRIVER: "memory" });
await engine.initialize();
const started = performance.now();
try {
  await engine.execute({
    id: "00000000-0000-4000-8000-000000000001",
    type: "AnalyzeProject",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    payload: { projectId: "00000000-0000-4000-8000-000000000002", path: project, refresh: true },
  });
} finally {
  await engine.shutdown();
}
const ms = Math.round(performance.now() - started);
const read = async (name: string) => JSON.parse(await readFile(join(project, ".discovery", name), "utf8"));
const semantic = await read("semantic.json");
const flow = await read("data-flow.json");
const resolved = semantic.calls.filter((call: { resolutionState: string }) => call.resolutionState === "RESOLVED").length;
const taint = (flow.graphs ?? []).reduce((sum: number, graph: { taintFlows?: unknown[] }) => sum + (graph.taintFlows?.length ?? 0), 0);
const interprocedural = Array.isArray(flow.interproceduralFlows) ? flow.interproceduralFlows.length : (flow.interprocedural?.flows?.length ?? "n/a");
console.log(JSON.stringify({ calls: semantic.calls.length, resolved, deadCode: semantic.deadCode.length, taint, interprocedural, ms, flowKeys: Object.keys(flow) }));
