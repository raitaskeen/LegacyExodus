# LegacyExodus Documentation Rules  
## Documentation Governance System

## 1) Purpose of Documentation Governance

Documentation governance exists to ensure that LegacyExodus knowledge remains durable, accurate, and operationally useful across time, teams, and tooling.

In LegacyExodus, documentation is not optional project decoration. It is a core engineering artifact that:

- prevents architectural and domain knowledge loss
- maintains cross-module and cross-stage consistency
- enables reliable collaboration between contributors
- allows AI systems to reason from stable context
- supports enterprise adoption, audits, and long-term maintenance

LegacyExodus is a knowledge-first modernization platform. Therefore, any undocumented critical design effectively behaves as hidden system state. Hidden state creates risk. Documentation governance reduces that risk by making architectural intent explicit, reviewable, and evolvable.

**Principle:** Documentation is part of the product surface and must be engineered with the same rigor as code.

---

## 2) Documentation Philosophy

### 2.1 Documentation Before Complexity

Important architecture and workflow decisions must be documented before implementation becomes deeply coupled or difficult to reverse.

Required sequence for non-trivial work:

**Design → Document → Implement → Review**

This sequence ensures:

- intent is explicit before code hardens assumptions
- reviewers evaluate decisions, not only code style
- future maintainers can distinguish deliberate design from accidental behavior

### 2.2 Documentation as Knowledge Preservation

LegacyExodus documentation must preserve:

- decisions that shaped the system
- reasoning behind those decisions
- expected system behavior
- architectural intent and boundaries
- explicit tradeoffs and rejected paths

If an expert leaves the project, documentation must retain enough context for a new engineer to reconstruct why the current architecture exists.

### 2.3 Documentation Must Explain WHY

Documentation that only describes **what exists** is incomplete.

Every major document must explain:

- why this component exists
- why this approach was selected
- what alternatives were considered
- why alternatives were rejected

“Why” is mandatory for architecture-level clarity, governance quality, and safe modernization.

---

## 3) Documentation Categories

### 3.1 Project Documentation  
**Location:** `docs/`  
**Purpose:** High-level orientation for project mission, scope, principles, and contributor onboarding.

Typical files include:

- `README.md`
- `PROJECT_CONTEXT.md`
- `GLOSSARY.md`

Project documentation must answer:

- what LegacyExodus is
- what it is not
- how the platform is organized
- where to find authoritative details

---

### 3.2 Architecture Documentation  
**Location:** `docs/architecture/`  
**Purpose:** Describe system design, boundaries, and runtime relationships.

Typical files include:

- `system-overview.md`
- `component-map.md`
- `runtime-architecture.md`
- `security-architecture.md`

Each architecture document should cover:

- component responsibility
- explicit boundaries and ownership
- interaction patterns and contracts
- data flow and control flow
- key design decisions
- tradeoffs and constraints

---

### 3.3 Architecture Decision Records (ADR)  
**Location:** `docs/adr/`  
**Purpose:** Capture irreversible or high-impact decisions with full context.

Every major decision must include:

1. Problem  
2. Context  
3. Options considered  
4. Decision  
5. Consequences

Examples requiring ADR coverage:

- storage model decisions
- event architecture and CQRS boundaries
- AI gateway and trust-boundary design
- plugin/runtime extension model

If a change modifies an existing major decision, update the prior ADR or add a superseding ADR.

---

### 3.4 Domain Documentation  
**Location:** `docs/domain/`  
**Purpose:** Define business and system concepts independent of implementation details.

Must include, where applicable:

- entities
- aggregates
- workflows
- domain events
- invariants
- canonical terminology

Domain documentation must remain consistent with DDD separation between Engine and Workflow contexts.

---

### 3.5 Implementation Documentation  
**Location:** `docs/implementation/`  
**Purpose:** Explain how system behavior is realized in code and modules.

Should include:

