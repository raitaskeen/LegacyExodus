# Engine context (conditional)

LegacyExodus is a codebase analysis and modernization project. Its current
integrated runtime discovers repositories and builds bounded JavaScript analysis
artifacts; end-to-end semantics-preserving migration remains target architecture.

Use for source, semantics, design, performance, and implementation claims.
This is a navigation map, not live certification. Revalidate cited paths and
behavior at the task's frozen implementation SHA before using any claim.
Do not load unrelated subsystems or roadmaps by default.

## Current implementation map

| Surface | Architecture state | Inspect in legacy-exodus-core/src |
|---|---|---|
| Discovery and analysis orchestration | IMPLEMENTED; supported behavior is bounded by contracts | discovery/discovery-engine.ts; core/orchestration/command-handler.ts |
| JavaScript frontend and symbols | IMPLEMENTED; not a universal language frontend | runtime/composition/services.ts; parser/manager/parser-manager.ts; symbols/javascript-symbol-extractor.ts |
| Module and call relationships | PARTIAL; resolution coverage must be checked | graph/dependency-graph-builder.ts; semantic/semantic-engine.ts; semantic/call-graph-builder.ts |
| CFG, DFG, taint and interprocedural transfers | PARTIAL; no general semantic-completeness claim | flow/flow-analysis-engine.ts; flow/data-flow-builder.ts; flow/control-flow-builder.ts; flow/flow-contracts.ts |
| Knowledge graph | PARTIAL; file/symbol nodes and contains/imports relationships | knowledge/knowledge-graph.ts |
| Event/state, runtime and storage | IMPLEMENTED; verify run/transaction/failure guarantees separately | core/orchestration/orchestrator.ts; runtime/composition/services.ts; storage/adapters/sqlite-storage.ts |

The flow engine builds DFG contexts from ASTs, proven semantic call targets and
symbols; it separately builds CFGs from ASTs, then connects flow contexts. The
current DFG is not CFG-derived. Module/call resolution and graph building have
distinct dependencies; this is not one universal linear compiler pipeline.

Check discovery accounting partitions against actual contracts; retain source
locations and stable identities; preserve lexical scopes, var hoisting and
shadowing; distinguish resolved from inferred call targets; test run/project
storage isolation, transaction failures, shutdown idempotency and error reporting.
For subprocess/path boundaries inspect actual executable selection, shell behavior,
Windows batch handling and traversal defenses. These are review questions, not
blanket claims of verified safety.

## North star

TARGET ARCHITECTURE, not an implemented sequential runtime:

repository snapshot -> discovery -> parser frontends -> symbols/scopes ->
module relationships -> call relationships -> CFG -> DFG/flow -> taint/effects ->
semantic evidence -> Semantic IR -> repository knowledge -> migration units ->
proof obligations -> bounded Jev -> deterministic transformation -> verification ->
human/release gate.

This expresses intended dependencies and feedback obligations; current AST-based
DFG and the small knowledge graph must not be misrepresented by those arrows.
General Semantic IR, migration/proof pipeline, Jev and deterministic cross-language
transformation are TARGET ARCHITECTURE here, not working integrated capabilities.
DEFERRED is a scheduling annotation requiring a dated decision, not an implementation
state; do not invent a deferral. CURRENT denotes observed implementation at a
frozen revision; PARTIAL denotes bounded working coverage.

Architecture claims use exactly one state: IMPLEMENTED, VERIFIED, PARTIAL,
EXPERIMENTAL, PLANNED, TARGET ARCHITECTURE, NOT IMPLEMENTED. VERIFIED additionally
needs applicable tests and benchmark evidence. PLANNED requires a concrete design.
A source map alone does not certify any subsystem as VERIFIED.

## Documentation truth

Freeze the implementation revision before reasoning about it. Core truth is
`main` (`core-foundation` and `docs-foundation` are retired, 2026-10-28); a
revision the task names explicitly takes precedence. Use branch-qualified Git to resolve it, then
git show <frozen-implementation-sha>:legacy-exodus-core/src/<path> and equivalent
tests/benchmark queries throughout. Never use the stale core snapshot in
docs-foundation, copy core there, or merge main merely to refresh that snapshot.

For stacked reviews, check exact target revision, implementation content and
ancestry. Squash integration can preserve content with different ancestry.
Classify a stale review base separately from a real defect; do not weaken a true
contract to satisfy stale commentary. Keep Diataxis content purpose and existing
navigation; relocation requires scope authorization.
