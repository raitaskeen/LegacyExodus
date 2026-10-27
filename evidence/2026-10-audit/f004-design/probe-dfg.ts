// usage: bun probe-dfg.ts <legacy-exodus-core root> [filter]
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { cases } from "./cases";
const root = process.argv[2]!;
const only = process.argv[3];
const { DeterministicDataFlowGraphBuilder } = await import(join(root, "src/flow/index.ts"));
const { JavaScriptParser } = await import(join(root, "src/parser/index.ts"));
const parser = new JavaScriptParser();
let misses = 0, extra = 0;
for (const [name, code] of Object.entries(cases)) {
  if (only !== undefined && !name.includes(only)) continue;
  const sent: unknown[] = [];
  runInNewContext(code, { req: { body: "TAINT", query: {}, params: {} }, res: { send: (v: unknown) => sent.push(v), json: (v: unknown) => sent.push(v) }, Error });
  const runtime = sent.some((v) => String(v).includes("TAINT"));
  const ast = (await parser.parse({ file: { id: "p", path: "p.js", language: "javascript", size: code.length }, source: code })).result;
  const graph = new DeterministicDataFlowGraphBuilder().build(ast);
  const flows = graph.taintFlows.map((f: { state: string }) => f.state);
  const engine = flows.length > 0;
  const verdict = runtime === engine ? "ok  " : runtime ? "MISS" : "FP  ";
  if (runtime && !engine) misses++;
  if (!runtime && engine) extra++;
  console.log(`${verdict} runtime=${runtime ? "flow" : "none"} engine=${engine ? flows.join(",") : "none"}  ${name}`);
}
console.log(`missed flows: ${misses}; flows with no runtime flow: ${extra}`);
