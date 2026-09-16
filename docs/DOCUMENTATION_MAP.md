# LegacyExodus Documentation Map

## 1. Purpose

`DOCUMENTATION_MAP.md` exists as the authoritative navigation architecture for the LegacyExodus documentation ecosystem. Its purpose is not merely to list files, but to organize knowledge so that humans and AI systems can reliably locate the right source of truth, understand document boundaries, and move through documentation in intentional learning and decision-making paths.

This document supports five critical needs:

- **Documentation discoverability**: Reduce time-to-knowledge by making it obvious where each type of information lives.
- **Knowledge organization**: Structure docs as an interconnected system (knowledge graph), not isolated markdown artifacts.
- **Contributor onboarding**: Provide deterministic starting points and progression paths for new contributors.
- **AI context navigation**: Help AI assistants resolve authoritative references before answering or generating changes.
- **Duplication prevention**: Define ownership boundaries to prevent conflicting explanations across multiple documents.

In short, this file is the index and routing layer of the **LegacyExodus knowledge ecosystem**.

---

## 2. Documentation Architecture Overview

The LegacyExodus documentation system is designed as a layered knowledge architecture where each category has a distinct responsibility and relationship to adjacent layers.

### Conceptual Hierarchy

```text
                      LegacyExodus Knowledge System
                                    │
    ┌───────────────────────────────┼───────────────────────────────┐
    ▼                               ▼                               ▼
1. Foundational Context     2. Architecture & Design        3. Governance & Quality
   • README.md                 • docs/architecture/            • GOVERNANCE.md
   • docs/PROJECT_CONTEXT.md   • docs/adr/                     • docs/security/
   • docs/GLOSSARY.md          • docs/api/                     • docs/development/
                                                               • ROADMAP.md
                                                               • CHANGELOG.md
```

---

### Directory & Document Sitemap

#### 1. Root Governance & Context Documents (Canonical & Populated)
* **[README.md](../README.md):** Concise current product boundary, setup, verification, limitations, and target direction.
* **[docs/CURRENT_IMPLEMENTATION.md](CURRENT_IMPLEMENTATION.md):** Canonical documentation status boundary synchronized to an explicit `core-foundation` SHA.
* **[GOVERNANCE.md](../GOVERNANCE.md):** Repository boundaries, execution invariants, Three-Universe evidence model, provenance freshness locks, and conservative semantic rules.
* **[SUPPORT.md](../SUPPORT.md):** Support policy, bug reporting guidelines, reproduction standards, and maintainers.
* **[LICENSE](../LICENSE):** Canonical MIT open-source license.
* **[.github/CODEOWNERS](../.github/CODEOWNERS):** Repository code ownership rules and maintainer mappings.
* **[ROADMAP.md](../ROADMAP.md):** Track and milestone progress tracker distinguishing Completed, In Progress, Planned, and Target Architecture.
* **[CHANGELOG.md](../CHANGELOG.md):** Chronological log of all version releases, verified fixes, and milestone accomplishments.
* **[CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md):** Contributor Covenant v2.1 community code of conduct.


#### 2. Core Context & Operational Rules (Canonical & Populated)
* **[docs/PROJECT_CONTEXT.md](PROJECT_CONTEXT.md):** Concise current product context, pipeline boundary, stage states, repository structure, limitations, and future direction.
* **[docs/GLOSSARY.md](GLOSSARY.md):** Ubiquitous domain terminology and architectural definitions (1,800+ lines).
* **[docs/AI_CONTEXT.md](AI_CONTEXT.md):** Operating rules and reasoning guidelines for AI coding assistants.
* **[docs/DOCUMENTATION_RULES.md](DOCUMENTATION_RULES.md):** Standards and constraints for editing and creating project documentation.
* **[docs/community/CODE_OF_CONDUCT.md](community/CODE_OF_CONDUCT.md):** Community standards and canonical policy link.

