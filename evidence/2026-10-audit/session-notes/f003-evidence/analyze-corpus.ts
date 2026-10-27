// Usage: CORE_ROOT=<legacy-exodus-core> bun run analyze-corpus.ts <repoPath> <outDir>
import { cpSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
const root = process.env.CORE_ROOT!;
const { createLegacyExodusEngine } = await import(`${root}/src/runtime/composition/services.ts`);
const repo = resolve(process.argv[2]!);
const out = resolve(process.argv[3]!);
rmSync(join(repo, ".discovery"), { recursive: true, force: true });
const engine = createLegacyExodusEngine({ LOG_LEVEL: "silent", NODE_ENV: "test" });
await engine.initialize();
const started = performance.now();
try {
  await engine.execute({ id: "00000000-0000-4000-8000-000000000099", type: "AnalyzeProject", createdAt: new Date(), payload: { projectId: "00000000-0000-4000-8000-000000000098", path: repo } });
} finally { await engine.shutdown(); }
console.log(`analyzed ${repo} in ${Math.round(performance.now() - started)}ms`);
if (!existsSync(join(repo, ".discovery", "control-flow.json"))) throw new Error("no control-flow.json produced");
rmSync(out, { recursive: true, force: true });
cpSync(join(repo, ".discovery"), out, { recursive: true });
rmSync(join(repo, ".discovery"), { recursive: true, force: true });
