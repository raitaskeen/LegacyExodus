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

describe("FINDING-SYM-01 — JavaScript var Scope Correctness", () => {
  it("1. assigns var inside if block to the function scope, not the if block scope", async () => {
    const code = `
      function example() {
        if (true) {
          var value = 1;
        }
        return value;
      }
    `;
    const table = await extractSymbols(code);
    const varSym = table.symbols.find((s) => s.name === "value" && s.kind === "variable");

    expect(varSym).toBeDefined();
    // var must belong to the function scope, not a block scope
    expect(varSym?.scopeId).toContain("FunctionDeclaration");
    expect(varSym?.scopeId).not.toContain("BlockStatement");
  });

  it("2. assigns var inside for loop to the function scope", async () => {
    const code = `
      function loopTest() {
        for (var i = 0; i < 10; i++) {}
      }
    `;
    const table = await extractSymbols(code);
    const varSym = table.symbols.find((s) => s.name === "i" && s.kind === "variable");

    expect(varSym?.scopeId).toContain("FunctionDeclaration");
    expect(varSym?.scopeId).not.toContain("BlockStatement");
  });

  it("3. assigns var inside while loop to the function scope", async () => {
    const code = `
      function whileTest() {
        while (true) {
          var running = false;
          break;
        }
      }
    `;
    const table = await extractSymbols(code);
    const varSym = table.symbols.find((s) => s.name === "running" && s.kind === "variable");

    expect(varSym?.scopeId).toContain("FunctionDeclaration");
    expect(varSym?.scopeId).not.toContain("BlockStatement");
  });

  it("4. assigns var inside deeply nested blocks to the function scope", async () => {
    const code = `
      function nested() {
        {
          {
            var deep = 42;
          }
        }
      }
    `;
    const table = await extractSymbols(code);
    const varSym = table.symbols.find((s) => s.name === "deep" && s.kind === "variable");

    expect(varSym?.scopeId).toContain("FunctionDeclaration");
    expect(varSym?.scopeId).not.toContain("BlockStatement");
  });

  it("5. preserves block scope for let inside if block", async () => {
    const code = `
      function letTest() {
        if (true) {
          let blockScoped = 1;
        }
      }
    `;
    const table = await extractSymbols(code);
    const letSym = table.symbols.find((s) => s.name === "blockScoped" && s.kind === "variable");

    expect(letSym).toBeDefined();
    expect(letSym?.scopeId).toContain("BlockStatement");
    expect(letSym?.scopeId).not.toContain("FunctionDeclaration");
  });

  it("6. preserves block scope for const inside loop block", async () => {
    const code = `
      function constTest() {
        for (let i = 0; i < 1; i++) {
          const item = i;
        }
      }
    `;
    const table = await extractSymbols(code);
    const constSym = table.symbols.find((s) => s.name === "item" && s.kind === "variable");

    expect(constSym?.scopeId).toContain("BlockStatement");
    expect(constSym?.scopeId).not.toContain("FunctionDeclaration");
  });

  it("7. isolates var in nested function from outer function scope", async () => {
    const code = `
      function outer() {
        var outerVar = 1;
        function inner() {
          if (true) {
            var innerVar = 99;
          }
        }
      }
    `;
    const table = await extractSymbols(code);
    const outerVar = table.symbols.find((s) => s.name === "outerVar" && s.kind === "variable");
    const innerVar = table.symbols.find((s) => s.name === "innerVar" && s.kind === "variable");

    expect(outerVar?.scopeId).toContain("FunctionDeclaration");
    expect(innerVar?.scopeId).toContain("FunctionDeclaration");
    expect(innerVar?.scopeId).not.toBe(outerVar?.scopeId ?? "");
  });

  it("8. handles shadowed variables correctly between block let and function var", async () => {
    const code = `
      function shadowTest() {
        var x = 1;
        if (true) {
          let x = 2;
        }
      }
    `;
    const table = await extractSymbols(code);
    const vars = table.symbols.filter((s) => s.name === "x");
    expect(vars.length).toBe(2);

    const varDecl = vars.find((s) => s.declarationKind === "var");
    const letDecl = vars.find((s) => s.declarationKind === "let");

    expect(varDecl?.scopeId).toContain("FunctionDeclaration");
    expect(letDecl?.scopeId).toContain("BlockStatement");
  });

  it("9. assigns top-level var inside a block to scope:module", async () => {
    const code = `
      if (true) {
        var topLevelVar = "hello";
      }
    `;
    const table = await extractSymbols(code);
    const varSym = table.symbols.find((s) => s.name === "topLevelVar");
    expect(varSym?.scopeId).toBe("scope:module");
  });

  it("10. extracts symbols deterministically across repeated runs", async () => {
    const code = `
      function foo() {
        if (true) { var a = 1; }
        while (false) { var b = 2; }
      }
    `;
    const table1 = await extractSymbols(code);
    const table2 = await extractSymbols(code);

    expect(JSON.stringify(table1)).toBe(JSON.stringify(table2));
  });
});
