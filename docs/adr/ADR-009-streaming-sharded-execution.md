# ADR-009 — Streaming, Sharded Execution

## Status
**ACCEPTED** (2026-11-03, owner). S4/S5 of the remediation queue; implemented before the IR phase, in the rollout steps below.

## Context
`AnalyzeProjectHandler` runs as one in-memory pass over the repository. Per file it builds symbols, calls and references, HTTP facts, CFGs and a data-flow context, and appends each to repository-wide arrays (`symbolTables`, `allCalls`, `allControlFlowGraphs`, `allContexts`, …). Cross-file stages (dependency graph, semantic synthesis, `flowEngine.connect`) then read those arrays. Projections serialize everything once, at the end, into a few large JSON artifacts. Only ASTs are spilled to disk (`run-scoped-ast-store`).

Peak memory therefore grows with the repository, not with the largest file. Measured on Ghost (9,171 files, 7,172 analyzed):
- Peak RSS is 7.6 GiB before ADR-008 keys and ids, and 9.9 GiB after (same machine, same session). The budget is 6.8 GiB.
- Live heap is 2–4 GiB. The rest of the peak is short-lived garbage the runtime collects late, and serialization buffers.
- Removing waste (#225, #235, #236) cut time 3× but cannot change the shape. A 500k-file enterprise repository (≈50× Ghost) does not fit on any machine under this design.

ADR-008 made every fact's id independent of other files and of position, which is the prerequisite for per-file shards and caches.

## Decision
Analysis keeps only **one file's facts plus a compact cross-file summary** in memory. Everything else lives in per-file shards on disk.

1. **Pass 1, per file (parallelizable):** parse, symbols, module references. Write the file's **shard**, then keep only its **summary**: export bindings (id, name, kind), import specifiers, module references and file hash.
2. **Link:** build the module graph and import/export resolution from summaries only. The summary index lives in memory up to a configured size, beyond that in SQLite (already a storage adapter). Its size is O(exports + imports), not O(facts).
3. **Pass 2, per file:** load the file's shard and the link index. Build calls and references, routes, CFGs and the data-flow context, append them to the shard, and drop them. Keep only the **interprocedural summary**: function summaries (parameter and return definition ids), call bindings, and source and sink ids with their keys.
4. **Cross-file taint:** a worklist over interprocedural summaries only, with ids interned to integers in memory. The results (cross-file flows) are appended to the affected shards.
5. **Output:** `.discovery/shards/<file-id>.json` per analyzed file, plus a manifest listing each shard's digest, still authenticated by the HMAC manifest (ADR-006, BA-26). Repository views (semantic findings, knowledge graph, summary) are computed by streaming over shards, never by loading them all. The current single-artifact projections become derived views and stay available for compatibility.
6. **Budgets as gates:** CI runs a synthetic scale corpus (100k files) with a fixed peak-RSS ceiling. Ghost must sit within its budget with headroom.

Follow-ups enabled by this design, decided separately:
- **S6, incremental runs:** reuse a shard keyed by content hash, engine fingerprint and config; invalidation follows the link index.
- **S7, workers:** a bounded worker pool for both passes, with per-worker memory budgets.

## Invariants
- **The same facts.** A sharded run is fact-diff 0/0 against the in-memory engine on every corpus. Outputs are byte-identical across runs and worker counts.
- **No cross-file fact lost.** Everything a later stage needs from another file goes through a declared summary contract, tested on its own.
- **Unknowns stay explicit.** A shard that fails to write or verify fails the run for that file, visibly, as dispositions do today.

## Rollout
1. Shard writer, with the existing projections derived from shards (output identical). Shards start run-scoped (beside the run-scoped AST store); persisting them under `.discovery/shards` with the manifest comes with S6, which is the first consumer that needs them after the run.
2. Pass 1 plus summaries plus link, with the dependency graph from summaries (fact-diff 0/0).
3. Pass 2 per file, with semantic and CFG facts streamed (fact-diff 0/0).
4. Cross-file taint over interprocedural summaries (fact-diff 0/0).
5. Scale gate in CI, and the Ghost budget re-baselined on a cool machine.

## Alternatives Considered
- **Keep tuning the in-memory engine.** Rejected: measured gains are already exhausted (S4/S5 investigation, 2026-11-03). The shape is O(repository).
- **Compact records or explicit GC.** Tried and reverted: JSON strings held more than the objects they replaced, and GC hints gave −2% on Ghost.
- **A database for all facts.** Rejected for now: a per-file shard is simpler, cacheable and HMAC-friendly. SQLite is used only for the link index at very large scale.

## Consequences
- **Positive:** peak memory O(largest file + summaries); enterprise-scale repositories become feasible; incremental and parallel runs become straightforward.
- **Tradeoff:** more disk I/O, and a summary contract to maintain between passes.
- **Tradeoff:** the `.discovery` layout gains shards, with existing artifacts kept as derived views.

## Related Documentation
- [ADR-005 Storage Strategy](ADR-005-storage-strategy.md), [ADR-006 Security Model](ADR-006-security-model.md), [ADR-008 Edit-Stable Fact Identity](ADR-008-edit-stable-identity.md).
