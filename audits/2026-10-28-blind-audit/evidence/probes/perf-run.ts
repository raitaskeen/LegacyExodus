// Times the CLI on the generated single-file repositories (3 measured runs after a warm-up).
import { spawnSync } from "node:child_process";
import { readFileSync, statSync, readdirSync } from "node:fs";

const wt = "C:/Projects/.audit/wt/legacy-exodus-core";
const sizes = (process.argv[2] ?? "500,1000,2000,4000").split(",").map(Number);
for (const n of sizes) {
  const dir = `C:/Projects/.audit/perf/n${n}`;
  const samples: number[] = [];
  for (let i = 0; i < 4; i++) {
    const run = spawnSync("bun", ["run", `${wt}/src/cli/index.ts`, "analyze", dir, "--refresh", "--json"], {
      cwd: wt, encoding: "utf8", maxBuffer: 1 << 26, env: { ...process.env, LEGACY_EXODUS_HOME: "C:/Projects/.audit/home" },
    });
    if (run.status !== 0) { console.log(`n=${n} failed: ${run.stderr.slice(0, 300)}`); break; }
    if (i > 0) samples.push(Math.round(JSON.parse(run.stdout).durationMs));
  }
  const bytes = readdirSync(`${dir}/.discovery`).reduce((sum, file) => sum + statSync(`${dir}/.discovery/${file}`).size, 0);
  const lines = readFileSync(`${dir}/big.js`, "utf8").split("\n").length;
  const sorted = [...samples].sort((a, b) => a - b);
  console.log(JSON.stringify({ n, lines, engineMs: samples, medianMs: sorted[1], discoveryMB: Math.round(bytes / 1e5) / 10 }));
}
