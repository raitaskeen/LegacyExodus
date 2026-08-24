# ADR-001 — Project State Architecture

## Status
**ACCEPTED** (Implemented & Verified in Phase 1–3)

## Context
LegacyExodus operates as a multi-stage static-analysis compiler pipeline (Discovery $\to$ Parser $\to$ Symbols $\to$ Module Graph $\to$ Semantic Call Graph $\to$ Flow Graphs $\to$ Streaming Projections). Each stage ingests artifacts from previous stages and produces new structural intelligence.

The system required an architectural decision for managing project state:
1. Mutating a shared global state object vs maintaining immutable, versioned project state snapshots.
2. Unchecked JSON structures vs runtime-validated strictly typed schemas.
3. In-memory orchestration state vs immediate database persistence.

## Decision
1. **Immutable In-Memory State Snapshots:** Implement `ProjectState` as an immutable, strictly typed state aggregate validated via Zod schemas (`state-schema.ts`).
2. **Deterministic State Transitions:** State transitions occur strictly through pure reducer logic (`event-reducer.ts`) triggered by domain events or explicit orchestrator command handlers (`command-handler.ts`).
3. **Artifact-Anchored Identity:** Files and entities are indexed deterministically using SHA-256 relative path file hashes (`FileId`), eliminating environmental or absolute path leakage.
4. **Current Implementation vs Target Architecture:** In-memory state snapshots with streaming JSON disk projection (`StreamingJsonWriter`) represent current verified implementation. SQLite/Parquet knowledge graph query layers are planned target architecture.

## Alternatives Considered
* **Direct Mutable Global Context:** Rejected because mutable shared state introduces race conditions, breaks determinism, and makes multi-run diff verification impossible.
* **Direct Database Dependency (Postgres / MongoDB):** Rejected for core analysis runs to ensure zero-infrastructure standalone CLI operation on Bun.

## Consequences
* **Positive:** Guaranteed bit-for-bit determinism across identical input repositories; strict type safety prevents runtime structure drift.
* **Positive:** Clear audit trail and reproducible pipeline replay.
* **Tradeoff:** Large repositories require memory-conscious bounded projections, resolved via `StreamingJsonWriter` chunk backpressure.

## Verification / Evidence
* **Source Implementation:** [`src/core/state/project-state.ts`](../../legacy-exodus-core/src/core/state/project-state.ts), [`src/core/state/state-factory.ts`](../../legacy-exodus-core/src/core/state/state-factory.ts), [`src/core/state/state-schema.ts`](../../legacy-exodus-core/src/core/state/state-schema.ts)
* **Test Suite:** `project-state.test.ts` and `state-factory.test.ts` (100% passing tests).
* **Determinism Evidence:** 3-run identical SHA-256 state outputs across Tier 1, Tier 2, and Tier 3 benchmark repositories.

## Related Documentation
* **[docs/PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md):** Foundational pipeline context.
* **[docs/architecture/runtime-architecture.md](../architecture/runtime-architecture.md):** Runtime composition and state factory models.
* **[GOVERNANCE.md](../../GOVERNANCE.md):** Deterministic execution invariants.
