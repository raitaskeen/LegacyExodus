import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ASTAttribute, ASTNode, SourceLocation } from "@parser/contracts/ast-node";
import type { ASTResult } from "@parser/contracts/ast-result";
import type { ParserError, ParserWarning } from "@parser/contracts/parser-errors";
import { LegacyExodusError } from "@shared/errors";
import { immutable } from "@shared/immutability";

const STORE_PREFIX = "legacy-exodus-ast-";

export interface AnalysisAstStore {
  write(ast: ASTResult): Promise<void>;
  read(sourcePath: string): Promise<ASTResult>;
  dispose(): Promise<void>;
}

export type AnalysisAstStoreFactory = () => Promise<AnalysisAstStore>;

type PackedLocation = readonly [number, number, number, number];
type PackedNode = readonly [string, string | null, PackedLocation | null, Readonly<Record<string, ASTAttribute>>, readonly PackedNode[]];
type PackedDiagnostic = readonly [string, string, PackedLocation | null];
interface PackedASTResult {
  readonly metadata: readonly [string, string, string];
  readonly root: PackedNode;
  readonly statistics: readonly [number, number];
  readonly warnings: readonly PackedDiagnostic[];
  readonly errors: readonly PackedDiagnostic[];
}

/** Run-owned spill storage that keeps normalized AST retention bounded to one active file. */
export class RunScopedAstStore {
  private disposed = false;

  private constructor(private readonly directoryPath: string) {}

  public static async create(): Promise<RunScopedAstStore> {
    return new RunScopedAstStore(await mkdtemp(join(tmpdir(), STORE_PREFIX)));
  }

  public async write(ast: ASTResult): Promise<void> {
    this.assertActive();
    try {
      await writeFile(this.pathFor(ast.metadata.sourcePath), JSON.stringify(packResult(ast)), "utf8");
    } catch (error: unknown) {
      throw new LegacyExodusError({
        code: "AST_SPILL_WRITE_FAILED",
        message: "Failed to persist a run-scoped normalized AST.",
        metadata: { sourcePath: ast.metadata.sourcePath },
        cause: error,
      });
    }
  }

  public async read(sourcePath: string): Promise<ASTResult> {
    this.assertActive();
    try {
      const serialized: unknown = JSON.parse(await readFile(this.pathFor(sourcePath), "utf8"));
      return restoreResult(serialized, sourcePath);
    } catch (error: unknown) {
      throw new LegacyExodusError({
        code: "AST_SPILL_READ_FAILED",
        message: "Failed to restore a run-scoped normalized AST.",
        metadata: { sourcePath },
        cause: error,
      });
    }
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await rm(this.directoryPath, { recursive: true, force: true });
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new LegacyExodusError({
        code: "AST_SPILL_DISPOSED",
        message: "Run-scoped normalized AST storage is already disposed.",
      });
    }
  }

  private pathFor(sourcePath: string): string {
    const key = createHash("sha256").update(sourcePath).digest("hex");
    return join(this.directoryPath, `${key}.json`);
  }
}

function packResult(ast: ASTResult): PackedASTResult {
  return {
    metadata: [ast.metadata.parserId, ast.metadata.language, ast.metadata.sourcePath],
    root: packNode(ast.root),
    statistics: [ast.statistics.durationMs, ast.statistics.nodeCount],
    warnings: ast.warnings.map(packDiagnostic),
    errors: ast.errors.map(packDiagnostic),
  };
}

function packNode(node: ASTNode): PackedNode {
  return [
    node.type,
    node.role ?? null,
    packLocation(node.location),
    node.attributes,
    node.children.map(packNode),
  ];
}

function packDiagnostic(diagnostic: ParserWarning | ParserError): PackedDiagnostic {
  return [diagnostic.code, diagnostic.message, packDiagnosticLocation(diagnostic.location)];
}

function packLocation(location: SourceLocation | undefined): PackedLocation | null {
  return location === undefined
    ? null
    : [location.start.line, location.start.column, location.end.line, location.end.column];
}

function packDiagnosticLocation(location: ParserWarning["location"]): PackedLocation | null {
  return location === undefined ? null : [location.line, location.column, location.line, location.column];
}

