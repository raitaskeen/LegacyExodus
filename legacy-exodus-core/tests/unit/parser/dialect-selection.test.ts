import { describe, expect, test } from "bun:test";

import {
  JavaScriptParser,
  ParserManager,
  ParserRegistry,
  type ASTNode,
  type ASTResult,
  type ParseRequest,
} from "@parser/index";
// Namespace import: until the per-path options function exists, only the option-shape tests fail
// (not-a-function) while the behavioural tests below fail for their real reason (parse errors).
import * as dialects from "@parser/adapters/javascript/javascript-parser-options";

const TYPESCRIPT_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

function languageOf(path: string): string {
  const lower = path.toLowerCase();
  return TYPESCRIPT_EXTENSIONS.some((extension) => lower.endsWith(extension)) ? "typescript" : "javascript";
}

function createRequest(source: string, path: string): ParseRequest {
  return {
    file: { id: `dialect:${path}`, path, language: languageOf(path), size: source.length },
    source,
  };
}

async function parseAs(path: string, source: string): Promise<ASTResult> {
  const registry = new ParserRegistry();
  registry.register(new JavaScriptParser());
  return new ParserManager(registry).parse(createRequest(source, path));
}

function findNodes(node: ASTNode, type: string): readonly ASTNode[] {
  return [node, ...node.children.flatMap((child) => findNodes(child, type))].filter(
    (candidate) => candidate.type === type,
  );
}

function codes(result: ASTResult): readonly string[] {
  return result.errors.map((error) => error.code);
}

describe("TypeScript dialects (.ts, .mts, .cts)", () => {
  test("parses an angle-bracket type assertion in .ts", async () => {
    const result = await parseAs("src/cast.ts", "declare const value: unknown;\nexport const n = <number>value;\n");

    expect(codes(result)).toEqual([]);
    expect(findNodes(result.root, "TSTypeAssertion")).toHaveLength(1);
  });

  test("parses a single-parameter generic arrow function without trailing comma in .ts", async () => {
    const result = await parseAs("src/generic-arrow.ts", "export const identity = <T>(x: T): T => x;\n");

    expect(codes(result)).toEqual([]);
    expect(findNodes(result.root, "ArrowFunctionExpression")).toHaveLength(1);
  });

  test("applies the same TypeScript rules to .mts and .cts", async () => {
    for (const path of ["src/cast.mts", "src/cast.cts"]) {
      const result = await parseAs(path, "declare const value: unknown;\nexport const n = <number>value;\n");
      expect(codes(result)).toEqual([]);
    }
  });

  test("matches extensions case-insensitively", async () => {
    const result = await parseAs("SRC/CAST.TS", "declare const value: unknown;\nexport const n = <number>value;\n");

    expect(codes(result)).toEqual([]);
  });
});

