import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { DeterministicDependencyGraphBuilder } from "@graph/index";
import { JavaScriptParser, type ASTNode, type ASTResult } from "@parser/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";
import { JavaScriptSymbolExtractor, type CodeSymbol, type SymbolTable } from "@symbols/index";

const path = "src/f08.js";
async function fixture(source: string) {
  const file = { id: "f08", path, language: "javascript", size: source.length };
  const ast = (await new JavaScriptParser().parse({ file, source })).result;
  const table = new JavaScriptSymbolExtractor().extract(ast);
  return { ast, table, file };
}
function analyze(f: Awaited<ReturnType<typeof fixture>>, table = f.table, ast = f.ast) {
  const graph = new DeterministicDependencyGraphBuilder().build([table], [f.file]);
  return new DeterministicSemanticAnalysisEngine().analyze({ astResults: [ast], symbolTables: [table], dependencyGraph: graph });
}
function exact(table: SymbolTable, name: string, kind: CodeSymbol["kind"] = "variable") {
  const symbols = table.symbols.filter(s => s.name === name && s.kind === kind && s.containerName === undefined);
  expect(symbols).toHaveLength(1);
  return symbols[0]!;
}
function targets(analysis: ReturnType<typeof analyze>, name: string) {
  return analysis.references.filter(r => r.kind === "identifier" && r.name === name).map(r => r.resolvedSymbolId).sort();
}
function live(analysis: ReturnType<typeof analyze>, symbol: CodeSymbol, count = 1) {
  expect(targets(analysis, symbol.name).filter(id => id === symbol.id)).toHaveLength(count);
  expect(analysis.deadCode.filter(f => f.symbolId === symbol.id)).toEqual([]);
}

