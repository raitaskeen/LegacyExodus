import { z } from "zod";

import { LegacyExodusError } from "@shared/errors";

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

export function validateASTNode(node: unknown): ASTNode {
  if (isDeeplyFrozenASTNode(node)) {
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

  return freezeNode(parsedNode.data);
}

export function freezeNode(node: ASTNode): ASTNode {
  if (isDeeplyFrozenASTNode(node)) {
    return node;
  }

  return Object.freeze({
    ...node,
    role: node.role,
    location:
      node.location === undefined
        ? undefined
        : Object.isFrozen(node.location)
          ? node.location
          : Object.freeze({
              start: Object.isFrozen(node.location.start) ? node.location.start : Object.freeze({ ...node.location.start }),
              end: Object.isFrozen(node.location.end) ? node.location.end : Object.freeze({ ...node.location.end }),
            }),
    attributes: Object.isFrozen(node.attributes) ? node.attributes : Object.freeze({ ...node.attributes }),
    children: Object.freeze(node.children.map(freezeNode)),
  });
}

function isDeeplyFrozenASTNode(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.isFrozen(value) &&
    "type" in value &&
    typeof (value as { readonly type: unknown }).type === "string" &&
    "attributes" in value &&
    Object.isFrozen((value as ASTNode).attributes) &&
    "children" in value &&
    Array.isArray((value as ASTNode).children) &&
    Object.isFrozen((value as ASTNode).children)
  );
}
