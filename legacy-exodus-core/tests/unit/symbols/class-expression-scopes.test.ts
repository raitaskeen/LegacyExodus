import { describe, expect, it } from "bun:test";
import { JavaScriptParser } from "@parser/adapters/javascript/javascript-parser";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";
import { DeterministicDependencyGraphBuilder } from "@graph/dependency-graph-builder";
import { DeterministicSemanticAnalysisEngine } from "@semantic/semantic-engine";
import { DeterministicCallGraphBuilder } from "@semantic/call-graph-builder";

async function analyze(source: string) {
  const file = { id: "f1", path: "src/main.js", language: "javascript", size: source.length };
  const ast = (await new JavaScriptParser().parse({ file, source })).result!;
  const table = new JavaScriptSymbolExtractor().extract(ast);
  const graph = new DeterministicDependencyGraphBuilder().build([table], [file]);
  const analysis = new DeterministicSemanticAnalysisEngine(new DeterministicCallGraphBuilder())
    .analyze({ astResults: [ast], dependencyGraph: graph, symbolTables: [table] });
  return { table, analysis, lines: source.split("\n") };
}

/** 1-based line of the unique source line carrying `marker`. */
function lineOf(lines: readonly string[], marker: string): number {
  const matches = lines.flatMap((text, index) => (text.includes(marker) ? [index + 1] : []));
  expect(matches.length).toBe(1);
  return matches[0]!;
}

describe("BA-13 class expressions are classes", () => {
  it("attributes members of a class assigned to a const to that binding", async () => {
    const { table } = await analyze([
      "export const Inner = class {",
      "  field = 1;",
      "  static sfield = 2;",
      "  m() { return 1; }",
      "  get g() { return 2; }",
      "  #p() { return 3; }",
      "  static s() { return 4; }",
      "};",
    ].join("\n"));
    const classes = table.symbols.filter((s) => s.kind === "class");
    expect(classes.map((s) => s.name)).toEqual(["Inner"]);
    const cls = classes[0]!;
    expect(cls.anonymous).toBe(false);
    const members = table.symbols.filter((s) => s.kind === "method" || (s.kind === "variable" && s.name !== "Inner"));
    // m, g, #p, s, field, sfield
    expect(members).toHaveLength(6);
    for (const member of members) {
      expect(member.containerName).toBe("Inner");
      expect(member.containerId).toBe(cls.id);
    }
    // The binding itself stays the variable it always was.
    expect(table.symbols.filter((s) => s.kind === "variable" && s.name === "Inner")).toHaveLength(1);
  });

  it("names an anonymous class by assignment, by object key, and falls back to anonymous-class", async () => {
    const { table } = await analyze([
      "let X;",
      "X = class { a() {} };",
      "const holder = { K: class { b() {} }, 'S': class { s() {} } };",
      "register(class { c() {} });",
    ].join("\n"));
    const byMethod = (method: string) => {
      const symbol = table.symbols.find((s) => s.kind === "method" && s.name === method)!;
      const owner = table.symbols.find((s) => s.kind === "class" && s.id === symbol.containerId);
      return { container: symbol.containerName, owner: owner?.name };
    };
    expect(byMethod("a")).toEqual({ container: "X", owner: "X" });
    expect(byMethod("b")).toEqual({ container: "K", owner: "K" });
    expect(byMethod("s")).toEqual({ container: "S", owner: "S" });
    expect(byMethod("c")).toEqual({ container: "anonymous-class", owner: "anonymous-class" });
    expect(table.symbols.find((s) => s.kind === "class" && s.name === "anonymous-class")?.anonymous).toBe(true);
  });

  it("names a named class expression by its own id and keeps the binding as a variable", async () => {
    const { table } = await analyze("const Outer = class Named { m() {} #q() {} get g() { return 1; } field = 1; };\n");
    const cls = table.symbols.filter((s) => s.kind === "class");
    expect(cls.map((s) => s.name)).toEqual(["Named"]);
    for (const name of ["m", "g", "field"]) {
      const member = table.symbols.find((s) => s.name === name && s.containerName !== undefined)!;
      expect(member.containerName).toBe("Named");
      expect(member.containerId).toBe(cls[0]!.id);
    }
    expect(table.symbols.some((s) => s.kind === "variable" && s.name === "Outer")).toBe(true);
    // Its own name is not a binding of the enclosing scope.
    expect(cls[0]!.scopeId).not.toBe("scope:module");
  });

  it("leaves class declarations and export default class unchanged", async () => {
    const { table } = await analyze("class Decl { m() {} }\nexport default class { n() {} }\n");
    expect(table.symbols.find((s) => s.kind === "method" && s.name === "m")?.containerName).toBe("Decl");
    expect(table.symbols.find((s) => s.kind === "method" && s.name === "n")?.containerName).toBe("anonymous-class");
    expect(table.symbols.filter((s) => s.kind === "class").map((s) => s.name).sort()).toEqual(["Decl", "anonymous-class"]);
  });

  it("resolves this.#m() inside an anonymous class expression to that class, not the enclosing class", async () => {
    const { table, analysis, lines } = await analyze([
      "class Outer {",
      "  #m() { return 1; } // @outerm",
      "  make() {",
      "    return class {",
      "      #m() { return 2; } // @innerm",
      "      n() { return this.#m(); } // @call",
      "    };",
      "  }",
      "}",
    ].join("\n"));
    const call = analysis.calls.find((c) => c.location?.line === lineOf(lines, "@call") && c.calleeName === "this.#m")!;
    const target = table.symbols.find((s) => s.id === call.targetSymbolId);
    expect(target?.location?.start.line).toBe(lineOf(lines, "@innerm"));
    expect(target?.containerName).toBe("anonymous-class");
  });
});

