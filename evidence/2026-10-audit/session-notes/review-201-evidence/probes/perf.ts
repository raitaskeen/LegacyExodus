// F-003 determinism/cost probe. Run from a copy's legacy-exodus-core dir: bun <this file> <label>
// Parses (never executes) the JavaScript under node_modules and builds every CFG twice.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const { DeterministicControlFlowGraphBuilder } = await import(resolve(root, "src/flow/control-flow-builder.ts"));
const { JavaScriptParser } = await import(resolve(root, "src/parser/index.ts"));

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) walk(path, out);
    else if (/\.(c|m)?js$/.test(name) && info.size < 400_000) out.push(path);
  }
}
const files: string[] = [];
walk(resolve(root, "node_modules"), files);

const parser = new JavaScriptParser();
const asts: any[] = [];
for (const path of files) {
  const source = readFileSync(path, "utf8");
  const ast = (await parser.parse({ file: { id: path, path: path.slice(root.length + 1).replaceAll("\\", "/"), language: "javascript", size: source.length }, source })).result;
  if (ast.errors.length === 0) asts.push(ast);
}

function run(builder: any): { digest: string; ms: number; graphs: number; blocks: number; loops: number; withIncomingEntry: number } {
  const hash = createHash("sha256");
  let graphs = 0, blocks = 0, loops = 0, withIncomingEntry = 0;
  const start = performance.now();
  for (const ast of asts) {
    for (const g of builder.buildAll(ast)) {
      graphs++; blocks += g.blocks.length; loops += g.loops.length;
      if (g.edges.some((e: any) => e.toBlockId === g.entryBlockId)) withIncomingEntry++;
      hash.update(JSON.stringify(g));
    }
  }
  return { digest: hash.digest("hex").slice(0, 16), ms: Math.round(performance.now() - start), graphs, blocks, loops, withIncomingEntry };
}

const reused = new DeterministicControlFlowGraphBuilder();
const a = run(reused);
const b = run(reused);
const c = run(new DeterministicControlFlowGraphBuilder());
console.log(`== ${process.argv[2]} files=${asts.length}/${files.length}`);
console.log(JSON.stringify({ first: a, reused: b, fresh: c, deterministic: a.digest === b.digest && b.digest === c.digest }));
console.log(`heapMB=${Math.round(process.memoryUsage().heapUsed / 1e6)}`);
