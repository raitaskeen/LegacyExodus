import { describe, expect, it } from "bun:test";
import { JavaScriptParser } from "../../../src/parser/adapters/javascript/javascript-parser";
import { JavaScriptSymbolExtractor } from "../../../src/symbols/javascript-symbol-extractor";

async function extractSymbols(code: string) {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();
  const response = await parser.parse({
    file: {
      id: "f1",
      path: "test.js",
      language: "javascript",
      size: code.length,
    },
    source: code,
  });
  return extractor.extract(response.result);
}

describe("FINDING-SYM-03 — Scope-Aware Export Marking", () => {
  it("1. exports module-level binding and leaves shadowed inner binding as exported: false", async () => {
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

  it("2. exports inner binding when module.exports is assigned inside a nested function", async () => {
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

  it("3. isolates sibling scopes so only the enclosing scope binding is exported", async () => {
    const code = `
      function a() {
        const item = "a";
      }
      function b() {
        const item = "b";
        module.exports = item;
      }
    `;
    const table = await extractSymbols(code);
    const items = table.symbols.filter((s) => s.name === "item" && s.kind === "variable");
    expect(items.length).toBe(2);

    const exportedItem = items.find((s) => s.exported === true);
    const unexportedItem = items.find((s) => s.exported === false);

    expect(exportedItem).toBeDefined();
    expect(unexportedItem).toBeDefined();
  });

  it("4. exports local symbol referenced in object shorthand export at module level", async () => {
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

  it("5. exports local symbol in exports.handler assignment without touching shadowed helper", async () => {
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

  it("6. resolves outer variable when exported from inner scope without shadowing", async () => {
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

  it("7. does not crash or mark symbols when exporting an unknown dynamic expression", async () => {
    const code = `
      const a = 1;
      module.exports = nonExistentVariable;
    `;
    const table = await extractSymbols(code);
    const aSym = table.symbols.find((s) => s.name === "a");

    expect(aSym?.exported).toBe(false);
  });

  it("8. produces deterministic symbol ordering across repeated runs", async () => {
    const code = `
      const foo = 1;
      function build() { const foo = 2; module.exports = foo; }
    `;
    const table1 = await extractSymbols(code);
    const table2 = await extractSymbols(code);

    expect(JSON.stringify(table1)).toBe(JSON.stringify(table2));
  });

  it("9. preserves Express createApplication export pattern", async () => {
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

  it("10. preserves Fastify main export function pattern", async () => {
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
});
