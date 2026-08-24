import { describe, expect, it } from "bun:test";

import { JavaScriptParser } from "@parser/adapters/javascript/javascript-parser";
import { JavaScriptSymbolExtractor } from "@symbols/javascript-symbol-extractor";

describe("FINDING-SYM-06: Assigned Function Var Scope", () => {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();

  async function parseAndExtract(source: string) {
    const response = await parser.parse({
      file: { id: "test-file", path: "test.js", language: "javascript", size: source.length },
      source,
    });
    return extractor.extract(response.result);
  }

  it("scopes var inside assigned FunctionExpression to the function's lexical scope", async () => {
    const code = `
      let h;
      h = function() {
        var inner = 1;
      };
    `;
    const table = await parseAndExtract(code);

    const innerSym = table.symbols.find((s) => s.name === "inner");
    expect(innerSym).toBeDefined();
    expect(innerSym?.kind).toBe("variable");
    expect(innerSym?.scopeId).not.toBe("scope:module");
    expect(innerSym?.scopeId).toContain("FunctionExpression");
  });

  it("scopes var inside assigned ArrowFunctionExpression to the arrow function's lexical scope", async () => {
    const code = `
      let h;
      h = () => {
        var inner = 1;
      };
    `;
    const table = await parseAndExtract(code);

    const innerSym = table.symbols.find((s) => s.name === "inner");
    expect(innerSym).toBeDefined();
    expect(innerSym?.kind).toBe("variable");
    expect(innerSym?.scopeId).not.toBe("scope:module");
    expect(innerSym?.scopeId).toContain("ArrowFunctionExpression");
  });

  it("preserves var hoisting to enclosing function while let/const remain block-scoped inside assigned function", async () => {
    const code = `
      let h;
      h = function() {
        if (true) {
          var inner = 1;
          let blockValue = 2;
        }
      };
    `;
    const table = await parseAndExtract(code);

    const innerSym = table.symbols.find((s) => s.name === "inner");
    const blockSym = table.symbols.find((s) => s.name === "blockValue");

    expect(innerSym).toBeDefined();
    expect(blockSym).toBeDefined();

    // var hoisted to assigned function scope
    expect(innerSym?.scopeId).toContain("FunctionExpression");
    expect(innerSym?.scopeId).not.toBe("scope:module");
    expect(innerSym?.scopeId).not.toContain("BlockStatement");

    // let remains block-scoped
    expect(blockSym?.scopeId).toContain("BlockStatement");
    expect(blockSym?.scopeId).not.toBe("scope:module");
  });
});
