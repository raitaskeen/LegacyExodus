import type { ASTAttribute, ASTNode, SourceLocation } from "@parser/contracts/ast-node";

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

const CANONICAL_CHILD_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  IfStatement: Object.freeze(["test", "consequent", "alternate"]),
  ConditionalExpression: Object.freeze(["test", "consequent", "alternate"]),
  ForStatement: Object.freeze(["init", "test", "update", "body"]),
  ForInStatement: Object.freeze(["left", "right", "body"]),
  ForOfStatement: Object.freeze(["left", "right", "body"]),
  WhileStatement: Object.freeze(["test", "body"]),
  DoWhileStatement: Object.freeze(["body", "test"]),
  SwitchStatement: Object.freeze(["discriminant", "cases"]),
  SwitchCase: Object.freeze(["test", "consequent"]),
  TryStatement: Object.freeze(["block", "handler", "finalizer"]),
  CatchClause: Object.freeze(["param", "body"]),
  CallExpression: Object.freeze(["callee", "arguments"]),
  NewExpression: Object.freeze(["callee", "arguments"]),
  MemberExpression: Object.freeze(["object", "property"]),
  OptionalMemberExpression: Object.freeze(["object", "property"]),
  BinaryExpression: Object.freeze(["left", "right"]),
  LogicalExpression: Object.freeze(["left", "right"]),
  AssignmentExpression: Object.freeze(["left", "right"]),
  AssignmentPattern: Object.freeze(["left", "right"]),
  FunctionDeclaration: Object.freeze(["id", "params", "body"]),
  FunctionExpression: Object.freeze(["id", "params", "body"]),
  ArrowFunctionExpression: Object.freeze(["params", "body"]),
  ClassDeclaration: Object.freeze(["id", "superClass", "body"]),
  ClassExpression: Object.freeze(["id", "superClass", "body"]),
  ClassMethod: Object.freeze(["key", "params", "body"]),
  ClassPrivateMethod: Object.freeze(["key", "params", "body"]),
  ClassProperty: Object.freeze(["key", "value"]),
  ClassPrivateProperty: Object.freeze(["key", "value"]),
  PropertyDefinition: Object.freeze(["key", "value"]),
  ClassAccessorProperty: Object.freeze(["key", "value"]),
  ObjectMethod: Object.freeze(["key", "params", "body"]),
  ObjectProperty: Object.freeze(["key", "value"]),
  VariableDeclarator: Object.freeze(["id", "init"]),
  LabeledStatement: Object.freeze(["label", "body"]),
  TaggedTemplateExpression: Object.freeze(["tag", "quasi"]),
  WithStatement: Object.freeze(["object", "body"]),
  ReturnStatement: Object.freeze(["argument"]),
  ThrowStatement: Object.freeze(["argument"]),
  AwaitExpression: Object.freeze(["argument"]),
  YieldExpression: Object.freeze(["argument"]),
  UnaryExpression: Object.freeze(["argument"]),
  UpdateExpression: Object.freeze(["argument"]),
  SpreadElement: Object.freeze(["argument"]),
  RestElement: Object.freeze(["argument"]),
  ExportNamedDeclaration: Object.freeze(["declaration", "specifiers", "source"]),
  ExportDefaultDeclaration: Object.freeze(["declaration"]),
  ExportAllDeclaration: Object.freeze(["source"]),
  ImportDeclaration: Object.freeze(["specifiers", "source"]),
  ImportSpecifier: Object.freeze(["imported", "local"]),
  ImportDefaultSpecifier: Object.freeze(["local"]),
  ImportNamespaceSpecifier: Object.freeze(["local"]),
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
        if (isBabelNode(item)) {
          const child = mapNode(item, key);
          children.push(child.node);
          nodeCount += child.nodeCount;
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
