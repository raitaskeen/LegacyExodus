# Storage Layer Implementation

This document describes the design and implementation of the storage and projection subsystem located in `src/storage/`.

---

## 1. Storage Architecture Overview

The storage layer provides abstracted persistence and streaming projection services for static analysis results:

```mermaid
flowchart TD
    A[Engine Pipelines] --> B[StorageManager]
    B --> C[MemoryStorageProvider In-Memory Records]
    B --> D[DiscoveryProjectionService]
    D --> E[FileDiscoveryProjection]
    E --> F[StreamingJsonWriter 64KB Bounded Chunks]
    F --> G[Disk Artifacts JSON]
```

---

## 2. Key Components

1. **`StorageManager` (`storage-manager.ts`):** High-level storage facade managing storage providers and projection pipelines. Implements `findScoped(criteria)` to delegate bounded queries, provides `clearTransient()` for safe session-boundary transient state clearing without affecting persistent storage, and coordinates lifecycle shutdown via `close()`.
2. **`StorageProvider` (`storage-provider.ts`):** Canonical persistence contract supporting `save`, `saveBatch`, `commitBatch`, `findById`, `findAll`, and `findScoped(criteria: StorageQueryCriteria)`, `iterateScoped`, `delete`, `clear`, and optional lifecycle `close`. Optionally exposes `isPersistent?: boolean`.
3. **`MemoryStorageProvider` (`adapters/memory-storage.ts`):** High-performance in-memory storage provider with index-aware scoped querying. Stores records in transient JavaScript `Map` structures for the duration of the active session; clears the provider's `records` Map and releases the provider's retained references to those records upon caller-driven `clearTransient()` / `clear()` and terminal `close()`.
4. **`SqliteStorageProvider` (`adapters/sqlite-storage.ts`):** SQLite persistence provider with parameterized SQL queries utilizing composite indexes (`idx_records_lookup`, `idx_records_file`) for zero-overhead bounded retrieval. Configures `isPersistent: boolean` (`!this.isInMemory`); disk-backed SQLite instances are persistent (`isPersistent === true`), protecting database tables from transient clearing operations, while in-memory SQLite instances (`:memory:`) are non-persistent (`isPersistent === false`).
5. **`StreamingJsonWriter` (`projections/streaming-json-writer.ts`):** Low-memory streaming writer that splits JSON output into bounded 64KB chunks with backpressure handling to prevent out-of-memory errors on large repositories.
6. **`FileDiscoveryProjection` (`projections/file-discovery-projection.ts`):** Generates structured discovery ledgers mapping file paths, languages, hashes, and symbol counts.

---

## 3. Query Scoping & Bounded Retrieval

`StorageQueryCriteria` allows consumers (`DiscoveryQueryService`, `DiscoveryProjectionService`) to retrieve precisely bounded record sets without broad table scans:

* **`type`**: Target record category (e.g. `discovery.project`, `discovery.file`).
* **`projectId`**: Optional partition key scoping records to a specific project.
* **`analysisRunId`**: Optional execution isolation key filtering records to the active analysis run.
* **`filePath`**: Optional file path filter for fine-grained per-file queries.

---

## 4. Schema Drift & Record Integrity Invariants

To guarantee that corrupted, incompatible, or drifted persisted records never masquerade as "no data exists", the retrieval boundary distinguishes between genuine data absence and schema invalidity:

* **Absent Data:** When no records match the scoped criteria, queries return `null` or empty collections (`[]`).
* **Corrupt/Drifted Data:** When matching records exist but fail schema validation during deserialization, `DiscoveryQueryService` and `DiscoveryProjectionService` throw an explicit `LegacyExodusError` with code `DISCOVERY_RECORD_INVALID` containing the affected record identifier and schema issue details.
* **Corrupt Serialization:** Malformed JSON strings stored in persistent storage immediately throw `StorageValidationError`.
* **Auxiliary Integrity:** Projection pipelines strictly validate all auxiliary records (`symbol-table`, `dependency-graph`, `knowledge-graph`, `semantic-analysis`, `control-flow-analysis`, `data-flow-analysis`), preventing the generation of deceptively incomplete projection artifacts.

