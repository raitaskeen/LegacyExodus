import { z } from "zod";

import { LegacyExodusError } from "@shared/errors";

export type DiscoveryArtifactName =
  | "manifest.json"
  | "project.json"
  | "files.json"
  | "dependencies.json"
  | "frameworks.json"
  | "summary.json"
  | "enumeration-failures.json"
  | "dependency-graph.json"
  | "modules.json"
  | "symbols.json"
  | "knowledge.json"
  | "semantic.json"
  | "cfg.json"
  | "control-flow.json"
  | "data-flow.json";

export interface DiscoveryArtifact {
  readonly name: DiscoveryArtifactName;
  readonly payload: unknown;
}

export interface DiscoveryProjectionMetadata {
  readonly projectId?: string;
  readonly analysisRunId?: string;
  readonly projectName?: string;
}

export interface DiscoveryProjection {
  readonly projectPath: string;
  readonly artifacts: readonly DiscoveryArtifact[];
  readonly metadata?: DiscoveryProjectionMetadata;
}

const artifactNames: readonly DiscoveryArtifactName[] = [
  "manifest.json",
  "project.json",
  "files.json",
  "dependencies.json",
  "frameworks.json",
  "summary.json",
  "enumeration-failures.json",
  "dependency-graph.json",
  "modules.json",
  "symbols.json",
  "knowledge.json",
  "semantic.json",
  "cfg.json",
  "control-flow.json",
  "data-flow.json",
];

const discoveryProjectionSchema = z.object({
  projectPath: z.string().min(1),
  artifacts: z.array(
    z.object({
      name: z.enum(artifactNames),
      payload: z.unknown(),
    }),
  ),
  metadata: z
    .object({
      projectId: z.string().optional(),
      analysisRunId: z.string().optional(),
      projectName: z.string().optional(),
    })
    .optional(),
});

const deferred = Symbol("deferred discovery artifact");

/**
 * An artifact whose payload is produced each time it is read. The writer reads artifacts one at a
 * time, so only one large payload is alive at once instead of all of them (BA-17). `load` must
 * return the same content on every call.
 */
export function deferredArtifact(name: DiscoveryArtifactName, load: () => unknown): DiscoveryArtifact {
  return Object.freeze({ name, get payload(): unknown { return deepFreeze(load()); }, [deferred]: true });
}

function isDeferred(artifact: DiscoveryArtifact): boolean {
  return (artifact as { readonly [deferred]?: boolean })[deferred] === true;
}

export function createDiscoveryProjection(projection: DiscoveryProjection): DiscoveryProjection {
  // Validated without reading payloads, so a deferred artifact is not produced here.
  const parsedProjection = discoveryProjectionSchema.safeParse({
    ...projection,
    artifacts: Array.isArray(projection?.artifacts) ? projection.artifacts.map((artifact) => ({ name: artifact?.name, payload: null })) : projection?.artifacts,
  });

  if (!parsedProjection.success) {
    throw new LegacyExodusError({
      code: "DISCOVERY_PROJECTION_INVALID",
      message: "Discovery projection is invalid.",
      metadata: { issues: parsedProjection.error.issues },
    });
  }

  return Object.freeze({
    projectPath: parsedProjection.data.projectPath,
    artifacts: Object.freeze(
      projection.artifacts.map((artifact) =>
        isDeferred(artifact) ? artifact : Object.freeze({ name: artifact.name, payload: deepFreeze(artifact.payload) }),
      ),
    ),
    ...(parsedProjection.data.metadata ? { metadata: Object.freeze({ ...parsedProjection.data.metadata }) } : {}),
  });
}

function deepFreeze(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Object.isFrozen(value)) {
    return value;
  }

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }

  return Object.freeze(value);
}