#### 3. Development & Engineering Guides (`docs/development/` — Populated)
* **[docs/development/contribution-guide.md](development/contribution-guide.md):** Contributor workflows, testing standards, and Definition of Done.
* **[docs/development/environment-setup.md](development/environment-setup.md):** Prerequisites, Bun toolchain, and verification steps.
* **[docs/development/local-development.md](development/local-development.md):** Daily developer workflow, watch mode, and benchmark sweeps.
* **[docs/development/development-guide.md](development/development-guide.md):** Extending engine static analysis rules and visitor patterns.
* **[docs/development/coding-standards.md](development/coding-standards.md):** Strict TypeScript, Zod schemas, immutability, and conservative semantics.
* **[docs/development/testing-strategy.md](development/testing-strategy.md):** Testing pyramid and failure-first invariant testing.
* **[docs/development/testing/unit-testing.md](development/testing/unit-testing.md):** Writing and running isolated subsystem unit tests.
* **[docs/development/testing/integration-testing.md](development/testing/integration-testing.md):** End-to-end multi-stage pipeline tests.
* **[docs/development/cli/commands.md](development/cli/commands.md):** CLI command reference (`status`, `init`, `analyze`, `test`, `verify`, `plugins`).
* **[docs/development/cli/configuration.md](development/cli/configuration.md):** Themes, output modes, and runtime options.
* **[docs/development/cli/troubleshooting.md](development/cli/troubleshooting.md):** Common errors, parse recovery, and memory scaling.

#### 4. Architecture Specifications (`docs/architecture/` — Canonical & Populated)
* **[docs/architecture/system-overview.md](architecture/system-overview.md):** System architecture, layer decomposition, and stage interaction models.
* **[docs/architecture/data-flow.md](architecture/data-flow.md):** Data flow tracing from discovery intake through flow graphs and streaming projection.
* **[docs/architecture/component-map.md](architecture/component-map.md):** Detailed map of deterministic services, control plane, and boundaries.
* **[docs/architecture/security-architecture.md](architecture/security-architecture.md):** Zero-Trust security model, traversal sandboxing, and trust boundaries.
* **[docs/architecture/runtime-architecture.md](architecture/runtime-architecture.md):** Runtime composition, lifecycle, and state factory architecture.
* **[docs/architecture/plugin-architecture.md](architecture/plugin-architecture.md):** Current in-process plugin foundation and explicitly separated target isolation/governance model.

#### 5. Architecture Decision Records (`docs/adr/` — Populated Decisions)
* **[ADR-001: Project State Architecture](adr/ADR-001-project-state-architecture.md):** Immutable state snapshots and deterministic reducers *(Accepted)*.
* **[ADR-002: Event System Governance](adr/ADR-002-event-system-governance.md):** Domain event ledgers, synchronous event bus, and audit replay *(Accepted)*.
* **[ADR-003: Plugin System Architecture](adr/ADR-003-plugin-system.md):** Contract-first plugin interfaces and context injection *(Accepted)*.
* **[ADR-004: Zero-Trust AI Gateway](adr/ADR-004-ai-gateway.md):** Secret redaction and prompt isolation proxy *(Proposed / Target Architecture)*.
* **[ADR-005: Storage Strategy](adr/ADR-005-storage-strategy.md):** Memory storage adapters and 64KB backpressure streaming JSON projections *(Accepted)*.
* **[ADR-006: Security Model](adr/ADR-006-security-model.md):** Symlink isolation, relative path hashing, and fail-closed resolution *(Accepted)*.
* **[ADR-007: Migration Pipeline](adr/ADR-007-migration-pipeline.md):** Compiler sandbox and self-healing repair loops *(Proposed / Target Architecture)*.