describe("BA-13 self-name scope of a named class expression", () => {
  it("binds the name only inside the class, so it never reaches the module function of that name", async () => {
    const { analysis, lines } = await analyze([
      "function Named() { return 1; }",
      "const Outer = class Named {",
      "  m() { return Named(); } // @inside",
      "};",
      "Named(); // @outside",
    ].join("\n"));
    const inside = analysis.calls.find((c) => c.calleeName === "Named" && c.location?.line === lineOf(lines, "@inside"));
    const outside = analysis.calls.find((c) => c.calleeName === "Named" && c.location?.line === lineOf(lines, "@outside"));
    expect(outside?.resolutionState).toBe("RESOLVED");
    expect(inside?.resolutionState).toBe("UNRESOLVED");
    expect(inside?.targetSymbolId).toBeUndefined();
  });
});

describe("BA-13 switch statements are block scopes", () => {
  it("scopes let and const of a case to the switch, not the enclosing function", async () => {
    const { table } = await analyze([
      "function f(k) {",
      "  switch (k) {",
      "    case 1: let a = 1; break;",
      "    case 2: const b = 2; break;",
      "  }",
      "  let after = 3;",
      "  return after;",
      "}",
    ].join("\n"));
    const scope = (name: string) => table.symbols.find((s) => s.kind === "variable" && s.name === name)!.scopeId!;
    expect(scope("a")).toContain("SwitchStatement");
    expect(scope("b")).toBe(scope("a"));
    expect(scope("after")).not.toContain("SwitchStatement");
    expect(scope("after")).toContain("BlockStatement");
  });

  it("keeps var of a case in the function scope", async () => {
    const { table } = await analyze("function f(k) { switch (k) { case 1: var v = 1; } return v; }\n");
    expect(table.symbols.find((s) => s.name === "v")!.scopeId).toContain("FunctionDeclaration");
  });

  it("resolves a call to a function declared in a case only inside the switch", async () => {
    const { table, analysis, lines } = await analyze([
      "'use strict';", // block functions are block-scoped only in strict code (Annex B otherwise)
      "function inner() { return 0; }",
      "function run(k) {",
      "  switch (k) {",
      "    case 1:",
      "      function inner() { return 1; } // @decl",
      "      inner(); // @in",
      "  }",
      "  inner(); // @out",
      "}",
    ].join("\n"));
    const call = (marker: string) => analysis.calls.find((c) => c.calleeName === "inner" && c.location?.line === lineOf(lines, marker))!;
    const target = (marker: string) => table.symbols.find((s) => s.id === call(marker).targetSymbolId);
    const inCase = target("@in");
    expect(inCase?.location?.start.line).toBe(lineOf(lines, "@decl"));
    // After the switch the name is the module function again.
    expect(target("@out")?.location?.start.line).toBe(2);
  });
});

describe("BA-13 static blocks are function-like scopes", () => {
  it("scopes let, const and var of a static block to the block", async () => {
    const { table } = await analyze([
      "var outerVar = 0;",
      "class C {",
      "  static {",
      "    var sv = 1;",
      "    let sl = 2;",
      "    const sc = 3;",
      "  }",
      "}",
    ].join("\n"));
    for (const name of ["sv", "sl", "sc"]) {
      const symbol = table.symbols.find((s) => s.kind === "variable" && s.name === name)!;
      expect(symbol.scopeId).toContain("StaticBlock");
    }
    expect(table.symbols.find((s) => s.name === "outerVar")!.scopeId).toBe("scope:module");
  });

  it("resolves a call to a function declared in a static block only inside the block", async () => {
    const { table, analysis, lines } = await analyze([
      "function helper() { return 0; }",
      "class C {",
      "  static {",
      "    function helper() { return 1; } // @decl",
      "    helper(); // @in",
      "  }",
      "  static m() { return helper(); } // @out",
      "}",
    ].join("\n"));
    const call = (marker: string) => analysis.calls.find((c) => c.calleeName === "helper" && c.location?.line === lineOf(lines, marker))!;
    const target = (marker: string) => table.symbols.find((s) => s.id === call(marker).targetSymbolId);
    expect(target("@in")?.location?.start.line).toBe(lineOf(lines, "@decl"));
    expect(target("@out")?.location?.start.line).toBe(1);
  });
});

