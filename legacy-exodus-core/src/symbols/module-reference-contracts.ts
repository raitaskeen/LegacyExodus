import { z } from "zod";

export type SourceAnchor =
  | { readonly kind: "offset"; readonly start: number; readonly end: number }
  | { readonly kind: "location"; readonly start: { readonly line: number; readonly column: number }; readonly end: { readonly line: number; readonly column: number } };

const positionSchema = z.object({ line: z.number().int().positive(), column: z.number().int().nonnegative() }).strict();
export const sourceAnchorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("offset"), start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict()
    .refine((anchor) => anchor.end >= anchor.start, "Source offsets must be ordered."),
  z.object({ kind: z.literal("location"), start: positionSchema, end: positionSchema }).strict()
    .refine((anchor) => anchor.end.line > anchor.start.line || (anchor.end.line === anchor.start.line && anchor.end.column >= anchor.start.column), "Source locations must be ordered."),
]);
export const moduleReferenceFormSchema = z.enum(["esm-side-effect", "esm-binding", "commonjs-import"]);
export const sourcePhaseSchema = z.enum(["value", "type", "mixed"]);

export interface ModuleReference {
  readonly moduleSpecifier: string;
  readonly form: "esm-side-effect" | "esm-binding" | "commonjs-import";
  readonly sourceAnchor?: SourceAnchor;
  readonly sourcePhase?: "value" | "type" | "mixed";
  readonly importSymbolIds: readonly string[];
}
export const moduleReferenceSchema = z.object({
  moduleSpecifier: z.string().min(1),
  form: moduleReferenceFormSchema,
  sourceAnchor: sourceAnchorSchema.optional(),
  sourcePhase: sourcePhaseSchema.optional(),
  importSymbolIds: z.array(z.string().min(1)).min(1),
}).strict();

export function freezeSourceAnchor(anchor: SourceAnchor): SourceAnchor {
  return anchor.kind === "offset" ? Object.freeze({ ...anchor }) : Object.freeze({
    ...anchor, start: Object.freeze({ ...anchor.start }), end: Object.freeze({ ...anchor.end }),
  });
}
export function freezeModuleReference(reference: ModuleReference): ModuleReference {
  return Object.freeze({
    ...reference,
    ...(reference.sourceAnchor === undefined ? {} : { sourceAnchor: freezeSourceAnchor(reference.sourceAnchor) }),
    importSymbolIds: Object.freeze([...reference.importSymbolIds]),
  });
}
