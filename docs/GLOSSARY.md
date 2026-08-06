# LegacyExodus Glossary

This glossary is the canonical vocabulary reference for LegacyExodus.  
It defines how terms are used across architecture, implementation, governance, and AI-assisted workflows.

Use this document as the single source of truth for terminology used by:

- software engineers
- architects
- AI agents
- reviewers
- enterprise stakeholders

---

## How to Use This Glossary

Each term is defined with the following structure:

- **Definition**: precise meaning.
- **LegacyExodus Meaning**: how the term is used in this platform.
- **Architectural Purpose**: why the concept exists.
- **Related Terms / Stages**: connected concepts and pipeline location.

---

## Section 1: Core Project Concepts

### LegacyExodus
**Definition**  
A knowledge-driven software modernization engine for analyzing, modeling, transforming, and validating legacy systems.

**LegacyExodus Meaning**  
LegacyExodus is not a code converter. It is a governed modernization platform that executes a four-stage pipeline: VyrixScout, NolaraStruct, ZelvoxForge, and VymosGate.

**Architectural Purpose**  
To produce safe, explainable modernization outcomes by treating system understanding as a prerequisite for transformation.

**Related Terms / Stages**  
Knowledge-First Architecture, Migration Pipeline, Human-Governed AI, Migration Confidence.

---

### Legacy Modernization
**Definition**  
A structured process of evolving legacy software into maintainable, secure, and operationally reliable modern systems.

**LegacyExodus Meaning**  
Modernization is defined as: understanding + modeling + transformation + validation. It is broader than syntax conversion.

**Architectural Purpose**  
To preserve business intent while reducing technical risk and long-term maintenance burden.

**Related Terms / Stages**  
System Understanding, Migration Strategy, Behavioral Equivalence, VymosGate.

---

### Modernization Intelligence Platform
**Definition**  
A platform that combines software analysis, system modeling, AI-assisted generation, and governance controls to support modernization decisions and execution.

**LegacyExodus Meaning**  
LegacyExodus functions as a modernization intelligence platform by maintaining a project state and system intelligence model through the full pipeline.

**Architectural Purpose**  
To make modernization deterministic, traceable, and repeatable at enterprise scale.

**Related Terms / Stages**  
Project State, Knowledge Graph, AI Governance, Pipeline Orchestration.

---

### Knowledge-First Architecture
**Definition**  
An architecture pattern where knowledge acquisition and representation precede and constrain automated change.

**LegacyExodus Meaning**  
No transformation is authoritative unless grounded in discovered system facts and formalized system intelligence.

**Architectural Purpose**  
To prevent unsafe or semantically incorrect migrations caused by shallow code-level conversion.

**Related Terms / Stages**  
VyrixScout, NolaraStruct, System Intelligence Model, Migration Confidence.

---

### Autonomous Migration System
**Definition**  
A system that can execute modernization tasks with high automation while remaining bounded by policy and approvals.

**LegacyExodus Meaning**  
Autonomy is operational, not absolute. Agents can propose and perform actions, but final trust decisions pass through governance controls.

**Architectural Purpose**  
To increase modernization throughput without removing accountability.

**Related Terms / Stages**  
Multi-Agent System, Agent Orchestration, Human Approval Loop, VymosGate.

---

### Human-Governed AI
**Definition**  
An operational model where AI-generated outputs are subject to explicit human-controlled gates and policy checks.

**LegacyExodus Meaning**  
AI contributes analysis and transformation, but high-impact decisions require review and approval.

**Architectural Purpose**  
To maintain auditability, compliance, and stakeholder trust in modernization outcomes.

**Related Terms / Stages**  
AI Governance, Human Approval Loop, Governance Engine, Audit Trail.

---

### Migration Intelligence
**Definition**  
The accumulated analytical and contextual knowledge required to modernize a system safely.

**LegacyExodus Meaning**  
A composite of parsed structures, dependencies, domain semantics, inferred architecture, and validation evidence.

**Architectural Purpose**  
To drive transformation quality and reduce regression risk.

**Related Terms / Stages**  
Source Analysis, Semantic Analysis, Knowledge Graph, System Intelligence Model.

---

### System Understanding
**Definition**  
A verified interpretation of how a software system behaves, is structured, and encodes business logic.

**LegacyExodus Meaning**  
System understanding is built progressively from discovery artifacts and formalized in NolaraStruct.

**Architectural Purpose**  
To establish behavioral and architectural baselines before code generation.

**Related Terms / Stages**  
VyrixScout, NolaraStruct, Domain Model, Invariant.

---

### Transformation Pipeline
**Definition**  
An ordered sequence of stages that convert discovered system knowledge into validated modern implementations.

**LegacyExodus Meaning**  
The pipeline is fixed in intent: discover, model, transform, validate.

**Architectural Purpose**  
To enforce separation of concerns and stage-specific quality controls.

**Related Terms / Stages**  
Migration Pipeline, Pipeline Orchestration, VyrixScout, NolaraStruct, ZelvoxForge, VymosGate.

---

### Migration Confidence
**Definition**  
A measurable level of trust that modernization outputs preserve required behavior and meet governance criteria.

**LegacyExodus Meaning**  
Confidence is evidence-based and derived from traceability, validation results, policy checks, and human approvals.

**Architectural Purpose**  
To support release decisions with auditable rationale.

**Related Terms / Stages**  
Behavioral Equivalence, Regression Testing, AI Reasoning Trace, Governance Engine.

---

## Section 2: Migration Pipeline Terms

### Migration Pipeline
**Definition**  
A structured lifecycle for modernizing legacy systems through distinct, interdependent stages.

**LegacyExodus Meaning**  
The canonical flow is: Legacy System -> VyrixScout -> NolaraStruct -> ZelvoxForge -> VymosGate -> Modern Production System.

**Architectural Purpose**  
To transform unstructured modernization effort into governed execution.

