<div align="center">
  <picture>
    <img src="docs/assets/branding/banner.png" alt="LegacyExodus Banner" width="100%">
  </picture>

  <h1>LegacyExodus</h1>
  <p><strong>Enterprise-Grade Autonomous Software Modernization Platform</strong></p>

  <p>
    <a href="docs/community/CODE_OF_CONDUCT.md"><img src="https://img.shields.io/badge/Code_of_Conduct-purple?style=for-the-badge" alt="Code of Conduct"></a>
    <a href="docs/development/contribution-guide.md"><img src="https://img.shields.io/badge/Contributing-blue?style=for-the-badge" alt="Contributing"></a>
    <a href="docs/architecture/security-architecture.md"><img src="https://img.shields.io/badge/Security-red?style=for-the-badge" alt="Security"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-success?style=for-the-badge" alt="MIT License"></a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/Runtime-Bun_v1.0+-f9f8f6?style=for-the-badge&logo=bun" alt="Bun">
    <img src="https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript Strict">
    <img src="https://img.shields.io/badge/Tests-660_Passing_|_0_Regressions-success?style=for-the-badge" alt="660 Tests Passing">
    <img src="https://img.shields.io/badge/Governance-10_/_10_Audits_Passed-success?style=for-the-badge" alt="10/10 Governance Passed">
    <img src="https://img.shields.io/badge/Status-Phase_3A_/_Hardened-success?style=for-the-badge" alt="Phase 3A / Hardened">
  </p>

  <p>
    <em>A knowledge-first engineering platform that systematically maps, documents, and safely transforms complex legacy software systems into memory-safe architectures.</em>
  </p>
</div>

---

> **Current Implementation Reality (August 2026):**
> * **Implemented & Verified:** Deterministic JavaScript/TypeScript multi-stage repository intelligence pipeline running natively on Bun (Discovery, Babel AST Parsing & Normalization, Scope & Symbol Extraction with `var` hoisting, Destructuring pattern extraction, Default parameter filtering, CommonJS exports & prototype methods, Module resolution & Dependency graphs, Semantic Call graphs with constructor instantiation resolution, Basic-Block CFG, Def-Use DFG with interprocedural taint flow, Streaming JSON serialization with 64KB backpressure, In-Memory and SQLite indexed storage providers, Three-Universe fidelity validator, 10-point governance self-audit, and 3-run bit-for-bit determinism across Tier 1, 2, and 3 targets).
> * **CLI Foundation:** Comprehensive terminal interface with 3 themes (`classic`, `aurora`, `mono`), dynamic test explorer with 12 subsystem domains (`test [domain]`, `--list`, `-v, --verbose`, `--bail`), multi-gate repository verification (`verify`), width-safe rendering (F-024), and pure machine-readable JSON output (`--json`).
> * **Target Architecture (Future Vision):** Unified IR/SSA intermediate representation, AI Gateway proxying, ZelvoxForge multi-agent code generation swarms, VymosGate isolated compiler sandboxes, and Rust/Axum/SQLx synthesis are planned target architecture and are not present in current core implementation.
> * **Migration Safety Verdict:** Sample-based validation across 25 representative files per target establishes 100% sample recall, but whole-repository migration safety is strictly maintained as `MIGRATION_SAFETY_NOT_YET_ESTABLISHED`.

## 1. Executive Vision

Software modernization must be driven by rigorous deterministic understanding, not by blind, probabilistic code generation.

LegacyExodus is not a simple Large Language Model (LLM) wrapper, nor is it a basic AST transpiler. It is a **strictly typed, CQRS-based compiler pipeline**. It is designed to ingest massive, undocumented codebases, extract their underlying architectural knowledge, model their business behavior, and produce high-confidence migrations to memory-safe languages (like Rust) under strict human oversight.

> **Principal Insight: The Epistemological Imperative** <br>
> *Understand deterministically first. Transform probabilistically second. Verify cryptographically always.* <br>
> Naive AI tools attempt to modernize software by predicting tokens. LegacyExodus modernizes software by reconstructing the mathematical and topological reality of the system *before* a single line of target code is generated. By treating migration as a continuous, verifiable engineering pipeline rather than a prompt-engineering trick, LegacyExodus preserves business logic, systematically eliminates technical debt, and maintains absolute developer trust.

---

## 2. The Legacy Crisis & The Pipeline Architecture

Millions of mission-critical enterprise applications run on fragile, tightly coupled technology stacks. When attempting to modernize these systems, organizations increasingly turn to naive AI generation—feeding raw legacy files into an LLM and asking for a Rust/Go translation.

This approach fatally ignores the realities of enterprise software. It results in **topological hallucinations**, missed dependency graphs, and complete architectural failure because LLMs lack the global deterministic context of the application state. LegacyExodus completely decouples *comprehension* from *generation* via four heavily isolated architectural stages.

### The Pipeline Architecture Flow

