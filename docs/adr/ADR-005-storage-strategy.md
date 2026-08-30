# ADR-005 — Storage Strategy & Projection Architecture

## Status
**ACCEPTED** (Implemented & Verified in Phase 1–3)

## Context
LegacyExodus generates substantial static intelligence data (ASTs, symbol tables, dependency graphs, call graphs, basic-block CFGs, def-use DFGs). For enterprise repositories (e.g. Fastify with 385 files, Express with 234 files), holding entire serialization trees in memory before dumping to disk causes memory spikes.

Key challenges:
1. Providing an abstract storage layer decoupled from physical storage technology.
2. Preventing memory exhaustion during large projection serializations.
3. Distinguishing current zero-dependency CLI execution from future high-throughput enterprise persistence.

## Decision
1. **Abstract Storage Manager:** Implement `StorageManager` (`storage-manager.ts`) providing pluggable `StorageAdapter` interfaces for CRUD operations on typed `StorageRecord` entities.
2. **In-Memory Volatile Adapter:** Use `MemoryStorageAdapter` (`memory-storage.ts`) for fast, isolated, deterministic in-memory operations during CLI analysis runs.
3. **Streaming JSON Projections:** Implement `StreamingJsonWriter` (`streaming-json-writer.ts`) for disk projections. Uses bounded 64KB chunk buffers with backpressure and atomic flush to stream multi-megabyte JSON arrays/objects with minimal heap memory consumption.
4. **Current Implementation vs Target Architecture:**
   * **Current / Implemented:** `MemoryStorageAdapter`, `SqliteStorageAdapter` (with `PRAGMA user_version = 1` schema compatibility, `PRAGMA busy_timeout = 5000;`, and WAL journaling), `StreamingJsonWriter` chunked disk projection with bounded 64KB backpressure, atomic filesystem replacement with bounded retries.
   * **Target / Planned:** DuckDB embedded analytics, Parquet columnar export dumps, and multi-tenant PostgreSQL persistence.

## Alternatives Considered
* **Eager JSON Serialization (`JSON.stringify`):** Rejected because serializing multi-megabyte graph models in a single call causes heap thrashing and out-of-memory errors on large repositories.
* **External Heavy Database Requirement:** Rejected for base CLI to preserve zero external infrastructure dependencies by leveraging in-memory storage and Bun's built-in native embedded SQLite engine.

## Consequences
* **Positive:** Flat memory profile during large repository scans (verified on Tier-2 Fastify and Tier-3 Express).
* **Positive:** Clean abstraction allows switching between in-memory and persistent SQLite storage providers without changing analysis engines.
* **Tradeoff:** Streaming output requires careful chunk delimiter and backpressure management.

## Verification / Evidence
* **Source Implementation:** [`src/storage/adapters/memory-storage.ts`](../../legacy-exodus-core/src/storage/adapters/memory-storage.ts), [`src/storage/adapters/sqlite-storage.ts`](../../legacy-exodus-core/src/storage/adapters/sqlite-storage.ts), [`src/storage/projections/streaming-json-writer.ts`](../../legacy-exodus-core/src/storage/projections/streaming-json-writer.ts), [`src/storage/storage-manager.ts`](../../legacy-exodus-core/src/storage/storage-manager.ts).
* **Test Suite:** `memory-storage.test.ts`, `sqlite-storage.test.ts`, `streaming-json-writer.test.ts`, `storage-manager.test.ts` (100% passing tests).
* **Performance Evidence:** Stable memory profile across 3-run deterministic benchmark sweeps (documented in `BENCHMARK_REPORT.md`).

## Related Documentation
* **[docs/architecture/components/storage-service.md](../architecture/components/storage-service.md):** Storage subsystem specification.
* **[ROADMAP.md](../../ROADMAP.md):** Track 3 P1.3 memory scalability milestone.