**Related Terms / Stages**  
Migration Stage, Pipeline Orchestration, Project State.

---

### Migration Stage
**Definition**  
A bounded phase in the pipeline with specific responsibilities, inputs, outputs, and acceptance criteria.

**LegacyExodus Meaning**  
Each named stage encapsulates a separate responsibility domain and contract.

**Architectural Purpose**  
To isolate complexity and improve reliability of stage transitions.

**Related Terms / Stages**  
Event Contract, Service Contract, Pipeline Orchestration.

---

### Pipeline Orchestration
**Definition**  
Coordination logic that sequences stages, propagates context, handles failures, and enforces gating rules.

**LegacyExodus Meaning**  
The orchestrator controls progression and ensures each stage consumes validated outputs from prior stages.

**Architectural Purpose**  
To maintain deterministic flow and state integrity.

**Related Terms / Stages**  
Orchestrator, Event-Driven Architecture, Project State.

---

### VyrixScout
**Purpose**  
Discovery and system observation.

**Responsibilities**  
- ingest legacy code and related artifacts  
- perform foundational structural and dependency discovery  
- capture observable system characteristics

**Inputs**  
Legacy source code, configuration artifacts, and project metadata.

**Outputs**  
Discovery artifacts: parse-ready structures, dependency observations, and initial system signals.

**Role in Lifecycle**  
Establishes the factual baseline for subsequent intelligence modeling.

**Related Terms / Stages**  
Source Analysis, Parser, Dependency Graph, Migration Intelligence.

---

### NolaraStruct
**Purpose**  
System intelligence and knowledge modeling.

**Responsibilities**  
- convert discovery artifacts into structured knowledge  
- construct domain and architecture representations  
- formalize entities, relationships, invariants, and boundaries

**Inputs**  
VyrixScout discovery outputs.

**Outputs**  
System Intelligence Model, Knowledge Graph, refined Project State.

**Role in Lifecycle**  
Transforms raw discovery into actionable understanding that guides safe transformation.

**Related Terms / Stages**  
Knowledge Graph, Domain Model, Bounded Context, Invariant.

---

### ZelvoxForge
**Purpose**  
AI-assisted transformation and generation.

**Responsibilities**  
- generate modern implementation candidates from validated system intelligence  
- apply transformation strategies under policy constraints  
- preserve intent and behavior defined by upstream knowledge models

**Inputs**  
NolaraStruct system intelligence outputs and transformation directives.

**Outputs**  
Generated modernization artifacts and transformation trace data.

**Role in Lifecycle**  
Performs modernization execution while remaining constrained by prior understanding.

**Related Terms / Stages**  
Prompt Engineering, Context Engineering, Behavioral Equivalence, AI Reasoning Trace.

---

### VymosGate
**Purpose**  
Validation, governance, and human approval.

**Responsibilities**  
- evaluate transformation outputs for correctness, safety, and policy compliance  
- enforce approval workflows  
- capture evidence for release confidence and auditability

**Inputs**  
ZelvoxForge generated artifacts, validation signals, and governance policies.

**Outputs**  
Approval decisions, compliance records, and final migration confidence status.

**Role in Lifecycle**  
Acts as the trust boundary before promotion to modern production systems.

**Related Terms / Stages**  
Human Approval Loop, AI Governance, Audit Trail, Regression Testing.

---

## Section 3: AI Architecture Terms

### AI Agent
**Definition**  
A bounded computational actor that performs specific reasoning or execution tasks.

**LegacyExodus Meaning**  
Agents operate within defined scopes per stage and are constrained by governance and context boundaries.

**Architectural Purpose**  
To modularize AI responsibilities and reduce uncontrolled behavior.

**Related Terms / Stages**  
Agent Isolation, Multi-Agent System, Agent Orchestration.

---

### Multi-Agent System
**Definition**  
A coordinated set of specialized agents collaborating toward a shared objective.

**LegacyExodus Meaning**  
Different agents support discovery, modeling, transformation, and validation tasks across the pipeline.

**Architectural Purpose**  
To achieve specialization, scalability, and composability in modernization workflows.

**Related Terms / Stages**  
AI Agent, Agent Orchestration, Migration Stage.

---

### Agent Orchestration
**Definition**  
The coordination of agent invocation, sequencing, context transfer, and policy enforcement.

**LegacyExodus Meaning**  
Orchestration aligns agent tasks with stage goals and lifecycle controls.

**Architectural Purpose**  
To ensure consistency, traceability, and bounded execution in autonomous operations.

**Related Terms / Stages**  
Pipeline Orchestration, AI Governance, Project State.

---

### Agent Memory
**Definition**  
Persisted and transient context used by agents to maintain task continuity.

**LegacyExodus Meaning**  
Memory is scoped to avoid contamination across projects or stages and to preserve explainability.

**Architectural Purpose**  
To improve reasoning continuity while enforcing context hygiene.

**Related Terms / Stages**  
Project State, Context Engineering, Agent Isolation.

---

### AI Gateway
**Definition**  
A control layer that brokers access between platform services and external or internal model providers.

**LegacyExodus Meaning**  
The gateway standardizes model invocation, policy checks, and telemetry for AI operations.

**Architectural Purpose**  
To centralize AI integration, control cost/risk, and enforce governance uniformly.

**Related Terms / Stages**  
Model Provider, AI Governance, Service Contract.

---

### Model Provider
**Definition**  
A runtime source of AI model capabilities used for analysis or generation.

**LegacyExodus Meaning**  
Providers are treated as interchangeable dependencies behind gateway-managed contracts.

**Architectural Purpose**  
To decouple business logic from specific model vendors or runtimes.

**Related Terms / Stages**  
AI Gateway, Service-Oriented Architecture, Plugin Architecture.

---

### Prompt Engineering
**Definition**  
The design of instruction payloads to produce controlled AI behavior.

