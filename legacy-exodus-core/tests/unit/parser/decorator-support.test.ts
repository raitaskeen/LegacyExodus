import { describe, expect, test } from "bun:test";

import {
  JavaScriptParser,
  ParserManager,
  ParserRegistry,
  type ASTNode,
  type ASTResult,
  type ParseRequest,
} from "@parser/index";
import { DeterministicFlowAnalysisEngine } from "@flow/index";
import { JavaScriptSymbolExtractor } from "@symbols/index";

function createRequest(source: string): ParseRequest {
  return {
    file: {
      id: "decorator-fixture",
      path: "src/decorated.js",
      language: "javascript",
      size: source.length,
    },
    source,
  };
}

async function parseJavaScript(source: string): Promise<ASTResult> {
  const registry = new ParserRegistry();
  registry.register(new JavaScriptParser());
  return new ParserManager(registry).parse(createRequest(source));
}

function findNodes(node: ASTNode, type: string): readonly ASTNode[] {
  return [node, ...node.children.flatMap((child) => findNodes(child, type))].filter(
    (candidate) => candidate.type === type,
  );
}

describe("modern decorator parser support", () => {
  test("parses the canonical decorated class through the LegacyExodus adapter", async () => {
    const result = await parseJavaScript("@logged class Foo {}");

    expect(result.errors).toEqual([]);
    expect(findNodes(result.root, "ClassDeclaration")).toHaveLength(1);
    const decorators = findNodes(result.root, "Decorator");
    expect(decorators).toHaveLength(1);
    expect(decorators[0]?.role).toBe("decorators");
    expect(decorators[0]?.children).toHaveLength(1);
    const expression = decorators[0]?.children[0];
    expect(expression?.type).toBe("Identifier");
    expect(expression?.role).toBe("expression");
    expect(expression?.attributes.name).toBe("logged");
    expect(expression?.children).toEqual([]);
    expect(expression?.location).toEqual({
      start: { line: 1, column: 1 },
      end: { line: 1, column: 7 },
    });
  });

  test("keeps ordinary classes and existing public and private members unchanged", async () => {
    const result = await parseJavaScript(
      "class Plain { field = 1; #secret = 2; #method() { return this.#secret; } }",
    );

    expect(result.errors).toEqual([]);
    expect(findNodes(result.root, "ClassDeclaration")).toHaveLength(1);
    expect(findNodes(result.root, "ClassProperty")).toHaveLength(1);
    expect(findNodes(result.root, "ClassPrivateProperty")).toHaveLength(1);
    expect(findNodes(result.root, "ClassPrivateMethod")).toHaveLength(1);
    expect(findNodes(result.root, "Decorator")).toEqual([]);
  });

  test("rejects malformed decorator syntax deterministically", async () => {
    const first = await parseJavaScript("@ class Foo {}");
    const second = await parseJavaScript("@ class Foo {}");

    expect(first.root.type).toBe("Program");
    expect(first.root.children).toEqual([]);
    expect(first.errors.map((error) => error.code)).toEqual(["UnexpectedLeadingDecorator"]);
    expect(second.errors).toEqual(first.errors);
  });

  test("rejects legacy-only object-member decorators", async () => {
    const result = await parseJavaScript("const value = { @logged method() {} };");

    expect(result.errors.map((error) => error.code)).toEqual(["UnsupportedPropertyDecorator"]);
  });

  test("preserves decorator nodes while symbol extraction ignores decorator semantics", async () => {
    const result = await parseJavaScript("@logged class Foo {}");
    const table = new JavaScriptSymbolExtractor().extract(result);

    expect(table.symbols.map((symbol) => ({ kind: symbol.kind, name: symbol.name }))).toEqual([
      { kind: "class", name: "Foo" },
    ]);
    expect(table.summary).toMatchObject({ classes: 1 });
  });

  test("produces deterministic normalized AST structure for repeated decorator parses", async () => {
    const first = await parseJavaScript("@logged class Foo {}");
    const second = await parseJavaScript("@logged class Foo {}");

    expect(second.root).toEqual(first.root);
    expect(second.errors).toEqual(first.errors);
    expect(second.warnings).toEqual(first.warnings);
  });

  test("keeps downstream control and data-flow construction deterministic and static", async () => {
    const ast = await parseJavaScript("@logged class Foo {}");
    const table = new JavaScriptSymbolExtractor().extract(ast);
    const engine = new DeterministicFlowAnalysisEngine();

    const first = engine.analyze([ast], undefined, [table]);
    const second = engine.analyze([ast], undefined, [table]);

    expect(first.controlFlowGraphs).toHaveLength(1);
    expect(first.controlFlowGraphs[0]?.scopeName).toBe("module");
    expect(first.dataFlowGraphs).toHaveLength(1);
    expect(first.dataFlowGraphs[0]?.filePath).toBe("src/decorated.js");
    expect(second).toEqual(first);
  });
});
