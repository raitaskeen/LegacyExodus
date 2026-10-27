import { describe, expect, it } from "bun:test";

import { JavaScriptParser } from "@parser/adapters/javascript/javascript-parser";
import type { ASTResult } from "@parser/index";
import { DeterministicCallGraphBuilder } from "@semantic/call-graph-builder";
import type { SemanticCall, SymbolReference } from "@semantic/semantic-contracts";
import type { CodeSymbol, SymbolTable } from "@symbols/index";

const SOURCE_PATH = "src/call-graph-scaling.js";

describe("DeterministicCallGraphBuilder symbol lookup scaling", () => {
  it("counts symbol-element examination through array helpers and explicit iteration", () => {
    const observed = observeSymbolExaminations([
      createSymbol(0),
      createSymbol(1),
      createSymbol(2),
    ]);

    observed.symbols.filter((symbol) => symbol.kind === "function");
    for (const symbol of observed.symbols) {
      void symbol.id;
    }

    expect(observed.examinations()).toBe(6);
  });

  it("does not repeatedly examine the complete symbol population per call site", async () => {
    const ast = await parseSource(Array.from({ length: 100 }, () => "target();").join("\n"));
    const sourceSymbols = Array.from({ length: 500 }, (_, index) =>
      createSymbol(index, index === 0 ? { id: "symbol:target", name: "target" } : undefined),
    );
    const observed = observeSymbolExaminations(sourceSymbols);
    const { calls } = buildForFile(ast, createTable(observed.symbols, sourceSymbols));

    expect(calls.length).toBe(100);
    expect(calls.every((call) => call.targetSymbolId === "symbol:target")).toBe(true);
    const symbolExaminations = observed.examinations();
    expect(symbolExaminations).toBe(500);
    expect(symbolExaminations).toBeLessThanOrEqual(2_000);
  });

  it("preserves duplicate callable ambiguity", async () => {
    const ast = await parseSource("duplicate();");
    const table = createTable([
      createSymbol(0, { id: "symbol:duplicate:first", name: "duplicate" }),
      createSymbol(1, { id: "symbol:duplicate:second", name: "duplicate" }),
    ]);
    const { calls } = buildForFile(ast, table);

    expect(calls.length).toBe(1);
    expect(calls[0]?.calleeName).toBe("duplicate");
    expect(calls[0]?.resolutionState).toBe("UNRESOLVED");
    expect(calls[0]?.targetSymbolId).toBeUndefined();
  });

  it("preserves callable and non-callable same-name behavior", async () => {
    const ast = await parseSource("collision();");
    const table = createTable([
      createSymbol(0, { id: "symbol:collision:function", name: "collision" }),
      createSymbol(1, {
        id: "symbol:collision:variable",
        kind: "variable",
        name: "collision",
        declarationKind: "const",
      }),
    ]);
    const { calls } = buildForFile(ast, table);

    expect(calls[0]?.resolutionState).toBe("RESOLVED");
    expect(calls[0]?.targetSymbolId).toBe("symbol:collision:function");
  });

  // F-002: two imports bound to one name are ambiguous, not first-match. After
  // `var shared = require("./first.js"); var shared = require("./second.js");`
  // a later `shared()` runs the second module's export.
  it("does not pick one of two imports that share a name", async () => {
    const ast = await parseSource("shared();");
    const firstImport = createSymbol(0, {
      id: "import:first",
      kind: "import",
      name: "shared",
      moduleSpecifier: "./first.js",
    });
    const secondImport = createSymbol(1, {
      id: "import:second",
      kind: "import",
      name: "shared",
      moduleSpecifier: "./second.js",
    });
    const table = createTable([firstImport, secondImport]);
    const { calls } = buildForFile(
      ast,
      table,
      new Map([[SOURCE_PATH, [firstImport, secondImport]]]),
      new Map([
        [firstImport.id, "export:first"],
        [secondImport.id, "export:second"],
      ]),
    );

    expect(calls[0]?.resolutionState).toBe("UNRESOLVED");
    expect(calls[0]?.targetSymbolId).toBeUndefined();
  });

  it("preserves import references when non-lexical symbols share the binding name", async () => {
    const ast = await parseSource("shared;");
    const imported = createSymbol(0, {
      id: "import:shared",
      kind: "import",
      name: "shared",
      moduleSpecifier: "./shared.js",
      location: location(1, 0),
    });
    const exported = createSymbol(1, {
      id: "export:shared",
      kind: "export",
      name: "shared",
      location: location(2, 0),
    });
    const { references } = buildForFile(ast, createTable([imported, exported]));

    expect(references.length).toBe(1);
    expect(references[0]?.kind).toBe("identifier");
    expect(references[0]?.name).toBe("shared");
    expect(references[0]?.resolutionState).toBe("RESOLVED");
    expect(references[0]?.resolvedSymbolId).toBe(imported.id);
  });
});