**LegacyExodus Meaning**  
Prompts are architecture-aware and grounded in system intelligence artifacts, not generic conversion requests.

**Architectural Purpose**  
To reduce ambiguity and improve determinism of transformation outputs.

**Related Terms / Stages**  
Context Engineering, ZelvoxForge, AI Reasoning Trace.

---

### Context Engineering
**Definition**  
The selection, shaping, and boundary control of input context for AI tasks.

**LegacyExodus Meaning**  
Context is intentionally scoped to stage-relevant knowledge and governance constraints.

**Architectural Purpose**  
To improve output relevance, reduce hallucination risk, and preserve security boundaries.

**Related Terms / Stages**  
Agent Memory, Knowledge Graph, Project State.

---

### AI Reasoning Trace
**Definition**  
Recorded rationale and decision evidence associated with AI-produced outputs.

**LegacyExodus Meaning**  
Trace data links generated artifacts back to inputs, constraints, and validation criteria.

**Architectural Purpose**  
To support explainability, reviewability, and audit requirements.

**Related Terms / Stages**  
Audit Trail, Migration Confidence, VymosGate.

---

### Human Approval Loop
**Definition**  
A required review-and-approval mechanism where humans authorize high-impact actions.

**LegacyExodus Meaning**  
Approval loops are integral to final gate decisions and cannot be bypassed by autonomous execution.

**Architectural Purpose**  
To preserve accountability and operational control.

**Related Terms / Stages**  
Human-Governed AI, Governance Engine, VymosGate.

---

### AI Governance
**Definition**  
Policy, process, and technical controls that regulate AI behavior and outputs.

**LegacyExodus Meaning**  
Governance defines what AI may do, what must be reviewed, and what evidence must be retained.

**Architectural Purpose**  
To align AI operations with enterprise risk, compliance, and quality standards.

**Related Terms / Stages**  
Governance, Compliance, AI Gateway, VymosGate.

---

### Agent Isolation
**Definition**  
Separation of agent execution contexts, permissions, and data visibility.

**LegacyExodus Meaning**  
Isolation prevents cross-stage and cross-project leakage of state or assumptions.

**Architectural Purpose**  
To improve security, reliability, and result integrity.

**Related Terms / Stages**  
Security Model, Agent Memory, Component Boundary.

---

## Section 4: Code Analysis Terms

### Source Analysis
**Definition**  
Systematic examination of source artifacts to extract structural and behavioral information.

**LegacyExodus Meaning**  
Source analysis is the entry point for migration intelligence generation in VyrixScout.

**Architectural Purpose**  
To replace assumptions with evidence from legacy code realities.

**Related Terms / Stages**  
Parser, AST, Semantic Analysis, Migration Intelligence.

---

### Parser
**Definition**  
A component that converts source text into structured representations.

**LegacyExodus Meaning**  
Parsers feed downstream intelligence workflows and must preserve syntactic fidelity.

**Architectural Purpose**  
To enable deterministic machine reasoning over legacy code.

**Related Terms / Stages**  
CST, AST, Parser Service.

---

### AST (Abstract Syntax Tree)
**Definition**  
A structural tree representation of source code semantics, abstracting low-level syntax tokens.

**LegacyExodus Meaning**  
ASTs are used for semantic inference, transformation planning, and behavior-preserving generation.

**Architectural Purpose**  
To provide an analyzable intermediate form for modernization logic.

**Related Terms / Stages**  
Parser, Semantic Analysis, ZelvoxForge.

---

### CST (Concrete Syntax Tree)
**Definition**  
A parse tree that preserves concrete source syntax, including token-level structure.

**LegacyExodus Meaning**  
CSTs support faithful reconstruction and diagnostics when syntax-level detail matters.

**Architectural Purpose**  
To retain source-level precision for traceability and parser correctness.

**Related Terms / Stages**  
Parser, Source Analysis, AI Reasoning Trace.

---

### Symbol Extraction
**Definition**  
Identification and indexing of named program elements such as functions, types, modules, and constants.

**LegacyExodus Meaning**  
Symbols become first-class knowledge objects for relationship mapping and migration planning.

**Architectural Purpose**  
To establish explicit references across large legacy codebases.

**Related Terms / Stages**  
Dependency Graph, Knowledge Graph, NolaraStruct.

---

### Dependency Graph
**Definition**  
A graph representation of compile-time or runtime dependencies among code elements or services.

**LegacyExodus Meaning**  
Dependency graphs expose coupling hotspots and modernization risk surfaces.

**Architectural Purpose**  
To prioritize transformation sequencing and isolate high-impact dependencies.

**Related Terms / Stages**  
Call Graph, Component Boundary, Migration Strategy.

---

### Call Graph
**Definition**  
A directed graph of callable relationships among procedures, methods, or services.

**LegacyExodus Meaning**  
Call graphs help identify execution pathways that must preserve behavior after modernization.

**Architectural Purpose**  
To support equivalence validation and regression-focused test design.

**Related Terms / Stages**  
Control Flow Graph, Regression Testing, VymosGate.

---

### Control Flow Graph
**Definition**  
A representation of possible execution paths through program logic.

**LegacyExodus Meaning**  
Control flow analysis is used to reason about branching behavior and critical logic paths.

**Architectural Purpose**  
To protect behavior consistency during transformation.

**Related Terms / Stages**  
Data Flow Analysis, Behavioral Equivalence, Source Analysis.

---

### Data Flow Analysis
**Definition**  
Analysis of how data values propagate and transform through program execution.

**LegacyExodus Meaning**  
Data flow insights reveal state dependencies, implicit contracts, and mutation risks.

**Architectural Purpose**  
To prevent semantic drift in transformed implementations.

**Related Terms / Stages**  
Control Flow Graph, Invariant, System Understanding.

---

### Static Analysis
**Definition**  
Program analysis without executing the target system.

**LegacyExodus Meaning**  
Static analysis provides scalable early signals for architecture reconstruction and risk detection.