```mermaid
flowchart TD
    subgraph Stage1 ["Stage 1: VyrixScout - Discovery (Implemented)"]
        A["Untrusted Legacy Source Code"] -->|Sandboxed Traversal| B["File Inventory & Manifests"]
        B -->|Static Dependency Mapping| C["Runtime Signals & Risk Seeds"]
    end

    subgraph Stage2 ["Stage 2: NolaraStruct - Understanding (Implemented)"]
        C -->|AST Extraction & Token Diet| D["Unified Intermediate Representation"]
        D -->|Symbol Resolution & CFG/DFG| E[("SQLite Storage & Knowledge Graph")]
    end

    subgraph Stage3 ["Stage 3: ZelvoxForge - Transformation (Target Architecture)"]
        E -->|Sanitized Context Slices| F["AI Gateway & Prompt Engine"]
        F -->|Multi-Agent Swarm| G["Draft Rust / Axum / SQLx Artifacts"]
    end

    subgraph Stage4 ["Stage 4: VymosGate - Verification & Governance (Target Architecture)"]
        G --> H["Isolated Compiler Sandbox"]
        H -->|cargo check / cargo test| I{"Compilation & Tests Pass?"}
        I -->|Diagnostic Errors| J["Self-Healing Loop -> RepairAgent"]
        J --> F
        I -->|Pass| K["Human-in-the-Loop Approval"]
        K --> L["Validated Modern Production Software"]
    end
```

---

## 3. The Four-Stage Modernization Pipeline

LegacyExodus executes its migration via four distinct, strictly governed architectural stages.

<table>
  <thead>
    <tr>
      <th align="left" width="15%">Pipeline Stage</th>
      <th align="left" width="15%">Codename</th>
      <th align="left" width="50%">Primary Responsibility</th>
      <th align="left" width="20%">Status</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="left"><b>Stage 1</b></td>
      <td align="left"><code>VyrixScout</code></td>
      <td align="left"><b>Legacy Intelligence Discovery.</b> Maps physical boundaries, detects languages, maps static dependencies, and surfaces framework signals. It builds the initial immutable <code>ProjectState</code> without modifying source files.</td>
      <td align="left"><img src="https://img.shields.io/badge/Status-IMPLEMENTED-brightgreen?style=flat-square" alt="Implemented"></td>
    </tr>
    <tr>
      <td align="left"><b>Stage 2</b></td>
      <td align="left"><code>NolaraStruct</code></td>
      <td align="left"><b>Knowledge Reconstruction.</b> Parses ASTs, extracts cross-file symbols, resolves import/export graphs, builds CFG/DFG models, and derives semantic facts into indexed Storage records.</td>
      <td align="left"><img src="https://img.shields.io/badge/Status-IMPLEMENTED-brightgreen?style=flat-square" alt="Implemented"></td>
    </tr>
    <tr>
      <td align="left"><b>Stage 3</b></td>
      <td align="left"><code>ZelvoxForge</code></td>
      <td align="left"><b>Modern Architecture Generation.</b> AI agents systematically plan architectures and generate modern code (Rust/Axum/SQLx) based <i>strictly</i> on the Knowledge Graph, never the raw source files.</td>
      <td align="left"><img src="https://img.shields.io/badge/Status-TARGET_ARCHITECTURE-blueviolet?style=flat-square" alt="Target Architecture"></td>
    </tr>
    <tr>
      <td align="left"><b>Stage 4</b></td>
      <td align="left"><code>VymosGate</code></td>
      <td align="left"><b>Verification & Governance.</b> Enforces Zero-Trust security, executes native compilation checks, runs automated testing, and acts as the Human-in-the-Loop (HITL) approval gate.</td>
      <td align="left"><img src="https://img.shields.io/badge/Status-TARGET_ARCHITECTURE-blueviolet?style=flat-square" alt="Target Architecture"></td>
    </tr>
  </tbody>
</table>

---

## 4. Deep Dive: The Understanding Phase (`NolaraStruct`)

The true power of LegacyExodus lies not in how it writes code, but in how it *reads* it. Before probabilistic AI is ever engaged, the platform utilizes deterministic parsing to extract the core business logic of the enterprise.

### Core Business Logic Extraction
Legacy software hides critical business decisions (e.g., *"If the user has been active for 5 years, bypass the standard authorization check"*) inside deeply nested, undocumented, and fragile `if` statements scattered across multiple controllers.

If you feed this directly to an LLM, it attempts to recreate the exact syntactic mess in the new language.

`NolaraStruct` solves this by traversing the Abstract Syntax Tree (AST) and abstracting these conditionals into a semantic, mathematical model:

