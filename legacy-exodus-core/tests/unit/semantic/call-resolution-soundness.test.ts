import { describe, expect, it } from "bun:test";

import { DeterministicDependencyGraphBuilder } from "@graph/index";
import { JavaScriptParser } from "@parser/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";
import { JavaScriptSymbolExtractor, type CodeSymbol } from "@symbols/index";

// F-002: RESOLVED is consumed as a proven call target (flow ProvenCallTarget).
// It must never name a target that a different execution of the same program
// can bypass. Each "unsound" case below has a concrete runtime counterexample.

const parser = new JavaScriptParser();
const extractor = new JavaScriptSymbolExtractor();

async function analyze(files: Readonly<Record<string, string>>) {
  const artifacts = Object.entries(files).map(([path, source]) => ({ id: path, path, language: "javascript", size: source.length }));
  const asts = await Promise.all(artifacts.map(async (file) => (await parser.parse({ file, source: files[file.path]! })).result!));
  const tables = asts.map((ast) => extractor.extract(ast));
  const dependencyGraph = new DeterministicDependencyGraphBuilder().build(tables, artifacts);
  const analysis = new DeterministicSemanticAnalysisEngine().analyze({ astResults: asts, dependencyGraph, symbolTables: tables });
  return { analysis, symbols: tables.flatMap((table) => table.symbols) };
}

async function callOf(source: string, calleeName: string, line?: number) {
  const { analysis, symbols } = await analyze({ "src/main.js": source });
  const calls = analysis.calls.filter((call) => call.calleeName === calleeName && (line === undefined || call.location?.line === line));
  expect(calls).toHaveLength(1);
  return { call: calls[0]!, symbols };
}

function method(symbols: readonly CodeSymbol[], name: string, containerName: string): CodeSymbol {
  const found = symbols.filter((symbol) => symbol.kind === "method" && symbol.name === name && symbol.containerName === containerName);
  expect(found).toHaveLength(1);
  return found[0]!;
}