### 4.1 Canonical Storage Payload Schemas & Ownership

To prevent schema drift and definition duplication between storage producers, queries, and projection adapters:
* **Canonical Location:** `src/contracts/discovery-storage.ts` owns the single source of truth for all storage record payload schemas (`discoveryPayloadSchema`, `symbolTablePayloadSchema`, `dependencyGraphPayloadSchema`, `knowledgeGraphPayloadSchema`, `semanticAnalysisPayloadSchema`, `controlFlowPayloadSchema`, `dataFlowPayloadSchema`).
* **Zero Duplication:** `DiscoveryQueryService` and `DiscoveryProjectionService` import and reuse the same canonical schemas and inferred types, guaranteeing identical validation semantics across persistence and retrieval boundaries.

### 4.2 Discovery Projection Manifest Artifact Contract

The discovery manifest (`.discovery/manifest.json`) generated by `FileDiscoveryProjectionAdapter` strictly reflects the actual artifacts produced during a specific projection invocation:
* **Truthful Manifest Inventory:** `manifest.requiredArtifacts` dynamically and deterministically mirrors `Object.keys(manifest.artifacts).sort()`, asserting only the artifacts that were actually produced and verified on disk for that invocation.
* **Partial Run Support:** For discovery-only or selective projection runs, the manifest does not claim unproduced artifacts (e.g. `symbols.json`, `control-flow.json`), preventing false-positive `ARTIFACT_MISSING` validation failures in downstream validators (`DiscoveryValidator`).
* **Canonical Flow Invariant (P0.3):** Projections emit canonical `control-flow.json` and never reference legacy `cfg.json`.

### 4.3 Analysis-Run Atomicity & Completion Semantics

To guarantee that incomplete, in-progress, or failed discovery runs are never exposed or mixed with completed analysis results, LegacyExodus implements **Defense-in-Depth Atomicity**:

1. **Physical Persistence Atomicity (`SqliteStorageProvider.saveBatch`):**
   * Multi-record execution outputs (discovery metadata, symbol tables, dependency graphs, semantic call graphs, CFG/DFG graphs, knowledge graphs, and the terminal `analysis-run` completion record) are persisted within a single ACID database transaction (`db.transaction(...)`).
   * If an exception or crash occurs during batch persistence, SQLite automatically rolls back the entire transaction, ensuring zero orphan records from the aborted run remain on disk.
2. **Logical Completion Gating (`DiscoveryQueryService`):**
   * Each analysis run is explicitly tracked as an `analysis-run` storage record (`analysisRunPayloadSchema`) with deterministic lifecycle statuses (`created`, `running`, `completed`, `failed`).
   * When `DiscoveryQueryService` queries project discovery, dependency graphs, knowledge graphs, semantic analysis, or flow graphs without an explicit `analysisRunId`, it automatically coordinates on `getLatestCompletedRunId(projectId)`, ensuring all returned artifacts originate from the exact same completed run.
### 4.4 Concurrent Projection Safety & Multi-Artifact Integrity

To guarantee that concurrent projection operations targeting the same repository never produce interleaved files, race conditions, or corrupted manifest checksums:

1. **Per-Directory Projection Serialization (`FileDiscoveryProjectionAdapter`):**
   * Multi-artifact projection writes to the `.discovery/` directory are coordinated via an asynchronous per-directory promise queue (`directoryQueues: Map<string, Promise<void>>`).
   * When concurrent projection requests target the same repository output directory, they are executed sequentially in queue order. Each projection completes writing all its artifacts (`project.json`, `files.json`, `symbols.json`, etc.) and its terminal `manifest.json` before the next projection begins.
   * Projections targeting distinct repositories execute concurrently in parallel with zero contention.
   * **Bounded Lifecycle:** When all in-flight projection operations for a target directory complete, the corresponding map entry is immediately cleaned up, preventing memory retention.
   * **Error Resilience:** Failed or aborted projection tasks do not deadlock subsequent queued projections.
