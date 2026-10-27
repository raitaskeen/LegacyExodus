const root = process.env.CORE_ROOT!;
const { JavaScriptParser } = await import(`${root}/src/parser/adapters/javascript/javascript-parser.ts`);
const { DeterministicControlFlowGraphBuilder } = await import(`${root}/src/flow/control-flow-builder.ts`);
async function cfg(code: string) {
  const ast = (await new JavaScriptParser().parse({ file: { id: "p", path: "p.js", language: "javascript", size: code.length }, source: code })).result;
  return new DeterministicControlFlowGraphBuilder().buildAll(ast).find((g: any) => g.scopeName.startsWith("f@"));
}
const blockOf = (g: any, pred: (s: any) => boolean) => g.blocks.find((b: any) => b.statements.some(pred));
const inLoop = (g: any, b: any) => g.loops.some((l: any) => l.blockIds.includes(b.id));
const w = await cfg("function f(c){ before(); while(c){ body(); } after(); }");
const before = blockOf(w, (s: any) => s.type === "ExpressionStatement" && s.location.column === 15);
const loopBack = w.edges.filter((e: any) => e.kind === "loop-back");
const fr = await cfg("function f(n){ for (let i = 0; i < n; i++) { if (i) continue; work(i); } }");
// On the base the init has no node of its own; it is a clause of the ForStatement node.
const initHolder = blockOf(fr, (s: any) => s.type === "VariableDeclaration") ?? blockOf(fr, (s: any) => s.type === "ForStatement");
const cont = fr.edges.find((e: any) => e.kind === "continue");
const contTarget = fr.blocks.find((b: any) => b.id === cont.toBlockId);
console.log(JSON.stringify({
  "before() is in no loop": !inLoop(w, before),
  "for init is not in the loop": !inLoop(fr, initHolder),
  "entry block has no incoming edges (while, for)": [w, fr].map((g: any) => g.edges.every((e: any) => e.toBlockId !== g.entryBlockId)),
  "loop-back targets a header holding only the loop test": loopBack.every((e: any) => w.blocks.find((b: any) => b.id === e.toBlockId).statements.map((s: any) => s.type).join() === "WhileStatement"),
  "continue in a for loop runs the update": contTarget.statements.some((s: any) => s.type === "UpdateExpression"),
  "continue target statements": contTarget.statements.map((s: any) => s.type),
  "state": [w.state, fr.state],
}, null, 1));