describe("F-002 call resolution soundness: unsound targets are not RESOLVED", () => {
  it("does not resolve a receiver reassigned on one branch (A.m or B.m may run)", async () => {
    const { call } = await callOf(`
      class A { m() { return 1; } }
      class B { m() { return 2; } }
      let x = new A();
      if (Math.random() > 0.5) { x = new B(); }
      x.m();
    `, "x.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
    expect(call.targetSymbolId).toBeUndefined();
  });

  it("does not resolve a captured receiver that is reassigned after the closure is defined", async () => {
    const { call } = await callOf(`
      class A { m() { return 1; } }
      class B { m() { return 2; } }
      let a = new A();
      function run() { a.m(); }
      a = new B();
      run();
    `, "a.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a function binding that is reassigned", async () => {
    const { call } = await callOf(`
      function f() { return 1; }
      function g() { return 2; }
      f = g;
      f();
    `, "f", 5);
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a receiver overwritten by a for-of target", async () => {
    const { call } = await callOf(`
      class A { m() {} }
      class B { m() {} }
      let x = new A();
      for (x of [new B()]) {}
      x.m();
    `, "x.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve this.m() in a base class when a subclass may override it", async () => {
    const { call } = await callOf(`
      class Base { m() { return 1; } run() { return this.m(); } }
      class Derived extends Base { m() { return 2; } }
      new Derived().run();
    `, "this.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve this.method() on an object container whose method can be borrowed", async () => {
    // other.init() runs app.init with this === other, so this.helper() is other.helper.
    const { call } = await callOf(`
      const app = {};
      app.helper = function() { return "app"; };
      app.init = function() { return this.helper(); };
      const other = { helper() { return "other"; }, init: app.init };
      other.init();
    `, "this.helper");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a class method replaced on the prototype", async () => {
    const { call } = await callOf(`
      class A { m() { return 1; } }
      A.prototype.m = function() { return 2; };
      const x = new A();
      x.m();
    `, "x.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a class method shadowed by an instance property", async () => {
    const { call } = await callOf(`
      class A {
        constructor() { this.m = () => 2; }
        m() { return 1; }
      }
      const x = new A();
      x.m();
    `, "x.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a container method that is later redefined", async () => {
    const { call } = await callOf(`
      const app = {};
      app.init = function() { return 1; };
      app.init = 42;
      app.init();
    `, "app.init");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a container method through a rebound container binding", async () => {
    const { call } = await callOf(`
      let app = {};
      app.init = function() { return 1; };
      app = { init() { return 2; } };
      app.init();
    `, "app.init");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a required binding that is reassigned", async () => {
    const { analysis } = await analyze({
      "src/main.js": `
        let helper = require("./helper");
        helper = function replacement() {};
        helper();
      `,
      "src/helper.js": "module.exports = function helper() {};\n",
    });
    const call = analysis.calls.find((candidate) => candidate.calleeName === "helper");
    expect(call?.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve an undeclared (global) receiver, which any script can reassign", async () => {
    const { call } = await callOf(`
      class A { m() {} }
      x = new A();
      x.m();
    `, "x.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a method on an undeclared (global) container", async () => {
    const { call } = await callOf(`
      app.init = function() { return 1; };
      app.init();
    `, "app.init");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("keeps destructuring reassignment unresolved", async () => {
    const { call } = await callOf(`
      class A { m() {} }
      class B { m() {} }
      let x = new A();
      [x] = [new B()];
      x.m();
    `, "x.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });
});

describe("F-002 call resolution soundness: write ordering", () => {
  it("resolves a call that runs before any later reassignment in straight-line code", async () => {
    const { analysis, symbols } = await analyze({ "src/main.js": `
      class A { m() {} }
      let x = new A();
      x.m();
      x = other();
      x.m();
    ` });
    const calls = analysis.calls.filter((call) => call.calleeName === "x.m").sort((left, right) => left.location!.line - right.location!.line);
    expect(calls.map((call) => call.resolutionState)).toEqual(["RESOLVED", "UNRESOLVED"]);
    expect(calls[0]?.targetSymbolId).toBe(method(symbols, "m", "A").id);
  });

  it("resolves the latest unconditional write: a var receiver declared twice", async () => {
    const { call, symbols } = await callOf(`
      class A { m() {} }
      class B { m() {} }
      var x = new A();
      var x = new B();
      x.m();
    `, "x.m");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(method(symbols, "m", "B").id);
  });

  it("resolves a binding whose only write is a later assignment", async () => {
    const { call, symbols } = await callOf(`
      class A { m() {} }
      let x;
      x = new A();
      x.m();
    `, "x.m");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(method(symbols, "m", "A").id);
  });

  it("resolves a parameter overwritten unconditionally before the call", async () => {
    const { call, symbols } = await callOf(`
      class A { m() {} }
      function run(x) { x = new A(); return x.m(); }
    `, "x.m");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(method(symbols, "m", "A").id);
  });

  it("does not resolve a parameter used before it is overwritten", async () => {
    const { call } = await callOf(`
      class A { m() {} }
      function run(x) { x.m(); x = new A(); }
    `, "x.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a call inside a loop whose body later writes the receiver", async () => {
    const { call } = await callOf(`
      class A { m() {} }
      class B { m() {} }
      let x = new A();
      while (Math.random() > 0.5) { x.m(); x = new B(); }
    `, "x.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a receiver written inside a closure that may run first", async () => {
    const { call } = await callOf(`
      class A { m() {} }
      class B { m() {} }
      let x = new A();
      function swap() { x = new B(); }
      swap();
      x.m();
    `, "x.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a call in a class field initializer, which runs at construction time", async () => {
    const { call } = await callOf(`
      class A { m() {} }
      class B { m() {} }
      let x = new A();
      class K { y = x.m(); }
      x = new B();
      new K();
    `, "x.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve through a write inside try, which may not complete", async () => {
    const { call } = await callOf(`
      class A { m() {} }
      class B { m() {} }
      let x = new A();
      try { mayThrow(); x = new B(); } catch (error) {}
      x.m();
    `, "x.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a for-of variable reassigned later in the body", async () => {
    const { call } = await callOf(`
      class A { m() {} }
      for (let x of items) { x.m(); x = new A(); }
    `, "x.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });
});

describe("F-002 call resolution soundness: provable targets stay RESOLVED", () => {
  it("resolves a method on a const receiver created with new", async () => {
    const { call, symbols } = await callOf(`
      class A { m() { return 1; } }
      const x = new A();
      x.m();
    `, "x.m");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(method(symbols, "m", "A").id);
  });

  it("resolves a method on a let receiver that is never written again", async () => {
    const { call, symbols } = await callOf(`
      class A { m() { return 1; } }
      let x = new A();
      other.unrelated = 1;
      x.m();
    `, "x.m");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(method(symbols, "m", "A").id);
  });

  it("resolves a function declaration that is never rebound", async () => {
    const { call, symbols } = await callOf(`
      function f() { return 1; }
      f();
    `, "f");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(symbols.find((symbol) => symbol.kind === "function" && symbol.name === "f")?.id);
  });

  it("resolves this.#private() because private methods cannot be overridden or borrowed", async () => {
    const { call, symbols } = await callOf(`
      class A {
        #compute() { return 1; }
        run() { return this.#compute(); }
      }
    `, "this.#compute");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(method(symbols, "#compute", "A").id);
  });

  it("resolves a container method declared once on a binding that is never rebound", async () => {
    const { call, symbols } = await callOf(`
      const app = {};
      app.init = function() { return 42; };
      app.init();
    `, "app.init");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(method(symbols, "init", "app").id);
  });

  it("resolves a required binding that is never rebound", async () => {
    const { analysis } = await analyze({
      "src/main.js": `
        const helper = require("./helper");
        helper();
      `,
      "src/helper.js": "module.exports = function helper() {};\n",
    });
    const call = analysis.calls.find((candidate) => candidate.calleeName === "helper");
    expect(call?.resolutionState).toBe("RESOLVED");
  });

  it("resolves a callback-free nested call to an outer function that is never rebound", async () => {
    const { call, symbols } = await callOf(`
      function helper() { return 1; }
      function main() { return helper(); }
    `, "helper");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(symbols.find((symbol) => symbol.kind === "function" && symbol.name === "helper")?.id);
  });
});

// Red-team counterexamples on 7424525: each program runs a different function than the
// RESOLVED target, so the write evidence behind these proofs must see these writes.
async function callIn(files: Readonly<Record<string, string>>, path: string, calleeName: string) {
  const { analysis, symbols } = await analyze(files);
  const calls = analysis.calls.filter((call) => call.sourceFilePath === path && call.calleeName === calleeName);
  expect(calls).toHaveLength(1);
  return { call: calls[0]!, symbols };
}

describe("F-002 call resolution soundness: private member writes", () => {
  it("does not resolve this.#m() after a method reassigns the private field", async () => {
    // new C().run() calls the second arrow, not the field initializer.
    const { call } = await callOf(`
      class C {
        #m = () => 1;
        run() { this.#m = () => 2; return this.#m(); }
      }
    `, "this.#m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve this.#m() when the constructor reassigns the private field", async () => {
    const { call } = await callOf(`
      class C {
        #m = () => 1;
        constructor(replacement) { this.#m = replacement; }
        run() { return this.#m(); }
      }
    `, "this.#m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("keeps this.#m() resolved when only a public property of the same name is written", async () => {
    const { call, symbols } = await callOf(`
      class C {
        #m() { return 1; }
        run(other) { other.m = 2; return this.#m(); }
      }
    `, "this.#m");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(method(symbols, "#m", "C").id);
  });
});

describe("F-002 call resolution soundness: constructed class identity", () => {
  it("does not resolve new C() when a parameter shadows class C", async () => {
    // make(B) constructs a B, so c.m() runs B.prototype.m.
    const { call } = await callOf(`
      class B { m() { return 2; } }
      class C { m() { return 1; } }
      function make(C) { const c = new C(); return c.m(); }
      make(B);
    `, "c.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve new C() when a local binding shadows class C", async () => {
    const { call } = await callOf(`
      class B { m() { return 2; } }
      class C { m() { return 1; } }
      function make() { const C = B; const c = new C(); return c.m(); }
    `, "c.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("resolves new C() to the nearest class declaration when a block declares its own C", async () => {
    const { call, symbols } = await callOf(`
      class C { m() { return 1; } }
      {
        class C { m() { return 2; } }
        const c = new C();
        c.m();
      }
    `, "c.m");
    const inner = symbols.find((symbol) => symbol.kind === "method" && symbol.name === "m" && symbol.containerName === "C" && symbol.location?.start.line === 4);
    expect(inner).toBeDefined();
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(inner?.id);
  });
});

describe("F-002 call resolution soundness: computed and reflective property writes", () => {
  const unresolved = async (source: string): Promise<void> => {
    const { call } = await callOf(source, "c.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  };

  it("does not resolve after a string-keyed prototype write", async () => {
    await unresolved(`
      class C { m() { return 1; } }
      C.prototype["m"] = function () { return 2; };
      const c = new C(); c.m();
    `);
  });

  it("does not resolve after a constructor shadows the method with a string-keyed write", async () => {
    await unresolved(`
      class C { constructor() { this["m"] = () => 2; } m() { return 1; } }
      const c = new C(); c.m();
    `);
  });

  it("does not resolve after a computed write with a dynamic key, which may name the method", async () => {
    await unresolved(`
      class C { m() { return 1; } }
      function patch(name, fn) { C.prototype[name] = fn; }
      const c = new C(); c.m();
    `);
  });

  it("does not resolve after Object.assign copies a method onto the prototype", async () => {
    await unresolved(`
      class C { m() { return 1; } }
      Object.assign(C.prototype, { m() { return 2; } });
      const c = new C(); c.m();
    `);
  });

  it("does not resolve after Object.defineProperty redefines the method", async () => {
    await unresolved(`
      class C { m() { return 1; } }
      Object.defineProperty(C.prototype, "m", { value() { return 2; } });
      const c = new C(); c.m();
    `);
  });

  it("does not resolve after Reflect.set writes the method", async () => {
    await unresolved(`
      class C { m() { return 1; } }
      Reflect.set(C.prototype, "m", () => 2);
      const c = new C(); c.m();
    `);
  });

  it("does not resolve after an aliased Object.defineProperty redefines the method", async () => {
    await unresolved(`
      const { defineProperty } = Object;
      class C { m() { return 1; } }
      defineProperty(C.prototype, "m", { value() { return 2; } });
      const c = new C(); c.m();
    `);
  });

  it("does not resolve after the instance's prototype is replaced", async () => {
    await unresolved(`
      class B { m() { return 2; } }
      class C { m() { return 1; } }
      const c = new C();
      Object.setPrototypeOf(c, B.prototype);
      c.m();
    `);
  });

  it("does not resolve after the method is deleted, exposing an inherited one", async () => {
    // With C.prototype.m deleted, c.m() runs A.prototype.m.
    await unresolved(`
      class A { m() { return 1; } }
      class C extends A { m() { return 2; } }
      delete C.prototype.m;
      const c = new C(); c.m();
    `);
  });

  it("does not resolve a container method redefined with a string-keyed write", async () => {
    const { call } = await callOf(`
      const app = {};
      app.init = function() { return 1; };
      app["init"] = function() { return 2; };
      app.init();
    `, "app.init");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("keeps resolving when Object.assign only fills a fresh object", async () => {
    const { call, symbols } = await callOf(`
      class C { m() { return 1; } }
      const options = Object.assign({}, { m: 1 });
      const c = new C(); c.m();
    `, "c.m");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(method(symbols, "m", "C").id);
  });

  it("keeps resolving when a string-keyed write names a different property", async () => {
    const { call, symbols } = await callOf(`
      class C { m() { return 1; } }
      const c = new C();
      c["other"] = 1;
      c.m();
    `, "c.m");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(method(symbols, "m", "C").id);
  });

  it("keeps this.#m() resolved despite dynamic writes, which cannot reach private names", async () => {
    const { call, symbols } = await callOf(`
      class C {
        #m() { return 1; }
        run(key, value) { this[key] = value; Object.assign(this, value); return this.#m(); }
      }
    `, "this.#m");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(method(symbols, "#m", "C").id);
  });
});

describe("F-002 call resolution soundness: function-valued writes from nested scopes", () => {
  it("does not resolve a function that a nested function reassigns to another function", async () => {
    // swap() replaces f, so f() runs the arrow; the arrow's symbol declares no new f.
    const { call } = await callOf(`
      function f() { return 1; }
      function swap() { f = () => 2; }
      swap();
      f();
    `, "f");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve the assigned function inside the assigning scope when a later call may replace it", async () => {
    const { call } = await callOf(`
      let f = () => 0;
      function reset() { f = () => 3; }
      function swap() { f = () => 2; reset(); return f(); }
    `, "f");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });
});

describe("F-002 call resolution soundness: exports reassigned by their own module", () => {
  it("does not resolve an imported let that its module reassigns", async () => {
    // ES module imports are live: after swap(), f() runs the second arrow.
    const { call } = await callIn({
      "src/a.js": "export let f = () => 1;\nexport function swap() { f = () => 2; }\n",
      "src/b.js": "import { f, swap } from './a';\nswap();\nf();\n",
    }, "src/b.js", "f");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve an imported function declaration that its module reassigns", async () => {
    const { call } = await callIn({
      "src/a.js": "export function f() { return 1; }\nexport function swap() { f = () => 2; }\n",
      "src/b.js": "import { f, swap } from './a';\nswap();\nf();\n",
    }, "src/b.js", "f");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve an aliased export whose local binding is reassigned", async () => {
    const { call } = await callIn({
      "src/a.js": "function g() { return 1; }\nexport function swap() { g = () => 2; }\nexport { g as f };\n",
      "src/b.js": "import { f, swap } from './a';\nswap();\nf();\n",
    }, "src/b.js", "f");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a re-exported function that its declaring module reassigns", async () => {
    const { call } = await callIn({
      "src/a.js": "export function f() { return 1; }\nexport function swap() { f = () => 2; }\n",
      "src/index.js": "export { f, swap } from './a';\n",
      "src/b.js": "import { f, swap } from './index';\nswap();\nf();\n",
    }, "src/b.js", "f");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a namespace member that its module reassigns", async () => {
    const { call } = await callIn({
      "src/a.js": "export function f() { return 1; }\nexport function swap() { f = () => 2; }\n",
      "src/b.js": "import * as ns from './a';\nns.swap();\nns.f();\n",
    }, "src/b.js", "ns.f");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a CommonJS module whose exports are assigned twice", async () => {
    // require() returns the last module.exports value.
    const { call } = await callIn({
      "src/helper.js": "module.exports = function first() {};\nmodule.exports = function second() {};\n",
      "src/main.js": "const helper = require('./helper');\nhelper();\n",
    }, "src/main.js", "helper");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("keeps resolving a CommonJS module that also exposes itself as a property (fastify's pattern)", async () => {
    // module.exports.default names a property of the exported function; require() still returns it.
    const { call } = await callIn({
      "src/helper.js": "function helper() {}\nmodule.exports = helper;\nmodule.exports.helper = helper;\nmodule.exports.default = helper;\n",
      "src/main.js": "const helper = require('./helper');\nhelper();\n",
    }, "src/main.js", "helper");
    expect(call.resolutionState).toBe("RESOLVED");
  });

  it("keeps resolving an imported function that its module never reassigns", async () => {
    const { call } = await callIn({
      "src/a.js": "export function f() { return 1; }\nexport function g() { return 2; }\n",
      "src/b.js": "import { f } from './a';\nf();\n",
    }, "src/b.js", "f");
    expect(call.resolutionState).toBe("RESOLVED");
  });

  it("keeps resolving a namespace member that its module never reassigns", async () => {
    const { call } = await callIn({
      "src/a.js": "export function f() { return 1; }\n",
      "src/b.js": "import * as ns from './a';\nns.f();\n",
    }, "src/b.js", "ns.f");
    expect(call.resolutionState).toBe("RESOLVED");
  });
});

// A container method is proven only on the binding it was defined on; another binding
// with the same name (a parameter, block local or catch parameter) may hold any object.
describe("F-002 call resolution soundness: container binding identity", () => {
  it("does not resolve a container method through a parameter that shadows the container", async () => {
    // run() receives another object, so its own init runs.
    const { call } = await callOf(`
      const app = {};
      app.init = function () { return 1; };
      function run(app) { return app.init(); }
      run({ init: () => 2 });
    `, "app.init");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a container method through a block binding that shadows the container", async () => {
    const { call } = await callOf(`
      function make() { return { init() { return 2; } }; }
      const app = {};
      app.init = function () { return 1; };
      { const app = make(); app.init(); }
    `, "app.init");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a container method through a catch parameter that shadows the container", async () => {
    const { call } = await callOf(`
      const app = {};
      app.init = function () { return 1; };
      try { throw { init: () => 2 }; } catch (app) { app.init(); }
    `, "app.init");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a module binding's method from a definition on a block binding of the same name", async () => {
    const { call } = await callOf(`
      function make() { return { init() { return 2; } }; }
      const app = make();
      { const app = {}; app.init = function () { return 1; }; }
      app.init();
    `, "app.init");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a module binding's method from a definition on a parameter of the same name", async () => {
    // decorate() is never called on the module app, which keeps make()'s init.
    const { call } = await callOf(`
      function make() { return { init() { return 2; } }; }
      function decorate(app) { app.init = function () { return 1; }; }
      const app = make();
      app.init();
    `, "app.init");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a parameter's method from a definition on a local of the same name (fastify's logger.child)", async () => {
    // childOf() receives a pino logger, not the null logger that create() decorates.
    const { call } = await callOf(`
      function childOf(logger) { return logger.child(); }
      function create() { const logger = {}; logger.child = () => logger; return logger; }
      childOf({ child: () => 2 });
    `, "logger.child");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not resolve a static method through a parameter that shadows the class", async () => {
    const { call } = await callOf(`
      class C { static m() { return 1; } }
      function run(C) { return C.m(); }
      run({ m: () => 2 });
    `, "C.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("keeps resolving a container method called from a nested function that does not shadow it", async () => {
    const { call, symbols } = await callOf(`
      const app = {};
      app.init = function () { return 1; };
      function run() { return app.init(); }
    `, "app.init");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(method(symbols, "init", "app").id);
  });

  it("keeps resolving a container method defined from a nested function on the outer binding", async () => {
    const { call, symbols } = await callOf(`
      const app = {};
      function setup() { app.init = function () { return 1; }; }
      setup();
      app.init();
    `, "app.init");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(method(symbols, "init", "app").id);
  });

  it("keeps resolving a container method defined and called on the same block binding", async () => {
    const { call, symbols } = await callOf(`
      { const app = {}; app.init = function () { return 1; }; app.init(); }
    `, "app.init");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(method(symbols, "init", "app").id);
  });

  it("keeps resolving the outer container's method when an unrelated function has a parameter of the same name", async () => {
    const { call, symbols } = await callOf(`
      const app = {};
      app.init = function () { return 1; };
      function other(app) { return app; }
      app.init();
    `, "app.init");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(method(symbols, "init", "app").id);
  });

  it("keeps resolving a static method called through the class from a nested function", async () => {
    const { call, symbols } = await callOf(`
      class C { static m() { return 1; } }
      function run() { return C.m(); }
    `, "C.m");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(method(symbols, "m", "C").id);
  });
});

// Member symbols (`o.x = …`, object literal keys) and export records share names with
// bindings but declare none; taken for declarations they hide writes to the real binding.
describe("F-002 call resolution soundness: only declarations name bindings", () => {
  it("does not take a member write for the receiver's declaration", async () => {
    // swap() writes the module x between `x = new A()` and the call, so B.m runs.
    const { call } = await callOf(`
      class A { m() { return 1; } }
      class B { m() { return 2; } }
      const o = {};
      let x;
      function swap() { x = new B(); }
      function run() { o.x = 1; x = new A(); swap(); x.m(); }
    `, "x.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not take an object literal key for the receiver's declaration", async () => {
    const { call } = await callOf(`
      class A { m() { return 1; } }
      class B { m() { return 2; } }
      let x;
      function swap() { x = new B(); }
      function run() { const o = { x: 1 }; x = new A(); swap(); x.m(); }
    `, "x.m");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("does not take a member write for the container's declaration", async () => {
    // app is rebound before run() calls it, so the second init runs.
    const { call } = await callOf(`
      let app = {};
      app.init = function () { return 1; };
      const o = {};
      function run() { o.app = 1; app.init(); }
      app = { init() { return 2; } };
    `, "app.init");
    expect(call.resolutionState).toBe("UNRESOLVED");
  });

  it("keeps resolving new C() for an exported class", async () => {
    const { call, symbols } = await callOf(`
      export class C { m() { return 1; } }
      const c = new C();
      c.m();
    `, "c.m");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(method(symbols, "m", "C").id);
  });

  it("keeps resolving a static method of an exported class", async () => {
    const { call, symbols } = await callOf(`
      export class C { static m() { return 1; } }
      C.m();
    `, "C.m");
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(method(symbols, "m", "C").id);
  });
});

// `app.init = f` proves `app.init()` only if the call cannot run while app holds another
// init: before the definition, on a path that skips it, or with a value that had one.
describe("F-002 call resolution soundness: container methods called before their definition", () => {
  const make = "function make() { return { init() { return 2; } }; }";
  const unresolved = async (source: string, calleeName = "app.init"): Promise<void> => {
    const { call } = await callOf(source, calleeName);
    expect(call.resolutionState).toBe("UNRESOLVED");
  };
  const resolvedToDefinition = async (source: string, calleeName = "app.init"): Promise<void> => {
    const [receiver, name] = calleeName.split(".") as [string, string];
    const { call, symbols } = await callOf(source, calleeName);
    expect(call.resolutionState).toBe("RESOLVED");
    expect(call.targetSymbolId).toBe(method(symbols, name, receiver).id);
  };

  it("does not resolve a call before the definition on an object that already has the method", async () => {
    await unresolved(`${make}\nconst app = make();\napp.init();\napp.init = function () { return 1; };`);
  });

  it("does not resolve a call before the definition on a parameter", async () => {
    await unresolved("function setup(app) { app.init(); app.init = function () { return 1; }; }");
  });

  it("does not resolve a call after a definition that runs on one branch only", async () => {
    await unresolved(`${make}\nconst app = make();\nif (process.env.FLAG) app.init = function () { return 1; };\napp.init();`);
  });

  it("does not resolve a call before the function that defines the method runs", async () => {
    await unresolved(`${make}\nconst app = make();\nfunction setup() { app.init = function () { return 1; }; }\napp.init();\nsetup();`);
  });

  it("does not resolve a call from a function that may run before the definition", async () => {
    await unresolved(`${make}\nconst app = make();\nfunction run() { return app.init(); }\nrun();\napp.init = function () { return 1; };`);
  });

  it("does not resolve a method a fresh object inherits from Object.prototype", async () => {
    await unresolved("const app = {};\napp.toString();\napp.toString = function () { return 1; };", "app.toString");
  });

  it("does not resolve on an object literal that sets its prototype", async () => {
    await unresolved("const app = { __proto__: { init() { return 2; } } };\napp.init();\napp.init = function () { return 1; };");
  });

  it("does not resolve on an object literal that spreads another object", async () => {
    await unresolved("const base = { init() { return 2; } };\nconst app = { ...base };\napp.init();\napp.init = function () { return 1; };");
  });

  it("does not resolve on an object literal with a computed key, which may name the method", async () => {
    await unresolved("const key = 'init';\nconst app = { [key]: () => 2 };\napp.init();\napp.init = function () { return 1; };");
  });

  it("does not resolve on a class that inherits a static method of the same name", async () => {
    await unresolved("class B { static m() { return 2; } }\nclass C extends B {}\nC.m();\nC.m = function () { return 1; };", "C.m");
  });

  it("keeps resolving a call from another function on a function container, which cannot have the method yet", async () => {
    await resolvedToDefinition("function app() {}\napp.init = function () { return 1; };\nfunction run() { return app.init(); }");
  });

  it("keeps resolving when the definition always runs first in the call's function", async () => {
    await resolvedToDefinition(`${make}\nconst app = make();\napp.init = function () { return 1; };\napp.init();`);
  });

  it("keeps resolving on a parameter when the definition always runs first", async () => {
    await resolvedToDefinition("function setup(app) { app.init = function () { return 1; }; app.init(); }");
  });

  it("keeps resolving a call inside the defined function, which exists only once the definition ran (express route-map)", async () => {
    await resolvedToDefinition(`${make}\nconst app = make();\napp.init = function (depth) { if (depth > 0) app.init(depth - 1); };`);
  });
});

// Counterexamples from the independent red-team review of efe425a. Each program was executed
// and a different function ran than the one the call graph claimed.
describe("F-002 call resolution soundness: independent review counterexamples", () => {
  async function analyzeFiles(files: Readonly<Record<string, string>>) {
    const artifacts = Object.entries(files).map(([path, source]) => ({ id: path, path, language: path.endsWith(".ts") ? "typescript" : "javascript", size: source.length }));
    const asts = await Promise.all(artifacts.map(async (file) => (await parser.parse({ file, source: files[file.path]! })).result!));
    const tables = asts.map((ast) => extractor.extract(ast));
    const dependencyGraph = new DeterministicDependencyGraphBuilder().build(tables, artifacts);
    const analysis = new DeterministicSemanticAnalysisEngine().analyze({ astResults: asts, dependencyGraph, symbolTables: tables });
    return { analysis, symbols: tables.flatMap((table) => table.symbols) };
  }
  function markedLine(files: Readonly<Record<string, string>>, file: string, marker: string): number {
    const line = files[file]!.split("\n").findIndex((text) => text.includes(marker)) + 1;
    expect(line).toBeGreaterThan(0);
    return line;
  }
  // Every call recorded on the marked line must stay unproven.
  async function unproven(files: Readonly<Record<string, string>>, file: string, marker: string) {
    const line = markedLine(files, file, marker);
    const { analysis } = await analyzeFiles(files);
    const calls = analysis.calls.filter((call) => call.sourceFilePath === file && call.location?.line === line);
    expect(calls.filter((call) => call.resolutionState === "RESOLVED").map((call) => call.calleeName)).toEqual([]);
  }
  async function resolvedOn(files: Readonly<Record<string, string>>, file: string, marker: string, calleeName: string) {
    const line = markedLine(files, file, marker);
    const { analysis, symbols } = await analyzeFiles(files);
    const calls = analysis.calls.filter((call) => call.sourceFilePath === file && call.location?.line === line && call.calleeName === calleeName);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.resolutionState).toBe("RESOLVED");
    return symbols.find((symbol) => symbol.id === calls[0]!.targetSymbolId)!;
  }
  const js = (source: string) => ({ "src/main.js": source });
  const ts = (source: string) => ({ "src/main.ts": source });

  describe("new C() does not always produce a C instance", () => {
    it("a constructor that returns another object", async () => {
      await unproven(js(`
        const impostor = { m() { return "impostor"; } };
        class C { constructor() { return impostor; } m() { return "C"; } }
        const c = new C();
        c.m(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("a base-class constructor that returns another object", async () => {
      await unproven(js(`
        const impostor = { m() { return "impostor"; } };
        class Base { constructor() { return impostor; } }
        class C extends Base { m() { return "C"; } }
        const c = new C();
        c.m(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("a superclass the file does not declare", async () => {
      await unproven(js(`
        import { Base } from "./base";
        class C extends Base { m() { return "C"; } }
        const c = new C();
        c.m(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("control: a derived class whose local base neither returns nor defines the method", async () => {
      const target = await resolvedOn(js(`
        class Base { constructor() { this.ready = true; } }
        class C extends Base { constructor() { super(); return; } m() { return "C"; } }
        const c = new C();
        c.m(); // CALL
      `), "src/main.js", "// CALL", "c.m");
      expect(target).toMatchObject({ kind: "method", name: "m", containerName: "C" });
    });
  });

  describe("instance fields shadow prototype methods", () => {
    it("an own field with the method name", async () => {
      await unproven(js(`
        function make() { return function () { return "field"; }; }
        class C { m = make(); m() { return "C"; } }
        const c = new C();
        c.m(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("a base-class field with the method name", async () => {
      await unproven(js(`
        class Base { m = () => "base field"; }
        class C extends Base { m() { return "C"; } }
        const c = new C();
        c.m(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("control: a field initialized with a function and never otherwise written", async () => {
      const target = await resolvedOn(js(`
        class C { m = () => "field"; }
        const c = new C();
        c.m(); // CALL
      `), "src/main.js", "// CALL", "c.m");
      expect(target).toMatchObject({ kind: "method", name: "m", containerName: "C" });
    });
  });

  describe("call and apply are ordinary properties", () => {
    it("a function whose own call property was replaced", async () => {
      await unproven(js(`
        function f() { return "f"; }
        f.call = function () { return "own call"; };
        f.call(null); // CALL
      `), "src/main.js", "// CALL");
    });

    it("a method whose apply property was replaced", async () => {
      await unproven(js(`
        class A { m() { return "A"; } }
        const a = new A();
        A.prototype.m.apply = function () { return "own apply"; };
        a.m.apply(a, []); // CALL
      `), "src/main.js", "// CALL");
    });

    it("control: call on a function whose call property is never written", async () => {
      const target = await resolvedOn(js(`
        function f() { return "f"; }
        f.call(null); // CALL
      `), "src/main.js", "// CALL", "f");
      expect(target).toMatchObject({ kind: "function", name: "f" });
    });
  });

  describe("only members declared in the class body are its methods", () => {
    it("an object literal method inside a class method", async () => {
      await unproven(js(`
        class C { make() { return { toString() { return "literal"; } }; } }
        const c = new C();
        c.toString(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("an object literal method inside a derived class method", async () => {
      await unproven(js(`
        class Base { only() { return "Base"; } }
        class C extends Base { make() { return { only() { return "literal"; } }; } }
        const c = new C();
        c.only(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("a method of a class expression inside a class method", async () => {
      await unproven(js(`
        class Base { only() { return "Base"; } }
        class Outer extends Base { make() { return class { only() { return "expr"; } }; } }
        const o = new Outer();
        o.only(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("an instance method called on the class", async () => {
      await unproven(js(`
        class B { static m() { return "static"; } }
        class C extends B { m() { return "instance"; } }
        C.m(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("a getter called as a method", async () => {
      await unproven(js(`
        class C { get m() { return () => "returned"; } }
        const c = new C();
        c.m(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("control: a class declaration's own private call beside a same-named class expression", async () => {
      const target = await resolvedOn(js(`
        class Inner { #m() { return "declaration"; } go() { return this.#m(); } } // CALL
        const K = class Inner { #m() { return "expression"; } };
      `), "src/main.js", "// CALL", "this.#m");
      expect(target).toMatchObject({ kind: "method", name: "#m", containerName: "Inner" });
      expect(target.location?.start.line).toBe(2);
    });
  });

  describe("scopes the symbol table does not model", () => {
    it("a lexical declaration in a switch case shadowing an outer receiver", async () => {
      await unproven(js(`
        class A { m() { return "A"; } }
        class B { m() { return "B"; } }
        const x = new A();
        function test(k) {
          switch (k) { case 0: const x = new B(); x.m(); }
          x.m(); // CALL
        }
        test(1);
      `), "src/main.js", "// CALL");
    });

    it("a write past a switch-case declaration to the outer function", async () => {
      await unproven(js(`
        function f() { return "declared"; }
        function test(k) {
          switch (k) { case 0: let f = 1; }
          f = function () { return "rewritten"; };
        }
        test(1);
        f(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("a declaration in a class static block", async () => {
      await unproven(js(`
        class A { m() { return "A"; } }
        class B { m() { return "B"; } }
        globalThis.x = new A();
        class K { static { const x = new B(); } }
        x.m(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("a parameter default that closes over a name the body redeclares with var", async () => {
      await unproven(js(`
        class A { m() { return "A"; } }
        class B { m() { return "B"; } }
        var x = new A();
        function f(g = () => x.m()) { // CALL
          var x = new B();
          return g();
        }
        f();
      `), "src/main.js", "// CALL");
    });

    it("a named function expression calling its own name", async () => {
      await unproven(js(`
        function f() { return "outer"; }
        const g = function f(n) {
          if (n > 0) return f(0); // CALL
          return "inner";
        };
        g(1);
      `), "src/main.js", "// CALL");
    });

    it("a named class expression constructing its own name", async () => {
      await unproven(js(`
        class C { constructor() { this.v = "outer"; } }
        const K = class C {
          static make() { return new C(); } // CALL
        };
        K.make();
      `), "src/main.js", "// CALL");
    });

    it("a private method of a class expression named like a class declaration", async () => {
      await unproven(js(`
        class Inner { #m() { return "declaration"; } }
        const K = class Inner {
          #m() { return "expression"; }
          go() { return this.#m(); } // CALL
        };
        new K().go();
      `), "src/main.js", "// CALL");
    });

    it("control: a receiver declared outside a switch", async () => {
      const target = await resolvedOn(js(`
        class A { m() { return "A"; } }
        function test(k) {
          const x = new A();
          switch (k) { case 0: x.m(); } // CALL
        }
      `), "src/main.js", "// CALL", "x.m");
      expect(target).toMatchObject({ kind: "method", name: "m", containerName: "A" });
    });
  });

  describe("module imports are only visible where they are declared", () => {
    it("a require inside a function does not name a module-level call", async () => {
      // The module-level h is the local function; the required module is bound only inside lazy().
      const target = await resolvedOn({
        "src/helper.js": `module.exports = function helper() { return "helper"; };\n`,
        "src/main.js": `
          function h() { return "local"; }
          function lazy() { const h = require("./helper"); return h; }
          h(); // CALL
        `,
      }, "src/main.js", "// CALL", "h");
      expect(target).toMatchObject({ kind: "function", name: "h", filePath: "src/main.js" });
    });

    it("control: a module-level require still resolves to the required module", async () => {
      const target = await resolvedOn({
        "src/helper.js": `module.exports = function helper() { return "helper"; };\n`,
        "src/main.js": `
          const h = require("./helper");
          h(); // CALL
        `,
      }, "src/main.js", "// CALL", "h");
      expect(target.filePath).toBe("src/helper.js");
    });
  });

  describe("constant keys respect hoisting", () => {
    it("a computed key whose constant is shadowed by a hoisted var", async () => {
      await unproven(js(`
        class A { m() { return "m"; } undefined() { return "undefined"; } }
        const x = new A();
        const k = "m";
        function run() { x[k](); var k = "zzz"; } // CALL
        run();
      `), "src/main.js", "// CALL");
    });
  });

  describe("TypeScript write targets", () => {
    it("an assignment through an as-expression", async () => {
      await unproven(ts(`
        class A { m() { return "A"; } }
        class B { m() { return "B"; } }
        let x: any = new A();
        function swap() { (x as any) = new B(); }
        swap();
        x.m(); // CALL
      `), "src/main.ts", "// CALL");
    });

    it("an assignment through a non-null assertion", async () => {
      await unproven(ts(`
        class A { m() { return "A"; } }
        class B { m() { return "B"; } }
        let y: any = new A();
        function swap() { y! = new B(); }
        swap();
        y.m(); // CALL
      `), "src/main.ts", "// CALL");
    });

    it("a constructor parameter property", async () => {
      await unproven(ts(`
        class A { m() { return "A"; } }
        class B { m() { return "B"; } }
        class C {
          constructor(private svc: any) {
            svc.m(); // CALL
            svc = new A();
          }
        }
        new C(new B());
      `), "src/main.ts", "// CALL");
    });
  });

  describe("decorators", () => {
    it("a decorated method may be replaced", async () => {
      await unproven(ts(`
        const replacement = function () { return "decorated"; };
        function replace(...args: any[]): any { return args.length === 3 ? { ...args[2], value: replacement } : replacement; }
        class C { @replace m() { return "C"; } }
        const c = new C();
        c.m(); // CALL
      `), "src/main.ts", "// CALL");
    });

    it("a decorated class may be replaced", async () => {
      await unproven(ts(`
        function swap(target: any): any { return class { m() { return "replacement"; } }; }
        @swap class C { m() { return "C"; } }
        const c = new C();
        c.m(); // CALL
      `), "src/main.ts", "// CALL");
    });
  });

  describe("logical assignment defines only when the property is missing", () => {
    it("??= on an object that already has the method", async () => {
      await unproven(js(`
        function make() { return { init() { return "make"; } }; }
        const app = make();
        app.init ??= function () { return "nullish"; };
        app.init(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("||= on an object that already has the method", async () => {
      await unproven(js(`
        function make() { return { init() { return "make"; } }; }
        const svc = make();
        svc.init ||= function () { return "or"; };
        svc.init(); // CALL
      `), "src/main.js", "// CALL");
    });

    it("control: ??= on a fresh object without the method", async () => {
      const target = await resolvedOn(js(`
        const app = {};
        app.init ??= function () { return "nullish"; };
        app.init(); // CALL
      `), "src/main.js", "// CALL", "app.init");
      expect(target).toMatchObject({ name: "init" });
    });
  });
});
