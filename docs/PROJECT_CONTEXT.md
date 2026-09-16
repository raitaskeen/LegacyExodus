# LegacyExodus Project Context

**Current-status authority:** [CURRENT_IMPLEMENTATION.md](CURRENT_IMPLEMENTATION.md)

**Core integration truth:** `origin/core-foundation`

**Main promotion truth:** `origin/main`

**Documentation integration truth:** `origin/docs-foundation`

Documentation work must inspect core source and tests with branch-qualified Git commands. The package snapshot present on a documentation branch is not automatically current implementation evidence.

LegacyExodus is currently a deterministic local JavaScript/TypeScript repository-intelligence and static-analysis engine. Its longer-term mission is governed legacy modernization, but transformation and generated-system verification are not implemented.

## Current pipeline

```text
repository
  -> discovery inventory
  -> Babel parse + normalized AST
  -> lexical symbols
  -> module/dependency graph
  -> knowledge and semantic graphs
  -> CFG / DFG / conservative taint facts
  -> run-scoped storage
  -> validated .discovery projections
```

The core observes source repositories and produces analysis artifacts. It does not rewrite target source. `init` and `analyze` do write LegacyExodus-owned metadata/projection directories.

## Current design principles

- Knowledge before transformation.
- Deterministic, immutable, schema-validated contracts.
- Conservative resolution: unresolved evidence remains unresolved.
- Event-driven command execution with storage separated from domain analysis.
- Dependency injection and explicit lifecycle ownership.
- Repository inputs are untrusted; generated writes are contained to owned paths.
- Passing tests are evidence, not proof of complete semantic or migration correctness.

## Product stages

| Stage | Purpose | State |
|---|---|---|
| VyrixScout | Discovery and inventory | `VERIFIED` for supported behavior |
| NolaraStruct | Static program understanding | `PARTIAL`; substantial JS/TS analysis exists |
| ZelvoxForge | Migration planning and generation | `TARGET ARCHITECTURE` |
| VymosGate | Generated-system verification and approval | `TARGET ARCHITECTURE` |

Current fidelity/governance utilities validate samples and repository evidence; they are not the complete future VymosGate product.

## Repository structure

```text
LegacyExodus/
  .agents/                  development-agent procedures (not runtime)
  .github/                  repository automation
  docs/                     documentation and target designs
  legacy-exodus-core/       authoritative application package on core-foundation
    src/                    implementation
    tests/                  executable evidence
    benchmarks/             governance/fidelity tooling and corpora
```

## Current boundaries

- Supported source focus: JavaScript, TypeScript, JSX, TSX, and selected ESM/CommonJS patterns.
- The parser normalizes Babel syntax; it is not a complete TypeScript type checker.
- Static call/data/taint facts do not execute programs and cannot prove all dynamic behavior.
- SQLite provides local durable analysis storage; there is no enterprise database service.
- Plugin foundations do not provide third-party sandboxing or a package marketplace.
- There is no AI, IR/SSA, migration planner, code generator, dashboard, or autonomous deployment.

## Future direction

Future work may add language-independent IR/SSA, migration planning, AI-assisted transformation, target-language generation, isolated compilation, equivalence validation, and scalable execution. These remain planned/target architecture until integrated code and evidence exist.
