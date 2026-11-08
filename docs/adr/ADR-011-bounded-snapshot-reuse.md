# ADR-011: Bounded-Memory Snapshot Reuse

## Status
**ACCEPTED** (2026-11-08, owner). Finding NA-16, found while fixing NA-04. **Implemented** (2026-11-09): decisions 1–3 for the semantic, CFG, DFG and knowledge artifacts in #285, then symbols, the dependency graph and the reuse gate (decision 4).

| Ghost, one process per run | Before | After |
|---|---|---|
| Snapshot reuse | 79 s, 11,610 MiB | 25 s, 936–1,006 MiB |
| Fresh analysis (unchanged) | 179 s, 2,400 MiB | 183 s, 2,417 MiB |

## Context
Reusing a validated `.discovery` snapshot costs far more memory than analysing from scratch. On Ghost (7,172 analysed files), measured with the benchmark harness, which now reports `snapshotReused`:

| Path | Wall time | Peak RSS |
|---|---|---|
| Fresh analysis | 216–253 s | 1,677–2,213 MiB |
| Snapshot reuse | 91 s | **8,939 MiB** |

The reuse path in `src/core/orchestration/command-handler.ts`:
1. keeps every validated artifact's bytes in memory (`validatedArtifacts`, about 1.8 GB on Ghost). This is deliberate: REUSE-03 consumes exactly the bytes whose digests were checked, so a file swapped between the check and the use cannot be read (TOCTOU);
2. `JSON.parse`s each artifact and re-validates it with zod;
3. rebuilds full storage records from it, then commits them.

ADR-009 bounded the fresh path by keeping fact lists on disk (`FactArray`). The reuse path never got the same treatment.

## Decision (proposed)
Reuse streams, keeping REUSE-03's guarantee:
1. **Verify while copying.** Each artifact is streamed once: hashed, and written to a run-scoped spool file. Only the spool copy is consumed afterwards, and only if its digest matched. That is the same TOCTOU guarantee without holding the bytes in memory.
2. **Restore as disk lists.** Large lists (calls, references, CFG and DFG graphs, symbols) become `FactArray` handles over the spool, exactly as the fresh path stores them (ADR-009). Records hold handles, not arrays.
3. **Validate per item.** Schemas validate list items as they stream, not whole documents.
4. **Gate.** The scale benchmark gains a reuse run with its own budget, at or below the fresh budget. CI fails a reuse that exceeds it.

## Invariants
- REUSE-03: the bytes consumed are the bytes verified. There is a test with a file replaced after verification.
- A reused analysis is fact-identical to the snapshot it restores (fact-diff 0/0).
- Reuse peak memory is at or below the fresh-analysis peak on Ghost.

## Alternatives considered
- **Skip restoring storage on reuse** when only the projection is needed. This is faster, but it changes what storage holds after a reuse (the SQLite run history). Possible later as an option, not the default.
- **Keep as is and document the limit.** This contradicts the scale goal: reuse is the common path for repeated CI runs.

## Consequences
- The reuse path moves to the same streaming building blocks as the fresh path, so there is less duplicated code.
- This is a prerequisite for S6 (incremental runs), which reuses snapshots per file.