**Architectural Purpose**  
To reduce migration uncertainty before runtime validation.

**Related Terms / Stages**  
Semantic Analysis, Source Analysis, VyrixScout.

---

### Semantic Analysis
**Definition**  
Interpretation of program meaning beyond syntax, including type intent, domain behavior, and logical effects.

**LegacyExodus Meaning**  
Semantic analysis converts parsed structures into modernization-relevant intelligence.

**Architectural Purpose**  
To ensure generated code preserves intent, not only form.

**Related Terms / Stages**  
System Intelligence Model, NolaraStruct, Behavioral Equivalence.

---

### Code Intelligence
**Definition**  
An actionable representation of code structure, behavior, and relationships for engineering decisions.

**LegacyExodus Meaning**  
Code intelligence is a foundation input to migration strategy and automated transformation.

**Architectural Purpose**  
To enable evidence-driven modernization at scale.

**Related Terms / Stages**  
Migration Intelligence, Knowledge Graph, ZelvoxForge.

---

## Section 5: Knowledge System Terms

### Project State
**Definition**  
The authoritative, evolving representation of a modernization project’s current facts, decisions, and artifacts.

**LegacyExodus Meaning**  
Project state is the cross-stage continuity model used by orchestration, agents, and governance controls.

**Architectural Purpose**  
To ensure lifecycle coherence and deterministic handoffs.

**Related Terms / Stages**  
Pipeline Orchestration, Agent Memory, Knowledge Service.

---

### Knowledge Graph
**Definition**  
A structured graph of entities and relationships representing system and domain intelligence.

**LegacyExodus Meaning**  
The graph encodes code, architecture, and domain linkages discovered and modeled through the pipeline.

**Architectural Purpose**  
To support reasoning, traceability, and dependency-aware transformation planning.

**Related Terms / Stages**  
Entity, Relationship Mapping, NolaraStruct, Graph Service.

---

### System Intelligence Model
**Definition**  
A formalized model describing how the legacy system is structured, behaves, and encodes business intent.

**LegacyExodus Meaning**  
This model is the primary transformation contract passed into ZelvoxForge.

**Architectural Purpose**  
To anchor generation in validated understanding rather than heuristics.

**Related Terms / Stages**  
System Understanding, Knowledge Graph, Migration Intelligence.

---

### Domain Model
**Definition**  
A conceptual representation of business concepts, rules, and interactions in a system domain.

**LegacyExodus Meaning**  
Domain models make implicit legacy business logic explicit for safe modernization.

**Architectural Purpose**  
To preserve business continuity across technological change.

**Related Terms / Stages**  
Entity, Aggregate, Bounded Context, Invariant.

---

### Entity
**Definition**  
A domain object with identity continuity over time.

**LegacyExodus Meaning**  
Entities represent durable business concepts extracted from legacy behavior and data flows.

**Architectural Purpose**  
To stabilize business semantics during architectural change.

**Related Terms / Stages**  
Domain Model, Aggregate, Value Object.

---

### Aggregate
**Definition**  
A consistency boundary that groups related entities and value objects under controlled invariants.

**LegacyExodus Meaning**  
Aggregates define transactional and behavioral boundaries inferred from legacy systems.

**Architectural Purpose**  
To preserve integrity rules in transformed implementations.

**Related Terms / Stages**  
Invariant, Bounded Context, Domain Event.

---

### Value Object
**Definition**  
An immutable domain concept identified by value rather than identity.

**LegacyExodus Meaning**  
Value objects help express precise business semantics in modernized models.

**Architectural Purpose**  
To reduce ambiguity and mutation-related defects.

**Related Terms / Stages**  
Entity, Domain Model, Type Safety.

---

### Bounded Context
**Definition**  
A semantic boundary within which a domain model and terminology are internally consistent.

**LegacyExodus Meaning**  
Bounded contexts partition large legacy domains into modernization-manageable units.

**Architectural Purpose**  
To prevent model collisions and support modular transformation.

**Related Terms / Stages**  
Domain Model, Component Boundary, Modular Architecture.

---

### Domain Event
**Definition**  
A business-significant occurrence represented as a formal event.

**LegacyExodus Meaning**  
Domain events provide traceable business behavior transitions across modernization stages.

**Architectural Purpose**  
To align domain semantics with event-driven orchestration.

**Related Terms / Stages**  
Event Contract, Event-Driven Architecture, Project State.

---

### Invariant
**Definition**  
A rule that must always hold true for system correctness.

**LegacyExodus Meaning**  
Invariants are extracted from legacy behavior and enforced in transformed systems.

**Architectural Purpose**  
To preserve business-critical correctness under modernization.

**Related Terms / Stages**  
Behavioral Equivalence, Aggregate, VymosGate.

---

### Relationship Mapping
**Definition**  
The explicit modeling of dependencies and semantic links among system elements.

**LegacyExodus Meaning**  
Mapping connects code artifacts, domain objects, and runtime interactions in a unified intelligence view.

**Architectural Purpose**  
To enable impact analysis and transformation planning.

**Related Terms / Stages**  
Knowledge Graph, Dependency Graph, System Intelligence Model.

---

### Metadata
**Definition**  
Structured descriptive attributes attached to artifacts, models, events, and decisions.

**LegacyExodus Meaning**  
Metadata records provenance, confidence, lineage, and policy context for modernization artifacts.

**Architectural Purpose**  
To support traceability, governance, and reproducibility.

**Related Terms / Stages**  
Audit Trail, AI Reasoning Trace, Project State.

---

## Section 6: Architecture Terms

### Event-Driven Architecture
**Definition**  
An architecture where components communicate through events rather than direct synchronous coupling.

**LegacyExodus Meaning**  
Stage transitions and state updates are coordinated through event contracts and orchestration rules.

**Architectural Purpose**  
To improve decoupling, resilience, and observability in pipeline execution.

