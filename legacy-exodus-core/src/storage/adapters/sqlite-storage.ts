import { Database } from "bun:sqlite";

import { StorageRecordNotFoundError, StorageValidationError } from "../storage-errors";
import {
  type SerializedPayload,
  type StorageRecord,
  validateStorageRecord,
} from "../storage-record";
import type { StorageProvider } from "../storage-provider";

export interface SqliteStorageOptions {
  readonly databasePath?: string;
  readonly inMemory?: boolean;
  readonly readonly?: boolean;
}

interface RawSqliteRecord {
  readonly id: string;
  readonly type: string;
  readonly project_id: string | null;
  readonly analysis_run_id: string | null;
  readonly file_path: string | null;
  readonly payload: string;
  readonly created_at: number;
  readonly updated_at: number;
}

export class SqliteStorageProvider implements StorageProvider {
  public readonly isPersistent: boolean;
  private readonly db: Database;
  private readonly isInMemory: boolean;

  public constructor(options: SqliteStorageOptions = {}) {
    this.isInMemory = options.inMemory ?? (!options.databasePath || options.databasePath === ":memory:");
    this.isPersistent = !this.isInMemory;
    const dbPath = this.isInMemory ? ":memory:" : options.databasePath!;

    this.db = new Database(dbPath, {
      readonly: options.readonly ?? false,
      create: true,
    });

    // Configure SQLite performance and integrity pragmas
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.run("PRAGMA synchronous = NORMAL;");
    this.db.run("PRAGMA foreign_keys = ON;");

    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS storage_records (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        project_id TEXT,
        analysis_run_id TEXT,
        file_path TEXT,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_records_type ON storage_records(type);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_records_run ON storage_records(project_id, analysis_run_id);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_records_file ON storage_records(type, file_path);`);
  }

  public async save<Payload extends SerializedPayload>(record: StorageRecord<Payload>): Promise<void> {
    const validatedRecord = validateStorageRecord(record);

    let projectId: string | null = null;
    let analysisRunId: string | null = null;
    let filePath: string | null = null;

    if (typeof validatedRecord.payload === "object" && validatedRecord.payload !== null) {
      const p = validatedRecord.payload as Record<string, unknown>;
      if (typeof p.projectId === "string") projectId = p.projectId;
      if (typeof p.analysisRunId === "string") analysisRunId = p.analysisRunId;
      if (typeof p.path === "string") filePath = p.path;
      else if (typeof p.filePath === "string") filePath = p.filePath;
    }

    const payloadJson = JSON.stringify(validatedRecord.payload);

    const stmt = this.db.prepare(`
      INSERT INTO storage_records (id, type, project_id, analysis_run_id, file_path, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        project_id = excluded.project_id,
        analysis_run_id = excluded.analysis_run_id,
        file_path = excluded.file_path,
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      validatedRecord.id,
      validatedRecord.type,
      projectId,
      analysisRunId,
      filePath,
      payloadJson,
      validatedRecord.createdAt.getTime(),
      validatedRecord.updatedAt.getTime(),
    );
  }

  public async findById<Payload extends SerializedPayload>(
    id: string,
  ): Promise<StorageRecord<Payload> | null> {
    const stmt = this.db.prepare<RawSqliteRecord, [string]>(`
      SELECT id, type, project_id, analysis_run_id, file_path, payload, created_at, updated_at
      FROM storage_records
      WHERE id = ?
    `);

    const row = stmt.get(id);
    if (!row) return null;

    return this.deserializeRecord<Payload>(row);
  }

  public async findAll<Payload extends SerializedPayload>(
    type: string,
  ): Promise<StorageRecord<Payload>[]> {
    const stmt = this.db.prepare<RawSqliteRecord, [string]>(`
      SELECT id, type, project_id, analysis_run_id, file_path, payload, created_at, updated_at
      FROM storage_records
      WHERE type = ?
      ORDER BY created_at ASC
    `);

    const rows = stmt.all(type);
    return rows.map((row) => this.deserializeRecord<Payload>(row));
  }

  public async delete(id: string): Promise<void> {
    const stmt = this.db.prepare(`DELETE FROM storage_records WHERE id = ?`);
    const result = stmt.run(id);

    if (result.changes === 0) {
      throw new StorageRecordNotFoundError(id);
    }
  }

  public async clear(): Promise<void> {
    this.db.run(`DELETE FROM storage_records`);
  }

  public close(): void {
    this.db.close();
  }

  private deserializeRecord<Payload extends SerializedPayload>(
    row: RawSqliteRecord,
  ): StorageRecord<Payload> {
    let payload: Payload;
    try {
      payload = JSON.parse(row.payload) as Payload;
    } catch {
      throw new StorageValidationError(`Failed to deserialize SQLite storage record ${row.id}`);
    }

    return Object.freeze({
      id: row.id,
      type: row.type,
      payload: Object.freeze(payload),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }
}
