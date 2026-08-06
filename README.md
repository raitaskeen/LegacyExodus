<!-- Replace the top text header with this -->
<p align="center">
  <picture>
    <img src="docs/assets/branding/banner.png" alt="LegacyExodus: Autonomous Software Modernization Platform" width="100%">
  </picture>
</p>

<h3 align="center">Enterprise-Grade Autonomous Software Modernization Platform</h3>

<p align="center">
  A knowledge-first engineering platform that systematically maps, documents, and safely transforms complex legacy software systems into memory-safe architectures.
</p>

---

## 1. Executive Vision

Software modernization should be driven by rigorous deterministic understanding, not by blind, probabilistic code generation. 

LegacyExodus aims to become the definitive enterprise platform capable of ingesting massive, undocumented codebases, extracting their underlying architectural knowledge, modeling their business behavior, and producing high-confidence migrations with strict human oversight.

Our core philosophy is simple and immutable:
> **Understand deterministically first.**
> **Transform probabilistically second.**

By treating software migration as an engineering pipeline rather than a prompt-engineering trick, LegacyExodus preserves business logic, systematically eliminates technical debt, and maintains absolute developer trust.

---

## 2. The Legacy Software Crisis

Millions of mission-critical enterprise applications currently run on aging, fragile technology stacks. As these systems age, they become increasingly hostile to modification and scaling.

### The Symptoms of Legacy Decay
Enterprise systems typically suffer from:
* **Undocumented Business Logic:** Core rules exist only in undocumented, nested conditionals.
* **Tightly Coupled Architecture:** Database queries, network requests, and presentation logic are inextricably linked.
* **Security Degradation:** Outdated dependencies and legacy frameworks harbor unpatched vulnerabilities.
* **Knowledge Silos:** The original engineers have left, leaving a "black box" that current maintainers are afraid to touch.
* **Testing Deficits:** A lack of unit and integration tests makes refactoring mathematically dangerous.

### The Failure of Traditional Modernization
When attempting to modernize these systems, organizations typically choose from three flawed paths:
1. **Manual Rewrites:** Exhaustively slow, mathematically prone to human error, and prohibitively expensive.
2. **Consulting Armies:** Outsourcing results in a loss of internal domain knowledge and massive capital expenditure.
3. **Naive AI Generation:** Feeding raw legacy files into an LLM asking for a Rust/Go translation results in hallucinated syntax, missed dependencies, and complete architectural failure.

---

## 3. The LegacyExodus Solution

LegacyExodus introduces the **Knowledge-First Modernization Pipeline**.

Instead of immediately asking an AI model to rewrite code, the platform first constructs a highly structured, relational representation of the software. 

### The Extraction Phase
Before a single line of target code is generated, the platform deterministically extracts:
* **Project Architecture:** The physical and logical layout of workspaces, modules, and directories.
* **Dependency Graphs:** A directed acyclic graph (DAG) of all imports, exports, network calls, and database transactions.
* **API Endpoints:** The exact request/response schemas and HTTP methods exposed by the system.
* **Symbols and References:** Every class, function, variable, and their exact `CodeSpan` occurrences.
* **Business Rules:** Abstracted logical workflows divorced from their original syntax.

### The Generation Phase
Only after the system has been mapped into a local `KnowledgeGraph` are specialized, narrow-focused AI agents allowed to generate migration artifacts. These agents query the graph, formulate a plan, and generate code. 

The deterministic platform always remains in control, validating the output through native compilers before presenting it for human approval.

---

## 4. Core Engineering Principles

To survive in an enterprise environment, LegacyExodus adheres to strict engineering constraints.

### I. Knowledge Before Generation
Understanding software is exponentially more valuable than generating software. The platform's primary output is the Knowledge Graph. Code generation is simply a byproduct of that knowledge.

### II. The Deterministic Core
Critical infrastructure operations are 100% deterministic and written in strict TypeScript. These include project discovery, AST parsing, dependency resolution, file storage, governance, and compiler integration. **These services never rely on probabilistic AI.**