- service responsibilities
- module boundaries
- internal architecture patterns
- integration contracts
- deterministic vs probabilistic separation points

Implementation docs must never contradict architecture docs or ADRs.

---

### 3.6 Pipeline Documentation  
**Location:** `docs/pipeline/`  
**Purpose:** Document stage isolation and end-to-end modernization flow.

Must explicitly cover:

- **VyrixScout** (discovery and inventory)
- **NolaraStruct** (knowledge reconstruction)
- **ZelvoxForge** (transformation and generation)
- **VymosGate** (validation and assurance)

Pipeline docs must preserve stage responsibilities and non-overlap constraints.

---

### 3.7 Security Documentation  
**Location:** `docs/security/`  
**Purpose:** Define security expectations for platform operation and enterprise usage.

Must cover:

- AI trust boundaries and sanitization rules
- handling of untrusted source code and generated code
- secrets management and credential boundaries
- compliance and governance considerations
- secure usage patterns for enterprise environments

Security documentation is mandatory for any feature that introduces new data paths, execution paths, or model interaction surfaces.

---

## 4) Required Document Structure

Major technical documents should use the following template:

```md
# Title

## Overview
Explain what this document covers.

## Purpose
Why this component or concept exists.

## Responsibilities
What it owns.

## Architecture
How it works.

## Data Flow
How information moves.

## Dependencies
What it relies on.

## Design Decisions
Important choices.

## Failure Handling
What happens when things fail.

## Security Considerations
Security implications.

## Future Evolution
Possible improvements.
```

Not every document requires every section; however, major architecture, pipeline, domain, and security documents should follow this structure unless there is a clear reason not to.

If a section is intentionally omitted, the omission should be obvious and justified by document scope.

---

## 5) Writing Standards

### 5.1 Clarity

Documentation must be understandable by:

- new contributors
- cross-functional reviewers
- maintainers operating months later
- AI assistants using docs as context

Avoid:

- unnecessary complexity
- vague statements
- unexplained terms
- ambiguous ownership language

Prefer explicit, observable descriptions.

---

### 5.2 Precision

Avoid generic phrasing such as:

> “The system handles things automatically.”

Prefer precise statements such as:

> “The orchestrator receives `MigrationRequested` events and schedules transformation agents.”

Precision is required for testability, reviewability, and safe evolution.

---

### 5.3 Consistency

Use canonical naming and never casually rename core concepts.

Required canonical terms include:

- **VyrixScout**
- **NolaraStruct**
- **ZelvoxForge**
- **VymosGate**

Also preserve consistency for:

- CQRS terminology (`Command`, `Event`, immutable log)
- DDD context terms (Engine vs Workflow)
- trust-boundary terms (deterministic core vs probabilistic periphery)

---

## 6) Technical Documentation Rules

### 6.1 Code Examples

Code examples must:

- be realistic and representative of actual system patterns
- explain only relevant complexity
- include annotations where intent may be misread
- align with current architecture and naming

Do not include contrived examples that conflict with real system behavior.

---

### 6.2 Diagrams

Use diagrams when textual explanation is insufficient for architecture comprehension.

Preferred format:

- **Mermaid**

Recommended diagram types:

- sequence diagrams
- component diagrams
- data flow diagrams
- boundary/trust-zone diagrams

Diagrams must match written descriptions and be updated with architecture changes.

---

### 6.3 References and Linking

Documents should link related artifacts, including:

- relevant ADRs
- architecture documents
- implementation documents
- security decisions
- pipeline stage docs

Cross-linking is mandatory when a document depends on assumptions defined elsewhere.

---

## 7) AI-Generated Documentation Rules

LegacyExodus uses AI heavily, but AI output is draft material until validated.

AI-generated documentation must:

- be reviewed by human owners before approval
- avoid invented components, stages, or flows
- verify technical claims against repository truth
- reference existing ADRs and architecture sources
- preserve canonical terminology and naming
- declare uncertainty rather than fabricate detail

