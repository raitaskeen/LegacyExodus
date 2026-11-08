import type { ASTAttribute, ASTNode, SourceLocation } from "@parser/contracts/ast-node";
import { immutable } from "@shared/immutability";

interface BabelPosition {
  readonly line: number;
  readonly column: number;
}

interface BabelLocation {
  readonly start: BabelPosition;
  readonly end: BabelPosition;
}

interface BabelNode {
  readonly type: string;
  readonly loc?: BabelLocation | null;
  readonly [key: string]: unknown;
}

export interface JavaScriptNodeMapping {
  readonly node: ASTNode;
  readonly nodeCount: number;
}

export function mapJavaScriptNode(value: unknown): JavaScriptNodeMapping {
  if (!isBabelNode(value)) {
    throw new TypeError("A Babel AST node is required for mapping.");
  }

  return mapNode(value);
}

const CANONICAL_CHILD_KEYS: Readonly<Record<string, readonly string[]>> = immutable({
  IfStatement: immutable(["test", "consequent", "alternate"]),
  ConditionalExpression: immutable(["test", "consequent", "alternate"]),
  ForStatement: immutable(["init", "test", "update", "body"]),
  ForInStatement: immutable(["left", "right", "body"]),
  ForOfStatement: immutable(["left", "right", "body"]),
  WhileStatement: immutable(["test", "body"]),
  DoWhileStatement: immutable(["body", "test"]),
  SwitchStatement: immutable(["discriminant", "cases"]),
  SwitchCase: immutable(["test", "consequent"]),
  TryStatement: immutable(["block", "handler", "finalizer"]),
  CatchClause: immutable(["param", "body"]),
  CallExpression: immutable(["callee", "arguments"]),
  NewExpression: immutable(["callee", "arguments"]),
  MemberExpression: immutable(["object", "property"]),
  OptionalMemberExpression: immutable(["object", "property"]),
  BinaryExpression: immutable(["left", "right"]),
  LogicalExpression: immutable(["left", "right"]),
  AssignmentExpression: immutable(["left", "right"]),
  AssignmentPattern: immutable(["left", "right"]),
  FunctionDeclaration: immutable(["id", "params", "body"]),
  FunctionExpression: immutable(["id", "params", "body"]),
  ArrowFunctionExpression: immutable(["params", "body"]),
  ClassDeclaration: immutable(["id", "superClass", "body"]),
  ClassExpression: immutable(["id", "superClass", "body"]),
  ClassMethod: immutable(["key", "params", "body"]),
  ClassPrivateMethod: immutable(["key", "params", "body"]),
  ClassProperty: immutable(["key", "value"]),
  ClassPrivateProperty: immutable(["key", "value"]),
  PropertyDefinition: immutable(["key", "value"]),
  ClassAccessorProperty: immutable(["key", "value"]),
  ObjectMethod: immutable(["key", "params", "body"]),
  ObjectProperty: immutable(["key", "value"]),
  VariableDeclarator: immutable(["id", "init"]),
  LabeledStatement: immutable(["label", "body"]),
  TaggedTemplateExpression: immutable(["tag", "quasi"]),
  WithStatement: immutable(["object", "body"]),
  ReturnStatement: immutable(["argument"]),
  ThrowStatement: immutable(["argument"]),
  AwaitExpression: immutable(["argument"]),
  YieldExpression: immutable(["argument"]),
  UnaryExpression: immutable(["argument"]),
  UpdateExpression: immutable(["argument"]),
  SpreadElement: immutable(["argument"]),
  RestElement: immutable(["argument"]),
  ExportNamedDeclaration: immutable(["declaration", "specifiers", "source"]),
  ExportDefaultDeclaration: immutable(["declaration"]),
  ExportAllDeclaration: immutable(["source"]),
  ImportDeclaration: immutable(["specifiers", "source"]),
  ImportSpecifier: immutable(["imported", "local"]),
  ImportDefaultSpecifier: immutable(["local"]),
  ImportNamespaceSpecifier: immutable(["local"]),
});

function getOrderedNodeKeys(node: BabelNode): readonly string[] {
  const canonical = CANONICAL_CHILD_KEYS[node.type];
  const allKeys = Object.keys(node);
  if (canonical === undefined) {
    return allKeys;
  }

  const ordered: string[] = [];
  for (let i = 0; i < canonical.length; i++) {
    const key = canonical[i]!;
    if (key in node) {
      ordered.push(key);
    }
  }

  for (let i = 0; i < allKeys.length; i++) {
    const key = allKeys[i]!;
    if (!canonical.includes(key)) {
      ordered.push(key);
    }
  }

  return ordered;
}

function mapNode(node: BabelNode, role?: string): JavaScriptNodeMapping {
  const children: ASTNode[] = [];
  let nodeCount = 1;
  const attributes: Record<string, ASTAttribute> = {};

  for (const key of getOrderedNodeKeys(node)) {
    if (key === "loc" || key === "type") {
      continue;
    }

    const value = node[key];

    if (isASTAttribute(value)) {
      attributes[key] = value;
      continue;
    }

    if (isBabelNode(value)) {
      const child = mapNode(value, key);
      children.push(child.node);
      nodeCount += child.nodeCount;
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === null && key === "elements") {
          children.push(
            immutable({
              type: "ArrayHole",
              role: key,
              attributes: immutable({}),
              children: immutable([]),
            }),
          );
          nodeCount += 1;
          continue;
        }

        if (isBabelNode(item)) {
          const child = mapNode(item, key);
          children.push(child.node);
          nodeCount += child.nodeCount;
          continue;
        }
      }
    }
  }

  if (node.type === "ExportSpecifier" || node.type === "ExportNamespaceSpecifier") {
    const exportedName = readBabelIdentifierName(node.exported);
    const sourceSymbolName = readBabelIdentifierName(node.local);

    if (exportedName !== undefined) {
      attributes.exportedName = exportedName;
    }
    if (sourceSymbolName !== undefined) {
      attributes.sourceSymbolName = sourceSymbolName;
    }
  }

  if (node.type === "ImportSpecifier") {
    const importedName = readBabelIdentifierName(node.imported);
    const localName = readBabelIdentifierName(node.local);
    if (importedName !== undefined) {
      attributes.importedName = importedName;
      attributes.sourceSymbolName = importedName;
    }
    if (localName !== undefined) {
      attributes.localName = localName;
    }
  }

  if (node.type === "TemplateElement" && typeof node.value === "object" && node.value !== null) {
    const raw = (node.value as { readonly raw?: unknown }).raw;
    const cooked = (node.value as { readonly cooked?: unknown }).cooked;
    if (typeof raw === "string") {
      attributes.raw = raw;
    }
    if (typeof cooked === "string") {
      attributes.cooked = cooked;
    }
    const val = cooked ?? raw;
    if (typeof val === "string") {
      attributes.value = val;
    }
  }

  return {
    node: {
      type: node.type,
      role,
      location: mapLocation(node.loc),
      attributes,
      children,
    },
    nodeCount,
  };
}

function readBabelIdentifierName(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value !== "object" || value === null || !("name" in value)) {
    return undefined;
  }

  const name = (value as { readonly name: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

function isBabelNode(value: unknown): value is BabelNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { readonly type: unknown }).type === "string"
  );
}

function isASTAttribute(value: unknown): value is ASTAttribute {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

function mapLocation(location: BabelLocation | null | undefined): SourceLocation | undefined {
  if (location === null || location === undefined) {
    return undefined;
  }

  return {
    start: { line: location.start.line, column: location.start.column },
    end: { line: location.end.line, column: location.end.column },
  };
}