### III. AI as Specialized Workers
AI is utilized strictly as a tool for heuristic reasoning, never as a system controller. Specialized agents are given narrow scopes (Architecture mapping, Business Logic extraction, Migration Planning, Rust Generation). **AI models never have direct write access to the filesystem, security policies, or secret management.**

### IV. Zero Trust & Enterprise Safety
LegacyExodus operates under a Zero Trust architecture. Every generated artifact is treated as hostile until validated. Output is piped through native compiler checks, and high-risk domains trigger automatic system halts requiring human cryptographic approval.

---

## 5. High-Level System Architecture

LegacyExodus is not a single AI script; it is a **four-stage autonomous modernization pipeline**. The system flows through strict, isolated phases:

                     [Legacy Source Code]
                              │
                              ▼
     ┌──────────────────────────────────────────────────┐
     │ Stage 1: VyrixScout                              │
     │ (Discovery & System Understanding)               │
     └──────────────────────────────────────────────────┘
                              │
                              ▼
     ┌──────────────────────────────────────────────────┐
     │ Stage 2: NolaraStruct                            │
     │ (Knowledge Graph Reconstruction)                 │
     └──────────────────────────────────────────────────┘
                              │
                              ▼
     ┌──────────────────────────────────────────────────┐
     │ Stage 3: ZelvoxForge                             │
     │ (Modern Architecture Generation)                 │
     └──────────────────────────────────────────────────┘
                              │
                              ▼
     ┌──────────────────────────────────────────────────┐
     │ Stage 4: VymosGate                               │
     │ (Validation & Governance)                        │
     └──────────────────────────────────────────────────┘
                              │
                              ▼
                    [Modernized Software]

---

## 6. The Four-Stage Pipeline (Major Components)

### Stage 1: VyrixScout (Legacy Intelligence Discovery Engine)
**The Goal:** *"What exists inside this software system?"*
VyrixScout is the deterministic reconnaissance layer. It scans the repository to map the physical boundaries of the legacy application before any parsing begins.
* **Responsibilities:** Language/framework detection, dependency mapping, entry point detection, and API endpoint discovery.
* **Output:** A complete System Inventory (Workspaces, Projects, Files, and raw Endpoints).

### Stage 2: NolaraStruct (Knowledge Reconstruction Engine)
**The Goal:** *"How does this system actually work?"*
NolaraStruct represents our *Knowledge-First* philosophy. It converts raw syntax into a deep, semantic understanding of the business domain.
* **Responsibilities:** AST parsing, symbol extraction, business rule discovery, domain modeling, and architecture reconstruction.
* **Output:** A relational Knowledge Graph (Entities, Relationships, Business Rules, and Architecture Models).

### Stage 3: ZelvoxForge (Modernization Generation Engine)
**The Goal:** *"How do we rebuild this system safely?"*
ZelvoxForge is where specialized AI agents operate. Guided by the Knowledge Graph, it systematically generates modern, memory-safe code. 
* **Responsibilities:** Rust code generation, framework mapping, database migration mapping, test generation, and compiler repair loops.
* **Output:** Modernized Source Code (Rust/Axum Services, SQLx Models, and generated tests).

### Stage 4: VymosGate (Verification & Governance Gateway)
**The Goal:** *"Can this transformation be trusted?"*
VymosGate is the final barrier before deployment. It enforces Zero-Trust security and ensures the generated code compiles, passes tests, and meets architectural standards.
* **Responsibilities:** Security validation, native compilation checks (`cargo check`), automated testing, and Human-in-the-Loop (HITL) approval checkpoints.
* **Output:** Validated Software, Migration Reports, and Cryptographic Approval Records.

---

## 7. Software Engineering Paradigms

