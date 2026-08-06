# LegacyExodus AI Context

## Purpose of This Document

This document provides the foundational context required for AI assistants working with the LegacyExodus project.

It defines:

- Project identity
- Architectural philosophy
- Core concepts
- Engineering principles
- Naming conventions
- Decision-making rules
- Documentation expectations
- Development boundaries

AI assistants MUST understand this document before suggesting:

- Architecture changes
- Code implementations
- New features
- Refactoring strategies
- Documentation updates
- Technology decisions

This document acts as the AI-readable foundation layer of LegacyExodus.

---

# 1. Project Identity

## Project Name

LegacyExodus

## Project Category

AI-powered legacy modernization platform.

## Core Mission

LegacyExodus transforms complex legacy software systems into modern, secure, maintainable, and scalable architectures through intelligent analysis, knowledge modeling, AI-assisted transformation, and governed validation.

---

# 2. What LegacyExodus Is

LegacyExodus is a modernization intelligence platform.

It is designed to understand existing software systems before attempting transformation.

The system does NOT:

- blindly translate code
- perform syntax replacement
- generate code without understanding context
- remove humans from critical decisions

Instead, LegacyExodus follows:

```
Understand
    ↓
Model
    ↓
Transform
    ↓
Validate
    ↓
Approve
```

The platform treats legacy systems as sources of valuable knowledge.

The objective is not to replace the old system quickly.

The objective is to safely evolve the system while preserving business capability.

---

# 3. Core Philosophy

## Knowledge First

The most important principle of LegacyExodus.

No transformation should happen before sufficient understanding exists.

The system must first discover:

- What the system contains
- How components interact
- Where business logic exists
- What dependencies exist
- Which behaviors are critical
- What risks exist

Only after creating system intelligence should transformation begin.

---

## Human-Governed AI

AI provides intelligence and acceleration.

Humans provide:

- accountability
- approval
- architectural judgment
- business understanding

AI suggestions must be:

- explainable
- traceable
- reviewable

Critical migration decisions require human approval.

---

## Event-Driven Thinking

LegacyExodus is designed around observable events.

Important operations should produce events.

Examples:

```
FileDiscovered

DependencyMapped

ASTGenerated

KnowledgeModelCreated

AgentCompleted

MigrationValidated

MigrationApproved
```

Events provide:

- traceability
- debugging capability
- audit history
- reproducibility
- system observability

---

## Modular Architecture

LegacyExodus components must have:

- clear responsibilities
- explicit boundaries
- stable contracts

Avoid:

- tightly coupled services
- hidden dependencies
- unclear ownership

---

## Safe Migration Over Fast Migration

Speed is valuable.

Trust is mandatory.

The system optimizes for:

- correctness
- maintainability
- security
- transparency
- enterprise confidence

Generated code quantity is NOT a success metric.

Successful modernization is the goal.

---

# 4. Migration Pipeline

LegacyExodus uses four primary stages.

```
Legacy System

      ↓

VyrixScout

      ↓

NolaraStruct

      ↓

ZelvoxForge

      ↓

VymosGate

      ↓

Modern System
```

---

# 5. Pipeline Stage Context

# VyrixScout

## Role

Discovery and observation stage.

## Responsibility

Understand the existing system.

## Performs:

- repository scanning
- file discovery
- language detection
- framework detection
- dependency analysis
- metadata extraction

## Output

A factual representation of the existing system.

VyrixScout answers:

"What exists?"

---

# NolaraStruct

## Role

Knowledge and intelligence stage.

## Responsibility

Convert discovered information into structured understanding.

## Performs:

- AST analysis
- symbol extraction
- relationship mapping
- dependency graphs
- knowledge graph generation
- domain modeling

## Output

System intelligence model.

NolaraStruct answers:

"How does this system work?"

---

# ZelvoxForge

## Role

Transformation stage.

## Responsibility

Generate modern implementations from verified understanding.

## Performs:

- architecture transformation
- AI-assisted generation
- Rust migration planning
- service creation
- modernization strategies

## Output

Modernization artifacts.

ZelvoxForge answers:

"How should this system evolve?"

---

# VymosGate

## Role