#### 6. API Contracts & Implementation Specs (`docs/api/` & `docs/implementation/`)
* **[docs/api/command-contracts.md](api/command-contracts.md):** CQRS command schemas (`AnalyzeProject`, `DiscoverProject`, etc.).
* **[docs/api/event-contracts.md](api/event-contracts.md):** Domain event envelope and event definitions.
* **[docs/api/plugin-api.md](api/plugin-api.md):** `LegacyExodusPlugin` interface and `PluginContext` services.
* **[docs/implementation/core-engine.md](implementation/core-engine.md):** Core engine pipeline orchestrator and lifecycle state machine.
* **[docs/implementation/project-state-model.md](implementation/project-state-model.md):** State aggregate and factory models.
* **[docs/implementation/event-system.md](implementation/event-system.md):** Synchronous event bus and event store.
* **[docs/implementation/parser-strategy.md](implementation/parser-strategy.md):** Babel parser adapter and error recovery.
* **[docs/implementation/storage-layer.md](implementation/storage-layer.md):** Storage manager, memory/SQLite adapters, and discovery projection boundary.
* **[docs/implementation/knowledge-graph.md](implementation/knowledge-graph.md):** Deterministic knowledge graph builder and edge hashing.
* **[docs/implementation/cli-design.md](implementation/cli-design.md):** CLI presentation layer, themes, tables, and error boundaries.

#### 7. Pipeline & Security (`docs/pipeline/` & `docs/security/`)
* **[docs/pipeline/pipeline-overview.md](pipeline/pipeline-overview.md):** 4-stage modernization pipeline overview.
* **[docs/security/security-principles.md](security/security-principles.md):** Zero-Trust static analysis principles.

#### 8. Planned Scaffolding & Future Subsystems (Unpopulated Stubs)
* **`docs/domain/`:** Domain models (synthesized in `docs/GLOSSARY.md` and `docs/PROJECT_CONTEXT.md`).
* **`docs/integrations/`:** Language and database integration specifications (planned for future phases).
* **`docs/operations/`:** Production operations specifications (planned for future phases).

---

## 4. Role-Based Reading Paths

### Path A: New Engineer / Contributor Onboarding
1. Read **[README.md](../README.md)** for project purpose and high-level architecture.
2. Read **[docs/PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)** for pipeline stages and repository boundaries.
3. Review **[docs/development/environment-setup.md](development/environment-setup.md)** to configure Bun and verify the local environment.
4. Review **[docs/development/contribution-guide.md](development/contribution-guide.md)** for developer workflows and testing rules.
5. Review **[GOVERNANCE.md](../GOVERNANCE.md)** to understand the Three-Universe evidence model and boundary rules.

### Path B: Static Analysis Engine Developer
1. Read **[docs/development/development-guide.md](development/development-guide.md)** and **[docs/development/coding-standards.md](development/coding-standards.md)**.
2. Inspect **[docs/implementation/parser-strategy.md](implementation/parser-strategy.md)** and **[docs/implementation/project-state-model.md](implementation/project-state-model.md)**.
3. Review **[docs/development/testing-strategy.md](development/testing-strategy.md)** for the failure-first testing cycle.

### Path C: AI Assistant / Automated Agent
1. Read **[docs/AI_CONTEXT.md](AI_CONTEXT.md)** for invariant engineering rules.
2. Read **[docs/GLOSSARY.md](GLOSSARY.md)** to ensure ubiquitous language alignment.
3. Check **[ROADMAP.md](../ROADMAP.md)** and **[GOVERNANCE.md](../GOVERNANCE.md)** before suggesting changes.

### Path D: Security & Verification Auditor
1. Review **[GOVERNANCE.md](../GOVERNANCE.md)** for provenance and freshness lock rules.
2. Inspect **`legacy-exodus-core/benchmarks/BENCHMARK_REPORT.md`** for determinism and fidelity validation evidence.
3. Review **[docs/security/security-principles.md](security/security-principles.md)** and **[docs/adr/ADR-006](adr/ADR-006-security-model.md)** for sandbox isolation and trust boundaries.

---

## 5. Maintenance & Ownership Rules

1. **Reality Over Aspiration:** Never document planned features as implemented.
2. **Single Source of Truth:** Evergreen documentation records verification commands, not ephemeral test totals. Dated audit records may preserve exact historical evidence.
3. **No Drift:** Whenever a milestone is completed, update `CHANGELOG.md`, `ROADMAP.md`, and `README.md` concurrently.