function restoreResult(value: unknown, expectedSourcePath: string): ASTResult {
  if (!isRecord(value)) invalidSpill(expectedSourcePath);
  const metadata = value.metadata;
  const statistics = value.statistics;
  const warnings = value.warnings;
  const errors = value.errors;
  if (
    !isTuple(metadata, 3)
    || !metadata.every(isNonEmptyString)
    || metadata[2] !== expectedSourcePath
    || !isTuple(statistics, 2)
    || !isNonNegativeNumber(statistics[0])
    || !Number.isInteger(statistics[1])
    || !isNonNegativeNumber(statistics[1])
    || !Array.isArray(warnings)
    || !Array.isArray(errors)
  ) {
    invalidSpill(expectedSourcePath);
  }

  return immutable({
    metadata: immutable({
      parserId: metadata[0] as string,
      language: metadata[1] as string,
      sourcePath: metadata[2] as string,
    }),
    root: restoreNode(value.root, expectedSourcePath),
    statistics: immutable({
      durationMs: statistics[0] as number,
      nodeCount: statistics[1] as number,
    }),
    warnings: immutable(warnings.map((diagnostic) => restoreDiagnostic(diagnostic, expectedSourcePath))),
    errors: immutable(errors.map((diagnostic) => restoreDiagnostic(diagnostic, expectedSourcePath))),
  });
}

function restoreNode(value: unknown, sourcePath: string): ASTNode {
  if (!isTuple(value, 5)) invalidSpill(sourcePath);
  const [type, role, location, attributes, children] = value;
  if (
    !isNonEmptyString(type)
    || (role !== null && !isNonEmptyString(role))
    || !isPackedLocation(location)
    || !isAttributes(attributes)
    || !Array.isArray(children)
  ) {
    invalidSpill(sourcePath);
  }

  return immutable({
    type: type as string,
    ...(role === null ? {} : { role: role as string }),
    ...(location === null ? {} : { location: restoreLocation(location as PackedLocation) }),
    attributes: immutable({ ...(attributes as Readonly<Record<string, ASTAttribute>>) }),
    children: immutable(children.map((child) => restoreNode(child, sourcePath))),
  });
}

function restoreDiagnostic(value: unknown, sourcePath: string): ParserWarning {
  if (!isTuple(value, 3)) invalidSpill(sourcePath);
  const [code, message, location] = value;
  if (!isNonEmptyString(code) || !isNonEmptyString(message) || !isPackedLocation(location)) {
    invalidSpill(sourcePath);
  }
  return immutable({
    code: code as string,
    message: message as string,
    ...(location === null
      ? {}
      : { location: immutable({ line: (location as PackedLocation)[0], column: (location as PackedLocation)[1] }) }),
  });
}

function restoreLocation(location: PackedLocation): SourceLocation {
  return immutable({
    start: immutable({ line: location[0], column: location[1] }),
    end: immutable({ line: location[2], column: location[3] }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTuple(value: unknown, length: number): value is unknown[] {
  return Array.isArray(value) && value.length === length;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPackedLocation(value: unknown): value is PackedLocation | null {
  return value === null || (
    isTuple(value, 4)
    && Number.isInteger(value[0])
    && typeof value[0] === "number"
    && value[0] > 0
    && Number.isInteger(value[1])
    && typeof value[1] === "number"
    && value[1] >= 0
    && Number.isInteger(value[2])
    && typeof value[2] === "number"
    && value[2] > 0
    && Number.isInteger(value[3])
    && typeof value[3] === "number"
    && value[3] >= 0
  );
}

function isAttributes(value: unknown): value is Readonly<Record<string, ASTAttribute>> {
  return isRecord(value) && Object.values(value).every((attribute) =>
    attribute === null || typeof attribute === "string" || typeof attribute === "number" || typeof attribute === "boolean",
  );
}

function invalidSpill(sourcePath: string): never {
  throw new LegacyExodusError({
    code: "AST_SPILL_INVALID",
    message: "Run-scoped normalized AST storage contained invalid data.",
    metadata: { sourcePath },
  });
}
