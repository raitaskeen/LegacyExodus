# Storage Service

> **Status:** `PARTIAL`. The current core implements injected in-memory and SQLite providers, a storage manager, run-scoped records, durable analysis commit, validated snapshot reuse, and contained `.discovery` projections. Enterprise databases, distributed artifact storage, retention services, multi-tenancy, and general checkpoint/resume are not implemented.

## Overview

Storage Service provides durable, versioned persistence for artifacts, metadata, and project execution state across the LegacyExodus pipeline.

## Scope

- artifacts
- project state
- metadata
- versioning
- persistence

## Purpose

- Persist all stage outputs and operational state reliably.
- Preserve provenance and auditability.
- Enable checkpoint/resume, replay, and compliance retrieval.

## Data Domains

### 1) Artifacts
- Discovery artifacts
- Parsed artifacts
- Graph snapshots
- Knowledge snapshots
- Transformation bundles
- Validation reports

### 2) Project State
- run lifecycle state
- stage progress state
- checkpoint pointers
- retry/terminal outcomes

### 3) Metadata
- provenance hashes
- policy/contract versions
- tenant and environment tags
- timestamps and lineage references

## Versioning Model

- Immutable artifact versions
- Append-only lineage links
- Explicit schema versions
- No silent overwrite of accepted records

## Persistence Architecture

```text
Pipeline Services
      |
      v
Storage API
      |
      +--> Artifact Store (binary/object)
      |
      +--> Metadata Store (relational/indexed)
      |
      +--> State Store (run/checkpoint lifecycle)
```

## Contracts

### Input
- Typed artifact/state write requests with provenance and policy context.

### Output
- Persisted record identifiers
- version/hash references
- retrieval pointers

## Consistency and Integrity

- Writes require integrity checksums.
- State transitions are transactionally guarded.
- Cross-reference integrity (artifact ↔ metadata ↔ state) must validate.

## Failure Handling

- Write failure => retry if transient; fail if integrity violation.
- Version conflict => reject and require explicit new version.
- Corrupt artifact => quarantine and block downstream consumption.

## Lifecycle & Resource Management

### Storage Provider Lifecycles: Transient vs. Persistent

LegacyExodus supports two concrete storage adapter implementations with persistence capability determined by `isPersistent = !this.isInMemory`:

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
- **Idempotent Disposal:** Repeated `shutdown()` calls are safe no-ops and never throw.

## Observability

- write/read latency
- storage growth by artifact class
- integrity failure rate
- checkpoint restore success rate