AI may assist writing velocity. AI may not become an unreviewed source of truth.

---

## 8) Documentation Review Process

### 8.1 Draft Stage  
**Location:** `docs/drafts/ai-generated/`  
Use for generated, exploratory, or unverified documentation.

### 8.2 Human Review Stage  
**Location:** `docs/drafts/human-review/`  
Architecture owners and domain reviewers validate correctness, consistency, and alignment.

### 8.3 Approved Stage  
Approved documents are moved into official documentation locations (for example `docs/architecture/`, `docs/domain/`, `docs/security/`, etc.).

### 8.4 Rejected Stage  
Rejected drafts are retained for historical reference when useful for auditability and decision traceability.

No AI-generated draft may bypass human review for architecture-impacting documentation.

---

## 9) Versioning and Change Management

Documentation must evolve with the code and architecture it describes.

When major architecture changes occur, required actions include:

1. update or add ADR(s)  
2. update all affected documentation  
3. complete review before merge

Documentation commits must use meaningful messages.

Good examples:

- `Document event-driven orchestration model`
- `Add ADR for AI gateway trust-boundary design`
- `Update NolaraStruct DAG documentation for new dependency classifier`

Bad example:

- `Update docs`

If behavior changed and docs did not, the change is incomplete.

---

## 10) Documentation Ownership

Documentation ownership is role-based and explicit.

- **Architects** own architecture and ADR quality.
- **Developers** maintain implementation-level documentation.
- **Security reviewers** maintain security guidance and compliance-aligned artifacts.
- **Contributors** follow governance rules and keep touched docs current.
- **AI assistants** generate draft content that conforms to this policy.

Ownership does not prevent collaboration; it defines accountability for correctness.

---

## 11) Documentation Quality Checklist

Before merging documentation, confirm all applicable items:

- [ ] Is the purpose clear?
- [ ] Is terminology canonical and consistent?
- [ ] Does the document explain **why**, not only **what**?
- [ ] Are architecture boundaries and responsibilities explicit?
- [ ] Are diagrams included where complexity warrants visual explanation?
- [ ] Are related ADRs and documents linked?
- [ ] Does the content match the current implementation and architecture?
- [ ] Have appropriate human reviewers approved it?

Merge readiness requires affirmative answers for relevant checklist items.

---

## 12) Documentation Anti-Patterns

### 12.1 Writing Without Context

Bad:

> “This service handles migration.”

Good:

> “This service orchestrates migration workflows by coordinating agents through event-based communication.”

Context transforms statements from superficial description into usable engineering knowledge.

---

### 12.2 Documentation Drift

If implementation evolves but documentation does not, documentation becomes misleading.

To prevent drift:

- update docs in the same PR as behavior changes whenever possible
- block merges for architecture-impacting changes without doc updates
- periodically audit core documents against current system behavior

---

### 12.3 Over-Documentation

Avoid documenting trivial or self-evident implementation details that provide little long-term value.

Prioritize documenting:

- decisions
- architecture
- behavior
- invariants
- tradeoffs
- reasoning

Signal-to-noise ratio matters. High-value documentation is curated, not verbose by default.

---

## 13) AI Assistant Instructions

When generating documentation for LegacyExodus, AI assistants must:

1. Read `PROJECT_CONTEXT.md`.
2. Read relevant architecture documents under `docs/architecture/`.
3. Review relevant ADRs under `docs/adr/`.
4. Align with existing domain terminology.
5. Preserve deterministic-core and zero-trust principles.
6. Avoid introducing undocumented architecture assumptions.
7. Ask clarifying questions if architectural intent is ambiguous.

AI assistants should optimize for architectural fidelity, not stylistic novelty.

---

## 14) Final Documentation Principle

LegacyExodus documentation exists to preserve intelligence.

The code explains **what** the system does.  
The documentation explains **why** the system exists.

Sustainable modernization requires both.
