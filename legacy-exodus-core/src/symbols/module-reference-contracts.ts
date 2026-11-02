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
export const moduleReferenceFormSchema = z.enum(["esm-side-effect", "esm-binding", "commonjs-import", "dynamic-import"]);
export const sourcePhaseSchema = z.enum(["value", "type", "mixed"]);

export interface ModuleReference {
  readonly moduleSpecifier: string;
  /** `dynamic-import` is a literal `import("x")`: it binds no import symbol. */
  readonly form: "esm-side-effect" | "esm-binding" | "commonjs-import" | "dynamic-import";
  readonly sourceAnchor?: SourceAnchor;
  readonly sourcePhase?: "value" | "type" | "mixed";
  readonly importSymbolIds: readonly string[];
}
export const moduleReferenceSchema = z.object({
  moduleSpecifier: z.string().min(1),
  form: moduleReferenceFormSchema,
  sourceAnchor: sourceAnchorSchema.optional(),
  sourcePhase: sourcePhaseSchema.optional(),
  importSymbolIds: z.array(z.string().min(1)),
}).strict().refine((reference) => (reference.form === "dynamic-import") === (reference.importSymbolIds.length === 0), "Only a dynamic import binds no import symbol.");

/** A module load whose specifier is computed (`import(name)`, `require(name)`): its target is unknown. */
export interface UnresolvedModuleReference {
  readonly form: "commonjs-import" | "dynamic-import";
  readonly sourceAnchor?: SourceAnchor;
}
export const unresolvedModuleReferenceSchema = z.object({
  form: z.enum(["commonjs-import", "dynamic-import"]),
  sourceAnchor: sourceAnchorSchema.optional(),
}).strict();

export function freezeSourceAnchor(anchor: SourceAnchor): SourceAnchor {
  return anchor.kind === "offset" ? Object.freeze({ ...anchor }) : Object.freeze({
    ...anchor, start: Object.freeze({ ...anchor.start }), end: Object.freeze({ ...anchor.end }),
  });
}
export function freezeUnresolvedModuleReference(reference: UnresolvedModuleReference): UnresolvedModuleReference {
  return Object.freeze({ ...reference, ...(reference.sourceAnchor === undefined ? {} : { sourceAnchor: freezeSourceAnchor(reference.sourceAnchor) }) });
}
export function freezeModuleReference(reference: ModuleReference): ModuleReference {
  return Object.freeze({
    ...reference,
    ...(reference.sourceAnchor === undefined ? {} : { sourceAnchor: freezeSourceAnchor(reference.sourceAnchor) }),
    importSymbolIds: Object.freeze([...reference.importSymbolIds]),
  });
}