// Current reuse requires this nested capability; historical projections remain readable.
const dispositionIdentity = {
  fileId: z.string().min(1),
  // Discovery owns path containment; R01 compares its validated spelling exactly.
  path: z.string().min(1),
};
const dispositionCode = z.string().min(1).refine((code) => code.trim().length > 0);
export const analysisDispositionV1Schema = z.object({
  contract: z.literal("r01-analysis-disposition-v1"),
  files: z.array(z.discriminatedUnion("kind", [
    z.object({
      ...dispositionIdentity,
      kind: z.literal("analyzed"),
      symbolCount: z.number().int().nonnegative(),
      secondPassFailure: z.object({ code: dispositionCode }).strict().optional(),
    }).strict(),
    z.object({ ...dispositionIdentity, kind: z.literal("initial-parser-failure"), code: dispositionCode }).strict(),
    z.object({ ...dispositionIdentity, kind: z.literal("symbol-extraction-failure"), code: dispositionCode }).strict(),
  ])),
}).strict();

export type AnalysisDispositionV1 = {
  readonly contract: "r01-analysis-disposition-v1";
  readonly files: readonly z.infer<typeof analysisDispositionV1Schema>["files"][number][];
};
export type AnalysisFileDisposition = AnalysisDispositionV1["files"][number];

type DispositionFile = {
  readonly id: string;
  readonly path: string;
  readonly language: string;
  readonly fileKind?: string;
};
type DispositionSymbol = { readonly filePath: string };
type DispositionTable = { readonly path: string; readonly fileId?: string; readonly symbols: readonly DispositionSymbol[] };

/** JavaScript and TypeScript sources are analyzed; generated files (minified bundles) are listed, not analyzed (BA-15). */
export function isR01DispatchedFile(file: DispositionFile): boolean {
  return (file.language === "javascript" || file.language === "typescript") && file.fileKind !== "generated";
}

