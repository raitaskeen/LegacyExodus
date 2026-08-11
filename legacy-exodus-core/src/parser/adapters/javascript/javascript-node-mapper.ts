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

function mapNode(node: BabelNode, role?: string): JavaScriptNodeMapping {
  const children: ASTNode[] = [];
  let nodeCount = 1;
  const attributes: Record<string, ASTAttribute> = {};

  for (const key of Object.keys(node).sort((left, right) => left.localeCompare(right))) {
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