LegacyExodus is designed around battle-tested software engineering patterns to ensure massive scalability and absolute data integrity.
* **Domain Driven Design (DDD):** Business concepts remain independent of infrastructure.
* **CQRS:** Commands mutate state. Queries retrieve knowledge.
* **Event Driven Architecture:** Every important system action becomes an immutable event.
* **Hybrid Event Sourcing:** Historical events are preserved while optimized projections support fast querying.
* **Human-in-the-Loop (HITL):** High-risk migrations require explicit manual approval at VymosGate.
* **Zero Trust AI:** AI agents operate strictly inside the deterministic boundaries of ZelvoxForge and NolaraStruct.
* **AI Gateway Routing:** Vendor-agnostic routing to prevent lock-in, utilizing local models for lightweight tasks and cloud models for heavy reasoning.

---

## 8. Technology Stack Justification

* **Runtime:** `Bun` (Ultra-fast File I/O, native TypeScript execution, built-in SQLite driver).
* **Language:** `TypeScript` in Strict Mode with `Zod` (Enforces rigorous data contracts).
* **Database:** `Better-SQLite3` (Embedded, local, ACID-compliant to prevent OOM crashes).
* **Event Store:** Flat `.jsonl` files (Human-readable, append-only, version-controlled).
* **Target Architecture:** `Rust` / `Axum` / `SQLx` (Memory-safe, highly performant, strictly typed).

---

## 9. Repository Directory Structure

LegacyExodus is designed with a massive, comprehensive documentation hub that precedes the core logic implementation.

    LegacyExodus/
    ├── .github/                           # GitHub Governance & CI/CD
    │   ├── ISSUE_TEMPLATE/                # Strict bug and ADR templates
    │   ├── workflows/                     # GitHub Actions (Testing, Linting)
    │   └── pull_request_template.md   
    ├── docs/                              # Comprehensive Documentation Hub
    │   ├── adr/                           # Architecture Decision Records
    │   ├── api/                           # API contracts and interface definitions
    │   ├── architecture/                  # System overviews, component maps, and flows
    │   ├── archive/                       # Deprecated documentation
    │   ├── decisions/                     # General project decisions
    │   ├── development/                   # CI/CD, coding standards, dev guides
    │   ├── diagrams/                      # Draw.io and PlantUML architecture diagrams
    │   ├── domain/                        # DDD models, entities, bounded contexts
    │   ├── drafts/                        # WIP and human-review drafts
    │   ├── operations/                    # Deployment and operational models
    │   ├── research/                      # AI models, parsers, and market analysis
    │   ├── reviews/                       # Architecture, security, and AI reviews
    │   ├── security/                      # Threat models, compliance, sandboxing
    │   ├── templates/                     # Standardized markdown templates
    │   ├── assets/branding/               # Logos, banners, and visual assets
    │   ├── AI_CONTEXT.md                  # Specific instructions for AI agents
    │   ├── DOCUMENTATION_RULES.md         # Rules for writing docs
    │   ├── GLOSSARY.md                    # Project-specific terminology
    │   ├── PROJECT_CONTEXT.md             # High-level context definitions
    │   └── README.md                      # Entry point for the docs hub
    ├── legacy-exodus-core/                # [HIDDEN - Future Phase: Backend Engine]
    ├── legacy-exodus-dashboard/           # [HIDDEN - Future Phase: Telemetry UI]
    ├── CHANGELOG.md                       # Keep-a-changelog standard
    ├── CONTRIBUTING.md                    # Rules of engagement for developers
    ├── LICENSE                            # MIT
    ├── README.md                          # This manifesto
    └── SECURITY.md                        # Responsible disclosure and threat policies

    ---

## 10. Development Roadmap

LegacyExodus is being built incrementally to ensure mathematical stability at every phase.

### Phase 0: Foundation (Current Status)
- [x] Establish Enterprise Repository Metadata & Branding.
- [x] Define Domain-Driven Design (DDD) Ubiquitous Language.
- [x] Draft Architecture Decision Records (ADRs 001-007).
- [x] Configure strict TypeScript and testing environments.
- [x] Establish the massive `docs/` knowledge hub.

### Phase 1: VyrixScout (The Deterministic Engine)
- [ ] Implement `StorageService` (SQLite scaffolding and Event Log writing).
- [ ] Implement `DiscoveryService` (Directory traversal, file hashing, `.exodusignore`).
- [ ] Validate Engine by parsing a dummy Express.js project into a structured JSON representation.