1. **AST Token Diet:** Standard ASTs produce massive JSON payloads (e.g., 700 lines for 7 lines of code). NolaraStruct filters out noisy metadata (line numbers, loc, formatting, comments) to generate a clean, compressed Unified Intermediate Representation (UIR).
2. **Symbol & Scope Tables:** Functions, classes, variables, and parameters are cataloged into relational tables, differentiating definitions from call-site occurrences.
3. **Control & Data Flow Graphs (CFG/DFG):** Constructs directed graphs modeling state mutations, conditional branches, and data flows.
4. **Pure `BusinessRule` Entities:** Extracts business invariants into schema-defined objects connecting preconditions, operations, and state side-effects.

```text
Source Code ──► Lexer/Parser ──► Token Diet ──► AST ──► CFG/DFG ──► BusinessRule Entity
```

---

## 5. Deep Dive: Generation & Self-Healing Loop [Target Architecture]

Once the system has been mapped deterministically, LegacyExodus engages its probabilistic AI swarms inside a strictly governed sandbox (planned target architecture).

```mermaid
sequenceDiagram
    autonumber
    participant Z as ZelvoxForge (AI Swarm)
    participant V as VymosGate (Compiler Sandbox)
    participant C as Native Rust Toolchain (cargo)
    participant R as RepairAgent (AI Heuristic)
    participant H as Human Architect (HITL)

    Z->>V: Submit Generated Rust Code (.rs crates)
    V->>C: Execute cargo check & cargo test
    alt Compilation / Test Failure
        C-->>V: JSON Diagnostic Errors (e.g., E0382 borrow checker)
        V->>R: Package Error Log + Faulty Code + AST Context
        R->>Z: Generate Minimal Lifetime / Ownership Patch
        Z->>V: Resubmit Patched Rust Code
    else Compilation & Tests Pass (Exit Code 0)
        C-->>V: Build Succeeded + Tests Green
        V->>H: Request Human-in-the-Loop Review & Sign-Off
        H-->>V: Cryptographic Approval Granted
        V->>V: Commit to Production Artifacts
    end
```

### Self-Healing Mechanics
1. **Compilation Attempt:** `VymosGate` executes `cargo check` on generated Rust artifacts in an isolated sandbox.
2. **Diagnostic Capture:** The native compiler captures structured JSON errors (e.g., borrow-checker conflicts, lifetime mismatches).
3. **Feedback Routing:** `VymosGate` bundles the raw diagnostic, the failing code, and the upstream AST symbol coordinates.
4. **Iterative Repair:** The `RepairAgent` analyzes the ownership defect and issues a targeted patch.
5. **Success & Memory Retention:** The loop repeats until `cargo test` passes with exit code `0`. Successful repair patterns are permanently recorded in the repair knowledge base.

---

## 6. Core Engineering Paradigms

To survive in an enterprise environment, LegacyExodus adheres to strict engineering constraints. We prioritize architectural purity, mathematical traceability, and deterministic safety over rapid prototyping.

### 6.1 Domain-Driven Design (DDD): Ubiquitous Language

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LEGACYEXODUS DOMAIN MAP                           │
├──────────────────────────────────────┬──────────────────────────────────────┤
│          THE ENGINE DOMAIN           │         THE WORKFLOW DOMAIN          │
│       (Static System Knowledge)      │      (Stateful Execution Tasks)      │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ Workspace                            │ Command                              │
│ Root container for a migration run.  │ Imperative intent to execute action. │
│                                      │                                      │
│ Project                              │ Event                                │
│ Discrete deployable codebase/unit.   │ Immutable fact of a state change.    │
│                                      │                                      │
│ File                                 │ MigrationTask                        │
│ Physical source file with SHA-256.   │ Discrete unit of modernization work. │
│                                      │                                      │
│ Module                               │ Risk                                 │
│ Logical namespace / module boundary. │ Flagged security or complexity item. │
│                                      │                                      │
│ Symbol                               │ ChangeSet                            │
│ Function, Class, Interface, or Type. │ Multi-file atomic filesystem patch.  │
│                                      │                                      │
│ CodeSpan                             │ Diagnostic                           │
│ Physical file coordinate (lines/cols)│ Native compiler output/error log.    │
│                                      │                                      │
│ Dependency                           │ Approval                             │
│ Directed edge (import, call, query). │ Cryptographic human sign-off token.  │
│                                      │                                      │
│ Endpoint                             │ Checkpoint                           │
│ Exposed REST/gRPC/GraphQL route.     │ Serialized snapshot for safe resume. │
│                                      │                                      │
│ BusinessRule                         │ PolicyResult                         │
│ Pure logic extracted from syntax.    │ Deterministic pass/fail evaluation.  │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

### 6.2 CQRS & Hybrid Event Sourcing
Agents and deterministic services **never** mutate state directly:

```mermaid
flowchart LR
    A["Actor / Agent"] -->|Issues| B["Command"]
    B -->|Zero-Trust Policy| C["Governance Engine"]
    C -->|Validated| D["Orchestrator Committer"]
    D -->|Append-Only| E[("Event Store .jsonl")]
    E -->|Synchronous Reducers| F[("SQLite Projections")]
    E -->|Async Broadcast| G["WebSocket / UI Views"]
    F -->|Read-Only| H["Queries"]
```

