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
