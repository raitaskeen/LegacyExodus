import { describe, expect, it } from "bun:test";

import { JavaScriptParser } from "@parser/adapters/javascript/javascript-parser";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";

describe("FINDING-SYM-04: Destructuring Pattern Symbols", () => {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();

  async function parseAndExtract(source: string) {
    const response = await parser.parse({
      file: { id: "test-file", path: "test.js", language: "javascript", size: source.length },
      source,
    });
    return extractor.extract(response.result);
  }

  it("extracts direct property destructuring: const { a } = obj", async () => {
    const code = `const { a } = obj;`;
    const table = await parseAndExtract(code);

    const names = table.symbols.map((s) => s.name);
    expect(names).toContain("a");
    expect(names).not.toContain("obj");

    const aSym = table.symbols.find((s) => s.name === "a");
    expect(aSym?.kind).toBe("variable");
    expect(aSym?.declarationKind).toBe("const");
  });

  it("extracts renamed property destructuring: const { a: b } = obj", async () => {
    const code = `const { a: b } = obj;`;
    const table = await parseAndExtract(code);

    const names = table.symbols.map((s) => s.name);
    expect(names).toContain("b");
    expect(names).not.toContain("a");
    expect(names).not.toContain("obj");

    const bSym = table.symbols.find((s) => s.name === "b");
    expect(bSym?.kind).toBe("variable");
  });

  it("extracts property destructuring with default value: const { a = fallback } = obj", async () => {
    const code = `const { a = fallback } = obj;`;
    const table = await parseAndExtract(code);

    const names = table.symbols.map((s) => s.name);
    expect(names).toContain("a");
    expect(names).not.toContain("fallback");
    expect(names).not.toContain("obj");
  });

  it("extracts renamed property with default value: const { a: b = fallback } = obj", async () => {
    const code = `const { a: b = fallback } = obj;`;
    const table = await parseAndExtract(code);

    const names = table.symbols.map((s) => s.name);
    expect(names).toContain("b");
    expect(names).not.toContain("a");
    expect(names).not.toContain("fallback");
    expect(names).not.toContain("obj");
  });

  it("extracts array destructuring: const [x, y] = list", async () => {
    const code = `const [x, y] = list;`;
    const table = await parseAndExtract(code);

    const names = table.symbols.map((s) => s.name);
    expect(names).toContain("x");
    expect(names).toContain("y");
    expect(names).not.toContain("list");
  });

  it("extracts array destructuring with hole: const [x, , y] = list", async () => {
    const code = `const [x, , y] = list;`;
    const table = await parseAndExtract(code);

    const names = table.symbols.map((s) => s.name);
    expect(names).toContain("x");
    expect(names).toContain("y");
    expect(names).not.toContain("list");
  });

  it("extracts array destructuring with default: const [x = fallback] = list", async () => {
    const code = `const [x = fallback] = list;`;
    const table = await parseAndExtract(code);

    const names = table.symbols.map((s) => s.name);
    expect(names).toContain("x");
    expect(names).not.toContain("fallback");
    expect(names).not.toContain("list");
  });

  it("extracts nested destructuring: const { a, nested: { b } } = obj", async () => {
    const code = `const { a, nested: { b } } = obj;`;
    const table = await parseAndExtract(code);

    const names = table.symbols.map((s) => s.name);
    expect(names).toContain("a");
    expect(names).toContain("b");
    expect(names).not.toContain("nested");
    expect(names).not.toContain("obj");
  });

  it("extracts object rest element: const { a, ...rest } = obj", async () => {
    const code = `const { a, ...rest } = obj;`;
    const table = await parseAndExtract(code);

    const names = table.symbols.map((s) => s.name);
    expect(names).toContain("a");
    expect(names).toContain("rest");
    expect(names).not.toContain("obj");
  });

  it("extracts array rest element: const [a, ...rest] = list", async () => {
    const code = `const [a, ...rest] = list;`;
    const table = await parseAndExtract(code);

    const names = table.symbols.map((s) => s.name);
    expect(names).toContain("a");
    expect(names).toContain("rest");
    expect(names).not.toContain("list");
  });

  it("extracts exported destructuring: export const { a: b } = obj", async () => {
    const code = `export const { a: b } = obj;`;
    const table = await parseAndExtract(code);

    const exportSymbols = table.symbols.filter((s) => s.kind === "export");
    expect(exportSymbols.map((s) => s.name)).toEqual(["b"]);

    const varSymbols = table.symbols.filter((s) => s.kind === "variable");
    expect(varSymbols.map((s) => s.name)).toEqual(["b"]);
    expect(varSymbols[0]?.exported).toBe(true);

    const names = table.symbols.map((s) => s.name);
    expect(names).not.toContain("obj");
    expect(names).not.toContain("a");
  });
});