### 6.3 The Canonical Message Envelope
Every message crossing component or process boundaries enforces this strict TypeScript contract:

```typescript
export interface MessageEnvelope<T = unknown> {
  /** Unique UUID v4 identifying the message */
  readonly messageId: string;

  /** Qualified message type (e.g., "AnalyzeProjectCommand", "ProjectDiscovered") */
  readonly messageType: string;

  /** SemVer contract version (e.g., "1.0.0") */
  readonly messageVersion: string;

  /** ISO-8601 UTC timestamp */
  readonly timestamp: string;

  /** Distributed tracing identifier spanning the entire migration run */
  readonly correlationId: string;

  /** Identifier of the parent message that directly triggered this message */
  readonly causationId: string;

  /** Optional tenant or organization identifier for multi-tenant isolation */
  readonly tenantId?: string;

  /** Identity of the originating service or human operator */
  readonly actor: string;

  /** Strongly typed, Zod-validated payload */
  readonly payload: T;
}
```

---

## 7. Component Map & Control Plane

```mermaid
flowchart TD
    CLI["CLI / API Layer"] -->|Commands| ORCH["Orchestrator Control Plane"]

    subgraph DetServices ["Deterministic Services"]
        ORCH --> DISC["Discovery Service"]
        ORCH --> PARS["Parser Service"]
        ORCH --> GRAPH["Graph Service"]
        ORCH --> KNOW["Knowledge Service"]
        ORCH --> COMP["Compiler Service"]
    end

    subgraph IntelSafety ["Intelligence & Safety"]
        KNOW -->|Sanitized Slices| AIGW["AI Gateway"]
        AIGW --> SWARM["AI Agent Swarm"]
        SWARM -->|Proposals| GOV["Governance Engine"]
    end

    COMP --> GOV
    GOV -->|Validated Events| STOR["Storage Service"]
    STOR -->|State Projections| ORCH
```

### Component Responsibility & Ownership Matrix

| Component | Primary Ownership | Secondary Stakeholder | Core Responsibilities |
|---|---|---|---|
| **CLI** | Platform DX | Core Platform | Ingests user commands, parses flags, displays live progress DAGs, renders diffs, and manages exit codes. |
| **Orchestrator** | Core Platform | Architecture Governance | Central execution brain. Manages stage progression, task queues, retries, stateful checkpoints, and OCC event commits. |
| **Discovery Service** | Static Analysis | Core Modeling | Sandboxed directory traversal, language fingerprinting, dependency discovery, and `.discovery/*.json` projection. |
| **Parser Service** | Language Infrastructure | Static Analysis | AST parsing, token extraction, "Token Diet" metadata stripping, and UIR generation. |
| **Graph Service** | Core Modeling | Governance | Builds dependency graphs, call hierarchies, circularity detection, and blast-radius impact queries. |
| **Knowledge Service** | Architecture Intelligence | Governance | Aggregates symbols, graph slices, and business rules into scoped context bundles with full provenance chains. |
| **AI Gateway** | AI Platform & Safety | Security | Zero-Trust LLM proxy. Performs prompt assembly, secret redaction, token budgeting, model routing, and output schema validation. |
| **Compiler Service** | Language Infrastructure | Build & Toolchain | Interfaces with native compiler toolchains (`cargo check`, `cargo test`, `clippy`) inside isolated sandboxes. |
| **Governance Engine** | Architecture Governance | Security | Evaluates deterministic security rules, SAST policies, risk scoring, and Human-in-the-Loop approval gates. |
| **Storage Service** | Data Platform | Reliability Engineering | System-of-record. Manages append-only `.jsonl` logs, SQLite projections, Parquet graphs, and content-addressed artifact blobs. |

---

## 8. CLI Terminal Foundation & Command Discovery

LegacyExodus features a unified, accessible terminal interface designed with strict output mode separation, theme customization, and terminal width safety.

### 8.1 Command Overview

```text
* LegacyExodus > v0.1.0 > Modernization Engine ---------------------------------
  Knowledge-first codebase modernization and repository intelligence

COMMANDS
  Workspace & Runtime
    status                Report runtime health and composed dependencies [read-only]
    init <path>           Initialize a new LegacyExodus workspace [mutates workspace]

  Repository Analysis
    analyze <path>        Analyze repository structure, ASTs, symbols & graph [read-only]

  Quality & Verification
    test [domain]         Explore and run test suites by architectural domain [read-only]
    verify                Run complete 4-gate repository verification [read-only]

  Plugins & Extensions
    plugins list          Inspect loaded plugins and discovery extensions [read-only]
```

### 8.2 Themes & Accessibility
- **`classic` (default):** TrueColor sky/emerald palette for interactive developer terminals.
- **`aurora`:** Soft lavender/teal palette with gentle contrast.
- **`mono`:** Monochrome high-contrast presentation for CI logs and automated environments (`NO_COLOR=1` compatible).

