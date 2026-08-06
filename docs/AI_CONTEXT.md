# AI Context: LegacyExodus

## Repository Identity
**Name:** LegacyExodus  
**Type:** Enterprise knowledge-first autonomous software modernization platform.  
**Core Goal:** Safely transform fragile legacy systems into modern, maintainable, memory-safe architectures through deterministic understanding and governed transformation.

## Mission and Non-Goals
LegacyExodus is built to modernize legacy software by reconstructing system knowledge before generation.

It is explicitly:
- **Not** a transpiler
- **Not** a naive AST-to-AST converter
- **Not** a direct LLM wrapper

Guiding philosophy:

> Understand deterministically first. Transform probabilistically second. Verify cryptographically always.

## Foundational Problem Framing
Legacy systems contain hidden operational and business semantics (“dark matter”) that syntax-only conversion cannot preserve:
- implicit business rules
- hidden dependency and boundary assumptions
- trust/security expectations
- transaction and rollback behaviors

Therefore, safe modernization requires deterministic discovery and semantic reconstruction before generation.

## Immutable Architectural Axioms
1. **Knowledge Before Generation**  
   Deterministic understanding is prerequisite; code generation is downstream.
2. **Deterministic Core, Probabilistic Periphery**  
   Critical infra is deterministic; AI is bounded to non-core transformation layers.
3. **Strict CQRS**  
   Services/agents emit commands; orchestrator validates and appends events.
4. **Domain-Driven Separation**  
   Clear separation between static Engine domain and dynamic Workflow domain.
5. **Zero Trust AI**  
   AI input/output is untrusted until schema validated and compiler verified.
6. **Human-in-the-Loop**  
   High-risk transformations require explicit human approval gates.

## Four-Stage Modernization Pipeline
### 1) VyrixScout — Legacy Intelligence Discovery Engine
- Deterministic reconnaissance
- File traversal, hashing, framework/language detection, boundary mapping
- Produces structured system inventory

### 2) NolaraStruct — Knowledge Reconstruction Engine
- Semantic elevation of discovered systems
- AST parsing, symbol extraction, dependency DAG creation, domain abstraction
- Produces UIR / Knowledge Graph

### 3) ZelvoxForge — Modernization Generation Engine
- Safe transformation planning and generation
- Coordinates AI agents for Rust/Axum and tests
- **Constraint:** agents consume Knowledge Graph outputs, not raw legacy files

### 4) VymosGate — Verification & Governance Gateway
- Deterministic trust validation
- Compilation, tests, security checks, confidence scoring, approval gating
- **Constraint:** modernization loop only closes on zero-exit deterministic compiler verification

## Technology Baselines
### Core Backend Engine
- Bun
- Strict TypeScript
- Zod
- Better-SQLite3

### Frontend
- React
- TypeScript
- Vite
- Tailwind CSS

### Target Modernized Output
- Rust
- Axum
- SQLx

## Operational Directives for AI/Copilot Behavior
1. Enforce deterministic methods in discovery/reconstruction stages; avoid LLM shortcuts for core understanding.
2. Protect event sourcing integrity; prefer command validation + event append over direct state mutation.
3. Validate all AI interfaces through strict schemas (Zod); reject/repair invalid payloads.
4. Preserve traceability from generated output to source symbols (CodeSpan lineage).
5. Keep architecture modular via plugin interfaces (parsers, targets, AI providers).

## Documentation & Governance Standards
- Use precise, engineering-first language.
- Explain purpose, trade-offs, failure modes, and recovery paths.
- Use ADRs for state model, domain entity, or event schema changes.

## AI Working Mindset
The AI assistant acts as an architecture guardian:
- prioritize deterministic safety over speed
- resist shortcuts that bypass CQRS/event-sourcing/verification
- preserve architectural vision while enabling practical execution
