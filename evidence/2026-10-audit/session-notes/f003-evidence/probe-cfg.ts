const root = process.env.CORE_ROOT!;
const { JavaScriptParser } = await import(`${root}/src/parser/adapters/javascript/javascript-parser.ts`);
const { DeterministicControlFlowGraphBuilder } = await import(`${root}/src/flow/control-flow-builder.ts`);
const code = process.argv[2]!;
const ast = (await new JavaScriptParser().parse({ file: { id: "p", path: "p.js", language: "javascript", size: code.length }, source: code })).result;
for (const g of new DeterministicControlFlowGraphBuilder().buildAll(ast)) {
  if (g.scopeName === "module" && process.argv[3] !== "module") continue;
  const name = new Map<string, string>(); g.blocks.forEach((b: any, i: number) => name.set(b.id, b.id === g.entryBlockId ? "ENTRY" : b.id === g.exitBlockId ? "EXIT" : `B${i}`));
  console.log(`== ${g.scopeName} state=${g.state}`);
  for (const b of g.blocks) console.log(`  ${name.get(b.id)}: [${b.statements.map((s: any) => `${s.type}@${s.location?.line}:${s.location?.column}`).join(", ")}] preds=${b.predecessorIds.map((p: string) => name.get(p)).join(",")}${g.unreachableBlockIds.includes(b.id) ? " UNREACHABLE" : ""}`);
  for (const e of g.edges) console.log(`  ${name.get(e.fromBlockId)} -${e.kind}-> ${name.get(e.toBlockId)}`);
  for (const l of g.loops) console.log(`  LOOP header=${name.get(l.headerBlockId)} blocks=${l.blockIds.map((x: string) => name.get(x)).join(",")}`);
  for (const d of g.dominators) if (d.immediateDominatorId) console.log(`  idom(${name.get(d.blockId)})=${name.get(d.immediateDominatorId)}`);
}