describe("TSX dialect (.tsx)", () => {
  test("parses JSX in .tsx", async () => {
    const result = await parseAs("src/view.tsx", 'export const view = <div className="a">{1}</div>;\n');

    expect(codes(result)).toEqual([]);
    expect(findNodes(result.root, "JSXElement")).toHaveLength(1);
  });

  test("keeps TSX semantics: the same generic arrow is a syntax error in .tsx", async () => {
    const result = await parseAs("src/generic-arrow.tsx", "export const identity = <T>(x: T): T => x;\n");

    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("keeps TSX semantics: a trailing comma makes the generic arrow valid in .tsx", async () => {
    const result = await parseAs("src/generic-arrow.tsx", "export const identity = <T,>(x: T): T => x;\n");

    expect(codes(result)).toEqual([]);
  });
});

describe("declaration files (.d.ts, .d.mts, .d.cts)", () => {
  const declaration = "export const limit: number;\n";

  test("parses a declaration without initializer in .d.ts", async () => {
    const result = await parseAs("typings/index.d.ts", declaration);

    expect(codes(result)).toEqual([]);
  });

  test("parses the same declaration in .d.mts and .d.cts", async () => {
    for (const path of ["typings/index.d.mts", "typings/index.d.cts"]) {
      const result = await parseAs(path, declaration);
      expect(codes(result)).toEqual([]);
    }
  });

  test("the same line in a .ts implementation file is an error", async () => {
    const result = await parseAs("src/limit.ts", declaration);

    expect(codes(result)).toContain("DeclarationMissingInitializer");
  });
});

describe("JavaScript dialects (.js, .jsx, .mjs, .cjs)", () => {
  test("treats a < b > (c) as relational operators in .js, not a generic call", async () => {
    const result = await parseAs("src/relational.js", "const a = 1, b = 2, c = 3;\nexport const r = a < b > (c);\n");

    expect(codes(result)).toEqual([]);
    expect(findNodes(result.root, "CallExpression")).toHaveLength(0);
    expect(findNodes(result.root, "BinaryExpression")).toHaveLength(2);
  });

  test("parses JSX in .js and .jsx", async () => {
    for (const path of ["src/view.js", "src/view.jsx"]) {
      const result = await parseAs(path, "export const view = <div className=\"a\">{1}</div>;\n");
      expect(codes(result)).toEqual([]);
      expect(findNodes(result.root, "JSXElement")).toHaveLength(1);
    }
  });

  test("parses Flow-annotated JavaScript with an @flow pragma", async () => {
    const result = await parseAs("src/flow.js", '// @flow\nfunction f(x: number): string { return "" + x; }\n');

    expect(codes(result)).toEqual([]);
    expect(findNodes(result.root, "FunctionDeclaration")).toHaveLength(1);
  });

  test("parses top-level await in .mjs", async () => {
    const result = await parseAs("src/main.mjs", "const value = await Promise.resolve(1);\nexport { value };\n");

    expect(codes(result)).toEqual([]);
    expect(findNodes(result.root, "AwaitExpression")).toHaveLength(1);
  });

  test("parses top-level return in .cjs (Node's CommonJS wrapper)", async () => {
    const result = await parseAs("src/main.cjs", "if (process.argv.length > 99) return;\nmodule.exports = 1;\n");

    expect(codes(result)).toEqual([]);
    expect(findNodes(result.root, "ReturnStatement")).toHaveLength(1);
  });

  test("still rejects top-level return in .js", async () => {
    const result = await parseAs("src/main.js", "if (process.argv.length > 99) return;\nmodule.exports = 1;\n");

    expect(codes(result)).toContain("IllegalReturn");
  });
});

describe("real syntax errors", () => {
  test("still yield a located error in every dialect", async () => {
    for (const path of ["a.js", "a.jsx", "a.mjs", "a.cjs", "a.ts", "a.mts", "a.cts", "a.tsx", "a.d.ts"]) {
      const result = await parseAs(path, "const = ;\n");

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.location?.line).toBe(1);
    }
  });
});

describe("javascriptParserOptionsFor", () => {
  const optionsFor = (path: string) => dialects.javascriptParserOptionsFor(path);

  test("selects the declaration-file dialect", () => {
    for (const path of ["a.d.ts", "a.d.mts", "a.d.cts", "A.D.TS"]) {
      expect(optionsFor(path).plugins).toEqual([["typescript", { dts: true }], "decorators"]);
    }
  });

  test("selects the TypeScript dialect without jsx", () => {
    for (const path of ["a.ts", "a.mts", "a.cts", "A.TS"]) {
      expect(optionsFor(path).plugins).toEqual(["typescript", "decorators"]);
    }
  });

  test("selects the TSX dialect", () => {
    expect(optionsFor("a.tsx").plugins).toEqual(["jsx", "typescript", "decorators"]);
  });

  test("selects the Flow-compatible JavaScript dialect", () => {
    for (const path of ["a.js", "a.jsx", "a.mjs", "a.cjs", "a.JS"]) {
      expect(optionsFor(path).plugins).toEqual(["jsx", ["flow", { all: false }], "decorators"]);
    }
  });

  test("selects the source type per extension", () => {
    const sourceTypes: Readonly<Record<string, "module" | "script" | "unambiguous">> = {
      "a.mjs": "module",
      "a.mts": "module",
      "a.d.mts": "module",
      "a.cts": "module",
      "a.d.cts": "module",
      "a.cjs": "script",
      "a.js": "unambiguous",
      "a.jsx": "unambiguous",
      "a.ts": "unambiguous",
      "a.d.ts": "unambiguous",
      "a.tsx": "unambiguous",
    };
    for (const [path, sourceType] of Object.entries(sourceTypes)) {
      expect(optionsFor(path).sourceType).toBe(sourceType);
    }
  });

  test("allows top-level return only for .cjs and always recovers from errors", () => {
    for (const path of ["a.js", "a.jsx", "a.mjs", "a.ts", "a.mts", "a.cts", "a.tsx", "a.d.ts"]) {
      expect(optionsFor(path).allowReturnOutsideFunction).toBe(false);
    }
    expect(optionsFor("a.cjs").allowReturnOutsideFunction).toBe(true);
    for (const path of ["a.js", "a.cjs", "a.ts", "a.tsx", "a.d.ts"]) {
      expect(optionsFor(path).errorRecovery).toBe(true);
    }
  });

  test("is a pure function of the path", () => {
    const first = optionsFor("src/a.ts");
    const second = optionsFor("src/a.ts");

    expect(second).toEqual(first);
    expect(optionsFor("other/dir/a.ts")).toEqual(first);
    expect(optionsFor("src/a.js")).not.toEqual(first);
  });
});
