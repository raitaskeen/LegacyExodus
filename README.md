# LegacyExodus

**Enterprise-Grade Autonomous Software Modernization Platform**

A knowledge-first engineering platform that systematically maps, documents, and safely transforms complex legacy software systems into memory-safe architectures.

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
* **Undocumented Business Logic:** Core rules ("VIPs get 15% discounts on Tuesdays") exist only in undocumented, nested `if` statements.
* **Tightly Coupled Architecture:** Database queries, network requests, and presentation logic are inextricably linked, making microservice extraction impossible.
* **Security Degradation:** Outdated dependencies and legacy frameworks harbor unpatched vulnerabilities.
* **Knowledge Silos:** The original engineers have left, leaving a "black box" that current maintainers are afraid to touch.
* **Testing Deficits:** A lack of unit and integration tests makes refactoring mathematically dangerous.

### The Failure of Traditional Modernization
When attempting to modernize these systems, organizations typically choose from three flawed paths:
1. **Manual Rewrites:** Exhaustively slow, mathematically prone to human error, and prohibitively expensive.
2. **Consulting Armies:** Outsourcing to large firms results in a loss of internal domain knowledge and massive capital expenditure.
3. **Naive AI Generation:** Feeding raw legacy files into an LLM (Large Language Model) asking for a Rust/Go translation. This results in hallucinated syntax, missed dependencies, and complete architectural failure because the AI lacks the *global context* of the application.

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
Critical infrastructure operations are 100% deterministic and written in strict TypeScript. These include:
* Project discovery and file hashing
* Abstract Syntax Tree (AST) parsing
* Dependency resolution
* File storage and database transactions
* System governance and policy enforcement
* Native compiler integration

**These services never rely on probabilistic AI.**

### III. AI as Specialized Workers
AI is utilized strictly as a tool for heuristic reasoning, never as a system controller. Specialized agents are given narrow scopes:
* **Architecture Agent:** Identifies design patterns.
* **Business Logic Agent:** Translates AST nodes into human-readable business rules.
* **Migration Planner:** formulates step-by-step conversion plans.
* **Rust Generator Agent:** Writes idiomatic Rust code based on strict interfaces.

**AI models never have direct write access to the filesystem, security policies, or secret management.**

### IV. Zero Trust & Enterprise Safety
LegacyExodus operates under a Zero Trust architecture:
* Every generated artifact is treated as hostile until validated.
* Output is piped through native compiler checks (e.g., `cargo check`).
* High-risk domains (Authentication, Cryptography, Payments) trigger automatic system halts, requiring explicit cryptographic sign-off from a human engineer before proceeding.

---

## 5. High-Level System Architecture

The pipeline operates as a unidirectional data flow, beginning with raw source code and ending with validated, modern binaries.

    ================================================================================
                               PHASE 0: INGESTION
    ================================================================================
                              [Legacy Source Code]
                                       │
                                       ▼
                             (Discovery Service)
                                       │
    ================================================================================
                               PHASE 1: THE ENGINE
    ================================================================================
                                       ▼
                               (Parser Service)
                                       │
                                       ▼
                            [Knowledge Extraction]
                                       │
                                       ▼
                          [(SQLite Knowledge Graph)]
                                       │
    ================================================================================
                             PHASE 2: ORCHESTRATION
    ================================================================================
                                       ▼
                          [Event-Driven Workflow Bus]
                                       │
                 ┌─────────────────────┼─────────────────────┐
                 ▼                     ▼                     ▼
         [Architecture]         [Business Logic]        [Migration]
            (Agent)                 (Agent)               (Agent)
                 │                     │                     │
                 └─────────────────────┼─────────────────────┘
                                       ▼
    ================================================================================
                               PHASE 3: GENERATION
    ================================================================================
                                       ▼
                            (Rust Generator Agent)
                                       │
                                       ▼
                           (Compiler Validation Gate)
                                       │
                            (Repair Agent Loop) ↺
                                       │
    ================================================================================
                                PHASE 4: DELIVERY
    ================================================================================
                                       ▼
                           [Human Approval (HITL)]
                                       │
                                       ▼
                               [Final ChangeSet]
    ================================================================================

---

## 6. Software Engineering Paradigms

LegacyExodus is designed around battle-tested software engineering patterns to ensure massive scalability and absolute data integrity.