```bash
# Switch visual theme
legacy-exodus status --theme aurora

# List test domain taxonomy
legacy-exodus test --list

# Run focused AST parser tests
legacy-exodus test parser

# Run parser tests with detailed execution trace
legacy-exodus test parser --verbose

# Run full multi-gate verification dashboard
legacy-exodus verify
```

---

## 9. Non-Negotiable Security Architecture & Compliance Matrix

### 9.1 The Master Trust Boundary
```text
Untrusted Legacy Code ──► Sandbox ──► Parser ──► Knowledge Model ──► AI Gateway
```
*No transformation engine, agent, or service may consume raw legacy source code directly or bypass intermediate governance boundaries.*

### 9.2 Boundary Compliance Matrix

<table>
  <thead>
    <tr>
      <th align="left">Boundary</th>
      <th align="left">Allowed Input</th>
      <th align="left">Required Controls</th>
      <th align="left">Must-Fail Conditions</th>
      <th align="left">Required Audit Events</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><b>Untrusted Code $\to$ Sandbox</b></td>
      <td>Raw files, archives, repositories</td>
      <td>File allowlist, size limits, bomb detection, network egress deny</td>
      <td>Path traversal (<code>../</code>), expansion bombs, disallowed files</td>
      <td><code>sandbox.intake.started</code><br><code>sandbox.intake.blocked</code><br><code>sandbox.intake.completed</code></td>
    </tr>
    <tr>
      <td><b>Sandbox $\to$ Parser</b></td>
      <td>Read-only sandbox artifacts</td>
      <td>Process isolation, read-only mounts, CPU/RAM/time quotas</td>
      <td>Outbound network attempts, memory exhaustion, timeout</td>
      <td><code>parser.run.started</code><br><code>parser.run.failed</code><br><code>parser.run.completed</code></td>
    </tr>
    <tr>
      <td><b>Parser $\to$ Knowledge Model</b></td>
      <td>Parsed IR + provenance metadata</td>
      <td>Strict schema validation, hash chaining, taint propagation</td>
      <td>Missing provenance, schema mismatch, broken symbol links</td>
      <td><code>km.ingest.started</code><br><code>km.ingest.rejected</code><br><code>km.ingest.completed</code></td>
    </tr>
    <tr>
      <td><b>Knowledge Model $\to$ AI Gateway</b></td>
      <td>Sanitized, policy-approved context slices</td>
      <td>Field-level redaction, secret/PII filtering, prompt token budgets</td>
      <td>Secret/token detection, policy deny, missing redaction receipt</td>
      <td><code>aigw.request.blocked</code><br><code>aigw.request.redacted</code><br><code>aigw.request.sent</code></td>
    </tr>
    <tr>
      <td><b>AI Gateway $\to$ Downstream</b></td>
      <td>Structured model response</td>
      <td>Schema validation, tool allowlist, confidence scoring</td>
      <td>Invalid schema, disallowed tool call, confidence &lt; threshold</td>
      <td><code>aigw.response.rejected</code><br><code>aigw.response.accepted</code></td>
    </tr>
    <tr>
      <td><b>ZelvoxForge $\to$ VymosGate</b></td>
      <td>Candidate transforms + trace maps</td>
      <td>Signed bundles, memory-safety verification, compiler checks</td>
      <td>Missing trace map, borrow-check failure, test regression</td>
      <td><code>forge.bundle.created</code><br><code>gate.validation.failed</code><br><code>gate.validation.passed</code></td>
    </tr>
  </tbody>
</table>

---

## 10. The AI Constitution & Governed Intelligence Model

AI operates strictly as an advisory cognitive worker, never as an authoritative controller.

$$\text{Deterministic Core} + \text{Probabilistic Intelligence} = \text{Controlled AI System}$$

```
AI Suggestion ──► Evidence Collection ──► Schema Validation ──► HITL Approval ──► Execution
```

### The 16 Invariant AI Engineering Rules
1. **Never assume the cause of an observed failure without concrete evidence.**
2. **Never redesign architecture based solely on intuition.**
3. **Never remove validation merely to make tests pass.**
4. **Never weaken schemas to accommodate malformed or unexpected data.**
5. **Never introduce speculative abstractions without a concrete, immediate need.**
6. **Every control-flow change requires dedicated regression tests.**
7. **Every data-flow change requires dedicated regression tests.**
8. **Mathematical and graph algorithms must have invariant-based test coverage.**
9. **Performance claims must be benchmarked and measured.**
10. **Memory and resource claims must be empirically verified via instrumentation.**
11. **Passing tests do not automatically prove semantic correctness.**
12. **No AI agent may declare a milestone, task, or phase complete.**
13. **The repository, test suites, benchmarks, and explicit acceptance criteria are the sole authorities.**
14. **Preserve existing runtime behavior unless the task explicitly mandates a change.**
15. **Prefer small, reviewable, incremental pull requests over massive rewrites.**
16. **When uncertain, report the uncertainty explicitly rather than inventing behavior.**