**Related Terms / Stages**  
Domain Event, Event Contract, Pipeline Orchestration.

---

### Service-Oriented Architecture
**Definition**  
An architecture organized around independently deployable services with defined contracts.

**LegacyExodus Meaning**  
Core platform capabilities are expressed as services with bounded responsibilities.

**Architectural Purpose**  
To support composability, operational scale, and independent evolution.

**Related Terms / Stages**  
Service Contract, Component Boundary, Runtime Architecture.

---

### Modular Architecture
**Definition**  
An architecture partitioned into cohesive modules with explicit interfaces.

**LegacyExodus Meaning**  
Modules map to functional concerns such as discovery, modeling, transformation, and governance.

**Architectural Purpose**  
To reduce coupling and increase maintainability.

**Related Terms / Stages**  
Component Boundary, Plugin Architecture, Migration Stage.

---

### Plugin Architecture
**Definition**  
An extensibility model where capabilities are added through contract-compliant plugin components.

**LegacyExodus Meaning**  
LegacyExodus can extend analysis or transformation behavior without altering core engine semantics.

**Architectural Purpose**  
To enable controlled adaptability across languages, frameworks, and enterprise constraints.

**Related Terms / Stages**  
Service Contract, Model Provider, Multi-Language Migration.

---

### Component Boundary
**Definition**  
A defined interface and responsibility limit between architectural units.

**LegacyExodus Meaning**  
Boundaries separate stage concerns and prevent leakage of hidden assumptions across components.

**Architectural Purpose**  
To preserve correctness, security, and evolvability.

**Related Terms / Stages**  
Service Contract, Agent Isolation, Bounded Context.

---

### Service Contract
**Definition**  
A formal definition of service inputs, outputs, behaviors, and error semantics.

**LegacyExodus Meaning**  
Contracts govern inter-service calls and stage handoffs.

**Architectural Purpose**  
To maintain integration stability and deterministic behavior.

**Related Terms / Stages**  
API Contract, Event Contract, Orchestrator.

---

### API Contract
**Definition**  
A formal interface definition for request/response interactions.

**LegacyExodus Meaning**  
APIs expose controlled capabilities to internal components and governed clients.

**Architectural Purpose**  
To ensure compatibility, versioning discipline, and safe integration.

**Related Terms / Stages**  
Service Contract, Runtime Architecture, Governance.

---

### Event Contract
**Definition**  
A formal schema and behavioral agreement for produced and consumed events.

**LegacyExodus Meaning**  
Event contracts define stage transition data expectations and validation requirements.

**Architectural Purpose**  
To ensure reliable asynchronous coordination and traceable state transitions.

**Related Terms / Stages**  
Event-Driven Architecture, Domain Event, Pipeline Orchestration.

---

### Runtime Architecture
**Definition**  
The operational structure of services, processes, and interactions while the system is executing.

**LegacyExodus Meaning**  
Runtime architecture governs how pipeline services and agents execute and communicate in production workflows.

**Architectural Purpose**  
To deliver reliable and observable modernization operations.

**Related Terms / Stages**  
Deployment Architecture, Service-Oriented Architecture, Observability.

---

### Deployment Architecture
**Definition**  
The topology and configuration by which system components are provisioned and run in target environments.

**LegacyExodus Meaning**  
Deployment architecture defines how LegacyExodus services are released and operated under enterprise controls.

**Architectural Purpose**  
To satisfy reliability, security, and scalability requirements.

**Related Terms / Stages**  
Runtime Architecture, Reliability, Scalability, Compliance.

---

## Section 7: Software Migration Terms

### Rewrite
**Definition**  
Re-implementation of system functionality from scratch in a new codebase.

**LegacyExodus Meaning**  
Rewrite is one possible strategy component, but is governed by discovered knowledge and validation constraints.

**Architectural Purpose**  
To replace brittle legacy constructs where incremental evolution is not viable.

**Related Terms / Stages**  
Migration Strategy, Behavioral Equivalence, ZelvoxForge.

---

### Refactoring
**Definition**  
Code structure improvement without changing externally observable behavior.

**LegacyExodus Meaning**  
Refactoring may occur within modernization outputs to improve maintainability and safety.

**Architectural Purpose**  
To reduce complexity while preserving behavior.

**Related Terms / Stages**  
Behavioral Equivalence, Regression Testing, Modernization.

---

### Replatforming
**Definition**  
Migration of software to a new platform with limited functional change.

**LegacyExodus Meaning**  
Replatforming is treated as a strategy option when business behavior is stable but infrastructure targets change.

**Architectural Purpose**  
To improve operability or cost profile with controlled functional risk.

**Related Terms / Stages**  
Migration Strategy, Compatibility Layer, Deployment Architecture.

---

### Rehosting
**Definition**  
Relocating software to a new runtime environment with minimal code changes.

**LegacyExodus Meaning**  
Rehosting may be used as a transitional step, not the end-state modernization objective.

**Architectural Purpose**  
To reduce immediate infrastructure constraints while preparing deeper modernization.

**Related Terms / Stages**  
Replatforming, Continuous Modernization, Legacy System.

---

### Translation
**Definition**  
Conversion of code representation from one language or format to another.

**LegacyExodus Meaning**  
Translation is a narrow technical action and does not satisfy LegacyExodus modernization requirements by itself.

**Architectural Purpose**  
To support transformation mechanics where appropriate, under model constraints.

**Related Terms / Stages**  
Transpilation, Code Conversion, Migration Strategy.

---

### Transpilation
**Definition**  
Automated source-to-source translation, typically preserving high-level semantics across languages.

**LegacyExodus Meaning**  
Transpilation can be a tactical mechanism inside transformation, but not the architectural definition of migration.

**Architectural Purpose**  
To accelerate implementation generation where behavior and structure are already understood.

**Related Terms / Stages**  
Translation, ZelvoxForge, Behavioral Equivalence.