### Phase 2: NolaraStruct (Knowledge Extraction)
- [ ] Implement `ParserService` (AST generation via `@babel/parser`).
- [ ] Implement `GraphService` (Resolving dependencies and mapping endpoints).
- [ ] Persist the completed Knowledge Graph to SQLite.

### Phase 3: ZelvoxForge (The Intelligence Layer)
- [ ] Build the `AI Gateway` (Vendor-agnostic routing interface).
- [ ] Implement local embedding support for semantic search.
- [ ] Deploy the `ArchitectureAgent` and `BusinessLogicAgent`.
- [ ] Implement the `RustGeneratorAgent`.

### Phase 4: VymosGate (Transformation & Validation)
- [ ] Build the `CompilerService` (`cargo check` integration).
- [ ] Develop the Self-Healing `RepairAgent` loop.
- [ ] Implement Human-in-the-loop (HITL) approval gates.
- [ ] Finalize telemetry and metric exporting via the Dashboard.

---

## 11. Getting Started

*(Note: LegacyExodus is currently in the Foundation phase. The following commands represent the intended Developer Experience once Phase 1 is complete.)*

### Prerequisites
* **OS:** Linux, macOS, or WSL2 (Windows)
* **Runtime:** [Bun](https://bun.sh/) (v1.0+)
* **Toolchain:** Rust (`rustup`, `cargo`) for Phase 4 validation.

### Local Installation

    # Clone the repository
    git clone https://github.com/your-org/LegacyExodus.git
    cd LegacyExodus/legacy-exodus-core

    # Install deterministic dependencies
    bun install

    # Run the test suite
    bun test

### Planned CLI Usage

    # Initialize a workspace in an existing legacy project
    legacy-exodus init ./my-legacy-express-app

    # Run VyrixScout and NolaraStruct
    legacy-exodus scan

    # Formulate a migration plan via ZelvoxForge
    legacy-exodus plan --target=rust-axum

    # Execute the migration with VymosGate HITL enabled
    legacy-exodus migrate --interactive

---

## 12. Contributing

We operate under strict enterprise contribution guidelines. We welcome collaboration, but all architectural changes must be heavily scrutinized.

1. **Read the Documentation:** Familiarize yourself with our Domain Model (`/docs/domain`) and existing ADRs (`/docs/adr`).
2. **Propose Architecture Changes:** If modifying state, schemas, or event flow, you must open an **Architecture Proposal Issue** to draft an ADR before writing code.
3. **Branching Strategy:** Use `feat/`, `fix/`, or `chore/` branches from `main`.
4. **Testing:** No PR will be reviewed without accompanying unit tests for deterministic services.
5. **No `any` Types:** TypeScript must remain in absolute strict mode.

For the full operational guide, please read [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 13. Security & Governance

Security is non-negotiable. LegacyExodus processes highly sensitive, proprietary source code and credentials embedded in legacy environments.

### The Zero-Trust Model
* **Code as Data:** All legacy code read by the system is treated as untrusted data to prevent Prompt Injection attacks against the AI agents.
* **Deterministic Isolation:** AI agents execute in isolated contexts. They cannot issue direct filesystem writes or execute bash commands.
* **Secret Scanning:** The Governance Engine deterministically strips `.env` files, `.pem` certificates, and hardcoded API keys before ASTs are transmitted to any cloud AI provider.

### Vulnerability Reporting
If you discover a vulnerability—especially sandbox escapes, prompt injection risks, or event-log corruption vectors—**do not open a public issue.** Please refer to our [SECURITY.md](SECURITY.md) file for responsible disclosure protocols. 

---

## 14. License

This project is licensed under the **MIT License**. By contributing to LegacyExodus, you agree that your contributions will be licensed under its MIT License. See the [LICENSE](LICENSE) file for complete details.

<div align="center">
  <br>
  <i>Built for the future of software engineering.</i>
</div>