---

## 11. Plugin-First Extension Architecture

LegacyExodus uses a **stable core** extended via **isolated, contract-first plugins**.

```
                                  Stable Core
                                       │
                                Plugin Interface
                                       │
    ┌──────────────────┬───────────────┼───────────────┬──────────────────┐
    ▼                  ▼               ▼               ▼                  ▼
Parser Plugins    Migration       AI Provider       Storage           Validation
 (JS, TS, PHP,    Strategies        Plugins         Plugins            Plugins
  Python, Java)  (Decomposition) (Local/Cloud)   (Postgres/Parquet) (Security/SAST)
```

### Mandatory Plugin Manifest Contract
Every plugin must supply a versioned, machine-readable manifest (`plugin.json`):

```json
{
  "name": "express-to-axum-strategy",
  "version": "1.0.0",
  "type": "migration-strategy",
  "contractVersion": "1",
  "capabilities": [
    "route-mapping",
    "middleware-synthesis",
    "sqlx-query-generation"
  ],
  "permissions": {
    "filesystem": "read:sandbox-input",
    "network": "deny",
    "secrets": "none"
  }
}
```

---

## 12. Data Flow, Storage Architecture, & Checkpoints

```mermaid
flowchart LR
    A[("Legacy Repo")] --> B["VyrixScout"]
    B --> C["inventory.json"]
    C --> D["NolaraStruct"]
    D --> E[("UIR & Knowledge Graph")]
    E --> F["ZelvoxForge"]
    F --> G["Rust Crates + Trace Map"]
    G --> H["VymosGate Sandbox"]
    H --> I[("Validated Production Rust")]

    subgraph DurableStores ["Durable Stores"]
        J[("Event Store .jsonl")]
        K[("SQLite Projections")]
        L[("Parquet KG Store")]
        M[("Artifact Store")]
    end

    B -.-> J
    D -.-> L
    F -.-> M
    H -.-> K
```

### Primary Storage Tiers
1. **Event Store:** Append-only `.jsonl` files (the ground truth for all state transitions).
2. **Artifact Store:** Content-addressed, hash-verified immutable files and code bundles.
3. **Knowledge Graph Store:** Parquet and SQLite databases for node/edge relationship queries.
4. **Operational Metadata Store:** Task queues, locks, retries, and approval states.
5. **Projection Store:** Query-optimized SQLite read models for CLI, API, and UI queries (`SqliteStorageProvider`).

### Resumable Checkpoints
Checkpoints are created atomically at:
- Run initialization
- Stage completion boundaries
- Pre- and post-high-risk transformation batches
- Pre-validation gate execution

Resuming a run loads the latest valid checkpoint, verifies artifact hashes, rebuilds in-memory projections up to the event sequence watermark, and re-queues incomplete tasks without re-executing completed stages.

---

## 13. Failure Recovery & Scalability Strategy

### 13.1 Failure Classification & Handling

| Failure Domain | Examples | Recovery Strategy |
|---|---|---|
| **Transient Infrastructure** | Network timeout, rate limits, queue lease expiry | Bounded retry with exponential backoff + jitter. |
| **Deterministic Processing** | Parser crash, schema mismatch, invariant violation | Fail-fast $\to$ Dead-Letter Queue (DLQ) quarantine $\to$ Operator triage. |
| **Resource Exhaustion** | Out of Memory (OOM), CPU throttling | Rebalance resources $\to$ Route to constrained recovery worker tier. |
| **Human / Governance Gated** | Approval timeout, risk policy rejection | Pause pipeline $\to$ Emit `EscalationRaised` $\to$ Await HITL decision. |

### 13.2 Capacity Classes & Worker Pools
Worker pools scale horizontally and independently:
- **`vyrixscout-workers`:** Fast directory traversal and I/O intake.
- **`nolara-parse-workers`:** CPU-bound parsing, Token Diet, and AST reduction.
- **`zelvox-transform-workers`:** Network-bound LLM routing and Rust synthesis.
- **`vymos-verify-workers`:** CPU-bound sandboxed native compilation and test sharding.

```text
Class S (Small)     ──► Single-module tools and small utility repositories.
Class M (Medium)    ──► Standard backend services with moderate graph complexity.
Class L (Large)     ──► Enterprise services with deep dependency DAGs.
Class XL (Monorepo) ──► Enterprise monorepos with multi-tenant namespace partitioning.
```

---

## 14. Technology Stack Decisions & Tradeoffs

