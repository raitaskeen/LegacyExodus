# LegacyExodus Documentation

Welcome to the LegacyExodus documentation hub. This directory is the authoritative knowledge base for the platform’s architecture, engineering practices, operational model, product context, and governance standards. It is designed to help engineers, architects, operators, contributors, and AI assistants understand *what LegacyExodus is, how it works, why decisions were made, and how to evolve it safely*.

---

## Documentation Philosophy

LegacyExodus treats documentation as an engineering asset, not a side artifact.

- Documentation is part of architecture.
- Decisions must be recorded.
- Knowledge must survive team changes.
- AI systems require structured context.
- Complex migration systems require traceability.

**Documentation is the memory layer of LegacyExodus.**

As an AI-powered legacy modernization platform, LegacyExodus depends on accurate, durable, and structured documentation to preserve system intelligence across the full migration lifecycle: discovery, modeling, transformation, and governance.

---

## Documentation Goals

### 1) Architecture Understanding

Enable engineers and architects to understand:

- System boundaries
- Component responsibilities
- Runtime behavior
- Design rationale
- Tradeoffs and constraints

### 2) Development Enablement

Provide contributors with practical guidance to:

- Implement features consistently
- Follow standards
- Integrate safely
- Test effectively
- Release with confidence

### 3) AI Context

Provide structured, machine-consumable context so AI coding assistants can:

- Understand domain language
- Respect architectural intent
- Navigate contracts and dependencies
- Generate changes aligned with project rules

### 4) Enterprise Trust

Support transparency and governance through:

- Decision traceability
- Security clarity
- Review records
- Audit-ready documentation
- Operational accountability

---

## LegacyExodus Migration Pipeline Context

LegacyExodus follows a knowledge-first modernization pipeline:

**Understand what exists → Build system intelligence → Plan transformation → Generate modern architecture → Validate through governance**

The four major stages are:

1. **VyrixScout** — discovery and observation  
2. **NolaraStruct** — knowledge and intelligence  
3. **ZelvoxForge** — transformation and generation  
4. **VymosGate** — governance and validation  

Documentation in this repository is organized to support that pipeline end-to-end.

---

## Documentation Organization

This section is the source-of-truth navigation map for `docs/`.

For each directory, we define:

- Purpose in the LegacyExodus ecosystem
- What belongs there
- Primary users
- When to update

---

### `adr/`

**Purpose**  
Architecture Decision Records (ADRs) capturing significant architectural choices and rationale.

**Contains**  
Decisions related to:

- Project state architecture
- Event system design
- Plugin architecture
- AI gateway strategy
- Storage decisions
- Security decisions
- Migration pipeline decisions

**Used by**  
Architects, senior engineers, reviewers.

**Update when**  
A significant architecture decision is made, revised, superseded, or deprecated.

---

### `api/`

**Purpose**  
Defines communication and interface boundaries between components.

**Contains**

- Command contracts
- Event contracts
- Query contracts
- Plugin APIs
- AI agent APIs

**Used by**  
Backend developers, integration developers, plugin authors.

**Update when**  
Any component interface, contract schema, or integration boundary changes.

---

### `architecture/`

**Purpose**  
Describes how LegacyExodus is structured at high and detailed levels.

**Contains**

- System overview
- Runtime architecture
- Component architecture
- Communication patterns
- Deployment architecture
- AI architecture
- Security architecture
- Scalability plans

**Includes**

#### `architecture/components/`

Detailed service-level documentation (for example):

- Orchestrator
- Parser Service
- Discovery Service
- Graph Service
- Knowledge Service
- AI Gateway
- Compiler Service
- Storage Service
- Governance Engine

#### `architecture/stages/`

Stage-level architecture docs for:

- VyrixScout
- NolaraStruct
- ZelvoxForge
- VymosGate

**Used by**  
Architects, developers, AI assistants.

**Update when**  
System structure, service boundaries, runtime behavior, or stage architecture changes.

---

### `community/`

**Purpose**  
Defines contributor culture and collaboration norms.

**Contains**

- Community guidelines
- Code of conduct
- Contribution expectations
- Community roadmap

**Used by**  
Contributors and open-source participants.

