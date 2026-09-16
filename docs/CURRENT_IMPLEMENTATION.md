# Current Implementation

**Documentation state:** `VERIFIED`

**Synchronized against core integration truth:** `origin/core-foundation` at `9e582388dece16ec6fd8bfc1f9aab6da4f0835c7`

**Main promotion boundary:** `origin/main` at `b342e8d45ee9ae1a5e2d9fdb1968f6486e83f733`

The core branch is one verified remediation ahead of main: IA-HIGH-007 corrects conservative catch reachability for potentially throwing invocations, nested protected blocks, and thrown-finalizer edge classification. It is `VERIFIED` and core-integrated, but **not main-promoted**.

This page is the concise status boundary for LegacyExodus. Implementation source, executable tests, and verified runtime behavior remain authoritative if this page drifts.

## Verified current core

- Bun runtime and strict TypeScript contracts.
- Engine facade, runtime lifecycle, command/orchestrator boundary, event bus/store, and durable event journal. Durable command commit defines success; post-commit synchronous notification failures are separately recorded and logged without implying rollback.
- Repository discovery with deterministic inventory, source/non-source classification, package/framework signals, and isolated enumeration failures.
- Babel-based JavaScript/TypeScript/JSX/TSX parsing into normalized immutable AST contracts.
- Lexical symbol extraction, selected ESM/CommonJS modeling, module resolution, dependency cycles, and deterministic knowledge graphs.
- Conservative semantic call/reference analysis, Express route and middleware facts for supported patterns.
- Function/control-flow and data-flow models, interprocedural transfer for proven targets, and conservative taint facts.
- In-memory and SQLite storage providers, run-scoped queries, analysis-run atomicity, validated snapshot reuse, and deep persisted-contract validation.
- Contained `.discovery` projections with atomic per-file replacement and integrity manifests. Durable analysis records are canonical; `.discovery` is a derived command deliverable. If fresh-run projection fails after commit, the engine rejects with `DISCOVERY_PROJECTION_FAILED_AFTER_COMMIT` and explicitly reports that the selected storage provider already committed the analysis.
- CLI commands: `status`, `init`, `analyze`, `test`, `verify`, and `plugins list`.
- Plugin contracts, registry, loader, and scoped context foundation.

## Partial or conservative areas

- JavaScript/TypeScript static semantics are not equivalent to runtime execution.
- Dynamic imports, computed calls, reflection, mutation-heavy receiver inference, and unsupported syntax may remain unresolved.
- Taint analysis is a deterministic foundation, not complete vulnerability detection.
- Knowledge, semantic, and flow artifacts are static evidence, not business-rule or behavioral-equivalence certification.
- Fidelity evidence is sample-based and does not establish whole-repository migration safety.
- Whole-repository bounded-memory scaling has not been universally established.
- Multi-artifact `.discovery` publication is not one filesystem transaction. A failed projection can leave a partial or previously valid directory; manifest and workspace validation determine whether it is reusable. No public projection-only retry command is implemented.
- Plugins are in-process instances; marketplace loading and security sandboxing are not implemented.

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

The synchronized core checkpoint reported:

- 1,049 tests passed, 1 skipped, 0 failed; 9,550 assertions.
- Typecheck passed.
- Benchmark governance passed 10/10.
- Composite verification passed.
- Three governed Express analyses produced identical results: 234 discovered, 152 analyzed, 0 failures.
- Hosted `CI / Verify Core` and `Windows Path Smoke` checks passed.

These values identify evidence for the SHA above. They must not be reused as current results after the core revision changes.

## CI and security boundary

Current main/core workflow truth includes immutable action SHA pins, least-privilege permissions, disabled checkout credential persistence, Bun 1.4.2, frozen installs, job timeouts, superseded-run cancellation, `CI / Verify Core`, and `Windows Path Smoke`.

CodeQL and Dependency Review are unavailable under the current private-repository/account configuration. The unusable historical CodeQL workflow was intentionally removed; its absence is not evidence that application security is complete.

## Historical audit queue integrity

The historical unresolved queue remains separate from current capability status: `PERF-002`, `MEM-001`, `SEC-004`, `SEC-003`, `SEM-002`, `MODULE-001`, `DFG-001`, `TAINT-001`, `ARCH-002`, `ARCH-003`, `CI-001`, and `TOOL-002`.

This list records identifiers, not newly validated findings or severity conclusions. `PERF-002` remains `BLOCKED` if its authoritative original definition has not been recovered; a new performance observation must not reuse that identifier. No item in this queue is closed by this documentation pass.