describe("F08 local lexical identifier references", () => {
  for (const [label, body, count] of [
    ["R1 local return", "return x;", 1],
    ["T3 initializer read", "const y = x; return y;", 1],
    ["T4 call argument", "foo(x);", 1],
    ["T5 arithmetic and condition", "if (x) return x + 1;", 2],
    ["R3 shorthand", "return { x };", 1],
    ["T7 member base", "return x.value;", 1],
    ["T17 write-only", "x = 2;", 1],
    ["T18 compound and updates", "x += 1; x++; ++x;", 3],
    ["computed property", "const obj = {}; return obj[x];", 1],
    ["template and array", "return [x, `value ${x}`];", 2],
  ] as const) {
    test(label, async () => {
      const f = await fixture(`function demo() { let x = 1; ${body} }`);
      live(analyze(f), exact(f.table, "x"), count);
    });
  }
  test("R2 truly unused local remains inferred", async () => {
    const f = await fixture("function demo() { const x = 1; return 2; }");
    const x = exact(f.table, "x");
    const a = analyze(f);
    expect(targets(a, "x")).toEqual([]);
    expect(a.deadCode.filter(d => d.symbolId === x.id)).toEqual([expect.objectContaining({ reason: "unreferenced-local-symbol", state: "INFERRED" })]);
  });
  test("R4 nearest local shadows import", async () => {
    const f = await fixture('import { x } from "external"; function demo() { const x = 1; return x; }');
    const x = exact(f.table, "x");
    const imported = exact(f.table, "x", "import");
    const a = analyze(f);
    expect(targets(a, "x")).toEqual([x.id]);
    expect(a.unusedImports.map(d => d.symbolId)).toContain(imported.id);
  });
  test("nearest block binding isolates outer and sibling scopes", async () => {
    const f = await fixture("const x = 1; { const x = 2; foo(x); } { const x = 3; }");
    const inner = f.table.symbols.find(s => s.name === "x" && s.value === 2)!;
    expect(targets(analyze(f), "x")).toEqual([inner.id]);
  });
  for (const [label, source] of [
    ["T9 parent block", "function demo() { const x = 1; { return x; } }"],
    ["T10 closure", "function demo() { const x = 1; function inner() { return x; } }"],
    ["scope membership before declaration", "function demo() { foo(x); const x = 1; }"],
    ["var function scope", "function demo() { { var x = 1; } return x; }"],
  ] as const) test(label, async () => {
    const f = await fixture(source);
    live(analyze(f), exact(f.table, "x"));
  });
  test("R5 used parameter and unused parameter", async () => {
    const f = await fixture("function demo(x, unused) { return x; }");
    const used = f.table.symbols.find(s => s.name === "x" && s.declarationKind === "param")!;
    const unused = f.table.symbols.find(s => s.name === "unused" && s.declarationKind === "param")!;
    expect(used.containerName).toBe("demo");
    const a = analyze(f);
    live(a, used);
    expect(a.deadCode.map(d => d.symbolId)).toContain(unused.id);
  });
  test("default parameter initializer and destructured parameter", async () => {
    const f = await fixture("const fallback = 1; function demo({x} = fallback) { return x; }");
    live(analyze(f), exact(f.table, "fallback"));
    const x = f.table.symbols.find(s => s.name === "x" && s.declarationKind === "param")!;
    live(analyze(f), x);
  });
  test("PR99 alias local identity and namespace/external lookup", async () => {
    const f = await fixture('import { foo as localFoo } from "external"; import * as ns from "external"; function demo() { return [localFoo, ns.foo]; }');
    const a = analyze(f);
    expect(targets(a, "localFoo")).toEqual([exact(f.table, "localFoo", "import").id]);
    expect(targets(a, "ns")).toEqual([exact(f.table, "ns", "import").id]);
    expect(targets(a, "foo")).toEqual([]);
    expect(a.unusedImports).toEqual([]);
  });
  test("R6 function value and normal invocation dual evidence", async () => {
    const f = await fixture("function helper() {} function demo() { helper(); return helper; }");
    const helper = exact(f.table, "helper", "function");
    const a = analyze(f);
    live(a, helper, 2);
    expect(a.calls.filter(c => c.targetSymbolId === helper.id)).toHaveLength(1);
    expect(a.references.filter(r => r.kind === "call" && r.resolvedSymbolId === helper.id)).toHaveLength(1);
  });
  test("R7 bind value does not invoke target or reference property token", async () => {
    const f = await fixture("function calculateTotal() {} const bound = calculateTotal.bind(null, 100); bound();");
    const helper = exact(f.table, "calculateTotal", "function");
    const a = analyze(f);
    live(a, helper);
    expect(a.calls.filter(c => c.targetSymbolId === helper.id)).toEqual([]);
    expect(a.references.filter(r => r.kind === "call" && r.resolvedSymbolId === helper.id)).toEqual([]);
    expect(targets(a, "bind")).toEqual([]);
  });
  test("call and apply retain invocation behavior", async () => {
    const f = await fixture("function helper() {} helper.call(null); helper.apply(null, []);");
    const helper = exact(f.table, "helper", "function");
    const a = analyze(f);
    live(a, helper, 2);
    expect(a.calls.filter(c => c.targetSymbolId === helper.id)).toHaveLength(2);
  });
  for (const init of ["() => {}", "function () {}"]) test(`assigned-function companion ${init}`, async () => {
    const f = await fixture(`function demo() { const helper = ${init}; return helper; }`);
    const variable = exact(f.table, "helper");
    const implementation = exact(f.table, "helper", "function");
    const a = analyze(f);
    expect(targets(a, "helper")).toEqual([variable.id, implementation.id].sort());
    live(a, variable); live(a, implementation);
    expect(a.calls).toEqual([]);
  });
  test("later assigned function is not an initializer companion", async () => {
    const f = await fixture("let helper; helper = () => {}; foo(helper);");
    const variable = exact(f.table, "helper");
    expect(targets(analyze(f), "helper")).toEqual([variable.id, variable.id]);
  });
  for (const prefix of ["", "function demo() { "]) test(`CommonJS exact companion ${prefix || "module"}`, async () => {
    const f = await fixture(`${prefix}const helper = require("./m"); foo(helper);${prefix ? " }" : ""}`);
    const variable = exact(f.table, "helper");
    const imported = exact(f.table, "helper", "import");
    const a = analyze(f);
    expect(targets(a, "helper")).toEqual([variable.id, imported.id].sort());
    live(a, variable);
    expect(a.unusedImports.map(d => d.symbolId)).not.toContain(imported.id);
  });
  test("unused CommonJS preserves both unused findings", async () => {
    const f = await fixture('const helper = require("./m");');
    const a = analyze(f);
    expect(a.deadCode.map(d => d.symbolId)).toContain(exact(f.table, "helper").id);
    expect(a.unusedImports.map(d => d.symbolId)).toContain(exact(f.table, "helper", "import").id);
  });
  test("recognized destructured CommonJS remains import canonical", async () => {
    const f = await fixture('const { helper: alias } = require("./m"); foo(alias);');
    expect(targets(analyze(f), "alias")).toEqual([exact(f.table, "alias", "import").id]);
  });
  test("class value and constructor retain exact identity", async () => {
    const f = await fixture("class C { field = 1; method() {} } foo(C); const c = new C();");
    const c = exact(f.table, "C", "class");
    const a = analyze(f);
    live(a, c, 2);
    expect(a.calls.filter(call => call.targetSymbolId === c.id)).toHaveLength(1);
    expect(targets(a, "field")).toEqual([]);
    expect(targets(a, "method")).toEqual([]);
  });
  test("property record does not hide outer lexical declaration", async () => {
    const f = await fixture("const x = 1; function demo() { const obj = { x: 2 }; return x; }");
    const a = analyze(f);
    expect(f.table.symbols.filter(s => s.name === "x" && s.containerName === "obj")).toHaveLength(1);
    expect(targets(a, "x")).toEqual([exact(f.table, "x").id]);
  });
  test("property/key/member records never establish bare lexical bindings", async () => {
    const f = await fixture("const obj = { x: 2 }; class C { field = 1; } exports.member = 3; foo(x, field, member); foo(obj.x);");
    const a = analyze(f);
    expect(targets(a, "x")).toEqual([]);
    expect(targets(a, "field")).toEqual([]);
    expect(targets(a, "member")).toEqual([]);
    expect(targets(a, "obj")).toEqual([exact(f.table, "obj").id]);
  });
  test("missing identifier emits no ordinary identifier evidence", async () => {
    const f = await fixture("function demo() { return missing; } missing();");
    const a = analyze(f);
    expect(targets(a, "missing")).toEqual([]);
    expect(a.references.filter(r => r.kind === "identifier")).toEqual([]);
    expect(a.calls[0]?.resolutionState).toBe("UNRESOLVED");
  });
  test("same-scope ambiguity blocks outward lookup independent of input order", async () => {
    const f = await fixture("const x = 1; function demo() { const x = 2; return x; }");
    const inner = f.table.symbols.find(s => s.name === "x" && s.value === 2)!;
    const symbols = [...f.table.symbols, { ...inner, id: "ambiguous-inner" }];
    for (const ordered of [symbols, [...symbols].reverse()]) {
      expect(targets(analyze(f, { ...f.table, symbols: ordered }), "x")).toEqual([]);
    }
  });
  test("opaque inner declaration blocks unsafe outward fallback", async () => {
    const f = await fixture("const x = 1; function demo() { const x = 2; return x; }");
    const symbols = f.table.symbols.map(s => s.name === "x" && s.value === 2 ? { ...s, location: undefined } : s);
    expect(targets(analyze(f, { ...f.table, symbols }), "x")).toEqual([]);
  });
  test("partial explicit import remains compatible but grants no local companion", async () => {
    const f = await fixture("shared;");
    const importedFixture = await fixture('import shared from "external";');
    const base = importedFixture.table.symbols[0]!;
    const imported = { ...base, filePath: path, location: undefined };
    expect(targets(analyze(f, { ...f.table, moduleReferences: importedFixture.table.moduleReferences, symbols: [imported] }), "shared")).toEqual([imported.id]);
    const local = { ...imported, id: "opaque-local", kind: "variable" as const, declarationKind: "const" as const };
    expect(targets(analyze(f, { ...f.table, moduleReferences: importedFixture.table.moduleReferences, symbols: [imported, local] }), "shared")).toEqual([]);
  });
  test("unlocated repeated uses preserve multiplicity and frozen ID formula", async () => {
    const f = await fixture("const x = 1; foo(x); foo(x);");
    const stripUses = (node: ASTNode): ASTNode => ({
      ...node, ...(node.type === "Identifier" && node.role === "arguments" ? { location: undefined } : {}),
      children: node.children.map(stripUses),
    });
    const ast: ASTResult = { ...f.ast, root: stripUses(f.ast.root) };
    const x = exact(f.table, "x");
    const refs = analyze(f, f.table, ast).references.filter(r => r.kind === "identifier" && r.name === "x");
    const id = createHash("sha256").update(`identifier-reference:${path}:${x.id}:0:0`).digest("hex");
    expect(refs).toHaveLength(2);
    expect(refs.map(r => r.id)).toEqual([id, id]);
  });
  test("partial CommonJS metadata cannot invent a scalar initializer companion", async () => {
    const f = await fixture("const helper = 1; foo(helper);");
    const other = await fixture('const helper = require("./m");');
    const variable = exact(f.table, "helper");
    const imported = { ...exact(other.table, "helper", "import"), location: variable.location };
    const table = { ...f.table, symbols: [...f.table.symbols, imported], moduleReferences: other.table.moduleReferences };
    expect(targets(analyze(f, table), "helper")).toEqual([]);
  });
  test("opaque variable at an implementation anchor still blocks an outer binding", async () => {
    const f = await fixture("const x = 1; function demo() { const impl = () => {}; return x; }");
    const implementation = exact(f.table, "impl", "function");
    const local = exact(f.table, "impl");
    const opaque = { ...local, id: "opaque-at-expression", name: "x", location: implementation.location };
    expect(targets(analyze(f, { ...f.table, symbols: [...f.table.symbols, opaque] }), "x")).toEqual([]);
  });

  test("three-run hashes and symbol input permutation are deterministic", async () => {
    const source = 'import { external } from "pkg"; const helper = () => {}; const dep = require("./m"); class C {} function demo(x) { let unused = 1; return [x, helper, dep, C, external]; } demo(1);';
    const digests: string[] = [];
    for (let run = 0; run < 3; run++) {
      const f = await fixture(source);
      const table = { ...f.table, symbols: run === 1 ? [...f.table.symbols].reverse() : f.table.symbols };
      const a = analyze(f, table);
      const symbols = table.symbols.map(s => s.id).sort();
      digests.push(createHash("sha256").update(JSON.stringify({ references: a.references, calls: a.calls, deadCode: [...a.deadCode].sort((l, r) => l.symbolId.localeCompare(r.symbolId)), symbols })).digest("hex"));
    }
    expect(new Set(digests).size).toBe(1);
    console.log("F08 determinism SHA256:", digests.join(" "));
  });
});