```text
┌────────────────────────┬────────────────────────────────────────────────────────┐
│ Layer                  │ Technology Selection & Rationale                       │
├────────────────────────┼────────────────────────────────────────────────────────┤
│ Core Engine & CLI      │ Bun v1.0+ + TypeScript (Strict Mode)                   │
│                        │ • Ultra-fast I/O, native TS execution, embedded SQLite │
├────────────────────────┼────────────────────────────────────────────────────────┤
│ Target Modernization   │ Rust + Axum + SQLx                                     │
│                        │ • Guaranteed memory safety, fearless concurrency,      │
│                        │   zero-cost abstractions, compile-time SQL verification│
├────────────────────────┼────────────────────────────────────────────────────────┤
│ Operator Console       │ React + Vite + Tailwind CSS                            │
│                        │ • Fast local rendering for complex ASTs and DAG graphs │
├────────────────────────┼────────────────────────────────────────────────────────┤
│ Validation & Contracts │ OpenAPI + Zod (Strict runtime schema boundaries)       │
├────────────────────────┼────────────────────────────────────────────────────────┤
│ Persistence Stores     │ Append-only .jsonl (Events), SQLite / Postgres         │
│                        │ (Projections), Parquet (Knowledge Graph)               │
├────────────────────────┼────────────────────────────────────────────────────────┤
│ Observability          │ OpenTelemetry-compatible tracing, Pino logging         │
└────────────────────────┴────────────────────────────────────────────────────────┘
```

---

## 15. Multi-AI Operating Framework & Role Division

To maintain engineering discipline and prevent AI drift across sessions:

```mermaid
flowchart TD
    A["Taskeen Haider - Chief Architect"] -->|Specifications & ADR Decisions| B["Primary Builder: Codex / Gemini"]
    B -->|Code, Tests, Diff| C["GitHub Repository - Single Source of Truth"]

    C -->|Repository Context| D["Claude Free - Adversarial Reviewer"]
    C -->|Local Completions| E["Copilot - IDE Acceleration"]

    D -->|Counterexamples & Edge Cases| B
    B -->|Verify & Fix| F{"Quality Gate: typecheck + test + diff"}
    F -->|Green Pass| A
```

1. **Chief Architect (Taskeen):** Sets specifications, reviews architecture, resolves tradeoffs, and signs off on pull requests.
2. **Primary Builder (Codex / Gemini):** Inspects the repository, implements minimal idiomatic code, and writes regression tests.
3. **Adversarial Reviewer (Claude Free):** Analyzes diffs strictly to attack the code, finding counterexamples, mathematical inaccuracies, and unhandled edge cases without writing feature code.
4. **IDE Acceleration (Copilot):** Provides local autocomplete, repetitive interface/schema boilerplate, and small edits.
5. **Canonical Repository:** The GitHub repository is the sole permanent memory and source of truth.

---

## 16. Quality Gate & Definition of Done

No milestone or pull request is accepted based on AI claims. Every change must pass the non-negotiable quality gate:

```bash
# 1. Strict static type checking
bun run typecheck

# 2. Comprehensive test suite execution
bun test

# 3. Multi-gate repository verification
bun run verify

# 4. Git whitespace and format verification
git diff --check
```

### Definition of Done Checklist
- [ ] **Problem Scope Documented:** Boundaries, contracts, and failure modes explicitly defined.
- [ ] **No Speculative Code:** Implementation solves verified requirements without premature abstractions.
- [ ] **100% Strict Typing:** Zero `any` types permitted; all boundary inputs validated with Zod.
- [ ] **Regression & Invariant Tests:** Unit tests, mathematical invariant tests, and edge-case coverage pass.
- [ ] **Traceability Preserved:** Emitted artifacts maintain lineage links and input hashes.
- [ ] **Fail-Closed Security:** Sandboxing, secret redaction, and prompt isolation verified.
- [ ] **Quality Gate Green:** `bun run typecheck`, `bun test`, `bun run verify`, and `git diff --check` return exit code `0`.
- [ ] **Architect Sign-Off:** Human review completed and committed to Git history.

---

## 17. Verified Evidence & Empirical Validation Baseline

All claims in LegacyExodus are grounded in reproducible automated test suites, multi-tier real-repository benchmarks, and cryptographic provenance locks.

### 17.1 Test Suite & Static Typing
* **Full Test Suite:** `bun test` $\to$ **660 / 660 passing tests across 87 files** (7,281 assertions, 0 failures, ~40s runtime).
* **TypeScript Type Checking:** `bun run typecheck` $\to$ **0 errors**.
* **Benchmark Governance Audit:** `bun run benchmark audit` $\to$ **10 / 10 checks passed (`PASS`)**.
* **Repository Verification Dashboard:** `bun run verify` $\to$ **4 / 4 gates passed (`PASS`)**.

### 17.2 Real-Repository 3-Run Determinism Evidence
Evaluated across three tiers of external real-world repositories with 3 consecutive cold analysis runs:

