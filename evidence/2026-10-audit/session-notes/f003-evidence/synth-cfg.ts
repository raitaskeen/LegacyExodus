import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = process.env.CORE_ROOT!;
const { JavaScriptParser } = await import(`${root}/src/parser/adapters/javascript/javascript-parser.ts`);
const { DeterministicControlFlowGraphBuilder } = await import(`${root}/src/flow/control-flow-builder.ts`);
const sources: Record<string, string> = {
  "labelled.js": "function f() { outer: while (outerCondition) { while (innerCondition) { break outer; } continue outer; } }",
  "abrupt-tail.js": "function g(c) { while (c) { work(); return; } }",
  "switch-tail.js": "function h(a) { for (var key in a) { switch (typeof a[key]) { case 'object': m(); break; default: n(); break; } } }",
  "continue-tail.js": "function k(n) { for (let i = 0; i < n; i++) { if (i) { continue; } work(); continue; } }",
  "nested-break.js": "function p(a, b) { while (a) { while (b) { step(); break; } } }",
};
const graphs: unknown[] = [];
for (const [path, source] of Object.entries(sources)) {
  const ast = (await new JavaScriptParser().parse({ file: { id: path, path, language: "javascript", size: source.length }, source })).result;
  graphs.push(...new DeterministicControlFlowGraphBuilder().buildAll(ast));
}
mkdirSync(process.argv[2]!, { recursive: true });
writeFileSync(join(process.argv[2]!, "control-flow.json"), JSON.stringify({ graphs }));
