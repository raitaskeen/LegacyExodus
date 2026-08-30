# LegacyExodus Architecture & Milestone Roadmap

This roadmap tracks the development progress of LegacyExodus across deterministic repository intelligence, verification hardening, migration fidelity, and future transformation stages.

---

## Roadmap Status Taxonomy

Every capability and milestone is strictly classified into one of the following states:

* **`COMPLETED`**: Fully implemented in the repository, supported by deterministic automated regression tests, benchmark verification, and provenance locks.
* **`IN PROGRESS`**: Active development and hardening.
* **`PLANNED`**: Prioritized for upcoming implementation milestones within existing architectural boundaries.
* **`DEFERRED`**: Intentionally scheduled for future consideration pending exhaustive whole-repository ground truth.
* **`TARGET ARCHITECTURE`**: Long-term platform vision (e.g. AI-assisted transformation, compiler sandboxing, Rust code synthesis) not present in current core implementation.

---

## Track 3 — Scalability, Verification Hardening & Migration Fidelity

| Milestone | Scope | Status | Verified Evidence / Notes |
|---|---|:---:|---|
| **P1.0** | Fidelity Validation Audit & Metric Correctness | **`COMPLETED`** | Verified precision, recall, and Three-Universe evaluation model. |
| **P1.1** | CommonJS Export Granularity | **`COMPLETED`** | Object literal and named export extraction. |
| **P1.2** | Whole-Repository Semantic Trust | **`COMPLETED`** | Stratified sampling and multi-category ground truth. |
| **P1.3** | Streaming Projection Serialization & Memory Bounding | **`COMPLETED`** | `StreamingJsonWriter` chunk-buffered JSON serialization with 64KB backpressure. |
| **P1.4** | Stage-Bounded Storage Lifecycle | **`COMPLETED`** | Memory disposal across analysis pipeline stages. |
| **P1.5** | Tier-3 Migration Fidelity Baseline & Freshness Lock | **`COMPLETED`** | Express v4.21.2 validation + SHA-256 provenance manifests. |
| **P1.6** | Repository Boundary & Execution-Context Hardening | **`COMPLETED`** | Centralized CWD-independent benchmark paths, elimination of root artifact leakage, and boundary regression suite. |
| **P1.7A** | Express Semantic Fidelity Hardening (Prototype Symbols & Call Resolution) | **`COMPLETED`** | Statically provable prototype/property symbols, chained CommonJS export unwrapping, NewExpression & apply/call unwrapping. |
| **P1.7B** | Whole-Repository Multi-File Ground-Truth Scaling | **`COMPLETED`** | Expanded ground truth across 25 production/core files each for Express v4.21.2 (142 GT facts, 4,165 scoped predictions, 100% recall, 100% actionable correctness) and Fastify v5.3.3 (154 GT facts, 6,330 scoped predictions, 100% recall, 100% actionable correctness) under the Three-Universe model. Migration safety verdict strictly preserved as `MIGRATION_SAFETY_NOT_YET_ESTABLISHED`. |
| **P1.7C** | Pre-Claude Audit Evidence Integrity & Semantic Correctness Hardening | **`COMPLETED`** | Fixed open-world fidelity metric semantics (`UNVERIFIED_SCOPED`, `precision = null`), hardened JavaScript `var` function/module hoisting, implemented deferred function assignment symbol extraction, and enforced scope-aware CommonJS export marking. 306/306 tests passing, 0 regressions, full determinism confirmed. |
| **P1.7D** | Controlled Forensic Weakness Discovery & Remediation | **`COMPLETED`** | Fixed destructuring pattern binding extraction (`FINDING-SYM-04`), default parameter expression filtering (`FINDING-SYM-05`), assigned function `var` scope hoisting (`FINDING-SYM-06`), and class constructor instantiation call resolution (`FINDING-SEM-02`). 329/329 tests passing, 0 regressions, full determinism confirmed. |
| **P1.8** | Core Runtime Lifecycle, Storage & Graph Hardening | **`COMPLETED`** | Fixed semantic `.bind()` receiver resolution (F-001), normalized `SymbolExtractionError` contract (F-002), implemented in-flight analysis draining on shutdown (F-004/F-006), hardened concurrent atomic file replacement with bounded retry on Windows (F-005), implemented SQLite storage provider with schema versioning (`PRAGMA user_version = 1`) and busy timeout (F-007), canonicalized POSIX module path resolution and cycle resolution (F-008), enforced dynamic Engine SHA freshness validation (F-023), and established AST validation provenance (`WeakSet` trust boundary, `Frozen ≠ Validated`). |
| **P1.9** | CLI Foundation, Command Discovery & Verification Hardening | **`COMPLETED`** | Implemented unified CLI theme engine (`classic`, `aurora`, `mono`), `HelpPresenter` with workflow-grouped discovery and safety badges, test explorer with dynamic domain taxonomy (`legacy-exodus test [domain]`, `--list`, `-v, --verbose`, `--bail`), 4-gate verification dashboard (`legacy-exodus verify`), F-024 terminal-width column budgeting and ANSI-safe truncation, and strict JSON output purity. 660/660 tests passing across 87 files (7,281 assertions), 10/10 governance checks, 3-tier bit-for-bit determinism. |

---

## Track 4 — Enterprise Intelligence Scaling & Documentation Foundation

| Milestone | Scope | Status | Notes |
|---|---|:---:|---|
| **DOC-01** | Enterprise Documentation Foundation & Reality Synchronization | **`COMPLETED`** | Synchronize README, ROADMAP, CHANGELOG, GOVERNANCE, and docs with verified repository state (660 tests, 7,281 assertions, 10/10 governance checks, 3-tier determinism, 366 GT facts across Express and Fastify). |
| **P2.0** | Whole-Repository Closed-World Ground-Truth Scaling | **`PLANNED`** | Expand ground truth surface from 25 representative files toward exhaustive whole-repository coverage for Tier-2 and Tier-3 targets. |
| **P2.1** | Non-Source Fixture & Template Classifier Hardening | **`PLANNED`** | Enhance discovery classification for EJS, Pug, Handlebars, and test fixture files to resolve Express completeness `NEEDS_REVIEW`. |
| **P2.2** | TypeScript Compiler API Integration | **`PLANNED`** | Complement Babel AST parser with native TypeScript type-checker symbols for `.ts` / `.tsx` codebases. |

---

## Track 5 — Target Architecture & Future Transformation Vision

> **Note:** Capabilities in Track 5 represent long-term architectural vision and are NOT implemented in the current repository code.

| Milestone | Capability | Status | Target Architecture Description |
|---|---|:---:|---|
| **V1.0** | Unified Intermediate Representation (IR / SSA) | **`TARGET ARCHITECTURE`** | Canonical language-agnostic SSA intermediate representation for cross-language migration analysis. |
| **V2.0** | ZelvoxForge AI Transformation Swarm | **`TARGET ARCHITECTURE`** | Governed multi-agent generation producing candidate modern implementations from verified knowledge graph slices. |
| **V3.0** | VymosGate Compiler Sandbox & Self-Healing Loop | **`TARGET ARCHITECTURE`** | Isolated compiler verification executing `cargo check` and `cargo test` with automated repair heuristics. |
| **V4.0** | Rust / Axum / SQLx Production Code Generation | **`TARGET ARCHITECTURE`** | Memory-safe, high-concurrency target backend synthesis with full semantic traceability. |
