// Real-code corpus run: copies a few real packages and the engine's own source into
// isolated directories, analyzes each twice with --refresh, and records parse failures,
// timing, peak memory reported by the OS, and whether the two runs' artifacts match.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const wt = "C:/Projects/.audit/wt/legacy-exodus-core";
const root = "C:/Projects/.audit/corpus";
const corpora: Record<string, string> = {
  "engine-src": join(wt, "src"),
  "engine-tests": join(wt, "tests"),
  zod: join(wt, "node_modules/zod"),
  pino: join(wt, "node_modules/pino"),
  commander: join(wt, "node_modules/commander"),
  "babel-parser": join(wt, "node_modules/@babel/parser"),
};
const volatileKeys = new Set(["generatedAt", "durationMs", "analysisRunId", "discoveredAt", "startedAt", "completedAt", "projectId"]);
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([key]) => !volatileKeys.has(key)).map(([key, inner]) => [key, stable(inner)]))
  : value;
const digest = (dir: string): Record<string, string> => Object.fromEntries(readdirSync(join(dir, ".discovery")).filter((name) => name.endsWith(".json") && name !== "manifest.json").sort().map((name) => {
  const parsed = JSON.parse(readFileSync(join(dir, ".discovery", name), "utf8"));
  return [name, createHash("sha256").update(JSON.stringify(stable(parsed))).digest("hex").slice(0, 16)];
}));

const results: unknown[] = [];
for (const [name, source] of Object.entries(corpora)) {
  if (!existsSync(source)) { console.log(`${name}: missing`); continue; }
  const dir = join(root, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(source, dir, { recursive: true, filter: (path) => !path.includes(".discovery") });
  const runs: { ms: number; report: any; digest: Record<string, string> }[] = [];
  for (let i = 0; i < 2; i++) {
    const started = performance.now();
    const run = spawnSync("bun", ["run", join(wt, "src/cli/index.ts"), "analyze", dir, "--refresh", "--json"], {
      cwd: wt, encoding: "utf8", maxBuffer: 1 << 26,
      env: { ...process.env, LEGACY_EXODUS_HOME: "C:/Projects/.audit/home", NO_COLOR: "1" },
    });
    const ms = Math.round(performance.now() - started);
    if (run.status !== 0) { console.log(`${name}: run ${i} exit ${run.status} ${run.stderr.slice(0, 600)}`); break; }
    runs.push({ ms, report: JSON.parse(run.stdout), digest: digest(dir) });
  }
  if (runs.length === 0) continue;
  const summary = JSON.parse(readFileSync(join(dir, ".discovery/summary.json"), "utf8"));
  const failures = summary.analysisDisposition.files.filter((file: any) => file.kind !== "analyzed");
  const codes: Record<string, number> = {};
  for (const failure of failures) codes[failure.code ?? failure.kind] = (codes[failure.code ?? failure.kind] ?? 0) + 1;
  const sizes = Object.fromEntries(readdirSync(join(dir, ".discovery")).map((file) => [file, statSync(join(dir, ".discovery", file)).size]));
  const deterministic = runs.length === 2 && JSON.stringify(runs[0]!.digest) === JSON.stringify(runs[1]!.digest);
  const differing = runs.length === 2 ? Object.keys(runs[0]!.digest).filter((key) => runs[0]!.digest[key] !== runs[1]!.digest[key]) : [];
  const row = { name, files: runs[0]!.report.filesDiscovered, analyzed: runs[0]!.report.filesAnalyzed, parserFailures: runs[0]!.report.parserFailures, failureCodes: codes, msRuns: runs.map((r) => r.ms), engineMs: Math.round(runs[0]!.report.durationMs), deterministic, differing, discoveryBytes: Object.values(sizes).reduce((a: number, b: any) => a + b, 0) };
  results.push({ ...row, failingFiles: failures.slice(0, 15).map((f: any) => `${f.path}:${f.code}`) });
  console.log(JSON.stringify(row));
}
writeFileSync("C:/Projects/.audit/logs/corpus-results.json", JSON.stringify(results, null, 2));
