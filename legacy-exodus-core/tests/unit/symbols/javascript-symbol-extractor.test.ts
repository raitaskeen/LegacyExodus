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
    expect(table.symbols.find((symbol) => symbol.name === "DATABASE_URL")?.declarationKind).toBe("const");
    expect(table.symbols.find((symbol) => symbol.name === "DATABASE_URL")?.value).toBe(
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
});
