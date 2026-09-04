import { describe, expect, it } from "bun:test";

import { DeterministicDependencyGraphBuilder } from "@graph/index";
import { JavaScriptParser, type ParseRequest } from "@parser/index";
import { DeterministicSemanticAnalysisEngine } from "@semantic/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

function createRequest(source: string, path = "src/example.js"): ParseRequest {
  return {
    file: {
      id: "example-file",
      path,
      language: "javascript",
      size: source.length,
    },
    source,
  };
}

describe("F-01: Lexical Block Scopes for Loops and Catch Bindings", () => {
  const parser = new JavaScriptParser();
  const extractor = new JavaScriptSymbolExtractor();
  const depBuilder = new DeterministicDependencyGraphBuilder();
  const engine = new DeterministicSemanticAnalysisEngine();

  async function parseAndExtract(source: string) {
    const ast = (await parser.parse(createRequest(source))).result;
    const table = extractor.extract(ast);
    return { ast, table };
  }

  async function analyze(source: string) {
    const file = { id: "example", path: "src/example.js", language: "javascript", size: source.length };
    const ast = (await parser.parse({ file, source })).result;
    const symbolTable = extractor.extract(ast);
    const depGraph = depBuilder.build([symbolTable], [file]);
    const analysis = engine.analyze({
      astResults: [ast],
      dependencyGraph: depGraph,
      symbolTables: [symbolTable],
    });
    return { ast, symbolTable, depGraph, analysis };
  }

  // ─── 1. ForStatement Scope Isolation ─────────────────────────────────────
  it("creates a distinct lexical scope for ForStatement let bindings", async () => {
    const source = `
      function run() {
        for (let i = 0; i < 10; i++) {
          const step = i;
        }
      }
    `;
    const { table } = await parseAndExtract(source);
    const fnSymbol = table.symbols.find((s) => s.kind === "function" && s.name === "run");
    const loopVar = table.symbols.find((s) => s.kind === "variable" && s.name === "i");
    const bodyVar = table.symbols.find((s) => s.kind === "variable" && s.name === "step");

    expect(fnSymbol).toBeDefined();
    expect(loopVar).toBeDefined();
    expect(bodyVar).toBeDefined();

    expect(loopVar?.declarationKind).toBe("let");
    expect(loopVar?.scopeId).toStartWith("scope:ForStatement:");
    expect(loopVar?.scopeId).not.toBe(fnSymbol?.scopeId);
    expect(loopVar?.scopeId).not.toBe("scope:module");

    expect(bodyVar?.scopeId).toStartWith("scope:BlockStatement:");
    expect(bodyVar?.scopeId).not.toBe(loopVar?.scopeId);
  });

  // ─── 2. ForOfStatement Scope Isolation ───────────────────────────────────
  it("creates a distinct lexical scope for ForOfStatement const bindings", async () => {
    const source = `
      function processItems(items) {
        for (const item of items) {
          consume(item);
        }
      }
    `;
    const { table } = await parseAndExtract(source);
    const fnSymbol = table.symbols.find((s) => s.kind === "function" && s.name === "processItems");
    const loopVar = table.symbols.find((s) => s.kind === "variable" && s.name === "item");

    expect(fnSymbol).toBeDefined();
    expect(loopVar).toBeDefined();
    expect(loopVar?.declarationKind).toBe("const");
    expect(loopVar?.scopeId).toStartWith("scope:ForOfStatement:");
    expect(loopVar?.scopeId).not.toBe(fnSymbol?.scopeId);
    expect(loopVar?.scopeId).not.toBe("scope:module");
  });

  // ─── 3. ForInStatement Scope Isolation ───────────────────────────────────
  it("creates a distinct lexical scope for ForInStatement const bindings", async () => {
    const source = `
      function processKeys(obj) {
        for (const key in obj) {
          consume(key);
        }
      }
    `;
    const { table } = await parseAndExtract(source);
    const fnSymbol = table.symbols.find((s) => s.kind === "function" && s.name === "processKeys");
    const loopVar = table.symbols.find((s) => s.kind === "variable" && s.name === "key");

    expect(fnSymbol).toBeDefined();
    expect(loopVar).toBeDefined();
    expect(loopVar?.declarationKind).toBe("const");
    expect(loopVar?.scopeId).toStartWith("scope:ForInStatement:");
    expect(loopVar?.scopeId).not.toBe(fnSymbol?.scopeId);
    expect(loopVar?.scopeId).not.toBe("scope:module");
  });

  // ─── 4. CatchClause Scope and Symbol Extraction ──────────────────────────
  it("creates a CatchClause lexical scope and extracts the catch parameter symbol", async () => {
    const source = `
      function safeOperation() {
        try {
          risky();
        } catch (error) {
          handle(error);
        }
      }
    `;
    const { table } = await parseAndExtract(source);
    const fnSymbol = table.symbols.find((s) => s.kind === "function" && s.name === "safeOperation");
    const catchParam = table.symbols.find((s) => s.kind === "variable" && s.name === "error");

    expect(fnSymbol).toBeDefined();
    expect(catchParam).toBeDefined();
    expect(catchParam?.declarationKind).toBe("let");
    expect(catchParam?.scopeId).toStartWith("scope:CatchClause:");
    expect(catchParam?.scopeId).not.toBe(fnSymbol?.scopeId);
    expect(catchParam?.scopeId).not.toBe("scope:module");
  });

  // ─── 5. Shadowing in Loops ───────────────────────────────────────────────
  it("preserves outer variable when shadowed by loop variable", async () => {
    const source = `
      let x = "outer";
      for (let x = 0; x < 5; x++) {
        noop(x);
      }
    `;
    const { table } = await parseAndExtract(source);
    const xSymbols = table.symbols.filter((s) => s.kind === "variable" && s.name === "x");

    expect(xSymbols.length).toBe(2);
    const outerX = xSymbols.find((s) => s.scopeId === "scope:module");
    const loopX = xSymbols.find((s) => s.scopeId?.startsWith("scope:ForStatement:") === true);

    expect(outerX).toBeDefined();
    expect(loopX).toBeDefined();
    expect(outerX?.value).toBe("outer");
    expect(loopX?.scopeId).not.toBe(outerX?.scopeId);
  });

  // ─── 6. Catch Parameter Shadowing ────────────────────────────────────────
  it("preserves outer variable when shadowed by catch parameter", async () => {
    const source = `
      let err = "initial";
      try {
        risky();
      } catch (err) {
        log(err);
      }
    `;
    const { table } = await parseAndExtract(source);
    const errSymbols = table.symbols.filter((s) => s.kind === "variable" && s.name === "err");

    expect(errSymbols.length).toBe(2);
    const outerErr = errSymbols.find((s) => s.scopeId === "scope:module");
    const catchErr = errSymbols.find((s) => s.scopeId?.startsWith("scope:CatchClause:") === true);

    expect(outerErr).toBeDefined();
    expect(catchErr).toBeDefined();
    expect(outerErr?.value).toBe("initial");
    expect(catchErr?.scopeId).not.toBe(outerErr?.scopeId);
  });

  // ─── 7. Optional Catch Binding (No Param) ────────────────────────────────
  it("handles optional catch binding without creating phantom symbols", async () => {
    const source = `
      try {
        doSomething();
      } catch {
        fallback();
      }
    `;
    const { table } = await parseAndExtract(source);
    const variables = table.symbols.filter((s) => s.kind === "variable");

    expect(variables.length).toBe(0);
    // Should not create undefined or empty symbols
    for (const sym of table.symbols) {
      expect(sym.name).toBeTruthy();
      expect(sym.name).not.toBe("undefined");
    }
  });

  // ─── 8. Var Hoisting in Loops ────────────────────────────────────────────
  it("preserves var hoisting from loops to enclosing function/module scope", async () => {
    const source = `
      function testVar() {
        for (var k = 0; k < 5; k++) {
          var inside = k;
        }
      }
    `;
    const { table } = await parseAndExtract(source);
    const kSymbol = table.symbols.find((s) => s.kind === "variable" && s.name === "k");
    const insideSymbol = table.symbols.find((s) => s.kind === "variable" && s.name === "inside");

    expect(kSymbol).toBeDefined();
    expect(insideSymbol).toBeDefined();

    expect(kSymbol?.declarationKind).toBe("var");
    expect(kSymbol?.scopeId).toStartWith("scope:FunctionDeclaration:");

    expect(insideSymbol?.declarationKind).toBe("var");
    expect(insideSymbol?.scopeId).toStartWith("scope:FunctionDeclaration:");
  });

  // ─── 9. Multi-variable loop declarations ─────────────────────────────────
  it("attaches all declarators in multi-variable loop to loop scope", async () => {
    const source = `
      for (let i = 0, j = 10; i < j; i++) {
        noop(i, j);
      }
    `;
    const { table } = await parseAndExtract(source);
    const iSymbol = table.symbols.find((s) => s.kind === "variable" && s.name === "i");
    const jSymbol = table.symbols.find((s) => s.kind === "variable" && s.name === "j");

    expect(iSymbol).toBeDefined();
    expect(jSymbol).toBeDefined();
    expect(iSymbol?.scopeId).toStartWith("scope:ForStatement:");
    expect(jSymbol?.scopeId).toBe(iSymbol?.scopeId);
  });

  // ─── 10. Destructuring in loop header ────────────────────────────────────
  it("extracts array and object destructuring bindings into loop scope", async () => {
    const source = `
      for (const [a, b] of pairs) {}
      for (const { x, y } of points) {}
    `;
    const { table } = await parseAndExtract(source);
    const aSym = table.symbols.find((s) => s.name === "a");
    const bSym = table.symbols.find((s) => s.name === "b");
    const xSym = table.symbols.find((s) => s.name === "x");
    const ySym = table.symbols.find((s) => s.name === "y");

    expect(aSym).toBeDefined();
    expect(bSym).toBeDefined();
    expect(xSym).toBeDefined();
    expect(ySym).toBeDefined();

    expect(aSym?.scopeId).toStartWith("scope:ForOfStatement:");
    expect(bSym?.scopeId).toBe(aSym?.scopeId);
    expect(xSym?.scopeId).toStartWith("scope:ForOfStatement:");
    expect(ySym?.scopeId).toBe(xSym?.scopeId);
    expect(aSym?.scopeId).not.toBe(xSym?.scopeId);
  });

  // ─── 11. Catch with destructuring ────────────────────────────────────────
  it("extracts destructured catch bindings into catch scope", async () => {
    const source = `
      try {
        work();
      } catch ({ message, code }) {
        report(message, code);
      }
    `;
    const { table } = await parseAndExtract(source);
    const msgSym = table.symbols.find((s) => s.name === "message");
    const codeSym = table.symbols.find((s) => s.name === "code");

    expect(msgSym).toBeDefined();
    expect(codeSym).toBeDefined();
    expect(msgSym?.scopeId).toStartWith("scope:CatchClause:");
    expect(codeSym?.scopeId).toBe(msgSym?.scopeId);
  });

  // ─── 12. Unbraced loop bodies ────────────────────────────────────────────
  it("handles unbraced loop bodies with loop scope", async () => {
    const source = `
      for (let i = 0; i < 5; i++)
        process(i);
    `;
    const { table } = await parseAndExtract(source);
    const iSymbol = table.symbols.find((s) => s.name === "i");

    expect(iSymbol).toBeDefined();
    expect(iSymbol?.scopeId).toStartWith("scope:ForStatement:");
  });

  // ─── 13. Nested loops with same variable name ────────────────────────────
  it("creates distinct scopes for nested loops with same variable name", async () => {
    const source = `
      for (let i = 0; i < 5; i++) {
        for (let i = 0; i < 3; i++) {
          inner(i);
        }
      }
    `;
    const { table } = await parseAndExtract(source);
    const iSymbols = table.symbols.filter((s) => s.name === "i");

    expect(iSymbols.length).toBe(2);
    expect(iSymbols[0]?.scopeId).toStartWith("scope:ForStatement:");
    expect(iSymbols[1]?.scopeId).toStartWith("scope:ForStatement:");
    expect(iSymbols[0]?.scopeId).not.toBe(iSymbols[1]?.scopeId);
  });

  // ─── 14. Downstream Call Graph / Anti-Corruption Resolution ──────────────
  it("resolves calls correctly and prevents shadowed variables from hijacking or leaking", async () => {
    const source = `
      function worker() { return 1; }
      function run() {
        worker();
        for (let worker = 0; worker < 2; worker++) {
          worker();
        }
      }
    `;
    const { analysis, symbolTable } = await analyze(source);
    const workerFn = symbolTable.symbols.find((s) => s.kind === "function" && s.name === "worker");
    const callsToWorker = analysis.calls.filter((c) => c.calleeName === "worker");

    expect(workerFn).toBeDefined();
    expect(callsToWorker.length).toBe(2);

    // First call outside the loop should resolve to the outer function worker
    expect(callsToWorker[0]?.callerName).toBe("run");
    expect(callsToWorker[0]?.resolutionState).toBe("RESOLVED");
    expect(callsToWorker[0]?.targetSymbolId).toBe(workerFn?.id);

    // Second call inside the loop has local variable 'worker' shadowing the function.
    // Because worker is a non-callable variable, worker() should be UNRESOLVED.
    expect(callsToWorker[1]?.callerName).toBe("run");
    expect(callsToWorker[1]?.resolutionState).toBe("UNRESOLVED");
    expect(callsToWorker[1]?.targetSymbolId).toBeUndefined();
  });
});
