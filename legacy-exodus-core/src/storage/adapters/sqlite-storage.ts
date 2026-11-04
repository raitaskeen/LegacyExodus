import { Database, type SQLQueryBindings } from "bun:sqlite";

import {
  StorageRecordNotFoundError,
  StorageSchemaVersionMismatchError,
  StorageValidationError,
} from "../storage-errors";
import {
  deepFreeze,
  extractRecordMetadata,
  type SerializedPayload,
  type StorageRecord,
  validateStorageRecord,
} from "../storage-record";
import type {
  CommitBatchOptions,
  EventBatchItem,
  StorageProvider,
  StorageQueryCriteria,
} from "../storage-provider";
import { immutable } from "@shared/immutability";

export const SQLITE_SCHEMA_VERSION = 1;

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
  public readonly schemaVersion: number = SQLITE_SCHEMA_VERSION;
  private readonly db: Database;
  private readonly isInMemory: boolean;
  private readonly maxSeqStmt: any;

  public constructor(options: SqliteStorageOptions = {}) {
    this.isInMemory = options.inMemory ?? (!options.databasePath || options.databasePath === ":memory:");
    this.isPersistent = !this.isInMemory;
    const dbPath = this.isInMemory ? ":memory:" : options.databasePath!;

    this.db = new Database(dbPath, {
      readonly: options.readonly ?? false,
      create: true,
    });

    try {
      // Configure SQLite performance, concurrency, and integrity pragmas
      this.db.run("PRAGMA journal_mode = WAL;");
      this.db.run("PRAGMA synchronous = NORMAL;");
      this.db.run("PRAGMA foreign_keys = ON;");
      this.db.run("PRAGMA busy_timeout = 5000;");
      this.db.run("PRAGMA temp_store = MEMORY;");

      this.initializeSchema();

      this.maxSeqStmt = this.db.prepare(`
        SELECT COALESCE(MAX(CAST(json_extract(payload, '$.sequence') AS INTEGER)), -1) as max_seq
        FROM storage_records
        WHERE type = 'domain-event' AND project_id = ?
      `);
    } catch (error: unknown) {
      this.db.close();
      throw error;
    }
  }

  private initializeSchema(): void {
    const versionRow = this.db.query("PRAGMA user_version;").get() as
      | { user_version: number }
      | [number]
      | null;
    const currentVersion = Array.isArray(versionRow)
      ? versionRow[0]
      : (versionRow?.user_version ?? 0);

    if (currentVersion === 0) {
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
      this.db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_durable_events_seq
        ON storage_records(project_id, CAST(json_extract(payload, '$.sequence') AS INTEGER))
        WHERE type = 'domain-event';
      `);

      this.db.run(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION};`);
    } else if (currentVersion === SQLITE_SCHEMA_VERSION) {
      this.db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_durable_events_seq
        ON storage_records(project_id, CAST(json_extract(payload, '$.sequence') AS INTEGER))
        WHERE type = 'domain-event';
      `);
    } else {
      throw new StorageSchemaVersionMismatchError(SQLITE_SCHEMA_VERSION, currentVersion);
    }
  }

  public async save<Payload extends SerializedPayload>(record: StorageRecord<Payload>): Promise<void> {
    const stmt = this.createUpsertStatement();

    try {
      this.executeInsert(stmt, record);
    } finally {
      stmt.finalize();
    }
  }

  public async saveBatch(records: readonly StorageRecord[]): Promise<void> {
    if (records.length === 0) return;

    const stmt = this.createUpsertStatement();

    try {
      const insertBatch = this.db.transaction((batchRecords: readonly StorageRecord[]) => {
        for (const record of batchRecords) {
          this.executeInsert(stmt, record);
        }
      });

      insertBatch(records);
    } finally {
      stmt.finalize();
    }
  }

  public async commitBatch(options: CommitBatchOptions): Promise<readonly StorageRecord[]> {
    const stmt = this.createUpsertStatement();

    try {
      const executeTx = this.db.transaction((records: readonly StorageRecord[], events: readonly EventBatchItem[] = []) => {
        const nextSeqByAgg = new Map<string, number>();
        const durableRecords: StorageRecord[] = [];

        for (const eventItem of events) {
          let seq = nextSeqByAgg.get(eventItem.aggregateId);
          if (seq === undefined) {
            const row = this.maxSeqStmt.get(eventItem.aggregateId) as { max_seq: number } | null;
            seq = (row?.max_seq ?? -1) + 1;
          }
          const record = eventItem.createRecord(seq);
          durableRecords.push(record);
          nextSeqByAgg.set(eventItem.aggregateId, seq + 1);
        }

        for (const record of records) {
          this.executeInsert(stmt, record);
        }

        for (const record of durableRecords) {
          this.executeInsert(stmt, record);
        }

        return durableRecords;
      });

      return executeTx.immediate(options.records, options.events ?? []);
    } finally {
      stmt.finalize();
    }
  }

  private createUpsertStatement(): any {
    return this.db.prepare(`
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
  }

  private executeInsert(stmt: any, record: StorageRecord): void {
    const validatedRecord = validateStorageRecord(record);
    const { projectId, analysisRunId, filePath } = extractRecordMetadata(validatedRecord.payload);
    const payloadJson = JSON.stringify(validatedRecord.payload);

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

    try {
      const row = stmt.get(id);
      if (!row) return null;

      return this.deserializeRecord<Payload>(row);
    } finally {
      stmt.finalize();
    }
  }

  public async findAll<Payload extends SerializedPayload>(
    type: string,
  ): Promise<StorageRecord<Payload>[]> {
    return this.findScoped<Payload>({ type });
  }

  public async findScoped<Payload extends SerializedPayload>(
    criteria: StorageQueryCriteria,
  ): Promise<StorageRecord<Payload>[]> {
    const { sql, params } = this.buildScopedQuery(criteria);
    const stmt = this.db.prepare<RawSqliteRecord, SQLQueryBindings[]>(sql);
    try {
      const rows = stmt.all(...params);
      return rows.map((row) => this.deserializeRecord<Payload>(row));
    } finally {
      stmt.finalize();
    }
  }

  public async *iterateScoped<Payload extends SerializedPayload>(
    criteria: StorageQueryCriteria,
  ): AsyncIterable<StorageRecord<Payload>> {
    const { sql, params } = this.buildScopedQuery(criteria);
    const stmt = this.db.prepare<RawSqliteRecord, SQLQueryBindings[]>(sql);

    try {
      for (const row of stmt.iterate(...params)) {
        yield this.deserializeRecord<Payload>(row);
      }
    } finally {
      stmt.finalize();
    }
  }

  private buildScopedQuery(criteria: StorageQueryCriteria): {
    readonly sql: string;
    readonly params: SQLQueryBindings[];
  } {
    const conditions: string[] = ["type = ?"];
    const params: SQLQueryBindings[] = [criteria.type];

    if (criteria.projectId !== undefined) {
      conditions.push("project_id = ?");
      params.push(criteria.projectId);
    }

    if (criteria.analysisRunId !== undefined) {
      conditions.push("analysis_run_id = ?");
      params.push(criteria.analysisRunId);
    }

    if (criteria.filePath !== undefined) {
      conditions.push("file_path = ?");
      params.push(criteria.filePath);
    }

    const sql = `
      SELECT id, type, project_id, analysis_run_id, file_path, payload, created_at, updated_at
      FROM storage_records
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at ASC, rowid ASC
    `;

    return { sql, params };
  }

  public async delete(id: string): Promise<void> {
    const stmt = this.db.prepare(`DELETE FROM storage_records WHERE id = ?`);
    try {
      const result = stmt.run(id);

      if (result.changes === 0) {
        throw new StorageRecordNotFoundError(id);
      }
    } finally {
      stmt.finalize();
    }
  }

  public async clear(): Promise<void> {
    this.db.run(`DELETE FROM storage_records`);
  }

  public close(): void {
    this.maxSeqStmt.finalize();
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

    return immutable({
      id: row.id,
      type: row.type,
      payload: deepFreeze(payload),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
  }
}