### Domain-Driven Design (DDD)
The system's internal language strictly separates business concepts from infrastructure.
* **The Engine:** Owns the static concepts (`Workspace`, `Project`, `File`, `Symbol`, `CodeSpan`, `Dependency`).
* **The Workflow:** Owns the dynamic processes (`Command`, `Event`, `MigrationTask`, `Approval`, `ChangeSet`).

### Command Query Responsibility Segregation (CQRS)
To prevent agents from corrupting the system state through race conditions, reads and writes are physically separated.
* **Commands (Writes):** Agents emit intents (e.g., `ExtractRuleCommand`). The Orchestrator validates the command against security policies before accepting it.
* **Queries (Reads):** Agents request context from highly optimized, read-only SQLite projections (e.g., `GetDependenciesQuery`).

### Event-Driven Architecture & Event Sourcing
Direct database mutation is prohibited. Every action in LegacyExodus is recorded as an immutable event in an append-only `.jsonl` log.
* If a process crashes at file 99,000 out of 100,000, the system does not restart. It reads the Event Log, rebuilds the exact state projection in milliseconds, and resumes at file 99,001.
* This provides a flawless, cryptographic audit trail for enterprise compliance teams.

### AI Gateway Routing
LegacyExodus does not depend on a single vendor (e.g., OpenAI, Anthropic, or Google). It utilizes an Intelligent AI Router pattern.
* **Lightweight tasks** (AST cleanup, semantic search) are routed to local, offline models (e.g., Ollama running Qwen/Llama) to ensure zero data leakage and zero API costs.
* **Heavy reasoning tasks** (Architecture mapping) are routed to premium cloud models via strict `AIProvider` interfaces.

---

## 7. Major Component Specifications

The repository is modularly divided into deterministic services, orchestrators, and AI layers.

### A. The Engine (Deterministic Services)
The Engine is the absolute source of truth. It executes predictably, rapidly, and without hallucination.

| Service Name | Primary Responsibility | Data Output |
| :--- | :--- | :--- |
| **Discovery Service** | Traverses directories, hashes files, and maps the `Workspace` and `Project` boundaries. Respects `.exodusignore`. | `Project` Entity |
| **Parser Service** | Converts raw text into Language-Agnostic Abstract Syntax Trees (AST). Applies the "Token Diet" to strip noise. | AST JSON |
| **Knowledge Service** | Resolves `Symbols` (functions, classes) and their exact `CodeSpan` locations across multiple files. | `Symbol` Entity |
| **Graph Service** | Builds directed acyclic graphs representing module imports and database calls. | `Dependency` Entity |
| **Storage Service** | Manages SQLite connections, Event Log appending, and file-system read/writes. | Checkpoints |
| **Governance Engine** | Deterministically enforces hard security rules (e.g., blocking `.env` reads). | `Risk` Flags |
| **Compiler Service** | Wraps native toolchains (e.g., Node, Cargo, Rustc) to execute `cargo check` and `cargo test`. | `Diagnostic` Entity |

### B. The Orchestrator (Workflow)
The Orchestrator is the central nervous system. It routes Commands, validates them against the Governance Engine, appends Events, and schedules Tasks.
* **Task Queue:** Manages the backlog of migration workloads, prioritizing based on dependencies (e.g., migrating Auth before Payments).
* **State Projections:** Continuously updates the SQLite database as new events are appended to the log.

### C. The Intelligence Layer (AI Agents)
Agents are stateless, isolated workers. They are spun up, provided a specific slice of the `ProjectState`, and expected to return a Zod-validated JSON response.

| Agent Name | Primary Responsibility | Target Output Schema |
| :--- | :--- | :--- |
| **Architecture Agent** | Maps API routes to database schemas and identifies missing middleware. | `Route` / `Endpoint` |
| **Business Logic Agent** | Translates complex nested loops and conditionals into plain-English rules. | `BusinessRule` |
| **Migration Planner** | Analyzes the Knowledge Graph to formulate safe, step-by-step migration phases. | `MigrationTask` |
| **Rust Generator** | Ingests a `MigrationTask` and outputs idiomatic Rust (`Axum`/`SQLx`) code. | `ChangeSet` |
| **Repair Agent** | Ingests a `Diagnostic` (Compiler error) and the faulty Rust code to generate a fix. | `ChangeSet` (Patch) |
| **Risk Agent** | Analyzes business logic for implied security vulnerabilities (e.g., missing auth checks). | `Risk` |