2. **Atomic File Replacement with Unique Temporary Paths (`StreamingJsonWriter`):**
   * Individual artifact writes stream to uniquely identified temporary files (`${destinationPath}.${randomUUID()}.tmp`) and promote to the destination path via `rename()`, falling back to `copyFile` + `unlink` when atomic rename is constrained, followed by automatic cleanup on terminal failure.
   * Unique temporary paths prevent concurrent file-level write collisions, ensuring no temporary files are overwritten or unlinked mid-stream, and unhandled write failures cleanly unlink the temporary file without leaving orphaned `.tmp` artifacts.

### 4.5 SQLite Storage Schema Versioning & Compatibility Guards

To prevent silent data corruption or ambiguous query failures across evolving versions:

1. **Deterministic Schema Stamping (`PRAGMA user_version`):**
   * The SQLite storage adapter defines an explicit canonical version constant (`SQLITE_SCHEMA_VERSION = 1`).
   * When initializing a new database, `SqliteStorageProvider` creates the required table and indexes and stamps `PRAGMA user_version = 1`.
2. **Explicit Compatibility Guard:**
   * Upon opening an existing database, `SqliteStorageProvider` reads `PRAGMA user_version`. If a version mismatch is detected (e.g., future or foreign schema `user_version != 1`), it throws an explicit `StorageSchemaVersionMismatchError` (code: `STORAGE_SCHEMA_VERSION_MISMATCH`) containing `{ expectedVersion: 1, actualVersion }` metadata.
3. **Handle Protection:**
   * If schema validation fails during construction, the database connection is cleanly closed in `try ... catch` to prevent dangling file locks on persistent disk databases.

### 4.6 SQLite Configuration & Lock Contention Hardening (F-008)

To ensure resilient execution across concurrent access and high-throughput pipeline runs on Windows and POSIX environments:

1. **Busy Timeout Configuration (`PRAGMA busy_timeout = 5000;`):**
   * Configures SQLite's busy handler with a 5,000ms retry window with exponential backoff, preventing transient file contention from raising immediate `SQLITE_BUSY: database is locked` exceptions.
2. **In-Memory Temporary Store (`PRAGMA temp_store = MEMORY;`):**
   * Directs temporary tables, subquery results, and transient sort structures to RAM instead of disk, eliminating disk I/O thrashing during query execution while maintaining bounded memory usage.
3. **Integrity & Concurrency Baseline:**
   * Retains `PRAGMA journal_mode = WAL;` for concurrent reads during writes, `PRAGMA synchronous = NORMAL;` for crash-safe performance, and `PRAGMA foreign_keys = ON;` for relational integrity.

### 4.7 Deep Immutability on Deserialization (DAT-01)

To guarantee that retrieved records cannot be modified in-place by consumers:
* `SqliteStorageProvider.deserializeRecord()` applies `deepFreeze()` recursively to deserialized JSON payloads.
* All nested objects, arrays, matrices, and maps within retrieved `StorageRecord` entities are deeply frozen, preventing accidental mutations from bleeding across queries or runtime scopes.

### 4.8 Storage Driver Auto-Inference & Path Validation (STORAGE-01)

To guarantee that persistence requests via CLI flags or environment variables never silently fall back to volatile memory:
* If `--storage-path` or `LEGACY_EXODUS_STORAGE_DB_PATH` is specified without an explicit storage driver, `loadRuntimeConfig` automatically selects `"sqlite"`.
* If `--storage-driver memory` is combined with `--storage-path`, `loadRuntimeConfig` throws an immediate, explicit `ConfigurationError`, rejecting ambiguous configurations.

### 4.9 Snapshot Reuse Contract Integrity

Snapshot reuse is accepted only after manifest integrity, workspace freshness, and canonical persisted payload schemas validate. Symbol tables preserve the complete canonical `CodeSymbol` representation rather than a lossy projection. Persisted semantic, CFG, and DFG payloads reuse the same nested schemas as their runtime contracts. An integrity-valid artifact with incompatible nested data is rejected and analysis falls back to a fresh run; malformed state is never treated as a completed reusable snapshot.

### 4.10 Owned-Path Write Containment

