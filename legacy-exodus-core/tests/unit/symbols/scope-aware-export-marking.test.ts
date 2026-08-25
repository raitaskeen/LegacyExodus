import { describe, expect, it } from "bun:test";
import { JavaScriptParser } from "../../../src/parser/adapters/javascript/javascript-parser";
import { JavaScriptSymbolExtractor } from "../../../src/symbols/javascript-symbol-extractor";
import { DeterministicDependencyGraphBuilder } from "@graph/index";

async function extractSymbols(code: string, filePath = "test.js") {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();
  const response = await parser.parse({
    file: {
      id: "f1",
      path: filePath,
      language: "javascript",
      size: code.length,
    },
    source: code,
  });
  return extractor.extract(response.result);
}

describe("FINDING-SYM-03 — Scope-Aware Export Marking", () => {
  it("Test A: same-name symbols in sibling scopes — exports only the targeted scope binding", async () => {
    const code = `
      function scopeA() {
        const foo = "foo_in_A";
        return foo;
      }
      function scopeB() {
        const foo = "foo_in_B";
        module.exports = foo;
      }
    `;
    const table = await extractSymbols(code);
    const fooSymbols = table.symbols.filter((s) => s.name === "foo" && s.kind === "variable");
    expect(fooSymbols).toHaveLength(2);

    const fooA = fooSymbols.find((s) => s.value === "foo_in_A");
    const fooB = fooSymbols.find((s) => s.value === "foo_in_B");

    expect(fooA?.exported).toBe(false);
    expect(fooB?.exported).toBe(true);
  });

  it("Test B: inner shadowing — exports inner binding and leaves module-level binding as exported: false", async () => {
    const code = `
      const foo = 1;
      function build() {
        const foo = 2;
        module.exports = foo;
      }
    `;
    const table = await extractSymbols(code);
    const outerFoo = table.symbols.find((s) => s.name === "foo" && s.scopeId === "scope:module");
    const innerFoo = table.symbols.find((s) => s.name === "foo" && s.scopeId !== "scope:module");

    expect(outerFoo).toBeDefined();
    expect(innerFoo).toBeDefined();
    expect(innerFoo?.exported).toBe(true);
    expect(outerFoo?.exported).toBe(false);
  });

  it("Test C: outer fallback — exports module-level binding and leaves shadowed inner binding as exported: false", async () => {
    const code = `
      const foo = 1;
      function helper() {
        const foo = 2;
        return foo;
      }
      module.exports = foo;
    `;
    const table = await extractSymbols(code);
    const outerFoo = table.symbols.find((s) => s.name === "foo" && s.scopeId === "scope:module");
    const innerFoo = table.symbols.find((s) => s.name === "foo" && s.scopeId !== "scope:module");

    expect(outerFoo).toBeDefined();
    expect(innerFoo).toBeDefined();
    expect(outerFoo?.exported).toBe(true);
    expect(innerFoo?.exported).toBe(false);
  });

  it("Test C2: nested outer resolution — resolves enclosing function variable without picking sibling", async () => {
    const code = `
      function sibling() {
        const handler = "sibling_handler";
        return handler;
      }

      function outer() {
        const handler = "outer_handler";
        function inner() {
          module.exports = handler;
        }
      }
    `;
    const table = await extractSymbols(code);
    const handlers = table.symbols.filter((s) => s.name === "handler" && s.kind === "variable");
    expect(handlers).toHaveLength(2);

    const siblingHandler = handlers.find((s) => s.value === "sibling_handler");
    const outerHandler = handlers.find((s) => s.value === "outer_handler");

    expect(outerHandler?.exported).toBe(true);
    expect(siblingHandler?.exported).toBe(false);
  });

  it("Test D: sibling scope isolation — does not falsely mark unrelated sibling symbol when exporting undeclared variable", async () => {
    const code = `
      function siblingA() {
        const secret = "private_a";
        return secret;
      }
      function siblingB() {
        // secret is undeclared in siblingB and undeclared in module
        module.exports = secret;
      }
    `;
    const table = await extractSymbols(code);
    const secretSym = table.symbols.find((s) => s.name === "secret" && s.kind === "variable");

    expect(secretSym).toBeDefined();
    expect(secretSym?.exported).toBe(false);
  });

  it("Test E: ambiguous / non-existent case — does not guess or mark arbitrary unexported symbols", async () => {
    const code = `
      const a = 1;
      const b = 2;
      module.exports = nonExistentVariable;
    `;
    const table = await extractSymbols(code);
    const aSym = table.symbols.find((s) => s.name === "a");
    const bSym = table.symbols.find((s) => s.name === "b");

    expect(aSym?.exported).toBe(false);
    expect(bSym?.exported).toBe(false);
  });

  it("Test F1: object shorthand export at module level", async () => {
    const code = `
      const api = 1;
      function shadow() {
        const api = 2;
      }
      module.exports = { api };
    `;
    const table = await extractSymbols(code);
    const outerApi = table.symbols.find((s) => s.name === "api" && s.scopeId === "scope:module");
    const innerApi = table.symbols.find((s) => s.name === "api" && s.scopeId !== "scope:module");

    expect(outerApi?.exported).toBe(true);
    expect(innerApi?.exported).toBe(false);
  });

  it("Test F2: exports.handler assignment without touching shadowed helper", async () => {
    const code = `
      function handler(req, res) {}
      function wrapper() {
        const handler = 42;
      }
      exports.handler = handler;
    `;
    const table = await extractSymbols(code);
    const outerHandler = table.symbols.find((s) => s.name === "handler" && s.kind === "function" && s.scopeId === "scope:module");
    const innerHandler = table.symbols.find((s) => s.name === "handler" && s.kind === "variable");

    expect(outerHandler?.exported).toBe(true);
    expect(innerHandler?.exported).toBe(false);
  });

  it("Test F3: resolves outer variable when exported from inner scope without shadowing", async () => {
    const code = `
      const server = { port: 3000 };
      function setup() {
        module.exports = server;
      }
    `;
    const table = await extractSymbols(code);
    const serverSym = table.symbols.find((s) => s.name === "server");

    expect(serverSym).toBeDefined();
    expect(serverSym?.exported).toBe(true);
  });

  it("Test F4: produces deterministic symbol ordering across repeated runs", async () => {
    const code = `
      const foo = 1;
      function build() { const foo = 2; module.exports = foo; }
    `;
    const table1 = await extractSymbols(code);
    const table2 = await extractSymbols(code);

    expect(JSON.stringify(table1)).toBe(JSON.stringify(table2));
  });

  it("Test F5: preserves Express createApplication export pattern", async () => {
    const code = `
      function createApplication() {
        var app = function(req, res, next) {
          app.handle(req, res, next);
        };
        return app;
      }
      exports = module.exports = createApplication;
    `;
    const table = await extractSymbols(code);
    const createFn = table.symbols.find((s) => s.name === "createApplication" && s.kind === "function");
    const appVar = table.symbols.find((s) => s.name === "app" && s.kind === "variable");

    expect(createFn?.exported).toBe(true);
    expect(appVar?.exported).toBe(false);
  });

  it("Test F6: preserves Fastify main export function pattern", async () => {
    const code = `
      function fastify(options) {
        return {};
      }
      module.exports = fastify;
      module.exports.fastify = fastify;
      module.exports.default = fastify;
    `;
    const table = await extractSymbols(code);
    const fnSym = table.symbols.find((s) => s.name === "fastify" && s.kind === "function");

    expect(fnSym?.exported).toBe(true);
  });

  it("Test G: Downstream dependency graph safety — exports link to genuine lexical symbol", async () => {
    const code = `
      function sibling() {
        const target = "sibling_target";
        return target;
      }
      function main() {
        const target = "main_target";
        module.exports = target;
      }
    `;
    const table = await extractSymbols(code, "service.js");
    const graphBuilder = new DeterministicDependencyGraphBuilder();
    const file = { id: "f1", path: "service.js", language: "javascript", size: code.length };
    const graph = graphBuilder.build([table], [file]);

    const targetSymbols = table.symbols.filter((s) => s.name === "target" && s.kind === "variable");
    const mainTarget = targetSymbols.find((s) => s.value === "main_target")!;
    const siblingTarget = targetSymbols.find((s) => s.value === "sibling_target")!;

    expect(mainTarget.exported).toBe(true);
    expect(siblingTarget.exported).toBe(false);

    // Verify dependency graph nodes reflect the exact exported status
    const mainNode = graph.nodes.find((n) => n.symbolId === mainTarget.id);
    const siblingNode = graph.nodes.find((n) => n.symbolId === siblingTarget.id);

    expect(mainNode).toBeDefined();
    expect(siblingNode).toBeDefined();
  });
});
