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

describe("FINDING-SYM-02 — Deferred Function Assignment", () => {
  it("1. extracts function symbol from deferred function expression assignment", async () => {
    const code = `
      let handler;
      handler = function handleRequest(req, res) {
        return true;
      };
    `;
    const table = await extractSymbols(code);
    const fnSym = table.symbols.find((s) => s.name === "handler" && s.kind === "function");

    expect(fnSym).toBeDefined();
    expect(fnSym?.parameters).toEqual(["req", "res"]);
  });

  it("2. extracts function symbol from deferred arrow function assignment", async () => {
    const code = `
      let compute;
      compute = (a, b) => a + b;
    `;
    const table = await extractSymbols(code);
    const fnSym = table.symbols.find((s) => s.name === "compute" && s.kind === "function");

    expect(fnSym).toBeDefined();
    expect(fnSym?.parameters).toEqual(["a", "b"]);
  });

  it("3. handles reassignment from primitive to function", async () => {
    const code = `
      let action = null;
      action = function(event) {
        return event.type;
      };
    `;
    const table = await extractSymbols(code);
    const varSym = table.symbols.find((s) => s.name === "action" && s.kind === "variable");
    const fnSym = table.symbols.find((s) => s.name === "action" && s.kind === "function");

    expect(varSym).toBeDefined();
    expect(fnSym).toBeDefined();
    expect(fnSym?.parameters).toEqual(["event"]);
  });

  it("4. does NOT emit function symbol for non-function reassignment", async () => {
    const code = `
      let value = function() {};
      value = 123;
    `;
    const table = await extractSymbols(code);
    const vars = table.symbols.filter((s) => s.name === "value");
    const fns = vars.filter((s) => s.kind === "function");
    // Initial declaration emits 1 function symbol, reassignment to 123 does not emit a second function symbol
    expect(fns.length).toBe(1);
  });

  it("5. preserves lexical scope for shadowed deferred function assignment", async () => {
    const code = `
      let fn = 1;
      function outer() {
        let fn;
        fn = (x) => x;
      }
    `;
    const table = await extractSymbols(code);
    const outerLet = table.symbols.find((s) => s.name === "fn" && s.kind === "variable" && s.scopeId === "scope:module");
    const innerLet = table.symbols.find((s) => s.name === "fn" && s.kind === "variable" && s.scopeId !== "scope:module");
    const fnSym = table.symbols.find((s) => s.name === "fn" && s.kind === "function");

    expect(outerLet).toBeDefined();
    expect(innerLet).toBeDefined();
    expect(fnSym).toBeDefined();
    expect(fnSym?.scopeId).toBe(innerLet?.scopeId ?? "");
    expect(fnSym?.scopeId).not.toBe(outerLet?.scopeId ?? "");
  });

  it("6. extracts deferred function inside nested block", async () => {
    const code = `
      let logger;
      if (true) {
        logger = function log(msg) { console.log(msg); };
      }
    `;
    const table = await extractSymbols(code);
    const fnSym = table.symbols.find((s) => s.name === "logger" && s.kind === "function");

    expect(fnSym).toBeDefined();
    expect(fnSym?.parameters).toEqual(["msg"]);
  });

  it("7. does NOT fabricate function identity for dynamic assignments (NEGATIVE)", async () => {
    const code = `
      let router;
      router = createRouter();
    `;
    const table = await extractSymbols(code);
    const fnSym = table.symbols.find((s) => s.name === "router" && s.kind === "function");
    expect(fnSym).toBeUndefined();
  });

  it("8. preserves function parameters on anonymous deferred assignment", async () => {
    const code = `
      var callback;
      callback = (err, data) => {};
    `;
    const table = await extractSymbols(code);
    const fnSym = table.symbols.find((s) => s.name === "callback" && s.kind === "function");

    expect(fnSym).toBeDefined();
    expect(fnSym?.parameters).toEqual(["err", "data"]);
  });

  it("9. extracts deferred function symbols deterministically", async () => {
    const code = `
      let a; a = (x) => x;
      let b; b = function(y) { return y; };
    `;
    const table1 = await extractSymbols(code);
    const table2 = await extractSymbols(code);

    expect(JSON.stringify(table1)).toBe(JSON.stringify(table2));
  });

  it("10. marks deferred function as exported when module.exports exports the variable", async () => {
    const code = `
      let service;
      service = function execute(cmd) { return cmd; };
      module.exports = service;
    `;
    const table = await extractSymbols(code);
    const fnSym = table.symbols.find((s) => s.name === "service" && s.kind === "function");

    expect(fnSym).toBeDefined();
    expect(fnSym?.exported).toBe(true);
  });
});