/** Canonical schema order and fixed code-unit path order, independent of record order. */
export function createAnalysisDisposition(files: readonly AnalysisFileDisposition[]): AnalysisDispositionV1 {
  const parsed = analysisDispositionV1Schema.parse({ contract: "r01-analysis-disposition-v1", files });
  return Object.freeze({
    contract: parsed.contract,
    files: Object.freeze([...parsed.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map((file) =>
      file.kind === "analyzed"
        ? Object.freeze({
          fileId: file.fileId, path: file.path, kind: file.kind, symbolCount: file.symbolCount,
          ...(file.secondPassFailure === undefined ? {} : { secondPassFailure: Object.freeze({ code: file.secondPassFailure.code }) }),
        })
        : Object.freeze({ fileId: file.fileId, path: file.path, kind: file.kind, code: file.code }),
    )),
  });
}

export function deriveR01Accounting(
  disposition: AnalysisDispositionV1,
  files: readonly DispositionFile[],
  enumerationFailures: number,
  manifestFailures: number,
) {
  const notDispatched = files.filter((file) => !isR01DispatchedFile(file));
  return {
    filesDiscovered: files.length,
    filesAnalyzed: disposition.files.filter((file) => file.kind === "analyzed").length,
    parserFailures: disposition.files.filter((file) => file.kind === "initial-parser-failure").length,
    symbolExtractionFailures: disposition.files.filter((file) => file.kind === "symbol-extraction-failure").length,
    unsupportedFiles: notDispatched.filter((file) => file.fileKind === "source").length,
    nonSourceArtifacts: notDispatched.filter((file) => file.fileKind !== "source" && file.fileKind !== "unknown" && file.fileKind !== undefined).length,
    unclassifiedArtifacts: notDispatched.filter((file) => file.fileKind === "unknown" || file.fileKind === undefined).length,
    enumerationFailures,
    secondPassFailures: disposition.files.filter((file) => file.kind === "analyzed" && file.secondPassFailure !== undefined).length,
    discoveryComplete: enumerationFailures === 0 && manifestFailures === 0,
  };
}

const r01SummarySchema = z.object({
  filesDiscovered: z.number().int().nonnegative(),
  filesAnalyzed: z.number().int().nonnegative(),
  parserFailures: z.number().int().nonnegative(),
  symbolExtractionFailures: z.number().int().nonnegative(),
  unsupportedFiles: z.number().int().nonnegative(),
  nonSourceArtifacts: z.number().int().nonnegative(),
  unclassifiedArtifacts: z.number().int().nonnegative(),
  enumerationFailures: z.number().int().nonnegative(),
  discoveryComplete: z.boolean(),
  secondPassFailures: z.number().int().nonnegative().optional(),
});

/** Reject contradictions; never repair identities or infer missing successful tables. */
export function validateAnalysisDisposition(
  input: unknown,
  evidence: {
    readonly files: readonly DispositionFile[];
    readonly symbols: readonly DispositionSymbol[];
    readonly tables?: readonly DispositionTable[];
    readonly summary: unknown;
    readonly enumerationFailures: number;
    readonly manifestFailures: number;
    readonly projected?: boolean;
  },
): AnalysisDispositionV1 {
  const disposition = createAnalysisDisposition(analysisDispositionV1Schema.parse(input).files);
  const invalid = (reason: string): never => { throw new LegacyExodusError({ code: "R01_DISPOSITION_INVALID", message: reason }); };
  const filesById = new Map(evidence.files.map((file) => [file.id, file]));
  const filesByPath = new Map(evidence.files.map((file) => [file.path, file]));
  if (filesById.size !== evidence.files.length || filesByPath.size !== evidence.files.length) invalid("Duplicate discovery identity.");
  const entriesById = new Map(disposition.files.map((file) => [file.fileId, file]));
  const entriesByPath = new Map(disposition.files.map((file) => [file.path, file]));
  if (entriesById.size !== disposition.files.length || entriesByPath.size !== disposition.files.length) invalid("Duplicate disposition identity.");
  for (const entry of disposition.files) {
    const file = filesById.get(entry.fileId);
    if (file === undefined || file.path !== entry.path || !isR01DispatchedFile(file)) invalid("Disposition identity does not match dispatched discovery.");
  }
  if (evidence.files.filter(isR01DispatchedFile).some((file) => !entriesById.has(file.id))) invalid("Dispatched file has no disposition.");

  const symbolCounts = new Map<string, number>();
  for (const symbol of evidence.symbols) {
    if (entriesByPath.get(symbol.filePath)?.kind !== "analyzed") invalid("Symbol belongs to a file without successful disposition.");
    symbolCounts.set(symbol.filePath, (symbolCounts.get(symbol.filePath) ?? 0) + 1);
  }
  for (const entry of disposition.files) {
    if (entry.kind === "analyzed" && entry.symbolCount !== (symbolCounts.get(entry.path) ?? 0)) invalid("Symbol count contradicts disposition.");
  }
  if (evidence.tables !== undefined) {
    const tablePaths = new Set<string>();
    for (const table of evidence.tables) {
      const entry = entriesByPath.get(table.path);
      if (tablePaths.has(table.path) || entry?.kind !== "analyzed" ||
        (table.fileId !== undefined && table.fileId !== entry.fileId) ||
        table.symbols.length !== entry.symbolCount ||
        table.symbols.some((symbol) => symbol.filePath !== table.path)) invalid("Stored table contradicts successful membership.");
      tablePaths.add(table.path);
    }
    if (disposition.files.some((entry) => entry.kind === "analyzed" && !tablePaths.has(entry.path))) invalid("Successful disposition lacks an actual stored table.");
  }

  const counts = deriveR01Accounting(disposition, evidence.files, evidence.enumerationFailures, evidence.manifestFailures);
  // Projected summaries own discovery completeness, while stored runs retain
  // the full accounting contract. Both are reconciled against the same evidence.
  if (evidence.projected) {
    const summary = z.object({ discoveryComplete: z.boolean() }).parse(evidence.summary);
    if (summary.discoveryComplete !== counts.discoveryComplete) invalid("Summary counters contradict discovery and disposition.");
  } else {
    const summary = r01SummarySchema.parse(evidence.summary);
    for (const key of Object.keys(summary) as (keyof typeof summary)[]) {
      if (summary[key] !== counts[key]) invalid("Summary counters contradict discovery and disposition.");
    }
    if (summary.secondPassFailures === undefined) invalid("Current run lacks second-pass summary accounting.");
  }
  return disposition;
}
