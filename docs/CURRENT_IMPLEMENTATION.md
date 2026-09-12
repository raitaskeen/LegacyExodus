# Current Implementation

**Documentation state:** `CURRENT`

**Synchronized against verified core task commit:** `76db0da965de6d007a636023362e11aaaf4c4915`

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
- Contained, atomic `.discovery` projections with integrity manifests.
- CLI commands: `status`, `init`, `analyze`, `test`, `verify`, and `plugins list`.
- Plugin contracts, registry, loader, and scoped context foundation.

## Partial or conservative areas

- JavaScript/TypeScript static semantics are not equivalent to runtime execution.
- Dynamic imports, computed calls, reflection, mutation-heavy receiver inference, and unsupported syntax may remain unresolved.
- Taint analysis is a deterministic foundation, not complete vulnerability detection.
- Knowledge, semantic, and flow artifacts are static evidence, not business-rule or behavioral-equivalence certification.
- Fidelity evidence is sample-based and does not establish whole-repository migration safety.
- Whole-repository bounded-memory scaling has not been universally established.
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