async function parseSource(source: string): Promise<ASTResult> {
  const response = await new JavaScriptParser().parse({
    file: {
      id: "file:call-graph-scaling",
      path: SOURCE_PATH,
      language: "javascript",
      size: source.length,
    },
    source,
  });
  if (response.result === undefined) {
    throw new Error("Expected the scaling fixture to parse successfully.");
  }
  return response.result;
}

function buildForFile(
  ast: ASTResult,
  table: SymbolTable,
  importsByFile: ReadonlyMap<string, readonly { readonly id: string; readonly name: string }[]> = new Map([[SOURCE_PATH, []]]),
  targetByImportId: ReadonlyMap<string, string> = new Map(),
): { readonly calls: readonly SemanticCall[]; readonly references: readonly SymbolReference[] } {
  const calls: SemanticCall[] = [];
  const references: SymbolReference[] = [];
  new DeterministicCallGraphBuilder().buildForFile(
    ast,
    new Map([[SOURCE_PATH, table]]),
    importsByFile,
    targetByImportId,
    new Set(),
    calls,
    references,
  );
  return { calls, references };
}

function observeSymbolExaminations(source: readonly CodeSymbol[]): {
  readonly symbols: readonly CodeSymbol[];
  readonly examinations: () => number;
} {
  let examinations = 0;
  const symbols = new Proxy([...source], {
    get(target, property, receiver) {
      if (typeof property === "string" && /^(?:0|[1-9]\d*)$/.test(property)) {
        examinations += 1;
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { symbols, examinations: () => examinations };
}

function createTable(
  symbols: readonly CodeSymbol[],
  summarySource: readonly CodeSymbol[] = symbols,
): SymbolTable {
  return {
    filePath: SOURCE_PATH,
    language: "javascript",
    symbols,
    summary: {
      classes: summarySource.filter((symbol) => symbol.kind === "class").length,
      exports: summarySource.filter((symbol) => symbol.kind === "export").length,
      functions: summarySource.filter((symbol) => symbol.kind === "function").length,
      imports: summarySource.filter((symbol) => symbol.kind === "import").length,
      methods: summarySource.filter((symbol) => symbol.kind === "method").length,
      variables: summarySource.filter((symbol) => symbol.kind === "variable").length,
    },
  };
}

function createSymbol(
  index: number,
  overrides: Partial<CodeSymbol> = {},
): CodeSymbol {
  return {
    id: `symbol:${index}`,
    kind: "function",
    name: `function${index}`,
    filePath: SOURCE_PATH,
    language: "javascript",
    exported: false,
    defaultExport: false,
    async: false,
    anonymous: false,
    visibility: "public",
    parameters: [],
    scopeId: "scope:module",
    ...overrides,
  };
}

function location(line: number, column: number): NonNullable<CodeSymbol["location"]> {
  return {
    start: { line, column },
    end: { line, column: column + 1 },
  };
}
