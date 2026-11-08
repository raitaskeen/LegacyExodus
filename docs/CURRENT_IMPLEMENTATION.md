# Current Implementation

**Documentation state:** `PARTIAL`. Re-labelled on 2026-10-28 from the [blind audit](https://github.com/raitaskeen/LegacyExodus/pull/203); finding ids (BA-xx) refer to it.

**Implementation truth:** `main`. `core-foundation` and `docs-foundation` are retired as integration branches (2026-10-28). No SHA is pinned here; verify the exact revision you review.

This page is the concise status boundary for LegacyExodus. Implementation source, executable tests, and verified runtime behavior remain authoritative if this page drifts.

## Current core (implemented; limits below)

- Bun runtime and strict TypeScript contracts.
- Engine facade, runtime lifecycle, command/orchestrator boundary, event bus/store, and durable event journal. Durable command commit defines success; post-commit synchronous notification failures are separately recorded and logged without implying rollback.
- Repository discovery with deterministic inventory, source/non-source classification, package/framework signals, and isolated enumeration failures.
- Babel-based JavaScript/TypeScript/JSX/TSX parsing, including standard decorator syntax, into normalized immutable AST contracts. Decorator semantics are not interpreted. The Babel dialect is chosen per file extension: `.d.ts` uses declaration mode, `.ts` has no JSX, `.tsx` has JSX, and JavaScript gets JSX plus pragma-only Flow; the source type is fixed per extension (BA-01).
- Lexical symbol extraction, ESM/CommonJS modelling, module resolution, dependency cycles, and a knowledge graph of file and symbol nodes with contains/imports edges (BA-19, not yet unified with flow facts). TypeScript declarations and namespaces (BA-02); TS module resolution with JSONC `tsconfig`/`jsconfig`, `extends`, `paths` and baseUrl (BA-03); class expressions and switch/static-block scopes (BA-13); namespace imports (BA-09); dynamic `import()` and computed loads as explicit unknowns (BA-10); compiled CommonJS (BA-12); npm/Yarn/pnpm workspace packages by name (S3). Third-party packages in `node_modules` and package `exports`/`imports` maps stay unresolved.
- Semantic call/reference analysis. Every call site is a fact; a callee no name denotes is an explicit UNRESOLVED call (NA-01), a tagged template calls its tag, and a call is RESOLVED only when its target is proven; `with` bodies and files with a direct `eval` resolve nothing they could rebind (NA-02). Fact ids are edit-stable keys (ADR-008). Express routes and middleware are modelled per router, in registration order, through mounts, and stay `INFERRED` (BA-08). Dead-code findings are `INFERRED`; a function an unresolved call names is not reported dead (NA-09).
- Control-flow graphs (every graph resolves) and data flow on the CFG: joins at loops, `switch`, `try` and short-circuit expressions, control-only use is not data (BA-04 to BA-06), interprocedural transfer for proven targets including a call result used directly (NA-03a). Taint policy `builtin-3`: Express request sources keyed by resolved bindings (BA-07), `child_process`/`vm`/`eval`/`Function` sinks, and file-path and request-URL sinks judged on that argument only (NA-03b). Owned open gaps (conformance ledger): returned object fields, callbacks of higher-order builtins, SQL through client instances (NA-03c to NA-03e).
- Locale-independent ordering (by UTF-16 code unit) of every projected artifact.
- In-memory and SQLite storage providers, streamed run-scoped queries, analysis-run atomicity, validated snapshot reuse, deep persisted-contract validation, and caller-controlled transient session reset. A refused snapshot is reported with its status and reason (NA-11). A second process waits for the SQLite lock and fails with `STORAGE_BUSY` past the timeout (NA-08).
- Contained `.discovery` projections with atomic per-file replacement and integrity manifests. Durable analysis records are canonical; `.discovery` is a derived command deliverable. If fresh-run projection fails after commit, the engine rejects with `DISCOVERY_PROJECTION_FAILED_AFTER_COMMIT` and explicitly reports that the selected storage provider already committed the analysis.
- CLI commands: `status`, `init`, `analyze`, `test`, `verify`, and `plugins list`.
- Plugin contracts, registry, loader, and lifecycle hooks. The current in-process `PluginContext` is intentionally capability-empty and frozen; it exposes no raw Logger, EventBus, or StorageManager.

## Partial or conservative areas

- JavaScript/TypeScript static semantics are not equivalent to runtime execution.
- Dynamic imports, computed calls, reflection, mutation-heavy receiver inference, and unsupported syntax may remain unresolved.
- Taint analysis is a deterministic foundation, not complete vulnerability detection.
- Knowledge, semantic, and flow artifacts are static evidence, not business-rule or behavioral-equivalence certification.
- Fidelity evidence is sample-based and does not establish whole-repository migration safety.
- Whole-run fact lists live on disk (ADR-009). Measured on Ghost (about 7,200 analyzed files): 216–253 s and 1.7–2.2 GB peak memory fresh; a synthetic 10,000-file repository stays under its CI ceiling. Memory still grows with repository size, and snapshot reuse holds the snapshot in memory (8.9 GB on Ghost; NA-16, ADR-011 proposed). Unlimited scale is not claimed.
- Multi-artifact `.discovery` publication is not one filesystem transaction. A failed projection can leave a partial or previously valid directory; manifest and workspace validation determine whether it is reusable. No public projection-only retry command is implemented.
- Plugins are in-process instances with ambient Bun/Node authority. Marketplace loading, permission manifests, process isolation, and filesystem/network sandboxing are not implemented. Future host interaction requires separately designed narrow capability facades.

## Known deferred capabilities

- **#111 / IA-HIGH-002 — framework semantics:** current analysis is generic deterministic JavaScript/TypeScript analysis plus narrow Express route and middleware recognition for proven patterns. Comprehensive React, NestJS, Angular, Vue, Fastify, or other framework runtime semantics are not implemented.
- **#112 / IA-HIGH-003 — taint policy boundary:** current deterministic propagation uses built-in source, sink, and sanitizer rules. A typed, versioned, project-configurable, or plugin-extensible taint-policy architecture is not implemented.
- **#117 / IA-MED-004 — package/workspace resolution:** current resolution covers repository-local relative modules and proven `tsconfig` path aliases. Full Node resolution, `node_modules`, package `exports`/`imports`, and npm/pnpm/Yarn workspace resolution are not implemented.

## Not implemented

- Language-independent IR or SSA.
- Migration planning or source rewriting.
- AI/LLM gateway or agent orchestration.
- Rust, Axum, SQLx, or other target-language generation.
- Generated-code compilation/repair sandbox.
- Behavioral-equivalence certification or autonomous deployment.
- Distributed/multi-tenant analysis service or dashboard.

## Verification commands

Run from `legacy-exodus-core/`:

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run benchmark audit
bun run src/cli/index.ts --help
```

Record live results rather than copying historical totals into evergreen documentation.

## Verification snapshot

Verification totals are intentionally not copied into this evergreen page; run the canonical commands and record their live output for the exact revision under review.

## CI and security boundary

Current `main` workflow truth includes immutable action SHA pins, least-privilege permissions, disabled checkout credential persistence, Bun 1.4.2, frozen installs, job timeouts, superseded-run cancellation and these jobs: `Verify Core` (typecheck, tests, benchmark audit, an accuracy report on the conformance corpus that fails on a regression), `Windows Path Smoke`, `Scale Gate` (synthetic 10,000-file corpus under a memory ceiling) and `Fact Diff` (facts lost and gained on the governance fixture, the engine's own source, Express and Fastify; lost facts fail it unless the owner labels the PR `facts-lost-explained`). The ruleset `main-branch-protection` requires `Verify Core` and `Windows Path Smoke`.

CodeQL and Dependency Review are unavailable under the current private-repository/account configuration. The unusable historical CodeQL workflow was intentionally removed; its absence is not evidence that application security is complete.

## Historical audit queue integrity

The historical unresolved queue remains separate from current capability status: `PERF-002`, `MEM-001`, `SEC-004`, `SEC-003`, `SEM-002`, `MODULE-001`, `DFG-001`, `TAINT-001`, `ARCH-002`, `ARCH-003`, `CI-001`, and `TOOL-002`.

This list records identifiers, not newly validated findings or severity conclusions. `PERF-002` remains `BLOCKED` if its authoritative original definition has not been recovered; a new performance observation must not reuse that identifier. No item in this queue is closed by this documentation pass.
