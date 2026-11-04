import { z } from "zod";

import { LegacyExodusError } from "@shared/errors";
import { immutable, isImmutable } from "@shared/immutability";

export interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

export interface SourceLocation {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export type ASTAttribute = string | number | boolean | null;

export interface ASTNode {
  readonly type: string;
  readonly role?: string;
  readonly location?: SourceLocation;
  readonly attributes: Readonly<Record<string, ASTAttribute>>;
  readonly children: readonly ASTNode[];
}

const sourcePositionSchema = z.object({
  line: z.number().int().positive(),
  column: z.number().int().nonnegative(),
});

const sourceLocationSchema = z.object({
  start: sourcePositionSchema,
  end: sourcePositionSchema,
});

export const astNodeSchema: z.ZodType<ASTNode> = z.lazy(() =>
  z.object({
    type: z.string().trim().min(1),
    role: z.string().trim().min(1).optional(),
    location: sourceLocationSchema.optional(),
    attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    children: z.array(astNodeSchema),
  }),
);

const validatedASTNodes = new WeakSet<object>();

export function validateASTNode(node: unknown): ASTNode {
  if (
    typeof node === "object" &&
    node !== null &&
    isDeeplyFrozenASTNode(node) &&
    validatedASTNodes.has(node)
  ) {
    return node as ASTNode;
  }

  const parsedNode = astNodeSchema.safeParse(node);

  if (!parsedNode.success) {
    throw new LegacyExodusError({
      code: "AST_NODE_INVALID",
      message: "AST node is invalid.",
      metadata: { issues: parsedNode.error.issues },
    });
  }

  const frozen = freezeNode(parsedNode.data);
  markTreeValidated(frozen);
  return frozen;
}

export function freezeNode(node: ASTNode): ASTNode {
  if (
    typeof node === "object" &&
    node !== null &&
    isDeeplyFrozenASTNode(node) &&
    validatedASTNodes.has(node)
  ) {
    return node;
  }

  return immutable({
    ...node,
    role: node.role,
    location: freezeLocation(node.location),
    attributes: isImmutable(node.attributes) ? node.attributes : immutable({ ...node.attributes }),
    children: immutable(node.children.map(freezeNode)),
  });
}

function freezeLocation(location: SourceLocation | undefined): SourceLocation | undefined {
  if (location === undefined) {
    return undefined;
  }

  if (
    isImmutable(location) &&
    isImmutable(location.start) &&
    isImmutable(location.end)
  ) {
    return location;
  }

  return immutable({
    start: isImmutable(location.start) ? location.start : immutable({ ...location.start }),
    end: isImmutable(location.end) ? location.end : immutable({ ...location.end }),
  });
}

function markTreeValidated(node: ASTNode): void {
  validatedASTNodes.add(node);
  for (const child of node.children) {
    markTreeValidated(child);
  }
}

function isDeeplyFrozenASTNode(value: unknown): boolean {
  if (
    typeof value !== "object" ||
    value === null ||
    !isImmutable(value) ||
    !("type" in value) ||
    typeof (value as { readonly type: unknown }).type !== "string" ||
    !("attributes" in value) ||
    !isImmutable((value as ASTNode).attributes) ||
    !("children" in value) ||
    !Array.isArray((value as ASTNode).children) ||
    !isImmutable((value as ASTNode).children)
  ) {
    return false;
  }

  const location = (value as ASTNode).location;
  if (
    location !== undefined &&
    (!isImmutable(location) ||
      !isImmutable(location.start) ||
      !isImmutable(location.end))
  ) {
    return false;
  }

  return true;
}