**Update when**  
Community processes, behavioral expectations, or participation policies evolve.

---

### `decisions/`

**Purpose**  
Records technology and implementation-level decision rationale.

**Contains**

- Runtime decisions
- Database decisions
- AI decisions
- Architecture decisions
- Technology decisions

**Used by**  
Developers and maintainers.

**Update when**  
Engineering choices are introduced, replaced, or materially changed.

---

### `development/`

**Purpose**  
Guides daily engineering workflow for contributors.

**Contains**

- Development setup
- Coding standards
- Testing strategy
- CI/CD strategy
- Release process
- Git workflow

**Includes**

#### `development/cli/`

CLI development documentation:

- Commands
- Configuration
- Plugins
- Troubleshooting

#### `development/testing/`

Testing strategy documentation:

- Unit testing
- Integration testing
- Migration testing
- Compiler testing
- AI evaluation

**Used by**  
Engineers and contributors implementing or maintaining features.

**Update when**  
Development workflows, standards, pipelines, or testing practices change.

---

### `diagrams/`

**Purpose**  
Provides visual understanding of complex architecture and flows.

**Contains**

- System architecture diagrams
- Event flow diagrams
- Deployment diagrams
- Migration pipeline diagrams
- Component interaction diagrams

**Used by**  
Architects, new contributors, stakeholders.

**Update when**  
Architectural or operational flows change and visuals no longer match reality.

---

### `domain/`

**Purpose**  
Documents the conceptual and business model of LegacyExodus.

**Contains**

- Domain entities
- Aggregates
- Value objects
- Domain events
- Knowledge graph concepts
- Business rules
- State models
- Workflows

**Used by**  
Domain architects, AI agents, engineers.

**Update when**  
Domain language, business rules, knowledge model structure, or workflow semantics evolve.

---

### `guides/`

**Purpose**  
Provides practical, role-focused onboarding and usage guidance.

**Contains**

- Developer guide
- Contributor guide
- Architecture guide
- Documentation writing guide

**Used by**  
New and existing contributors across engineering roles.

**Update when**  
Onboarding flow, contribution expectations, or recommended practices are revised.

---

### `implementation/`

**Purpose**  
Explains internal technical implementation approaches.

**Contains**

- Core engine design
- Event system implementation
- Parser strategy
- Plugin system
- Knowledge graph implementation
- Storage layer
- Compiler integration
- AI agent system

**Used by**  
Developers implementing deep technical features.

**Update when**  
Internal engineering mechanisms or implementation patterns change.

---

### `integrations/`

**Purpose**  
Documents external ecosystem integrations.

**Contains**

#### `integrations/ai-providers/`

- OpenAI
- Anthropic
- Local models

#### `integrations/databases/`

- PostgreSQL
- MongoDB
- MySQL

#### `integrations/languages/`

- JavaScript
- TypeScript
- PHP
- Rust

**Used by**  
Integration developers, platform engineers, AI pipeline developers.

**Update when**  
Supported providers, adapters, connection patterns, or compatibility assumptions change.

---

### `operations/`

**Purpose**  
Defines production operations and runtime management practices.

**Contains**

- Monitoring
- Logging
- Deployment
- Incident response
- Recovery procedures

**Used by**  
DevOps engineers and operators.

**Update when**  
Operational procedures, reliability controls, or deployment strategies are modified.

---

### `pipeline/`

**Purpose**  
Provides deep documentation for each migration stage.

**Contains**

#### `pipeline/vyrix-scout/`

Discovery documentation.

#### `pipeline/nolara-struct/`

Knowledge modeling documentation.

#### `pipeline/zelvox-forge/`

Generation and transformation documentation.

#### `pipeline/vymos-gate/`

Validation and approval documentation.

**Used by**  
Pipeline developers and AI agents.

**Update when**  
Stage responsibilities, algorithms, inputs/outputs, or governance checkpoints change.

---

### `product/`

**Purpose**  
Explains the product and business context behind LegacyExodus.

**Contains**

- Vision
- Problem statement
- Solution overview
- Target users
- Use cases
- Enterprise value
- Competitive positioning
- Success metrics

**Used by**  
Product teams and stakeholders.