describe("BA-13 class expressions are never dead code", () => {
  const forms: Record<string, string> = {
    assignment: "let X; X = class {}; new X();",
    "module.exports": "module.exports = class {};",
    "returned from a function": "function f() { return class {}; }\nf();",
    "extends": "class Z extends class {} {}\nnew Z();",
    argument: "use(class {});",
    "immediately constructed": "new (class { m() {} })().m();",
    "object key": "const obj = { K: class {} };\nnew obj.K();",
  };
  for (const [label, source] of Object.entries(forms)) {
    it(`reports no class symbol of a class expression: ${label}`, async () => {
      const { table, analysis } = await analyze(`${source}\n`);
      const classIds = new Set(table.symbols.filter((s) => s.kind === "class" && s.expression === true).map((s) => s.id));
      expect(classIds.size).toBeGreaterThan(0);
      expect(analysis.deadCode.filter((finding) => classIds.has(finding.symbolId))).toEqual([]);
    });
  }

  it("still reports an unused const that holds a class expression, as the variable", async () => {
    const { table, analysis } = await analyze("const Unused = class {};\n");
    const variable = table.symbols.find((s) => s.kind === "variable" && s.name === "Unused")!;
    expect(analysis.deadCode.map((finding) => finding.symbolId)).toEqual([variable.id]);
  });
});

describe("BA-13 Annex B: block-level functions in sloppy code", () => {
  const call = (analysis: Awaited<ReturnType<typeof analyze>>["analysis"], lines: readonly string[], marker: string) =>
    analysis.calls.find((c) => c.calleeName === "f" && c.location?.line === lineOf(lines, marker))!;

  it("leaves f() UNRESOLVED after a switch case that declares f (sloppy)", async () => {
    const { analysis, lines } = await analyze("function f() { return 0; }\nswitch (1) { case 1: function f() { return 1; } }\nf(); // OUT\n");
    expect(call(analysis, lines, "// OUT").resolutionState).toBe("UNRESOLVED");
  });

  it("leaves f() UNRESOLVED after a plain block that declares f (sloppy)", async () => {
    const { analysis, lines } = await analyze("function f() { return 0; }\n{ function f() { return 1; } }\nf(); // OUT\n");
    expect(call(analysis, lines, "// OUT").resolutionState).toBe("UNRESOLVED");
  });

  it("applies inside nested functions, to a name declared in an outer function", async () => {
    const { analysis, lines } = await analyze([
      "function f() { return 0; }",
      "function run(k) {",
      "  switch (k) { case 1: function f() { return 1; } }",
      "  f(); // OUT",
      "}",
    ].join("\n"));
    expect(call(analysis, lines, "// OUT").resolutionState).toBe("UNRESOLVED");
  });

  it("still resolves a call made inside the block to the block's function", async () => {
    const { analysis, lines } = await analyze("function f() { return 0; }\n{ function f() { return 1; } f(); // IN\n}\n");
    expect(call(analysis, lines, "// IN").resolutionState).toBe("RESOLVED");
  });

  it("keeps resolving when the code is strict: use strict directive", async () => {
    const { analysis, lines } = await analyze("'use strict';\nfunction f() { return 0; }\n{ function f() { return 1; } }\nf(); // OUT\n");
    expect(call(analysis, lines, "// OUT").resolutionState).toBe("RESOLVED");
  });

  it("keeps resolving in a function with its own use strict directive", async () => {
    const { analysis, lines } = await analyze("function f() { return 0; }\nfunction run() {\n  'use strict';\n  { function f() { return 1; } }\n  f(); // OUT\n}\n");
    expect(call(analysis, lines, "// OUT").resolutionState).toBe("RESOLVED");
  });

  it("keeps resolving in an ES module", async () => {
    const { analysis, lines } = await analyze("export {};\nfunction f() { return 0; }\nswitch (1) { case 1: function f() { return 1; } }\nf(); // OUT\n");
    expect(call(analysis, lines, "// OUT").resolutionState).toBe("RESOLVED");
  });
});