| Repository | Tier | Role | Files Discovered / Analyzed | 3-Run Determinism | Health Gate |
|---|:---:|:---:|:---:|:---:|:---:|
| **`cookie-parser`** | Tier-1 | External Utility | 12 / 2 (0 failures) | **`✓ PASS (0 semantic diffs)`** | **`PASS`** |
| **`fastify`** | Tier-2 | Enterprise Framework | 385 / 287 (0 failures) | **`✓ PASS (0 semantic diffs)`** | **`PASS`** |
| **`express`** | Tier-3 | Enterprise Framework | 234 / 152 (0 failures) | **`✓ PASS (0 semantic diffs)`** | **`NEEDS_REVIEW`** *(82 non-source fixtures)* |

### 17.3 Multi-File Migration Fidelity Evidence
Sample-based validation across 25 representative core files per framework target under the Three-Universe model:

| Framework Target | Validated Files | Ground Truth Facts | True Positives | False Negatives | Sample Recall | Actionable Correctness | Migration Safety Verdict |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Express v4.21.2** | 25 | 173 (+5 KN) | 172 | 1 | **99.4%** | **100.0%** | `MIGRATION_SAFETY_NOT_YET_ESTABLISHED` |
| **Fastify v5.3.3** | 25 | 193 (+6 KN) | 193 | 0 | **100.0%** | **100.0%** | `MIGRATION_SAFETY_NOT_YET_ESTABLISHED` |

---

## 18. The Three-Universe Fidelity Evidence Model

To ensure mathematical integrity and eliminate false positive distortion when evaluating large open-world codebases, LegacyExodus implements the **Three-Universe Model**:

* **Universe A (Verified Ground Truth):** Explicitly annotated positive ground-truth facts ($U_{GT}^+$) and known negative constraints ($U_{GT}^-$) within verified sample files.
* **Universe B (Scoped / Unverified):** Engine predictions within verified files that lack corresponding manual annotations. Classified as `UNVERIFIED_SCOPED` (not false positives); open-world sample precision is reported strictly as `N/A (Sample-Based)`.
* **Universe C (Unvalidated Predictions):** Predictions across files outside the ground-truth sample. Classified as `UNVALIDATED` (never false positives).

> **Important Safety Principle:**
> High sample recall (even 100.0%) proves the engine reconstructs known architectural facts within verified files, but does **NOT** prove whole-repository migration correctness. The migration safety verdict strictly remains `MIGRATION_SAFETY_NOT_YET_ESTABLISHED` until exhaustive whole-repository ground truth is validated.

---

## 19. Intentional Architectural Boundaries & Conservative Invariants

The following behaviors represent deliberate conservative design invariants:

1. **Dynamic Property Calls:** Expressions like `app[computedMethod]()` strictly resolve to `UNRESOLVED` to prevent semantic fabrication.
2. **Third-Party NPM Packages:** Module specifiers outside the local repository (e.g. `import express from 'express'`) resolve to `resolvedPath: null` (correctly unresolved).
3. **Symlink Isolation:** Directory scanning intentionally skips symbolic links to prevent infinite traversal cycles and boundary escapes.
4. **Streaming JSON Backpressure:** All projections stream via `StreamingJsonWriter` with bounded 64KB buffers to eliminate memory spikes on multi-megabyte repositories.

---

## 20. Authoritative Documentation Ecosystem

For deeper technical documentation, refer to the following canonical resources:

* **[GOVERNANCE.md](GOVERNANCE.md):** Repository boundaries, Three-Universe model contracts, and provenance freshness locks.
* **[ROADMAP.md](ROADMAP.md):** Milestone status tracker (Completed, Planned, and Target Architecture).
* **[CHANGELOG.md](CHANGELOG.md):** Detailed release history, verified fixes, and milestone summaries.
* **[SUPPORT.md](SUPPORT.md):** Technical support policies, bug reporting guidelines, and maintainers.
* **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md):** Contributor Covenant community code of conduct.
* **[.github/CODEOWNERS](.github/CODEOWNERS):** Repository code ownership mappings.
* **[docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md):** Foundational architecture context and pipeline specifications.
* **[docs/DOCUMENTATION_MAP.md](docs/DOCUMENTATION_MAP.md):** Master documentation index and knowledge routing.
* **[docs/development/contribution-guide.md](docs/development/contribution-guide.md):** Contributor workflows, testing standards, and Definition of Done.
* **[docs/architecture/security-architecture.md](docs/architecture/security-architecture.md):** Zero-Trust security model and boundary isolation.
* **[docs/GLOSSARY.md](docs/GLOSSARY.md):** Ubiquitous domain language and architectural definitions.

---

### Recent Contributions

<div align="center">
  <a href="https://github.com/raitaskeen/LegacyExodus/graphs/contributors">
    <img src="https://repobeats.axiom.co/api/embed/ad6cb9c1edcc45f447fc783b17ebbc8c483e178a.svg" alt="Repobeats analytics image" />
  </a>
</div>

---

## License

LegacyExodus is open-source software licensed under the **[MIT License](LICENSE)**.

<div align="center">
  <br>
  <i>Built for the future of software engineering.</i>
</div>
