import { describe, expect, it } from "bun:test";

import { JavaScriptParser } from "@parser/adapters/javascript/javascript-parser";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";

describe("FINDING-SYM-05: Default Parameter Semantics", () => {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();

  async function parseAndExtract(source: string) {
    const response = await parser.parse({
      file: { id: "test-file", path: "test.js", language: "javascript", size: source.length },
      source,
    });
    return extractor.extract(response.result);
  }

  it("extracts parameters with default values without treating expressions as parameter names", async () => {
    const code = `
      const fallback = 42;
      function test(x = fallback, y = 10) {}
    `;
    const table = await parseAndExtract(code);

    const testFn = table.symbols.find((s) => s.kind === "function" && s.name === "test");
    expect(testFn).toBeDefined();
    expect(testFn?.parameters).toEqual(["x", "y"]);
    expect(testFn?.parameters).not.toContain("fallback");
  });

  it("extracts object destructuring parameter: function f({a}) {}", async () => {
    const code = `function f({a}) {}`;
    const table = await parseAndExtract(code);

    const fn = table.symbols.find((s) => s.kind === "function" && s.name === "f");
    expect(fn?.parameters).toEqual(["a"]);
  });

  it("extracts renamed object destructuring parameter: function f({a: b}) {}", async () => {
    const code = `function f({a: b}) {}`;
    const table = await parseAndExtract(code);

    const fn = table.symbols.find((s) => s.kind === "function" && s.name === "f");
    expect(fn?.parameters).toEqual(["b"]);
  });

  it("extracts array destructuring parameter: function f([x, y]) {}", async () => {
    const code = `function f([x, y]) {}`;
    const table = await parseAndExtract(code);

    const fn = table.symbols.find((s) => s.kind === "function" && s.name === "f");
    expect(fn?.parameters).toEqual(["x", "y"]);
  });

  it("extracts rest parameter: function f(...args) {}", async () => {
    const code = `function f(...args) {}`;
    const table = await parseAndExtract(code);

    const fn = table.symbols.find((s) => s.kind === "function" && s.name === "f");
    expect(fn?.parameters).toEqual(["args"]);
  });

  it("extracts object destructuring with default: function f({a = fallback}) {}", async () => {
    const code = `function f({a = fallback}) {}`;
    const table = await parseAndExtract(code);

    const fn = table.symbols.find((s) => s.kind === "function" && s.name === "f");
    expect(fn?.parameters).toEqual(["a"]);
    expect(fn?.parameters).not.toContain("fallback");
  });

  it("extracts array destructuring with default: function f([x = fallback]) {}", async () => {
    const code = `function f([x = fallback]) {}`;
    const table = await parseAndExtract(code);

    const fn = table.symbols.find((s) => s.kind === "function" && s.name === "f");
    expect(fn?.parameters).toEqual(["x"]);
    expect(fn?.parameters).not.toContain("fallback");
  });
});
