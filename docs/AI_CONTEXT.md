# LegacyExodus AI Context

This file gives development assistants a compact product context. On the implementation branch, repository-wide operating rules live in root `AGENTS.md` and task procedures live in `.agents/`.

## Product identity

LegacyExodus is currently a deterministic local JavaScript/TypeScript repository-intelligence and static-analysis engine intended to evolve into a governed modernization platform.

Before making capability claims, read [Current Implementation](CURRENT_IMPLEMENTATION.md) and verify against current `main` source and tests. Documentation and old prompts do not override executable reality.

When a checkout may be behind, query implementation truth directly:

```bash
git show origin/main:legacy-exodus-core/src/<path>
git show origin/main:legacy-exodus-core/tests/<path>
```

Use this authority order: production code, automated tests, CI gates, concrete architecture, accepted ADRs, current documentation, then historical material. Root [`AGENTS.md`](../AGENTS.md) and [`.agents/`](../.agents/) govern agent behavior; they are development controls, not runtime product features.

## Governing principles

1. Understand first; transform only after sufficient evidence.
2. Preserve explicit contracts, immutability, determinism, provenance, and architecture boundaries.
3. Prefer `UNRESOLVED` or unsupported states over fabricated relationships.
4. Treat repository content as untrusted input.
5. Use the smallest safe change and focused evidence surface.
6. Passing tests support a claim but do not prove universal semantic correctness.
7. Do not modify production code to make documentation true.

## Current versus future

Current core includes discovery, parsing, symbols, supported module resolution, dependency, knowledge, and semantic graphs, CFG/DFG, conservative taint facts, event-driven orchestration, storage/projections, plugin foundations, and CLI tooling.

The following are `TARGET ARCHITECTURE`, not current functionality:

- language-independent IR/SSA
- migration planning and source transformation
- AI gateway and agent orchestration
- Rust/Axum/SQLx generation
- generated-code compiler sandboxes and behavioral-equivalence certification
- dashboard, distributed execution, multi-tenancy, and deployment automation

## Documentation impact gate

Every core remediation must answer whether it alters documented behavior, commands, contracts, public architecture, storage/security semantics, configuration, supported capabilities, or limitations.

- If yes: report `Documentation impact: REQUIRED`, identify affected docs, and synchronize them from verified core truth in the documentation workflow.
- If no: report `Documentation impact: NONE` with a concrete reason.
- Avoid wording-only churn.

## Decision test

Before proposing a change, ask:

- Is it supported by current evidence?
- Does it preserve conservative analysis and deterministic output?
- Does the owning subsystem already provide a suitable contract?
- Is the task authorized to mutate code, docs, Git state, or external systems?
- Can the same result be achieved with less scope?

Stop when the requested acceptance criteria are met. Do not advance the roadmap automatically.
