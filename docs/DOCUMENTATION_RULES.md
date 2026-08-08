# LegacyExodus AI Context
## AI Assistant Operating Manual

## 1) Purpose

This document defines the canonical operating context for AI assistants contributing to LegacyExodus.

LegacyExodus is an architecture-governed modernization platform. Contributions cannot be treated as isolated file edits. Every technical decision can impact:

- migration safety
- intelligence fidelity
- enterprise trust
- governance boundaries
- long-term maintainability

AI assistants must treat this document as foundational, not optional reference material.

---

## 2) What LegacyExodus Is

LegacyExodus is a knowledge-first modernization intelligence platform for transforming complex legacy systems into modern, secure, maintainable architectures while preserving business behavior.

LegacyExodus is **not** a direct code translation tool.

It does **not** follow:

```text
Legacy Code
   -> AI Translation
   -> Modern Code
```

It follows:

```text
Legacy System
   -> System Discovery
   -> Knowledge Reconstruction
   -> Architectural Understanding
   -> Controlled Transformation
   -> Validation & Governance
   -> Modern System
```

Foundational belief:

> A system must be understood before it can be safely transformed.

---

## 3) Core Philosophy

All AI-assisted contributions must align with these principles.

### 3.1 Knowledge Before Generation

LegacyExodus prioritizes understanding before transformation.

AI assistants must not recommend “analyze one file then generate replacement” workflows without producing understanding artifacts first.

Required reasoning sequence:

```text
Source Code
   -> Discovery
   -> Structural Analysis
   -> Dependency Mapping
   -> Domain Understanding
   -> Transformation Planning
   -> Generation
   -> Validation
```

Generation must be evidence-backed, not assumption-driven.

### 3.2 Human-Governed AI

AI accelerates engineering work; it is not final authority.

LegacyExodus must preserve:

- human review
- approval checkpoints
- audit trails
- decision visibility
- rollback paths

Critical transformations must never execute silently.

Correct governance flow:

```text
AI identifies opportunity
   -> proposal
   -> supporting evidence
   -> human approval
   -> controlled execution
```

### 3.3 Deterministic Core, Probabilistic Periphery

LegacyExodus separates deterministic correctness from probabilistic assistance.

**Deterministic Core owns:**

- filesystem and repository processing
- parsing and structural extraction
- graph/state construction
- storage and event handling
- contract validation
- security and policy checks

**Probabilistic Periphery supports:**

- semantic reasoning
- architecture suggestions
- generation assistance
- modernization alternatives

AI output is always untrusted until validated by deterministic systems.

---

## 4) Pipeline Model (Four-Stage Isolation)

LegacyExodus is a strict four-stage pipeline:

```text
VyrixScout -> NolaraStruct -> ZelvoxForge -> VymosGate
```

Each stage has explicit boundaries and must not collapse responsibilities.

### 4.1 VyrixScout — Discovery

**Question answered:** What exists?

Responsibilities:

- repository scanning
- language and framework detection
- dependency extraction
- configuration discovery
- source metadata collection

Input: legacy codebases  
Output: discovery artifacts (files, symbols, dependencies, metadata, initial relationships)

VyrixScout observes and inventories. It does not redesign.

### 4.2 NolaraStruct — Knowledge Reconstruction

**Question answered:** What does the system mean?

Responsibilities:

- AST analysis
- symbol relationship modeling
- dependency graph construction
- domain inference
- architecture interpretation
- knowledge graph generation

Input: VyrixScout artifacts  
Output: System Intelligence Model (knowledge foundation for transformation)

### 4.3 ZelvoxForge — Controlled Transformation

**Question answered:** How should this become modern?

Responsibilities:

- target architecture planning
- AI-assisted modernization generation
- Rust-oriented implementation generation
- interface redesign
- migration strategy execution

Input: NolaraStruct intelligence  
Output: modernization artifacts (services, modules, APIs, migration plans)

ZelvoxForge must not generate in the absence of validated understanding context.

### 4.4 VymosGate — Validation & Governance

**Question answered:** Is this safe?

Responsibilities:

- behavioral validation
- security verification
- compliance checks
- testing and assurance
- governance decision workflows