`FileDiscoveryProjectionAdapter` physically resolves the target project and `.discovery` directory, rejects redirected/non-directory roots, and rejects artifact destinations that are symlinks, non-files, or multiply linked. Safety checks occur before and around atomic publication. The `init` command applies the corresponding containment discipline to `.legacy-exodus/config.json`. These controls protect LegacyExodus-owned writes; they are not a general process sandbox for analyzed repositories.

### 4.11 Durable Commit and Projection Failure Semantics

For a fresh `AnalyzeProject` execution, the current boundary is:

```text
analysis computation
  -> atomic record + durable-event commit
  -> post-commit event delivery
  -> .discovery projection
  -> caller result
```

Storage records and the durable event journal are canonical analysis state. `.discovery` is a derived, integrity-checked materialization and a required deliverable of a successful fresh `analyze` command. These two facts produce the following explicit failure contract:

* A persistence failure before commit remains fatal and cannot be reported as committed analysis.
* A projection failure after commit does not roll back or relabel the completed analysis run. `LegacyExodusEngine` rejects with `DISCOVERY_PROJECTION_FAILED_AFTER_COMMIT`, preserves the original error as its cause, and includes `analysisCommitted: true`, `projectionStatus: "failed"`, project/run identity, and the underlying cause code/message.
* The CLI exits nonzero for that failure because its requested `.discovery` deliverable is incomplete; it does not print an ordinary successful analysis summary.
* With SQLite, committed records and `AnalysisRunCompleted` remain queryable after close/reopen. With memory storage, the commit is valid for the active runtime but is not cross-process durable.
* Atomicity is per artifact, not across the entire directory. The manifest is written last. A failed run may leave partial new artifacts or an older manifest, but reuse requires artifact hashes and workspace freshness to validate before consumption.
* `DiscoveryProjectionService` can materialize from the committed discovery record. No public CLI/API projection-only retry command currently exists; ordinary re-execution may recompute analysis and must not be described as an idempotent projection repair operation.

This contract is separate from post-commit event-delivery semantics: subscriber failures are recorded without failing an already committed command, whereas projection failure makes the requested filesystem deliverable incomplete and therefore remains a typed caller-visible failure.

### 4.12 Transient Session Reset & Storage Lifetime Management

To prevent unbounded memory growth in long-running engine hosts (such as IDE language servers, daemon processes, and multi-test execution suites) while preserving deterministic repeatability and avoiding destructive data loss:

1. **Deterministic Retention Model (No Uncontrolled Eviction):**
   * `MemoryStorageProvider` retains records in an in-memory `Map` for the lifetime of the active transient session.
   * LegacyExodus intentionally does not implement silent background LRU eviction, TTL expiry, or automatic run pruning. Within an active session, historical analysis records remain queryable via `DiscoveryQueryService` (e.g. `getAnalysisRun(projectId, runId)` and `listAnalysisRuns(projectId)`).
   * Memory bounds are controlled explicitly at session boundaries by the calling process.

2. **Caller-Controlled Lifecycle Boundary (`LegacyExodusEngine.resetSession`):**
   * Callers invoke `await engine.resetSession()` between independent tasks or repository analyses to release transient state without the overhead of destroying and reinitializing the engine runtime.
   * `resetSession()` leaves the engine in the `running` state. Configuration, runtime environments, and core services remain initialized and ready for subsequent commands.

3. **Selective Transient Clearing (`StorageManager.clearTransient`):**
   * `StorageManager` exposes `clearTransient()` which checks `this.isPersistent()`, delegating to `this.provider.isPersistent ?? false`.
   * **Transient Non-Persistent Providers (`MemoryStorageProvider`, In-Memory SQLite):** Because `isPersistent` is falsy (including `MemoryStorageProvider` and in-memory `SqliteStorageProvider`), `clearTransient()` executes `this.clear()`, clearing the provider's `records` Map (or SQLite table) and releasing the provider's retained references to those records.
   * **Persistent Providers (Disk-Backed `SqliteStorageProvider`):** Disk-backed SQLite providers configure `isPersistent = !this.isInMemory` (`true` when configured with a database file path). When `isPersistent()` is `true`, `clearTransient()` resolves immediately as a safe no-op (`Promise.resolve()`). Persisted `storage_records`, SQLite indexes, and durable domain events are preserved intact across session resets.
   * **Separation from Destructive Clearing:** `StorageManager.clear()` remains an administrative destructive operation that unconditionally calls `provider.clear()` (executing `DELETE FROM storage_records` on SQLite). Session resets strictly use `clearTransient()`, preventing catastrophic data loss in persistent configurations.

