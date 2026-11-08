import { describe, expect, test } from "bun:test";

import {
  JavaScriptParser,
  ParserManager,
  ParserRegistry,
  type ASTNode,
  type ParseRequest,
} from "@parser/index";

function createRequest(source: string, path = "src/example.js"): ParseRequest {
  return {
    file: {
      id: "javascript-file",
      path,
      language: "javascript",
      size: source.length,
    },
    source,
  };
}

async function parseJavaScript(source: string): Promise<ASTNode> {
  const registry = new ParserRegistry();
  registry.register(new JavaScriptParser());
  const result = await new ParserManager(registry).parse(createRequest(source));

  return result.root;
}

function findNodes(node: ASTNode, type: string): readonly ASTNode[] {
  return [node, ...node.children.flatMap((child) => findNodes(child, type))].filter(
    (candidate) => candidate.type === type,
  );
}

describe("JavaScriptParser", () => {
  test("registers and is selected by ParserManager for JavaScript", async (): Promise<void> => {
    const registry = new ParserRegistry();
    const parser = new JavaScriptParser();
    registry.register(parser);

    expect(registry.findByLanguage("javascript")).toBe(parser);

    const result = await new ParserManager(registry).parse(createRequest("const value = 1;"));
    expect(result.metadata.parserId).toBe("javascript-parser");
  });

  test("parses an empty JavaScript file into an immutable Program", async (): Promise<void> => {
    const registry = new ParserRegistry();
    registry.register(new JavaScriptParser());

    const result = await new ParserManager(registry).parse(createRequest(""));

    expect(result.root.type).toBe("Program");
    expect(result.root.children).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.root.children)).toBe(true);
  });

  test("maps imports, exports, variables, functions, classes, and source locations", async (): Promise<void> => {
    const root = await parseJavaScript(`
      import value from "./value.js";
      export const catalog = [];
      export function listBooks() { return catalog; }
      export default class Library { find() { return listBooks(); } }
    `);

    expect(findNodes(root, "ImportDeclaration")).toHaveLength(1);
    expect(findNodes(root, "ExportNamedDeclaration")).toHaveLength(2);
    expect(findNodes(root, "ExportDefaultDeclaration")).toHaveLength(1);
    expect(findNodes(root, "VariableDeclaration")).toHaveLength(1);
    expect(findNodes(root, "FunctionDeclaration")).toHaveLength(1);
    expect(findNodes(root, "ClassDeclaration")).toHaveLength(1);
    expect(root.location?.start.line).toBeGreaterThan(0);
  });

  test("preserves nested function structure", async (): Promise<void> => {
    const root = await parseJavaScript(`
      function outer() {
        function inner() { return 1; }
        return inner();
      }
    `);

    expect(findNodes(root, "FunctionDeclaration")).toHaveLength(2);
  });

  test("returns deterministic diagnostics for syntax errors", async (): Promise<void> => {
    const registry = new ParserRegistry();
    registry.register(new JavaScriptParser());

    const result = await new ParserManager(registry).parse(createRequest("const = ;"));

    expect(result.root.type).toBe("Program");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBeTruthy();
    expect(result.errors[0]?.location?.line).toBe(1);
  });
});

describe("NA-10 resource limits are not syntax errors", () => {
  test("a valid file too long for the parser's call stack is a PARSER_RESOURCE_LIMIT", async () => {
    const source = `let y = 1${" + 1".repeat(100_000)};\n`;
    const response = await new JavaScriptParser().parse(createRequest(source));
    expect(response.result.errors.map((error) => error.code)).toEqual(["PARSER_RESOURCE_LIMIT"]);
    expect(response.result.errors[0]?.message).toContain("not a syntax error");
  });

  test("a real syntax error keeps its syntax error code", async () => {
    const response = await new JavaScriptParser().parse(createRequest("let = ;\n"));
    expect(response.result.errors.length).toBeGreaterThan(0);
    expect(response.result.errors.map((error) => error.code)).not.toContain("PARSER_RESOURCE_LIMIT");
  });
});
