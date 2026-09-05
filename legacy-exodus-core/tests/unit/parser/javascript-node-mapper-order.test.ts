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

async function parseSource(source: string): Promise<ASTNode> {
  const registry = new ParserRegistry();
  registry.register(new JavaScriptParser());
  const response = await new ParserManager(registry).parse(createRequest(source));
  return response.root;
}

function findFirstNode(node: ASTNode, type: string): ASTNode | undefined {
  if (node.type === type) return node;
  for (const child of node.children) {
    const found = findFirstNode(child, type);
    if (found !== undefined) return found;
  }
  return undefined;
}

function getChildRoles(node: ASTNode): readonly (string | undefined)[] {
  return node.children.map((child) => child.role);
}

describe("F-06: AST Child Traversal Order & Source Evaluation Order Integrity", () => {
  test("Test 1 — IfStatement preserves test -> consequent -> alternate order", async () => {
    const root = await parseSource(`
      if (condition) {
        thenBranch();
      } else {
        elseBranch();
      }
    `);

    const ifNode = findFirstNode(root, "IfStatement");
    expect(ifNode).toBeDefined();
    expect(getChildRoles(ifNode!)).toEqual(["test", "consequent", "alternate"]);

    const testChild = ifNode!.children[0]!;
    const consequentChild = ifNode!.children[1]!;
    const alternateChild = ifNode!.children[2]!;

    expect(testChild.role).toBe("test");
    expect(testChild.type).toBe("Identifier");
    expect(consequentChild.role).toBe("consequent");
    expect(consequentChild.type).toBe("BlockStatement");
    expect(alternateChild.role).toBe("alternate");
    expect(alternateChild.type).toBe("BlockStatement");

    // Source position verification
    expect(testChild.location!.start.line).toBeLessThanOrEqual(consequentChild.location!.start.line);
    expect(consequentChild.location!.start.line).toBeLessThanOrEqual(alternateChild.location!.start.line);
  });

  test("Test 2 — ForStatement preserves init -> test -> update -> body order", async () => {
    const root = await parseSource(`
      for (let i = 0; check(i); i++) {
        work(i);
      }
    `);

    const forNode = findFirstNode(root, "ForStatement");
    expect(forNode).toBeDefined();
    expect(getChildRoles(forNode!)).toEqual(["init", "test", "update", "body"]);

    expect(forNode!.children[0]!.role).toBe("init");
    expect(forNode!.children[0]!.type).toBe("VariableDeclaration");
    expect(forNode!.children[1]!.role).toBe("test");
    expect(forNode!.children[1]!.type).toBe("CallExpression");
    expect(forNode!.children[2]!.role).toBe("update");
    expect(forNode!.children[2]!.type).toBe("UpdateExpression");
    expect(forNode!.children[3]!.role).toBe("body");
    expect(forNode!.children[3]!.type).toBe("BlockStatement");
  });

  test("Test 3 — CallExpression preserves callee -> arguments order and argument source order", async () => {
    const root = await parseSource(`
      receiver.doSomething(first(), second());
    `);

    const callNode = findFirstNode(root, "CallExpression");
    expect(callNode).toBeDefined();
    expect(getChildRoles(callNode!)).toEqual(["callee", "arguments", "arguments"]);

    expect(callNode!.children[0]!.role).toBe("callee");
    expect(callNode!.children[0]!.type).toBe("MemberExpression");
    expect(callNode!.children[1]!.role).toBe("arguments");
    expect(callNode!.children[2]!.role).toBe("arguments");

    // Arguments must remain in source order
    const arg1 = callNode!.children[1]!;
    const arg2 = callNode!.children[2]!;
    expect(arg1.location!.start.column).toBeLessThan(arg2.location!.start.column);
  });

  test("Test 4 — BinaryExpression preserves left -> right order", async () => {
    const root = await parseSource(`
      left() + right();
    `);

    const binNode = findFirstNode(root, "BinaryExpression");
    expect(binNode).toBeDefined();
    expect(getChildRoles(binNode!)).toEqual(["left", "right"]);
    expect(binNode!.children[0]!.role).toBe("left");
    expect(binNode!.children[1]!.role).toBe("right");
    expect(binNode!.children[0]!.location!.start.column).toBeLessThan(
      binNode!.children[1]!.location!.start.column,
    );
  });

  test("Test 5 — LogicalExpression preserves left -> right order", async () => {
    const root = await parseSource(`
      first() && second();
    `);

    const logNode = findFirstNode(root, "LogicalExpression");
    expect(logNode).toBeDefined();
    expect(getChildRoles(logNode!)).toEqual(["left", "right"]);
    expect(logNode!.children[0]!.role).toBe("left");
    expect(logNode!.children[1]!.role).toBe("right");
  });

  test("Test 6 — ConditionalExpression preserves test -> consequent -> alternate order", async () => {
    const root = await parseSource(`
      condition ? yes() : no();
    `);

    const condNode = findFirstNode(root, "ConditionalExpression");
    expect(condNode).toBeDefined();
    expect(getChildRoles(condNode!)).toEqual(["test", "consequent", "alternate"]);
    expect(condNode!.children[0]!.role).toBe("test");
    expect(condNode!.children[1]!.role).toBe("consequent");
    expect(condNode!.children[2]!.role).toBe("alternate");
  });

  test("Test 7 — AssignmentExpression preserves left -> right order", async () => {
    const root = await parseSource(`
      target = compute();
    `);

    const assignNode = findFirstNode(root, "AssignmentExpression");
    expect(assignNode).toBeDefined();
    expect(getChildRoles(assignNode!)).toEqual(["left", "right"]);
    expect(assignNode!.children[0]!.role).toBe("left");
    expect(assignNode!.children[1]!.role).toBe("right");
  });

  test("Test 8 — MemberExpression preserves object -> property order for non-computed and computed", async () => {
    const rootNonComputed = await parseSource(`getObject().property;`);
    const memNonComp = findFirstNode(rootNonComputed, "MemberExpression");
    expect(memNonComp).toBeDefined();
    expect(getChildRoles(memNonComp!)).toEqual(["object", "property"]);
    expect(memNonComp!.children[0]!.role).toBe("object");
    expect(memNonComp!.children[1]!.role).toBe("property");

    const rootComputed = await parseSource(`getObject()[getProperty()];`);
    const memComp = findFirstNode(rootComputed, "MemberExpression");
    expect(memComp).toBeDefined();
    expect(getChildRoles(memComp!)).toEqual(["object", "property"]);
    expect(memComp!.children[0]!.role).toBe("object");
    expect(memComp!.children[1]!.role).toBe("property");
  });

  test("Test 9 — TryStatement preserves block -> handler -> finalizer order (handler before finalizer)", async () => {
    const root = await parseSource(`
      try {
        risky();
      } catch (error) {
        recover(error);
      } finally {
        cleanup();
      }
    `);

    const tryNode = findFirstNode(root, "TryStatement");
    expect(tryNode).toBeDefined();
    expect(getChildRoles(tryNode!)).toEqual(["block", "handler", "finalizer"]);
    expect(tryNode!.children[0]!.role).toBe("block");
    expect(tryNode!.children[1]!.role).toBe("handler");
    expect(tryNode!.children[1]!.type).toBe("CatchClause");
    expect(tryNode!.children[2]!.role).toBe("finalizer");
    expect(tryNode!.children[2]!.type).toBe("BlockStatement");
  });

  test("Test 10 — Nested Evaluation preserves recursive source and evaluation order", async () => {
    const root = await parseSource(`
      outer(first(), second() + third());
    `);

    const outerCall = findFirstNode(root, "CallExpression");
    expect(outerCall).toBeDefined();
    expect(getChildRoles(outerCall!)).toEqual(["callee", "arguments", "arguments"]);

    const binArg = outerCall!.children[2]!;
    expect(binArg.type).toBe("BinaryExpression");
    expect(getChildRoles(binArg)).toEqual(["left", "right"]);
  });

  test("Test 11 — ArrayExpression preserves element source order", async () => {
    const root = await parseSource(`
      [first(), second(), third()];
    `);

    const arrNode = findFirstNode(root, "ArrayExpression");
    expect(arrNode).toBeDefined();
    expect(arrNode!.children).toHaveLength(3);
    for (const child of arrNode!.children) {
      expect(child.role).toBe("elements");
    }
    expect(arrNode!.children[0]!.location!.start.column).toBeLessThan(
      arrNode!.children[1]!.location!.start.column,
    );
    expect(arrNode!.children[1]!.location!.start.column).toBeLessThan(
      arrNode!.children[2]!.location!.start.column,
    );
  });

  test("Test 12 — ObjectExpression preserves property source order", async () => {
    const root = await parseSource(`
      ({
        first: one(),
        second: two(),
        third: three()
      });
    `);

    const objNode = findFirstNode(root, "ObjectExpression");
    expect(objNode).toBeDefined();
    expect(objNode!.children).toHaveLength(3);
    for (const child of objNode!.children) {
      expect(child.role).toBe("properties");
    }
    expect(objNode!.children[0]!.location!.start.line).toBeLessThan(
      objNode!.children[1]!.location!.start.line,
    );
    expect(objNode!.children[1]!.location!.start.line).toBeLessThan(
      objNode!.children[2]!.location!.start.line,
    );
  });

  test("Test 13 — TemplateLiteral preserves expression interpolation order", async () => {
    const root = await parseSource("`${first()}-${second()}-${third()}`;");

    const templateNode = findFirstNode(root, "TemplateLiteral");
    expect(templateNode).toBeDefined();

    const exprChildren = templateNode!.children.filter((c) => c.role === "expressions");
    expect(exprChildren).toHaveLength(3);
    expect(exprChildren[0]!.location!.start.column).toBeLessThan(
      exprChildren[1]!.location!.start.column,
    );
    expect(exprChildren[1]!.location!.start.column).toBeLessThan(
      exprChildren[2]!.location!.start.column,
    );
  });

  test("Test 14 — Determinism across repeated parser invocations", async () => {
    const source = `
      function complexWorkflow(items) {
        if (items.length === 0) {
          return null;
        }
        for (let i = 0; i < items.length; i++) {
          try {
            processItem(items[i]);
          } catch (err) {
            logError(err);
          } finally {
            cleanup();
          }
        }
      }
    `;

    const runs = await Promise.all([
      parseSource(source),
      parseSource(source),
      parseSource(source),
      parseSource(source),
      parseSource(source),
    ]);

    const serializedFirst = JSON.stringify(runs[0]);
    for (let i = 1; i < runs.length; i++) {
      expect(JSON.stringify(runs[i])).toBe(serializedFirst);
    }
  });

  test("Negative / Contract: WhileStatement and DoWhileStatement preserve canonical order", async () => {
    const whileRoot = await parseSource(`while (condition) { loopBody(); }`);
    const whileNode = findFirstNode(whileRoot, "WhileStatement");
    expect(whileNode).toBeDefined();
    expect(getChildRoles(whileNode!)).toEqual(["test", "body"]);

    const doWhileRoot = await parseSource(`do { loopBody(); } while (condition);`);
    const doWhileNode = findFirstNode(doWhileRoot, "DoWhileStatement");
    expect(doWhileNode).toBeDefined();
    expect(getChildRoles(doWhileNode!)).toEqual(["body", "test"]);
  });

  test("Negative / Contract: SwitchCase and LabeledStatement preserve canonical order", async () => {
    const switchRoot = await parseSource(`switch (x) { case 1: work(); break; default: def(); }`);
    const caseNode = findFirstNode(switchRoot, "SwitchCase");
    expect(caseNode).toBeDefined();
    expect(getChildRoles(caseNode!)).toEqual(["test", "consequent", "consequent"]);

    const labelRoot = await parseSource(`lbl: while (true) { break lbl; }`);
    const labelNode = findFirstNode(labelRoot, "LabeledStatement");
    expect(labelNode).toBeDefined();
    expect(getChildRoles(labelNode!)).toEqual(["label", "body"]);
  });

  test("Negative / Contract: preserves attributes, locations, nodeCount, and node roles", async () => {
    const root = await parseSource(`
      export const magic = 42;
      import { util } from "./util";
    `);

    const varDecl = findFirstNode(root, "VariableDeclaration");
    expect(varDecl).toBeDefined();
    expect(varDecl!.attributes.kind).toBe("const");
    expect(varDecl!.location).toBeDefined();
    expect(varDecl!.location!.start.line).toBeGreaterThan(0);

    const importSpec = findFirstNode(root, "ImportSpecifier");
    expect(importSpec).toBeDefined();
    expect(importSpec!.attributes.importedName).toBe("util");
    expect(importSpec!.attributes.localName).toBe("util");
  });
});
