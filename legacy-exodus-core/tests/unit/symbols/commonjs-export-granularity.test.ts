import { describe, expect, it } from "bun:test";
import { JavaScriptParser } from "@parser/adapters/javascript/javascript-parser";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";

describe("P1.1 CommonJS Export Granularity & Symbol Fidelity", () => {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();

  async function extractFromSource(code: string, path = "test.js") {
    const parseRes = await parser.parse({
      file: {
        id: "test-file-id",
        path,
        language: "javascript",
        size: code.length,
        fileKind: "source",
      },
      source: code,
    });
    return extractor.extract(parseRes.result);
  }

  // 1. Shorthand export
  it("Scenario 1: extracts shorthand CommonJS export { foo } and marks local symbol as exported", async () => {
    const code = `
      function foo() {}
      module.exports = { foo };
    `;
    const table = await extractFromSource(code);
    const fooFn = table.symbols.find((s) => s.name === "foo" && s.kind === "function");
    const fooExport = table.symbols.find((s) => s.name === "foo" && s.kind === "export");

    expect(fooFn).toBeDefined();
    expect(fooFn?.exported).toBe(true);

    expect(fooExport).toBeDefined();
    expect(fooExport?.exported).toBe(true);
    expect(fooExport?.defaultExport).toBe(false);
    expect(fooExport?.sourceSymbolName).toBe("foo");
  });

  // 2. Multiple shorthand exports
  it("Scenario 2: extracts multiple shorthand exports { foo, bar }", async () => {
    const code = `
      const foo = 1;
      const bar = 2;
      module.exports = { foo, bar };
    `;
    const table = await extractFromSource(code);
    const exports = table.symbols.filter((s) => s.kind === "export" && !s.defaultExport);

    expect(exports.map((e) => e.name)).toEqual(["foo", "bar"]);
    expect(table.symbols.find((s) => s.name === "foo" && s.kind === "variable")?.exported).toBe(true);
    expect(table.symbols.find((s) => s.name === "bar" && s.kind === "variable")?.exported).toBe(true);
  });

  // 3. Aliased export
  it("Scenario 3: extracts aliased export { publicFoo: privateFoo } preserving alias provenance", async () => {
    const code = `
      function privateFoo() {}
      module.exports = { publicFoo: privateFoo };
    `;
    const table = await extractFromSource(code);
    const privateFn = table.symbols.find((s) => s.name === "privateFoo" && s.kind === "function");
    const publicExport = table.symbols.find((s) => s.name === "publicFoo" && s.kind === "export");

    expect(privateFn).toBeDefined();
    expect(privateFn?.exported).toBe(true);

    expect(publicExport).toBeDefined();
    expect(publicExport?.name).toBe("publicFoo");
    expect(publicExport?.sourceSymbolName).toBe("privateFoo");
    expect(publicExport?.defaultExport).toBe(false);
  });

  // 4. Identifier-to-object-literal export
  it("Scenario 4: resolves module.exports = api when api is an object literal", async () => {
    const code = `
      const api = {
        alpha: 100,
        beta: 200
      };
      module.exports = api;
    `;
    const table = await extractFromSource(code);
    const exports = table.symbols.filter((s) => s.kind === "export" && !s.defaultExport);

    expect(exports.map((e) => e.name)).toEqual(["alpha", "beta"]);
    expect(table.symbols.find((s) => s.name === "api" && s.kind === "variable")?.exported).toBe(true);
    expect(table.symbols.find((s) => s.name === "alpha" && s.kind === "variable")?.exported).toBe(true);
    expect(table.symbols.find((s) => s.name === "beta" && s.kind === "variable")?.exported).toBe(true);

    const defaultExport = table.symbols.find((s) => s.name === "default" && s.kind === "export");
    expect(defaultExport).toBeDefined();
    expect(defaultExport?.sourceSymbolName).toBe("api");
  });

  // 5. Mixed shorthand and aliased exports
  it("Scenario 5: extracts mixed shorthand and aliased exports", async () => {
    const code = `
      function a() {}
      function b() {}
      module.exports = {
        a,
        renamedB: b
      };
    `;
    const table = await extractFromSource(code);
    const expA = table.symbols.find((s) => s.name === "a" && s.kind === "export");
    const expB = table.symbols.find((s) => s.name === "renamedB" && s.kind === "export");

    expect(expA?.sourceSymbolName).toBe("a");
    expect(expB?.sourceSymbolName).toBe("b");
    expect(table.symbols.find((s) => s.name === "a" && s.kind === "function")?.exported).toBe(true);
    expect(table.symbols.find((s) => s.name === "b" && s.kind === "function")?.exported).toBe(true);
  });

  // 6 & 11. Conservative dynamic export & Failure-First Negative Test
  it("Scenario 6 & 11 (FAILURE-FIRST): does NOT hallucinate named exports from dynamic expressions", async () => {
    const code = `
      module.exports = getDynamicExports();
    `;
    const table = await extractFromSource(code);
    const namedExports = table.symbols.filter((s) => s.kind === "export" && !s.defaultExport);

    // Negative assertion: Must not invent phantom named exports
    expect(namedExports.length).toBe(0);

    const defaultExport = table.symbols.find((s) => s.name === "default" && s.kind === "export");
    expect(defaultExport).toBeDefined();
  });

  // 7. Local unexported helper remains unexported
  it("Scenario 7: unexported internal helper remains exported: false", async () => {
    const code = `
      function internalHelper() {}
      function publicApi() {}
      module.exports = { publicApi };
    `;
    const table = await extractFromSource(code);

    const helper = table.symbols.find((s) => s.name === "internalHelper" && s.kind === "function");
    const publicFn = table.symbols.find((s) => s.name === "publicApi" && s.kind === "function");

    expect(helper?.exported).toBe(false);
    expect(publicFn?.exported).toBe(true);
  });

  // 8. Individual property assignments module.exports.x and exports.y
  it("Scenario 8: preserves compatibility with module.exports.x and exports.y", async () => {
    const code = `
      function foo() {}
      function bar() {}
      module.exports.foo = foo;
      exports.bar = bar;
    `;
    const table = await extractFromSource(code);

    const expFoo = table.symbols.find((s) => s.name === "foo" && s.kind === "export");
    const expBar = table.symbols.find((s) => s.name === "bar" && s.kind === "export");

    expect(expFoo).toBeDefined();
    expect(expBar).toBeDefined();
    expect(table.symbols.find((s) => s.name === "foo" && s.kind === "function")?.exported).toBe(true);
    expect(table.symbols.find((s) => s.name === "bar" && s.kind === "function")?.exported).toBe(true);
  });

  // 9. Deterministic ordering
  it("Scenario 9: produces deterministic byte-identical symbol ordering across multiple runs", async () => {
    const code = `
      const keys = {
        kAvvio: Symbol('avvio'),
        kHooks: Symbol('hooks'),
        kReply: Symbol('reply')
      };
      module.exports = keys;
    `;
    const table1 = await extractFromSource(code);
    const table2 = await extractFromSource(code);

    expect(table1.symbols.map((s) => s.id)).toEqual(table2.symbols.map((s) => s.id));
    expect(table1.symbols.map((s) => s.name)).toEqual(table2.symbols.map((s) => s.name));
  });
});