4. **Volatile Event Store Clearing (`InMemoryEventStore.clear`):**
   * `resetSession()` resets process-local volatile domain events via `context.eventStore.clear()` (`events.length = 0`).
   * When disk-backed SQLite storage is configured, durable domain events persisted in the `storage_records` table (`WHERE type = 'domain-event'`) remain stored and queryable via `loadDurableEvents`.

5. **Concurrency & Lifecycle Serialization:**
   * **Engine State Precondition:** `engine.resetSession()` verifies `this.state === "running"`. If the engine is in `created`, `stopping`, or `stopped` states, it immediately throws a typed `LegacyExodusError` with code `ENGINE_NOT_RUNNING`.
   * **Active Execution Guard:** If commands are currently executing (`this.activeExecutions.size > 0`), `resetSession()` immediately throws `ENGINE_BUSY` without clearing transient state.
   * **Execution Mutual Exclusion:** If a session reset is currently in progress (`this.resetPromise !== null`), `engine.execute()` immediately rejects with `ENGINE_BUSY`.
   * **Concurrent Reset Coalescing:** Multiple concurrent calls to `resetSession()` return the same active `resetPromise`, ensuring transient state is cleared in a single coordinated operation.
   * **Shutdown Synchronization:** `engine.shutdown()` checks if a session reset is in progress (`resetPromise !== null`) and awaits `Promise.allSettled([this.resetPromise])` before awaiting active executions and tearing down runtime components. Calling `resetSession()` after shutdown begins throws `ENGINE_NOT_RUNNING`.

6. **Terminal Disposal (`close`):**
   * During terminal `engine.shutdown()`, `StorageManager.close()` is called.
   * `MemoryStorageProvider.close()` delegates to `this.clear()`, clearing the provider's `records` Map and releasing the provider's retained references to those records.
   * `SqliteStorageProvider.close()` finalizes prepared statements (`maxSeqStmt.finalize()`) and closes the underlying SQLite database handle without deleting persisted records.

---

## 5. Implementation Evidence

* **Source Location:** [`src/storage/`](../../legacy-exodus-core/src/storage), [`src/storage/storage-manager.ts`](../../legacy-exodus-core/src/storage/storage-manager.ts), [`src/storage/adapters/memory-storage.ts`](../../legacy-exodus-core/src/storage/adapters/memory-storage.ts), [`src/storage/adapters/sqlite-storage.ts`](../../legacy-exodus-core/src/storage/adapters/sqlite-storage.ts), [`src/core/engine/engine.ts`](../../legacy-exodus-core/src/core/engine/engine.ts), [`src/core/events/event-store.ts`](../../legacy-exodus-core/src/core/events/event-store.ts), [`src/discovery/discovery-query-service.ts`](../../legacy-exodus-core/src/discovery/discovery-query-service.ts), [`src/core/orchestration/command-handler.ts`](../../legacy-exodus-core/src/core/orchestration/command-handler.ts), [`src/storage/projections/`](../../legacy-exodus-core/src/storage/projections).
* **Tests:** `engine.test.ts`, `memory-storage.test.ts`, `storage-manager.test.ts`, `storage-scoped-query.test.ts`, `schema-drift-integrity.test.ts`, `streaming-json-writer.test.ts`, `projection-manifest-integrity.test.ts`, `projection-failure-semantics.test.ts`, `analysis-run-atomicity.test.ts`, `concurrent-projection-safety.test.ts`, `storage-schema-versioning.test.ts`, `sqlite-storage.test.ts`.
* **Related ADR:** **[ADR-005: Storage Strategy](../adr/ADR-005-storage-strategy.md)**.
* **Architecture Spec:** **[Storage Service Architecture](../architecture/components/storage-service.md)**.