---

### Migration Strategy
**Definition**  
A planned approach selecting modernization methods, sequencing, and risk controls.

**LegacyExodus Meaning**  
Strategy is evidence-driven and derived from migration intelligence and governance constraints.

**Architectural Purpose**  
To optimize safety, cost, and delivery outcomes.

**Related Terms / Stages**  
Migration Intelligence, Pipeline Orchestration, VymosGate.

---

### Behavioral Equivalence
**Definition**  
The condition where modernized outputs preserve required observable behavior of legacy systems.

**LegacyExodus Meaning**  
Behavioral equivalence is a core acceptance criterion for modernization trust.

**Architectural Purpose**  
To ensure business continuity through change.

**Related Terms / Stages**  
Regression Testing, Invariant, Migration Confidence.

---

### Regression Testing
**Definition**  
Validation activities ensuring changes do not introduce unintended behavior deviations.

**LegacyExodus Meaning**  
Regression testing evidence is consumed by VymosGate to support approval decisions.

**Architectural Purpose**  
To detect semantic drift before production release.

**Related Terms / Stages**  
Behavioral Equivalence, VymosGate, Migration Confidence.

---

### Compatibility Layer
**Definition**  
An intermediary interface preserving interaction compatibility during transitional modernization states.

**LegacyExodus Meaning**  
Compatibility layers may be used to decouple rollout sequencing from full domain transformation.

**Architectural Purpose**  
To reduce migration disruption and enable phased adoption.

**Related Terms / Stages**  
Replatforming, Rehosting, Deployment Architecture.

---

### Clarification: Translation vs Migration
**Translation != Migration**  
Translation changes code form. Migration changes system architecture, maintainability, safety posture, and governance state while preserving business intent.

### Clarification: Code Conversion vs Modernization
**Code Conversion != Modernization**  
Conversion is an implementation step. Modernization is a lifecycle outcome requiring discovery, modeling, transformation, and validation.

---

## Section 8: Rust Migration Terms

### Ownership
**Definition**  
A compile-time model that assigns each value a single owner responsible for lifecycle management.

**LegacyExodus Meaning**  
Ownership is a target-state design principle used to eliminate classes of legacy memory defects.

**Architectural Purpose**  
To provide predictable resource safety and enforce disciplined data lifecycles.

**Related Terms / Stages**  
Borrow Checker, Memory Safety, Type Safety.

---

### Borrow Checker
**Definition**  
A compile-time mechanism enforcing aliasing and lifetime rules for references.

**LegacyExodus Meaning**  
Borrow checking is central to validating memory-safe modernization outputs.

**Architectural Purpose**  
To prevent use-after-free, data races, and invalid aliasing patterns.

**Related Terms / Stages**  
Ownership, Memory Safety, Error Handling.

---

### Memory Safety
**Definition**  
Protection against invalid memory operations through language and runtime guarantees.

**LegacyExodus Meaning**  
Memory safety is a core modernization objective and reason for Rust-first targets.

**Architectural Purpose**  
To reduce security risk and runtime instability endemic to unsafe legacy patterns.

**Related Terms / Stages**  
Ownership, Borrow Checker, Security Model.

---

### Zero-Cost Abstraction
**Definition**  
High-level language abstractions that compile to efficient low-level code without runtime penalty beyond manual equivalents.

**LegacyExodus Meaning**  
Enables modern, maintainable implementations without sacrificing performance constraints common in legacy environments.

**Architectural Purpose**  
To balance maintainability and performance in production modernization.

**Related Terms / Stages**  
Type Safety, Rust target strategy, Scalability.

---

### Async Runtime
**Definition**  
Execution environment for non-blocking asynchronous tasks and I/O.

**LegacyExodus Meaning**  
Async runtime choices influence throughput and service responsiveness in modernized systems.

**Architectural Purpose**  
To support scalable concurrent workloads.

**Related Terms / Stages**  
Tokio, Runtime Architecture, Reliability.

---

### Tokio
**Definition**  
A Rust asynchronous runtime and ecosystem for building concurrent applications.

**LegacyExodus Meaning**  
Tokio is a preferred runtime foundation for modernized Rust services where async concurrency is required.

**Architectural Purpose**  
To provide robust async execution primitives and ecosystem maturity.

**Related Terms / Stages**  
Async Runtime, Axum, SQLx.

---

### Axum
**Definition**  
A Rust web framework built on the Tokio ecosystem.

**LegacyExodus Meaning**  
Axum is a preferred service interface layer for modern Rust implementations generated or guided by modernization workflows.

**Architectural Purpose**  
To expose APIs with strong typing and async integration.

**Related Terms / Stages**  
Tokio, API Contract, Service-Oriented Architecture.

---

### SQLx
**Definition**  
A Rust SQL toolkit emphasizing compile-time checked query interactions.

**LegacyExodus Meaning**  
SQLx supports safer persistence modernization by aligning data access with Rust type guarantees.

**Architectural Purpose**  
To reduce runtime query/type mismatches and improve reliability.

**Related Terms / Stages**  
Type Safety, Error Handling, Reliability.

---

### Type Safety
**Definition**  
A property where type constraints prevent classes of invalid operations at compile time.

**LegacyExodus Meaning**  
Type safety is a key modernization objective for reducing latent defects in transformed code.

**Architectural Purpose**  
To shift error detection earlier in delivery lifecycle.

**Related Terms / Stages**  
Ownership, SQLx, Behavioral Equivalence.

---

### Error Handling
**Definition**  
Structured management of failure conditions, propagation, and recovery.

**LegacyExodus Meaning**  
Modernization outputs prioritize explicit, typed error handling over ambiguous control patterns.

**Architectural Purpose**  
To increase observability, reliability, and governance confidence.

**Related Terms / Stages**  
Reliability, Migration Confidence, VymosGate.

---

### Why Rust is the Preferred Migration Target
Rust is preferred because it combines:

