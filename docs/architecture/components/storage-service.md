# Storage Service

> **Status:** `PARTIAL`. The current core implements one injected storage provider behind `StorageManager`, with in-memory and SQLite adapters, scoped record queries, batch commit operations, validated snapshot reuse, and contained `.discovery` projections. Storage-provider record persistence across processes is available only with disk-backed SQLite. The separate stores and enterprise capabilities described under Target Architecture are not implemented.

## Overview

The current storage boundary gives runtime and pipeline services one typed interface for saving and querying serialized records. The active `StorageManager` delegates to exactly one injected `StorageProvider`: `MemoryStorageProvider` or `SqliteStorageProvider`.

## Current Implementation

```text
Pipeline / Runtime Services
            |
            v
      StorageManager
            |
            v
      StorageProvider
       /          \
      v            v
MemoryStorageProvider   SqliteStorageProvider
```

This is a record-oriented abstraction, not three independently implemented artifact, metadata, and state services. Discovery projection is a separate service that derives `.discovery` files from stored analysis records.

### Current Storage Contract

`StorageProvider` currently exposes:

- `save`
- optional `saveBatch`
- optional `commitBatch`
- `findById`
- `findAll`
- `findScoped`
- `iterateScoped`
- `delete`
- `clear`
- optional `close`
- optional `isPersistent`

`StorageManager` delegates those operations to its provider. Its fallback batch implementations preserve the common interface when a provider does not supply an optimized batch method; they do not add transactionality that the provider itself lacks.

### Current Providers

- **`MemoryStorageProvider`:** Validates records and stores them in a process-local `Map`. It supports scoped queries and record/event batch commit behavior, but is transient and non-persistent. Saving an existing record ID replaces the retained record. `clear()` removes all records, and `close()` clears retained records.
- **`SqliteStorageProvider`:** Uses Bun SQLite, either as `:memory:` or a disk-backed database. It stores records in one `storage_records` table, indexes record type, run scope, file path, and durable event sequence, and validates the SQLite schema version. It supports transactional `saveBatch` and immediate transactional `commitBatch` for records plus durable events. Scoped queries filter by type and optional `projectId`, `analysisRunId`, and `filePath`. `close()` finalizes retained statements and closes the database.

## Target Architecture (Planned)

The long-term storage architecture separates artifact payloads, indexed metadata, and execution state. These are target responsibilities, not independently implemented services in the current core.

```text
Pipeline Services
      |
      v
Storage API
      |
      +--> Artifact Store (binary/object)            [TARGET]
      |
      +--> Metadata Store (relational/indexed)       [TARGET]
      |
      +--> State Store (run/checkpoint lifecycle)    [TARGET]
```

Planned responsibilities include:

- durable storage for all stage outputs and operational state
- immutable artifact versions and append-only lineage links
- checkpoint and resume workflows
- transactionally guarded state-machine transitions
- retry policy for transient writes and artifact quarantine
- retention and compliance retrieval services
- tenant and environment storage semantics
- distributed artifact storage and separately designed vector or graph stores
- integrity checksums and validated artifact-to-metadata-to-state references

None of these planned capabilities should be inferred from the current record provider merely because SQLite persistence or `.discovery` projection exists.

## Current Lifecycle & Resource Management

### Storage Provider Lifecycles: Transient vs. Persistent

LegacyExodus supports two concrete storage adapter implementations. `StorageManager.isPersistent()` treats an absent provider flag as `false`; SQLite explicitly reports persistence according to whether it is disk-backed:

