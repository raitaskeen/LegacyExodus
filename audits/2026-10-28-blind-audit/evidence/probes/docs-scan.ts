// Read-only docs scan of the frozen worktree: inventory, size, last-touch commit date,
// broken relative links/anchors, and stale numeric claims (test counts, audit counts, SHAs).
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repo = "C:/Projects/.audit/wt";
const skip = new Set(["node_modules", ".git", "legacy-exodus-core"]);
const files: string[] = [];
const walk = (dir: string): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name) && dir === repo) continue;
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".discovery") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith(".md")) files.push(path);
  }
};
walk(repo);
for (const extra of ["legacy-exodus-core/benchmarks"]) if (existsSync(join(repo, extra))) walk(join(repo, extra));

const slug = (heading: string): string => heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");
const anchorsOf = new Map<string, Set<string>>();
const anchors = (path: string): Set<string> => {
  if (!anchorsOf.has(path)) {
    const set = new Set<string>();
    for (const line of readFileSync(path, "utf8").split("\n")) { const m = /^#{1,6}\s+(.*)$/.exec(line); if (m) set.add(slug(m[1]!)); }
    anchorsOf.set(path, set);
  }
  return anchorsOf.get(path)!;
};

const broken: string[] = [];
const claims: string[] = [];
const rows: string[] = [];
for (const path of files.sort()) {
  const rel = relative(repo, path).replaceAll("\\", "/");
  const text = readFileSync(path, "utf8");
  const log = spawnSync("git", ["-C", repo, "log", "-1", "--format=%cs", "--", rel], { encoding: "utf8" }).stdout.trim();
  rows.push(`${rel}\t${text.split("\n").length}\t${log}`);
  for (const match of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1]!;
    if (/^(https?:|mailto:|#$)/.test(target)) continue;
    const [file, anchor] = target.split("#");
    const resolved = file === "" ? path : resolve(dirname(path), decodeURIComponent(file!));
    if (!existsSync(resolved)) { broken.push(`${rel} -> ${target} (missing file)`); continue; }
    if (anchor && resolved.endsWith(".md") && statSync(resolved).isFile() && !anchors(resolved).has(anchor.toLowerCase())) broken.push(`${rel} -> ${target} (missing anchor)`);
  }
  text.split("\n").forEach((line, index) => {
    if (/\b\d{3,4}\s*(?:\/\s*\d{3,4}\s*)?tests?\b|\b10\/10\b|10-point|\b[0-9a-f]{40}\b|8,536|7,281|366 GT/i.test(line)) claims.push(`${rel}:${index + 1}: ${line.trim().slice(0, 160)}`);
  });
}
console.log(`DOCS ${files.length}`);
console.log(rows.join("\n"));
console.log(`\nBROKEN ${broken.length}`);
console.log(broken.join("\n"));
console.log(`\nCLAIMS ${claims.length}`);
console.log(claims.join("\n"));