- strong memory safety guarantees
- compile-time correctness checks
- high performance characteristics
- explicit concurrency semantics
- strong ecosystem support for modern service architecture

In LegacyExodus, these properties align with the objective of producing secure, reliable, and governable modernization outcomes.

---

## Section 9: Enterprise Engineering Terms

### Technical Debt
**Definition**  
Accumulated engineering liabilities that increase change cost and risk.

**LegacyExodus Meaning**  
Debt signals are discovered, modeled, and prioritized as modernization inputs.

**Architectural Purpose**  
To guide sequencing and reduce long-term operational burden.

**Related Terms / Stages**  
Migration Strategy, Legacy System, Reliability.

---

### Legacy System
**Definition**  
An existing system with entrenched behavior, constraints, and often aging architecture or tooling.

**LegacyExodus Meaning**  
The modernization source system whose business semantics must be preserved while technical posture is improved.

**Architectural Purpose**  
To establish the baseline subject of discovery and transformation.

**Related Terms / Stages**  
VyrixScout, System Understanding, Behavioral Equivalence.

---

### Business Logic
**Definition**  
Rules and workflows that implement business intent and domain policy.

**LegacyExodus Meaning**  
Business logic is treated as protected knowledge that must survive modernization intact.

**Architectural Purpose**  
To preserve enterprise value during technical change.

**Related Terms / Stages**  
Domain Model, Invariant, System Intelligence Model.

---

### Compliance
**Definition**  
Conformance to internal and external regulatory or policy requirements.

**LegacyExodus Meaning**  
Compliance checks are integrated into validation and approval paths.

**Architectural Purpose**  
To ensure modernization outputs are operationally and legally acceptable.

**Related Terms / Stages**  
Governance, Audit Trail, VymosGate.

---

### Audit Trail
**Definition**  
A traceable record of actions, decisions, and evidence throughout system operations.

**LegacyExodus Meaning**  
Audit trails capture pipeline events, AI traces, approvals, and policy outcomes.

**Architectural Purpose**  
To support accountability, forensics, and regulatory evidence.

**Related Terms / Stages**  
AI Reasoning Trace, Governance Engine, Migration Confidence.

---

### Governance
**Definition**  
Organizational and technical control mechanisms that enforce acceptable behavior and decision rights.

**LegacyExodus Meaning**  
Governance defines authorization, approval requirements, and risk thresholds across modernization lifecycle stages.

**Architectural Purpose**  
To keep automated modernization aligned with enterprise controls.

**Related Terms / Stages**  
Human-Governed AI, Compliance, VymosGate.

---

### Security Model
**Definition**  
A formal representation of security assumptions, controls, and enforcement boundaries.

**LegacyExodus Meaning**  
Security models constrain agent behavior, data flow, and service interaction.

**Architectural Purpose**  
To protect modernization workflows and outcomes from misuse or exposure.

**Related Terms / Stages**  
Threat Model, Agent Isolation, Component Boundary.

---

### Threat Model
**Definition**  
A structured analysis of potential adversaries, attack paths, and mitigations.

**LegacyExodus Meaning**  
Threat modeling informs governance and validation criteria for modernized systems.

**Architectural Purpose**  
To reduce security regression risk during transformation.

**Related Terms / Stages**  
Security Model, Compliance, VymosGate.

---

### Observability
**Definition**  
The ability to understand system internal state through telemetry signals.

**LegacyExodus Meaning**  
Observability applies to pipeline execution, agent behavior, and validation workflows.

**Architectural Purpose**  
To support diagnosis, trust, and operational control.

**Related Terms / Stages**  
Runtime Architecture, Reliability, Audit Trail.

---

### Reliability
**Definition**  
The probability that a system performs required functions correctly over time.

**LegacyExodus Meaning**  
Reliability is a validation objective for both platform operations and modernization outputs.

**Architectural Purpose**  
To ensure production readiness and stakeholder trust.

**Related Terms / Stages**  
Regression Testing, Error Handling, VymosGate.

---

### Scalability
**Definition**  
The capacity of a system to handle increasing load with acceptable performance.

**LegacyExodus Meaning**  
Scalability applies to analysis throughput, transformation execution, and governance processing volume.

**Architectural Purpose**  
To support enterprise modernization programs across large portfolios.

**Related Terms / Stages**  
Deployment Architecture, Async Runtime, Service-Oriented Architecture.

---

## Section 10: LegacyExodus Internal Components

### Core Engine
**Purpose**  
Central execution foundation for modernization lifecycle management.

**Responsibilities**  
- coordinate platform-wide state transitions  
- enforce lifecycle invariants  
- provide shared execution primitives

**Communication Boundaries**  
Interacts with orchestrator and core services through defined contracts; does not collapse service boundaries.

**Related Terms / Stages**  
Project State, Pipeline Orchestration, Service Contract.

---

### Orchestrator
**Purpose**  
Controls sequencing and gating across migration stages and agent tasks.

**Responsibilities**  
- stage transition control  
- event routing and failure handling  
- enforcement of progression criteria

**Communication Boundaries**  
Consumes and emits contract-bound events and service calls; avoids direct logic ownership of stage internals.

**Related Terms / Stages**  
Migration Pipeline, Event Contract, VymosGate.

---

### Parser Service
**Purpose**  
Provides syntax and structure extraction from legacy source artifacts.

**Responsibilities**  
- parse source into CST/AST forms  
- emit parse diagnostics and structural metadata  
- support language-specific analysis entry points

**Communication Boundaries**  
Produces structured outputs for discovery/modeling services via explicit contracts.

**Related Terms / Stages**  
Parser, AST, CST, VyrixScout.

---

### Discovery Service
**Purpose**  
Executes early-stage discovery workflows over legacy systems.

**Responsibilities**  
- gather dependency and structural signals  
- classify and normalize discovered artifacts  
- publish discovery outputs for intelligence modeling