**Update when**  
Strategy, value proposition, user segmentation, or outcome metrics evolve.

---

### `research/`

**Purpose**  
Tracks investigations, experiments, and technical exploration.

**Contains**

- Competitor analysis
- Parser research
- AI model evaluation
- Rust migration research
- Technology evaluation
- Experiments

**Used by**  
Architects, senior engineers, research-oriented contributors.

**Update when**  
New experiments are run, prior findings are refined, or conclusions materially change.

---

### `reviews/`

**Purpose**  
Stores quality and architecture evaluation outputs.

**Contains**

- Architecture reviews
- Security reviews
- Performance reviews
- Dependency reviews
- AI reviews

**Used by**  
Reviewers, maintainers, governance stakeholders.

**Update when**  
Formal evaluations are conducted or follow-up findings are produced.

---

### `security/`

**Purpose**  
Defines security and compliance principles, architecture, and controls.

**Contains**

- Threat model
- Security architecture
- AI security
- Compliance model
- Data protection
- Secret management

**Includes**

#### `security/ai-safety/`

- Agent isolation
- Prompt injection defense
- Model risk management

#### `security/compliance/`

- Audit model
- Data classification
- Enterprise requirements

**Used by**  
Security engineers, architects, compliance stakeholders, maintainers.

**Update when**  
Threat posture, controls, compliance requirements, or AI risk strategy changes.

---

### `templates/`

**Purpose**  
Provides reusable templates to maintain documentation consistency and quality.

**Contains**

- ADR template
- Feature request template
- Bug report template
- Architecture review template
- Security review template

**Used by**  
All contributors creating standardized documentation artifacts.

**Update when**  
Documentation standards, review expectations, or template usability needs improvement.

---

## Foundational Documents (Read First)

The following files define terminology, context, and documentation behavior across the ecosystem:

1. `PROJECT_CONTEXT.md`
2. `AI_CONTEXT.md`
3. `GLOSSARY.md`
4. `DOCUMENTATION_RULES.md`

These are mandatory grounding references for both humans and AI assistants.

---

## Recommended Reading Paths

### For New Engineers

1. `PROJECT_CONTEXT.md`
2. `GLOSSARY.md`
3. `architecture/`
4. `development/`
5. `pipeline/`
6. `implementation/`

### For Architects

1. `PROJECT_CONTEXT.md`
2. `architecture/`
3. `adr/`
4. `decisions/`
5. `security/`
6. `reviews/`

### For Product and Stakeholders

1. `product/`
2. `architecture/` (overview-level docs)
3. `pipeline/`
4. `reviews/`

### For AI Assistants

1. `AI_CONTEXT.md`
2. `DOCUMENTATION_RULES.md`
3. `GLOSSARY.md`
4. `architecture/`
5. `api/`
6. `domain/`
7. `pipeline/`
8. `implementation/`
9. `security/`

---

## Contributor Guidance

When contributing documentation:

- Place content in the correct directory based on purpose.
- Keep terminology consistent with `GLOSSARY.md`.
- Link decisions to implementation and architecture where relevant.
- Update impacted docs in the same change set (not later).
- Prefer traceable, reviewable records over implicit assumptions.
- Treat diagrams and contracts as versioned engineering artifacts.

A good rule: if code behavior changes, related architecture/API/implementation docs should usually change too.

---

## AI Assistant Guidance

AI assistants operating in LegacyExodus should:

- Treat docs as authoritative context unless explicitly superseded.
- Follow terminology and constraints in foundational documents.
- Use `api/`, `architecture/`, and `domain/` to infer boundaries and intent.
- Use `decisions/` and `adr/` to preserve architectural rationale in generated changes.
- Use `security/` and `reviews/` to enforce governance and safety expectations.
- Avoid inventing concepts, stages, or directory structures not present in this documentation system.

---

## How to Use This README

Use this file as:

- The **navigation layer** for the entire `docs/` ecosystem
- The **orientation guide** for new contributors
- The **context map** for AI-assisted engineering work
- The **entry point** for architecture and governance traceability

If you are unsure where to start, begin with the **Foundational Documents** section and then follow the role-specific reading path above.