- **Transient In-Memory Storage (`MemoryStorageProvider`):** Stores records in process-local JavaScript `Map` collections. Records persist for the duration of the active transient session. Because `isPersistent` is undefined (falsy), it operates under transient non-persistent semantics. There is no automatic time-to-live (TTL), least-recently-used (LRU) cache eviction, or background run pruning.
- **SQLite Storage (`SqliteStorageProvider`):** Persistence capability is determined dynamically:
  - **Disk-backed SQLite (`isPersistent === true`):** When configured with a database file path (`!this.isInMemory`), records, tables, indexes, and durable domain events persist across engine instances and process restarts.
  - **In-Memory SQLite (`isPersistent === false`):** When configured in-memory (`:memory:` or `options.inMemory = true`), records exist only within process memory and operate under transient non-persistent semantics.

### Caller-Controlled Session Reset (`LegacyExodusEngine.resetSession()`)

For long-lived host processes (IDEs, background language services, daemons, test suites), memory retention across multiple analysis runs is bounded via explicit caller-controlled lifecycle management:

- **Explicit Session Boundary:** Callers invoke `engine.resetSession()` between independent tasks or repository analyses to release transient state without re-initializing the engine.
- **Operational Readiness:** `resetSession()` leaves the engine in the `running` state. Configuration, runtime environments, and core services remain initialized and ready for subsequent commands.
- **Transient State Reset:** `resetSession()` coordinates transient state clearing across two subsystems:
  1. `StorageManager.clearTransient()`: Clears provider-held record entries when `isPersistent()` is `false`, while acting as a safe no-op for persistent storage (`isPersistent()` is `true`).
  2. `InMemoryEventStore.clear()`: Resets process-local volatile domain events (`events.length = 0`).
- **Historical Query Semantics:** Prior to `resetSession()`, historical analysis records and run ledgers remain queryable via `DiscoveryQueryService`. The caller explicitly controls when historical session data is discarded.

### Transient Clearing vs. Destructive Clearing

To prevent accidental data loss in persistent configurations, the storage abstraction distinguishes between session-level transient clearing and administrative destructive clearing:

- **`StorageManager.clearTransient()`:** Evaluates provider persistence via `isPersistent()`. For transient non-persistent providers (`isPersistent === false`, including `MemoryStorageProvider` and in-memory `SqliteStorageProvider`), it executes `provider.clear()` to clear provider-held record entries. For persistent providers (`isPersistent === true`, such as disk-backed `SqliteStorageProvider`), it returns an immediate resolved Promise (`Promise.resolve()`), preserving all persisted `storage_records`, SQLite schema, and durable domain events.
- **`StorageManager.clear()`:** Destructive administrative operation that unconditionally delegates to `provider.clear()`. On SQLite, this executes `DELETE FROM storage_records`. Session resets strictly invoke `clearTransient()` and must never invoke `clear()`.

### Concurrency & Lifecycle Serialization

Session reset operations are strictly serialized against execution and shutdown lifecycles:

- **Engine Running Invariant:** `resetSession()` requires the engine state to be `running`. Invoking reset before initialization or after shutdown has begun throws a typed `ENGINE_NOT_RUNNING` error.
- **Execution Mutual Exclusion:**
  - `resetSession()` throws `ENGINE_BUSY` if any command execution is active (`activeExecutions.size > 0`), aborting without modifying transient state.
  - `engine.execute()` throws `ENGINE_BUSY` if a session reset is currently in flight (`resetPromise !== null`).
- **Concurrent Reset Coalescing:** Concurrent invocations of `resetSession()` join the same in-flight `resetPromise`, executing the underlying clear operations exactly once.
- **Shutdown Synchronization:** If `engine.shutdown()` is called while a session reset is in progress, shutdown waits for the active reset to settle before proceeding with component disposal.

### Terminal Shutdown & Handle Cleanup

- **`MemoryStorageProvider.close()`:** Delegates to `this.clear()`, clearing the provider's `records` Map and releasing the provider's retained references to those records on engine shutdown.
- **`SqliteStorageProvider.close()`:** Finalizes prepared statements (such as `maxSeqStmt`) and closes the SQLite database handle without deleting persisted records.

## Target Observability (Planned)

- write/read latency
- storage growth by artifact class
- integrity failure rate
- checkpoint restore success rate