**Communication Boundaries**  
Consumes parser outputs; publishes discovery artifacts without owning transformation logic.

**Related Terms / Stages**  
VyrixScout, Source Analysis, Dependency Graph.

---

### Graph Service
**Purpose**  
Stores and serves graph-modeled relationships for system intelligence.

**Responsibilities**  
- maintain knowledge graph structures  
- support relationship queries and traversals  
- preserve lineage and mapping integrity

**Communication Boundaries**  
Exposes graph operations through service APIs; isolates graph persistence concerns.

**Related Terms / Stages**  
Knowledge Graph, Relationship Mapping, NolaraStruct.

---

### Knowledge Service
**Purpose**  
Manages formalized system intelligence and project knowledge lifecycle.

**Responsibilities**  
- persist and version system intelligence artifacts  
- enforce metadata and provenance consistency  
- serve context packages to downstream stages

**Communication Boundaries**  
Interfaces with graph/storage services under explicit contracts; does not execute generation logic.

**Related Terms / Stages**  
System Intelligence Model, Metadata, Project State.

---

### AI Gateway
**Purpose**  
Governed integration layer for model invocation.

**Responsibilities**  
- route requests to model providers  
- apply policy checks and context controls  
- collect usage and trace telemetry

**Communication Boundaries**  
Decouples internal components from provider-specific APIs.

**Related Terms / Stages**  
Model Provider, AI Governance, Agent Orchestration.

---

### Compiler Service
**Purpose**  
Validates and verifies build-level properties of generated modernization artifacts.

**Responsibilities**  
- execute compilation/build checks  
- surface diagnostics for validation workflows  
- provide build evidence for confidence assessment

**Communication Boundaries**  
Consumes generated artifacts; returns validation signals to governance paths.

**Related Terms / Stages**  
ZelvoxForge, VymosGate, Migration Confidence.

---

### Storage Service
**Purpose**  
Persistent storage layer for artifacts, state, traces, and governance records.

**Responsibilities**  
- durable artifact and metadata persistence  
- versioned state support  
- retrieval for audit and replay workflows

**Communication Boundaries**  
Provides persistence contracts to platform services; no ownership of business transformation semantics.

**Related Terms / Stages**  
Project State, Audit Trail, Metadata.

---

### Governance Engine
**Purpose**  
Executes policy and approval logic for modernization decisions.

**Responsibilities**  
- evaluate validation evidence  
- enforce approval requirements  
- record governance outcomes and rationale

**Communication Boundaries**  
Consumes evidence from validation and orchestration paths; publishes decision artifacts to project state.

**Related Terms / Stages**  
Human Approval Loop, AI Governance, VymosGate.

---

## Section 11: Naming Conventions

### Stage Naming Philosophy
LegacyExodus stage names are purpose-signaling identifiers.  
Each name communicates operational responsibility in the modernization lifecycle.

---

### VyrixScout
**Name Intent**  
"Scout" indicates reconnaissance and discovery.

**Responsibility Signal**  
This stage observes and maps the legacy landscape before interpretation or change.

---

### NolaraStruct
**Name Intent**  
"Struct" indicates structuring and formal modeling.

**Responsibility Signal**  
This stage turns discovered facts into organized system intelligence and domain structure.

---

### ZelvoxForge
**Name Intent**  
"Forge" indicates controlled creation.

**Responsibility Signal**  
This stage constructs modern implementation artifacts from validated intelligence inputs.

---

### VymosGate
**Name Intent**  
"Gate" indicates controlled admission and decisioning.

**Responsibility Signal**  
This stage validates, governs, and authorizes progression to production-ready outcomes.

---

### Convention Rule
Stage names must remain tightly coupled to responsibilities.  
A stage name is valid only if it communicates what the stage does in the architecture.

---

## Section 12: Future Expansion Terms

### Continuous Modernization
**Definition**  
An operating model where modernization is iterative and ongoing rather than a one-time project.

**LegacyExodus Meaning**  
Future workflows may continuously re-assess and evolve systems as architecture and risk profiles change.

**Architectural Purpose**  
To keep systems modernization-aligned over long operational horizons.

---

### Autonomous Engineering
**Definition**  
High-automation engineering execution under explicit governance boundaries.

**LegacyExodus Meaning**  
Extends agent capabilities while preserving human approval and policy enforcement as control points.

**Architectural Purpose**  
To increase throughput without sacrificing trust.

---

### Self-Healing Systems
**Definition**  
Systems that can detect, diagnose, and remediate certain failure classes automatically.

**LegacyExodus Meaning**  
A future-state objective for modernization outputs and potentially platform operations.

**Architectural Purpose**  
To improve resilience and reduce operational intervention burden.

---

### AI Software Architect
**Definition**  
An AI capability that reasons about architecture, trade-offs, and modernization plans at system level.

**LegacyExodus Meaning**  
A future specialized role for architecture guidance constrained by knowledge-first and governance policies.

**Architectural Purpose**  
To augment human architecture decision-making with scalable analytical support.

---

### Multi-Language Migration
**Definition**  
Support for modernization across multiple source and target language ecosystems.

**LegacyExodus Meaning**  
Extensible pipeline capabilities through plugin and parser/service expansion models.

**Architectural Purpose**  
To broaden platform applicability across enterprise legacy portfolios.

---

### Cloud-Native Transformation
**Definition**  
Modernization toward architectures optimized for cloud deployment, scaling, resilience, and managed operations.

**LegacyExodus Meaning**  
A target transformation profile that may be selected by migration strategy and governance requirements.

**Architectural Purpose**  
To align modernized systems with contemporary operational platforms.

---

## Final Terminology Principle

In LegacyExodus, terminology is an architectural control surface.  
If a term is ambiguous, it is incomplete.  
If a term is incomplete, modernization risk increases.  
This glossary exists to eliminate that risk by enforcing shared, explicit language.