### D. The Enterprise Dashboard
A frontend UI providing real-time telemetry into the migration process.
* **Visualizes the Knowledge Graph:** Allows engineers to see how their legacy monolith is connected.
* **Approval Gates:** The UI pauses and flashes when a High-Risk task requires human cryptographic approval.
* **Confidence Scoring:** Displays the AI's self-reported confidence metric for every generated `ChangeSet`.

---

## 8. Technology Stack Justification

Every tool in the LegacyExodus stack was chosen for speed, type safety, and local execution capabilities.

* **Runtime:** `Bun`
  * *Why:* Bun offers ultra-fast File I/O, native TypeScript execution without compilation overhead, and a built-in SQLite driver. This is critical for scanning 100,000+ file repositories.
* **Language:** `TypeScript` (Strict Mode)
  * *Why:* Enforces rigorous data contracts. By utilizing `Zod`, we guarantee that malformed AI outputs crash at the boundary layer rather than corrupting the database.
* **Database:** `Better-SQLite3`
  * *Why:* Embedded, local, and ACID-compliant. It prevents Out-Of-Memory (OOM) crashes by offloading the Knowledge Graph to disk while maintaining sub-millisecond query speeds.
* **Event Store:** Flat `.jsonl` files
  * *Why:* Human-readable, append-only, and easily version-controlled.
* **Target Architecture:** `Rust` / `Axum`
  * *Why:* Memory-safe, highly performant, and strictly typed. Rust's compiler acts as our ultimate deterministic validation gate.

  ---

## 9. Repository Directory Structure

LegacyExodus is designed with a massive, comprehensive documentation hub that precedes the core logic implementation. The core engine and dashboard are explicitly isolated for future phases.

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
- [x] Establish Enterprise Repository Metadata.
- [x] Define Domain-Driven Design (DDD) Ubiquitous Language.
- [x] Draft Architecture Decision Records (ADRs 001-007).
- [x] Configure strict TypeScript and testing environments.
- [x] Establish the massive `docs/` knowledge hub.

### Phase 1: The Deterministic Engine (Upcoming)
- [ ] Implement `StorageService` (SQLite scaffolding and Event Log writing).
- [ ] Implement `DiscoveryService` (Directory traversal, file hashing, `.exodusignore`).
- [ ] Validate Engine by parsing a dummy Express.js project into a structured JSON representation without AI.

### Phase 2: Knowledge Extraction (Upcoming)
- [ ] Implement `ParserService` (AST generation via `@babel/parser`).
- [ ] Implement `GraphService` (Resolving dependencies and mapping endpoints).
- [ ] Persist the completed Knowledge Graph to SQLite.

### Phase 3: The Intelligence Layer (Upcoming)
- [ ] Build the `AI Gateway` (Vendor-agnostic routing interface).
- [ ] Implement local embedding support for semantic search.
- [ ] Deploy the `ArchitectureAgent` and `BusinessLogicAgent`.

### Phase 4: Transformation & Validation (Upcoming)
- [ ] Implement the `RustGeneratorAgent`.
- [ ] Build the `CompilerService` (`cargo check` integration).
- [ ] Develop the Self-Healing `RepairAgent` loop.

### Phase 5: Enterprise Controls (Upcoming)
- [ ] Develop the React `legacy-exodus-dashboard`.
- [ ] Implement Human-in-the-loop (HITL) approval gates.
- [ ] Finalize telemetry and metric exporting.

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

    # Run the deterministic Discovery and Knowledge services
    legacy-exodus scan

    # Formulate a migration plan using the Intelligence Layer
    legacy-exodus plan --target=rust-axum

    # Execute the migration with Human-in-the-loop enabled
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
If you discover a vulnerability—especially sandbox escapes, prompt injection risks, or event-log corruption vectors—**do not open a public issue.** 

Please refer to our [SECURITY.md](SECURITY.md) file for responsible disclosure protocols. 

---

## 14. License

This project is licensed under the **MIT License**. 

By contributing to LegacyExodus, you agree that your contributions will be licensed under its MIT License. See the [LICENSE](LICENSE) file for complete details.

**Built for the future of software engineering.**
