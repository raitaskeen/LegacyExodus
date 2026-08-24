/**
 * Milestone P1.7A — Failure-First Test Suite
 *
 * Prototype and Property-Assignment Symbol Granularity
 *
 * Covers:
 * 1. Direct property assignment: obj.prop = val
 * 2. Function-expression property assignment: proto.handle = function handle() {}
 * 3. Named function assignment: app.listen = listen
 * 4. Aliased property assignment: exports.application = proto
 * 5. Prototype assignment: proto.route = function route() {}
 * 6. Exported prototype/property assignment where statically provable: exports.json = bodyParser.json
 * 7. Dynamic computed property negative case: obj[dynamicName] = fn (must NOT invent symbol)
 * 8. Duplicate assignment behavior (distinct source locations / IDs)
 * 9. Deterministic ordering across invocations
 * 10. Source-location preservation
 */

import { describe, expect, it } from "bun:test";
import { JavaScriptParser, type ParseRequest } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";

describe("Milestone P1.7A — Prototype & Property Symbol Extraction", () => {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();

  function createRequest(source: string, path = "src/module.js"): ParseRequest {
    return {
      file: {
        id: path,
        path,
        language: "javascript",
        size: source.length,
      },
      source,
    };
  }

  async function extract(code: string, sourcePath = "src/module.js") {
    const parseResponse = await parser.parse(createRequest(code, sourcePath));
    return extractor.extract(parseResponse.result!);
  }

  // ─── 1. Direct Property Assignment ─────────────────────────────────────────
  it("Scenario 1: extracts statically provable property assignments as variable/property symbols", async () => {
    const code = `
      var proto = {};
      proto.name = "MyRouter";
      proto.version = 4;
    `;
    const table = await extract(code);
    const propSymbols = table.symbols.filter((s) => s.name === "name" || s.name === "version");
    expect(propSymbols.length).toBe(2);
    expect(propSymbols[0]?.containerName).toBe("proto");
    expect(propSymbols[0]?.kind).toBe("variable");
  });

  // ─── 2. Function-Expression Property Assignment ────────────────────────────
  it("Scenario 2: extracts function expressions assigned to prototype properties as methods", async () => {
    const code = `
      var proto = {};
      proto.handle = function handle(req, res, out) {
        return out();
      };
    `;
    const table = await extract(code);
    const method = table.symbols.find((s) => s.name === "handle" && s.kind === "method");
    expect(method).toBeDefined();
    expect(method?.containerName).toBe("proto");
    expect(method?.parameters).toEqual(["req", "res", "out"]);
  });

  // ─── 3. Anonymous Function Property Assignment ────────────────────────────
  it("Scenario 3: extracts anonymous function expressions on object properties with proper method names", async () => {
    const code = `
      var app = {};
      app.listen = function() {
        return true;
      };
    `;
    const table = await extract(code);
    const listenMethod = table.symbols.find((s) => s.name === "listen" && s.kind === "method");
    expect(listenMethod).toBeDefined();
    expect(listenMethod?.containerName).toBe("app");
  });

  // ─── 4. Aliased Property Assignment & CommonJS Exports ────────────────────
  it("Scenario 4: extracts exports.application = proto and exports.json = bodyParser.json", async () => {
    const code = `
      var proto = {};
      var bodyParser = { json: function() {} };
      exports.application = proto;
      exports.json = bodyParser.json;
    `;
    const table = await extract(code);
    const appExport = table.symbols.find((s) => s.name === "application" && s.exported);
    const jsonExport = table.symbols.find((s) => s.name === "json" && s.exported);
    expect(appExport).toBeDefined();
    expect(jsonExport).toBeDefined();
  });

  // ─── 5. Chained CommonJS Exports ──────────────────────────────────────────
  it("Scenario 5: unwraps chained exports = module.exports = createApplication correctly", async () => {
    const code = `
      function createApplication() {
        return {};
      }
      exports = module.exports = createApplication;
    `;
    const table = await extract(code, "lib/express.js");
    const fnSym = table.symbols.find((s) => s.name === "createApplication" && s.kind === "function");
    expect(fnSym?.exported).toBe(true);

    const expSym = table.symbols.find((s) => s.kind === "export" && s.defaultExport);
    expect(expSym).toBeDefined();
    expect(expSym?.sourceSymbolName).toBe("createApplication");
  });

  // ─── 6. Assignment-Level require() Import Extraction ──────────────────────
  it("Scenario 6: extracts require() in assignment expressions (module.exports = require('./lib/express'))", async () => {
    const code = `
      module.exports = require('./lib/express');
    `;
    const table = await extract(code, "index.js");
    const impSym = table.symbols.find((s) => s.kind === "import" && s.moduleSpecifier === "./lib/express");
    expect(impSym).toBeDefined();
  });

  // ─── 7. Dynamic Computed Property Negative Case ───────────────────────────
  it("Scenario 7 (FAILURE-FIRST NEGATIVE): does NOT invent symbols for dynamic computed property assignments", async () => {
    const code = `
      var obj = {};
      obj[Math.random() > 0.5 ? "a" : "b"] = function() {};
      obj[getRuntimeKey()] = 123;
    `;
    const table = await extract(code);
    const phantomSymbols = table.symbols.filter((s) => s.name === "a" || s.name === "b" || s.name === "getRuntimeKey");
    expect(phantomSymbols.length).toBe(0);
  });

  // ─── 8. Duplicate Assignment Handling ─────────────────────────────────────
  it("Scenario 8: handles duplicate assignments by generating deterministic distinct symbol IDs", async () => {
    const code = `
      var proto = {};
      proto.init = function() { return 1; };
      proto.init = function() { return 2; };
    `;
    const table = await extract(code);
    const initSymbols = table.symbols.filter((s) => s.name === "init");
    expect(initSymbols.length).toBe(2);
    expect(initSymbols[0]?.id).not.toBe(initSymbols[1]?.id);
  });

  // ─── 9. Deterministic Ordering ────────────────────────────────────────────
  it("Scenario 9: preserves deterministic symbol ordering across repeated runs", async () => {
    const code = `
      var app = {};
      app.init = function() {};
      app.listen = function() {};
      exports.application = app;
    `;
    const table1 = await extract(code);
    const table2 = await extract(code);
    expect(table1.symbols.map((s) => s.id)).toEqual(table2.symbols.map((s) => s.id));
  });

  // ─── 10. Source-Location Preservation ─────────────────────────────────────
  it("Scenario 10: preserves exact source locations on property and method symbols", async () => {
    const code = `
      var req = {};
      req.header = function header(name) {
        return this.headers[name];
      };
    `;
    const table = await extract(code);
    const headerMethod = table.symbols.find((s) => s.name === "header" && s.kind === "method");
    expect(headerMethod?.location?.start.line).toBe(3);
  });
});