Input: generated artifacts  
Output: confidence decision

Outcomes:

- approved
- rejected
- requires review
- requires additional evidence

---

## 5) Architectural Mental Model

LegacyExodus is a coordinated system of intelligence, transformation, and governance:

```text
LegacyExodus
   -> Intelligence
   -> Transformation
   -> Governance

Discovery -> Knowledge -> Generation -> Validation
```

It is not an AI wrapper. It is an engineering system with AI as a constrained capability.

---

## 6) Architecture Principles

### 6.1 Event-Driven Design

Key actions emit events to create traceability and replayable system history.

Example event types:

- `FileDiscovered`
- `DependencyMapped`
- `ASTGenerated`
- `KnowledgeUpdated`
- `MigrationGenerated`
- `ValidationCompleted`

Event discipline provides:

- observability
- auditability
- debuggability
- replayability
- loose coupling

### 6.2 Modular Boundaries

Major components should remain explicitly bounded:

- Core Engine
- Orchestrator
- Discovery Service
- Parser Service
- Graph Service
- Knowledge Service
- AI Gateway
- Compiler Service
- Storage Service
- Governance Engine

Each component must have clear ownership and contracts.

### 6.3 Plugin-Based Extensibility

LegacyExodus must scale without core rewrites.

Extension surfaces include:

- parser plugins
- migration strategy plugins
- validation rule plugins
- AI provider adapters
- storage adapters

---

## 7) AI Assistant Reasoning Rules

### 7.1 Before Writing Code

AI assistants must determine:

1. Why does this component exist?
2. Which architectural boundary owns it?
3. What problem does it solve?
4. Which contracts or invariants can it impact?
5. Which documentation artifacts must be updated?

### 7.2 Before Suggesting Improvements

Assess:

- architecture impact
- security impact
- migration safety impact
- maintainability impact
- compatibility impact

Do not optimize exclusively for:

- fewer lines of code
- fastest implementation path
- trend-based technology adoption

---

## 8) Prohibited AI Behaviors

AI assistants must never:

- invent undocumented platform components
- rename canonical stages or concepts
- bypass governance or approval requirements
- remove human review checkpoints
- reduce modernization to direct translation
- assume generated code correctness without validation
- ignore ADR decisions
- introduce architecture changes without rationale and traceability

---

## 9) Canonical Vocabulary

The following names are mandatory and must be used exactly:

```text
VyrixScout
NolaraStruct
ZelvoxForge
VymosGate
```

Do not introduce alternate spellings or “friendly” variants.

---

## 10) Target Technology Direction

### 10.1 Core Platform

Preferred:

- TypeScript
- Bun runtime

Rationale:

- development velocity
- tooling maturity
- ecosystem leverage
- AI integration practicality

### 10.2 Frontend

Preferred:

- React
- TypeScript
- Vite
- Tailwind CSS

Purpose: visualization, review, and operational control interfaces.

### 10.3 Migration Target Stack

Primary target language: Rust

Preferred ecosystem:

- Axum
- Tokio
- SQLx

Rationale:

- memory safety
- performance
- reliability
- strong correctness characteristics

---

## 11) Documentation Authority Model

AI assistants must follow this hierarchy when documents conflict:

1. ADR decisions
2. Architecture documentation
3. Project context documentation
4. Implementation documentation

Expected context chain:

```text
AI_CONTEXT.md
   -> PROJECT_CONTEXT.md
   -> docs/architecture/*
   -> docs/adr/*
   -> docs/implementation/*
```

---

## 12) Contribution Standard for AI

AI contributions should reflect the quality bar of:

- principal software architecture
- distributed systems engineering
- modernization safety engineering
- secure systems design

Before finalizing any output, ask:

> Does this change move LegacyExodus toward becoming a trustworthy autonomous modernization platform?

---

## 13) Final Principle

Legacy systems are not only code; they are accumulated business intelligence.

LegacyExodus exists to preserve and modernize that intelligence safely.

The mission is not:

> “Convert old code to new code.”

The mission is:

> “Understand legacy systems deeply, preserve their intelligence, and evolve them into secure future architectures.”

Operating axiom:

```text
Understand First.
Transform Second.
Validate Always.
```
