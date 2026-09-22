# Current Implementation

**Documentation state:** `VERIFIED`

**Synchronized against core integration truth:** `origin/core-foundation` at `204f123ac374c3fefa4ccc0f4d5decb80a1e9b9f`

**Main promotion boundary:** `origin/main` at `6f88ec57d8275c6a367018d3106b537a26cbc2d1`

The core branch contains verified implementation changes that are not yet main-promoted. These include conservative catch reachability, CLI storage-option forwarding, plugin capability containment, run-scoped AST reuse, discovery-manifest diagnostics and provenance isolation, truthful degraded-analysis presentation, standard decorator parsing, streamed scoped storage reads, caller-controlled transient session reset, and bounded/indexed semantic and flow-analysis paths. They are core-integrated at the SHA above but **not main-promoted**.

This page is the concise status boundary for LegacyExodus. Implementation source, executable tests, and verified runtime behavior remain authoritative if this page drifts.

## Verified current core

- Bun runtime and strict TypeScript contracts.
- Engine facade, runtime lifecycle, command/orchestrator boundary, event bus/store, and durable event journal. Durable command commit defines success; post-commit synchronous notification failures are separately recorded and logged without implying rollback.
- Repository discovery with deterministic inventory, source/non-source classification, package/framework signals, and isolated enumeration failures.
- Babel-based JavaScript/TypeScript/JSX/TSX parsing, including standard decorator syntax, into normalized immutable AST contracts. Decorator semantics are not interpreted.
- Lexical symbol extraction, selected ESM/CommonJS modeling, module resolution, dependency cycles, and deterministic knowledge graphs.
- Conservative semantic call/reference analysis, Express route and middleware facts for supported patterns.
- Function/control-flow and data-flow models, interprocedural transfer for proven targets, conservative taint facts, and deterministic bounded work-queue propagation for the implemented repository-wide flow connections.
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

The synchronized boundary is the core SHA above. Verification totals are intentionally not copied into this evergreen page; run the canonical commands and record their live output for the exact revision under review.

## CI and security boundary

Current main/core workflow truth includes immutable action SHA pins, least-privilege permissions, disabled checkout credential persistence, Bun 1.4.2, frozen installs, job timeouts, superseded-run cancellation, `CI / Verify Core`, and `Windows Path Smoke`.

CodeQL and Dependency Review are unavailable under the current private-repository/account configuration. The unusable historical CodeQL workflow was intentionally removed; its absence is not evidence that application security is complete.

## Historical audit queue integrity

The historical unresolved queue remains separate from current capability status: `PERF-002`, `MEM-001`, `SEC-004`, `SEC-003`, `SEM-002`, `MODULE-001`, `DFG-001`, `TAINT-001`, `ARCH-002`, `ARCH-003`, `CI-001`, and `TOOL-002`.

This list records identifiers, not newly validated findings or severity conclusions. `PERF-002` remains `BLOCKED` if its authoritative original definition has not been recovered; a new performance observation must not reuse that identifier. No item in this queue is closed by this documentation pass.
