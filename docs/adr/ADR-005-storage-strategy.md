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
1. **Abstract Storage Manager:** Implement `StorageManager` (`storage-manager.ts`) providing pluggable `StorageProvider` interfaces for CRUD operations on typed `StorageRecord` entities.
2. **In-Memory Volatile Provider:** Use `MemoryStorageProvider` (`memory-storage.ts`) for fast, isolated, deterministic in-memory operations during CLI analysis runs.
3. **Streaming JSON Projections:** Implement `StreamingJsonWriter` (`streaming-json-writer.ts`) for disk projections. Uses bounded 64KB chunk buffers with backpressure, inline SHA-256 computation, and atomic flush to stream multi-megabyte JSON arrays/objects with minimal heap memory consumption.
4. **Discovery Snapshot Reuse & Freshness (REUSE-01, REUSE-02, REUSE-03):** Use `DiscoveryValidator` (`discovery-validator.ts`) to validate on-disk `.discovery/` projections against `manifest.json` cryptographic checksums and target workspace freshness (file set, sizes, and `sourceDigest`) before analysis. When valid, downstream commands and migration consumers reuse persisted discovery facts and restored analysis records (`dependency-graph`, `symbol-table`, `knowledge-graph`, `semantic-analysis`, `control-flow-analysis`, `data-flow-analysis`, `analysis-run`), bypassing full file scanning and AST re-parsing. Validated artifact bytes are returned in-memory to prevent filesystem TOCTOU tampering. If any artifact is corrupted, missing, or mismatched, the engine automatically falls back to fresh discovery.
5. **Persistent Cross-Process Storage:** `SqliteStorageProvider` enables durable persistence across independent CLI and migration process lifetimes, queryable via `DiscoveryQueryService` without whole-graph memory materialization. Deserialized record payloads are recursively deep-frozen (`deepFreeze()`, DAT-01) to ensure absolute immutability.
6. **Storage Driver Auto-Inference & Path Validation (STORAGE-01):** When `--storage-path` is provided without `--storage-driver`, the runtime automatically infers the `"sqlite"` storage driver. If `--storage-driver memory` is explicitly requested alongside `--storage-path`, the runtime throws an explicit `ConfigurationError` to prevent silent persistence misconfiguration.
7. **Current Implementation vs Target Architecture:**
   * **Current / Implemented:** `MemoryStorageProvider`, `SqliteStorageProvider` (with `PRAGMA user_version = 1` schema compatibility, `PRAGMA busy_timeout = 5000;`, and WAL journaling), `StreamingJsonWriter` chunked disk projection with inline hashing and backpressure, `DiscoveryValidator` cryptographic manifest integrity, automatic discovery snapshot reuse with workspace freshness and artifact restoration, `DiscoveryQueryService` run-scoped queries, storage driver auto-inference and path validation.
   * **Target / Planned:** DuckDB embedded analytics, Parquet columnar export dumps, and multi-tenant PostgreSQL persistence.

## Alternatives Considered
* **Eager JSON Serialization (`JSON.stringify`):** Rejected because serializing multi-megabyte graph models in a single call causes heap thrashing and out-of-memory errors on large repositories.
* **External Heavy Database Requirement:** Rejected for base CLI to preserve zero external infrastructure dependencies by leveraging in-memory storage and Bun's built-in native embedded SQLite engine.
* **Unvalidated File Caching:** Rejected because stale or corrupted discovery files would cause false downstream migration results. `DiscoveryValidator` guarantees complete cryptographic artifact integrity before reuse.

## Consequences
* **Positive:** Valid snapshots can avoid fresh scanning and AST analysis when integrity, freshness, and schema checks pass.
* **Limitation:** Universal bounded-memory scaling and performance characteristics require live comparative benchmark evidence; they are not guaranteed by streaming projection alone.
* **Positive:** Clean abstraction allows switching between in-memory and persistent SQLite storage providers without changing analysis engines.
* **Positive:** Independent migration processes can query persistent SQLite facts without rediscovering the target codebase.
* **Tradeoff:** Streaming output requires careful chunk delimiter and backpressure management.

## Verification / Evidence
* **Source Implementation:** [`src/storage/adapters/memory-storage.ts`](../../legacy-exodus-core/src/storage/adapters/memory-storage.ts), [`src/storage/adapters/sqlite-storage.ts`](../../legacy-exodus-core/src/storage/adapters/sqlite-storage.ts), [`src/storage/projections/streaming-json-writer.ts`](../../legacy-exodus-core/src/storage/projections/streaming-json-writer.ts), [`src/storage/storage-manager.ts`](../../legacy-exodus-core/src/storage/storage-manager.ts).
* **Test Suite:** `memory-storage.test.ts`, `sqlite-storage.test.ts`, `streaming-json-writer.test.ts`, `storage-manager.test.ts` (100% passing tests).
* **Performance Evidence:** Stable memory profile across 3-run deterministic benchmark sweeps (documented in `BENCHMARK_REPORT.md`).

## Related Documentation
* **[docs/architecture/components/storage-service.md](../architecture/components/storage-service.md):** Storage subsystem specification.
* **[ROADMAP.md](../../ROADMAP.md):** Track 3 P1.3 memory scalability milestone.