Governance and validation stage.

## Responsibility

Ensure safe migration outcomes.

## Performs:

- testing
- validation
- security checks
- policy evaluation
- human approval workflows

## Output

Migration confidence and approval decision.

VymosGate answers:

"Is this safe to release?"

---

# 6. Architectural Model

LegacyExodus follows:

```
Knowledge Layer

        ↓

Decision Layer

        ↓

Transformation Layer

        ↓

Validation Layer
```

Important architectural concepts:

- Project State
- Event System
- Knowledge Graph
- Multi-Agent System
- Plugin Architecture
- AI Gateway
- Governance Engine

---

# 7. AI Agent Rules

When generating suggestions, AI assistants must:

## Understand First

Before proposing changes:

Read:

- PROJECT_CONTEXT.md
- GLOSSARY.md
- DOCUMENTATION_RULES.md
- relevant architecture documents


---

## Respect Existing Decisions

Do not introduce:

- random frameworks
- unnecessary dependencies
- conflicting architecture patterns

Always check:

```
docs/adr/
docs/decisions/
```

before suggesting major changes.

---

## Prefer Explicit Reasoning

Good:

"Use an event contract because multiple pipeline stages require independent evolution."

Bad:

"Use events because they are popular."

---

## Preserve Traceability

Every important generated artifact should have:

- source relationship
- reasoning
- decision context
- validation status

---

# 8. Technology Context

## Core Engine

Primary language:

```
TypeScript
```

Runtime:

```
Bun
```

Reasons:

- fast development
- strong ecosystem
- AI integration support
- developer productivity


---

## Frontend

Technology:

```
React
TypeScript
Vite
Tailwind CSS
```

Purpose:

Provide operational visibility into:

- migration progress
- system graphs
- AI decisions
- validation status

---

## Migration Target

Primary target:

```
Rust
```

Reasons:

- memory safety
- performance
- reliability
- strong type system
- enterprise suitability


Common Rust ecosystem:

```
Tokio
Axum
SQLx
```

---

# 9. Naming Rules

Pipeline names describe responsibilities.

## VyrixScout

Meaning:

Scout = discover and observe.

---

## NolaraStruct

Meaning:

Structure = organize and model knowledge.

---

## ZelvoxForge

Meaning:

Forge = create and transform.

---

## VymosGate

Meaning:

Gate = control progression.

---

# 10. Documentation Rules For AI

AI assistants must:

- use existing terminology
- follow documentation structure
- avoid creating unnecessary files
- update related documentation when needed
- respect architecture decisions

Documentation hierarchy:

```
AI_CONTEXT.md

        ↓

PROJECT_CONTEXT.md

        ↓

GLOSSARY.md

        ↓

Architecture Documents

        ↓

Implementation Documents
```

---

# 11. Coding Principles

AI-generated code should prioritize:

## Maintainability

Code should be understandable by future contributors.

## Explicit Design

Avoid hidden behavior.

## Strong Boundaries

Components should communicate through contracts.

## Testing

Important behavior requires verification.

## Security

Security is a default requirement.

---

# 12. Things AI Must Avoid

Do NOT:

- rewrite architecture without approval
- introduce unnecessary complexity
- create duplicate documentation
- ignore existing ADR decisions
- assume migration means translation
- generate code without understanding context
- optimize only for speed

---

# 13. Decision Framework

When suggesting a change, evaluate:

## Does it improve understanding?

## Does it preserve architecture boundaries?

## Does it improve reliability?

## Does it maintain traceability?

## Does it reduce migration risk?

If not, reconsider the proposal.

---

# 14. AI Assistant Identity

When working on LegacyExodus, AI assistants should behave as:

- Senior Software Architect
- Rust Migration Specialist
- AI Systems Engineer
- Enterprise Documentation Engineer

The assistant should think long-term.

Do not optimize only for the current task.

Consider:

- scalability
- maintainability
- future contributors
- enterprise adoption

---

# 15. Final Principle

The central rule of LegacyExodus:

```
Understand deeply.

Transform responsibly.

Validate continuously.

Trust completely.
```

Every architectural decision, generated artifact, and AI suggestion should support this principle.
