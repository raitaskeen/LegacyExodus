// Writes each sample, runs `legacy-exodus analyze --refresh --json` from the frozen
// worktree, and saves the CLI report plus the projected artifacts for inspection.
import { mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { samples } from "./samples";

const root = "C:/Projects/.audit/samples";
const cli = "C:/Projects/.audit/wt/legacy-exodus-core/src/cli/index.ts";
const only = process.argv[2];

for (const [name, files] of Object.entries(samples)) {
  if (only !== undefined && !name.startsWith(only)) continue;
  const dir = join(root, name);
  rmSync(dir, { recursive: true, force: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  const run = spawnSync("bun", ["run", cli, "analyze", dir, "--refresh", "--json"], {
    cwd: "C:/Projects/.audit/wt/legacy-exodus-core",
    encoding: "utf8",
    env: { ...process.env, LEGACY_EXODUS_HOME: "C:/Projects/.audit/home", NO_COLOR: "1" },
  });
  const outDir = join(root, `${name}.out`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "cli.json"), run.stdout);
  writeFileSync(join(outDir, "cli.err"), run.stderr);
  const discovery = join(dir, ".discovery");
  const artifacts = existsSync(discovery) ? readdirSync(discovery) : [];
  console.log(`${name}: exit ${run.status}; artifacts ${artifacts.length}; ${run.stdout.trim().slice(0, 400)}`);
  if (run.status !== 0) console.log(run.stderr.slice(0, 800));
  for (const artifact of artifacts) writeFileSync(join(outDir, artifact), readFileSync(join(discovery, artifact)));
}
