import { describe, expect, test } from "bun:test";

import { JavaScriptParser, type ParseRequest } from "@parser/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

function createRequest(source: string): ParseRequest {
  return {
    file: {
      id: "symbol-source",
      path: "src/user-service.js",
      language: "javascript",
      size: source.length,
    },
    source,
  };
}

describe("JavaScriptSymbolExtractor", () => {
  test("extracts imports, exports, variables, functions, classes, and methods from a normalized AST", async (): Promise<void> => {
    const source = `
      import express from "express";
      export const DATABASE_URL = "mongodb://localhost/library";
      export async function login(email, password) { return Boolean(email && password); }
      export default class UserService {
        logout() { return true; }
      }
    `;
    const ast = (await new JavaScriptParser().parse(createRequest(source))).result;
    const table = new JavaScriptSymbolExtractor().extract(ast);

    expect(table.summary).toEqual({
      classes: 1,
      exports: 3,
      functions: 1,
      imports: 1,
      methods: 1,
      variables: 1,
    });
    expect(table.symbols.find((symbol) => symbol.kind === "import")?.moduleSpecifier).toBe("express");
    expect(table.symbols.find((symbol) => symbol.kind === "variable" && symbol.name === "DATABASE_URL")?.declarationKind).toBe("const");
    expect(table.symbols.find((symbol) => symbol.kind === "variable" && symbol.name === "DATABASE_URL")?.value).toBe(
      "mongodb://localhost/library",
    );
    expect(
      table.symbols.find((symbol) => symbol.kind === "function" && symbol.name === "login")?.parameters,
    ).toEqual(["email", "password"]);
    expect(table.symbols.find((symbol) => symbol.kind === "function" && symbol.name === "login")?.async).toBe(
      true,
    );
    expect(table.symbols.find((symbol) => symbol.kind === "class" && symbol.name === "UserService")?.exported).toBe(
      true,
    );
    expect(table.symbols.find((symbol) => symbol.name === "logout")?.containerName).toBe("UserService");
  });

  test("extracts nested functions and returns an immutable deterministic symbol table", async (): Promise<void> => {
    const source = `function outer() { function inner() { return 1; } return inner(); }`;
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const first = extractor.extract((await parser.parse(createRequest(source))).result);
    const second = extractor.extract((await parser.parse(createRequest(source))).result);

    expect(first.summary.functions).toBe(2);
    expect(first.symbols.map((symbol) => symbol.id)).toEqual(second.symbols.map((symbol) => symbol.id));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.symbols)).toBe(true);
    expect(Object.isFrozen(first.symbols[0] ?? {})).toBe(true);
  });

  test("extracts every named export and preserves aliased re-export provenance", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const extractor = new JavaScriptSymbolExtractor();
    const source = 'export { foo, bar as renamedBar } from "./source";';
    const table = extractor.extract((await parser.parse(createRequest(source))).result);
    const exports = table.symbols.filter((symbol) => symbol.kind === "export");

    expect(exports.map((symbol) => symbol.name)).toEqual(["foo", "renamedBar"]);
    expect(exports.map((symbol) => symbol.sourceSymbolName)).toEqual(["foo", "bar"]);
    expect(exports.map((symbol) => symbol.moduleSpecifier)).toEqual(["./source", "./source"]);
  });

  test("represents variable-assigned arrow and function expressions as named functions", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const source = "const handler = async (value) => value; const Component = (props) => props; const legacy = function (item) { return item; };";
    const table = new JavaScriptSymbolExtractor().extract((await parser.parse(createRequest(source))).result);
    const functions = table.symbols.filter((symbol) => symbol.kind === "function");

    expect(functions.map((symbol) => symbol.name)).toEqual(["handler", "Component", "legacy"]);
    expect(functions.map((symbol) => symbol.parameters)).toEqual([["value"], ["props"], ["item"]]);
    expect(functions.every((symbol) => !symbol.anonymous)).toBe(true);
  });

  test("never emits an empty module specifier", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const table = new JavaScriptSymbolExtractor().extract((await parser.parse(createRequest('import "";'))).result);

    expect(table.symbols[0]?.moduleSpecifier).toBe("unknown-module");
    expect(table.symbols.every((symbol) => symbol.moduleSpecifier !== "")).toBe(true);
  });

  test("extracts all export declaration and alias names without inventing defaults", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const source = "export const a = 1, b = 2; export let c = 3; export var d = 4; export {}; export { foo as bar, foo as default }; export default function named() {}";
    const table = new JavaScriptSymbolExtractor().extract((await parser.parse(createRequest(source))).result);
    const exports = table.symbols.filter((symbol) => symbol.kind === "export");

    expect(exports.map((symbol) => symbol.name)).toEqual(["a", "b", "c", "d", "bar", "default", "default"]);
    expect(exports.filter((symbol) => symbol.name === "default").map((symbol) => symbol.defaultExport)).toEqual([true, true]);
    expect(exports.find((symbol) => symbol.name === "bar")?.sourceSymbolName).toBe("foo");
    expect(exports.find((symbol) => symbol.name === "default" && symbol.sourceSymbolName === "foo")?.defaultExport).toBe(true);
    expect(exports.some((symbol) => symbol.name === "default" && symbol.sourceSymbolName === undefined && !symbol.defaultExport)).toBe(false);
  });

  test("models statically provable CommonJS imports and exports", async (): Promise<void> => {
    const parser = new JavaScriptParser();
    const source = "const utils = require('./utils'); const { helper } = require('./utils'); const named = require('./utils').named; module.exports = utils; exports.helper = helper; module.exports.named = named; const dynamic = require(path);";
    const table = new JavaScriptSymbolExtractor().extract((await parser.parse(createRequest(source))).result);
    const imports = table.symbols.filter((symbol) => symbol.kind === "import");
    const exports = table.symbols.filter((symbol) => symbol.kind === "export");

    expect(imports.map((symbol) => [symbol.name, symbol.moduleSpecifier, symbol.defaultExport])).toEqual([["utils", "./utils", true], ["helper", "./utils", false], ["named", "./utils", false]]);
    expect(exports.map((symbol) => [symbol.name, symbol.defaultExport, symbol.sourceSymbolName])).toEqual([["default", true, "utils"], ["helper", false, "helper"], ["named", false, "named"]]);
    expect(imports.some((symbol) => symbol.name === "dynamic")).toBe(false);
  });
});
