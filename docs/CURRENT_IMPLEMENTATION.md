# Current Implementation

**Documentation state:** `PARTIAL`. Re-labelled on 2026-10-28 from the [blind audit](https://github.com/raitaskeen/LegacyExodus/pull/203); finding ids (BA-xx) refer to it.

**Implementation truth:** `main`. `core-foundation` and `docs-foundation` are retired as integration branches (2026-10-28). No SHA is pinned here; verify the exact revision you review.

This page is the concise status boundary for LegacyExodus. Implementation source, executable tests, and verified runtime behavior remain authoritative if this page drifts.

## Current core (implemented; limits below)

- Bun runtime and strict TypeScript contracts.
- Engine facade, runtime lifecycle, command/orchestrator boundary, event bus/store, and durable event journal. Durable command commit defines success; post-commit synchronous notification failures are separately recorded and logged without implying rollback.
- Repository discovery with deterministic inventory, source/non-source classification, package/framework signals, and isolated enumeration failures.
- Babel-based JavaScript/TypeScript/JSX/TSX parsing, including standard decorator syntax, into normalized immutable AST contracts. Decorator semantics are not interpreted. One parser configuration serves every extension, so some valid `.ts` and `.d.ts` files are rejected (BA-01).
- Lexical symbol extraction, selected ESM/CommonJS modeling, module resolution, dependency cycles, and a knowledge graph of file and symbol nodes with contains/imports edges (BA-19). TypeScript enums, namespaces, interfaces and type aliases are not modelled (BA-02); TS ESM `./x.js` specifiers and `tsconfig.json` files with comments are not resolved (BA-03).
- Semantic call/reference analysis that resolves a call only when its target is proven. Express route and middleware facts are `INFERRED`: per-router middleware, handlers and mount paths are not yet modelled (BA-08).
- Function/control-flow and data-flow models, interprocedural transfer for proven targets, taint facts from a built-in policy, and deterministic bounded work-queue propagation for the implemented repository-wide flow connections. Data flow misses loops, `switch`, `try`, short-circuit expressions and direct source arguments, and can over-label conditional values (BA-04 to BA-07).
- Locale-independent (code-point) ordering of every projected artifact.
- In-memory and SQLite storage providers, streamed run-scoped queries, analysis-run atomicity, validated snapshot reuse, deep persisted-contract validation, and caller-controlled transient session reset.
- Contained `.discovery` projections with atomic per-file replacement and integrity manifests. Durable analysis records are canonical; `.discovery` is a derived command deliverable. If fresh-run projection fails after commit, the engine rejects with `DISCOVERY_PROJECTION_FAILED_AFTER_COMMIT` and explicitly reports that the selected storage provider already committed the analysis.
- CLI commands: `status`, `init`, `analyze`, `test`, `verify`, and `plugins list`.
- Plugin contracts, registry, loader, and lifecycle hooks. The current in-process `PluginContext` is intentionally capability-empty and frozen; it exposes no raw Logger, EventBus, or StorageManager.

## Partial or conservative areas

- JavaScript/TypeScript static semantics are not equivalent to runtime execution.
- Dynamic imports, computed calls, reflection, mutation-heavy receiver inference, and unsupported syntax may remain unresolved.
- Taint analysis is a deterministic foundation, not complete vulnerability detection.
- Knowledge, semantic, and flow artifacts are static evidence, not business-rule or behavioral-equivalence certification.
- Fidelity evidence is sample-based and does not establish whole-repository migration safety.
- Indexed semantic lookup, streamed scoped reads, compact connection state, and bounded flow-propagation work queues address specific measured scaling paths. Whole-repository bounded-memory scaling has not been universally established.
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

Current main/core workflow truth includes immutable action SHA pins, least-privilege permissions, disabled checkout credential persistence, Bun 1.4.2, frozen installs, job timeouts, superseded-run cancellation, `CI / Verify Core`, and `Windows Path Smoke`.

CodeQL and Dependency Review are unavailable under the current private-repository/account configuration. The unusable historical CodeQL workflow was intentionally removed; its absence is not evidence that application security is complete.

## Historical audit queue integrity

The historical unresolved queue remains separate from current capability status: `PERF-002`, `MEM-001`, `SEC-004`, `SEC-003`, `SEM-002`, `MODULE-001`, `DFG-001`, `TAINT-001`, `ARCH-002`, `ARCH-003`, `CI-001`, and `TOOL-002`.

This list records identifiers, not newly validated findings or severity conclusions. `PERF-002` remains `BLOCKED` if its authoritative original definition has not been recovered; a new performance observation must not reuse that identifier. No item in this queue is closed by this documentation pass.
