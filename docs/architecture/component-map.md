# Component Map — LegacyExodus

## Purpose
Define the system’s bounded components, contracts, and control boundaries so architecture remains deterministic, auditable, and scalable.

## Architecture Topology

```text
                LegacyExodus

                    CLI
                     |
                     v
              Orchestrator
                     |
 ------------------------------------------------
 |          |           |          |             |
 v          v           v          v             v
Parser   Discovery   Graph   Knowledge    AI Gateway
Service  Service     Service Service
 |
 v
Compiler Service
 |
 v
Governance Engine
 |
 v
Storage Service
```

---

## 1) CLI `[IMPLEMENTED]`

### Responsibility
- Primary user interface for local and CI workflows.
- Accepts commands, flags, and configuration overlays.
- Renders progress, summaries, artifacts, and policy outcomes.

### Ownership
- **Platform DX / Developer Tooling**

### Inputs
- User commands (`analyze`, `init`, `status`, `plugins`).
- Config files, environment variables, command-line flags.

### Outputs
- Structured command payloads to Orchestrator.
- Human-readable and machine-readable reports.
- Exit codes reflecting governance status.

### Dependencies
- Orchestrator API/SDK.
- Local config schema + validation module.

---

## 2) Orchestrator `[IMPLEMENTED / CORE RUNTIME]`

### Responsibility
- Central workflow coordinator and deterministic execution controller.
- Splits commands into ordered tasks with explicit stage boundaries.
- Enforces retries/timeouts and idempotent execution semantics.

### Ownership
- **Core Platform / Runtime**

### Inputs
- Command payloads from CLI.
- Existing graph/project metadata from Storage Service.
- Governance ruleset references.

### Outputs
- Directed task invocations to internal services.
- Stage events and execution traces.
- Final workflow state + decision envelope.

### Dependencies
- Parser Service
- Discovery Service
- Graph Service
- Knowledge Service
- AI Gateway (planned)
- Governance Engine
- Storage Service

---

## 3) Parser Service `[IMPLEMENTED]`

### Responsibility
- Produces language-aware AST/IR from source files.
- Normalizes syntax/semantic signals into deterministic parse artifacts.
- Exposes compiler-independent parse contracts.

### Ownership
- **Language Infrastructure**

### Inputs
- Source files, manifests, language config.
- Parse mode directives (fast/full/incremental).

### Outputs
- AST/IR nodes and symbol tables.
- Parse diagnostics (errors/warnings with locations).

### Dependencies
- Compiler Service (adapter integration and canonicalization).
- Storage Service (cached parse artifacts).

---

## 4) Discovery Service `[IMPLEMENTED]`

### Responsibility
- Detects project structure, modules, packages, entry points, and boundaries.
- Resolves import/include/use relations at repository scale.
- Builds deterministic dependency inventory.

### Ownership
- **Static Analysis / Topology**

### Inputs
- File tree snapshots.
- Build files/manifests.
- Parse/symbol signals from Parser Service.

### Outputs
- Component and dependency candidates.
- Edge lists (module↔module, file↔file, package↔package).
- Discovery confidence annotations.

### Dependencies
- Parser Service
- Storage Service

---

## 5) Graph Service `[IMPLEMENTED]`

### Responsibility
- Maintains canonical architecture graph (entities, edges, provenance).
- Supports queries for impact analysis, cycles, coupling, blast radius.
- Provides graph views for migration planning.

### Ownership
- **Core Modeling / Graph Platform**

### Inputs
- Discovery edge lists.
- Parser semantic links.
- Governance annotations and overrides.

### Outputs
- Versioned graph snapshots.
- Query results for orchestrated steps and reports.
- Diffs between graph revisions.

### Dependencies
- Storage Service
- Governance Engine (for policy-tagged graph constraints)

---

## 6) Knowledge Service `[IMPLEMENTED]`

### Responsibility
- Aggregates deterministic facts, rules, migration patterns, and historical decisions.
- Supplies context packages to runtime stages and human reviewers.
- Maintains provenance for every non-trivial recommendation.

### Ownership
- **Knowledge Systems / Architecture Intelligence**

### Inputs
- Graph snapshots/diffs.
- Governance rulings and waivers.
- Curated rulebooks and migration recipes.

### Outputs
- Context bundles keyed by task/stage.
- Ranked deterministic guidance (non-generative).
- Provenance chains for decisions.

### Dependencies
- Graph Service
- Governance Engine
- Storage Service

---

## 7) AI Gateway `[PLANNED / TARGET ARCHITECTURE]`

### Responsibility
- Zero-trust boundary for all model interactions.
- Applies prompt policy, data minimization, schema constraints, and redaction.
- Converts model output into validated proposals (never direct execution).

### Ownership
- **AI Platform / Safety & Trust**

### Inputs
- Sanitized context bundles from Orchestrator/Knowledge Service.
- Strict task schema and acceptance contracts.

### Outputs
- Structured, schema-validated suggestions.
- Confidence + rationale metadata.
- Rejection signals for non-compliant/unsafe model responses.

### Dependencies
- Governance Engine (policy checks and model-use constraints)
- Storage Service (prompt/output audit logs)

---

## 8) Compiler Service `[PLANNED / TARGET ARCHITECTURE]`

### Responsibility
- Language/compiler adapters for semantic enrichment and type resolution.
- Provides canonical symbol/type identity across ecosystems.
- Supports build-system-aware verification hooks.

### Ownership
- **Language Infrastructure**

### Inputs
- Parse artifacts from Parser Service.
- Build metadata and toolchain configuration.

### Outputs
- Typed IR augmentations.
- Cross-reference maps and semantic diagnostics.

### Dependencies
- Parser Service
- Storage Service

---

## 9) Governance Engine `[IMPLEMENTED / CORE FIDELITY & BENCHMARKS]`

### Responsibility
- Enforces architecture, security, and migration policies.
- Applies deterministic gates for merge/deploy readiness.
- Manages waivers/exception workflows with auditability.

### Ownership
- **Architecture Governance / Security**

### Inputs
- Graph metrics and topology constraints.
- Rule definitions, policy packs, risk thresholds.
- AI Gateway proposals and provenance metadata.

### Outputs
- Pass/fail decisions with machine-readable reasons.
- Required remediation actions.
- Signed governance events/audit records.

### Dependencies
- Graph Service
- Knowledge Service
- Storage Service

---

## 10) Storage Service

### Responsibility
- Durable system-of-record for artifacts, graph snapshots, runs, and audits.
- Supports immutable event logs + query-optimized projections.
- Guarantees reproducibility and traceability across runs.

### Ownership
- **Data Platform / Reliability**

### Inputs
- Artifacts and events from all services.
- Version tags, run IDs, provenance envelopes.

### Outputs
- Retrieved artifacts/snapshots.
- Time-travel reads and historical comparisons.
- Audit exports.

### Dependencies
- Underlying object store / DB engines (implementation-specific).

---

## Cross-Cutting Contracts

### Deterministic Core
- Parser, Discovery, Graph, Compiler, Governance paths must be deterministic for same inputs.
- Any nondeterministic contribution (e.g., AI) must be isolated behind AI Gateway and converted into governed proposals.

### CQRS
- **Commands:** Orchestrator stage invocations, policy evaluations, artifact writes.
- **Queries:** Graph analysis, knowledge retrieval, run/audit inspection.
- Write/read models are separated to preserve scale and traceability.

### DDD Boundaries
- Each service is a bounded context with explicit contracts.
- Shared kernel is restricted to typed schemas: identifiers, provenance envelope, policy result model.

### HITL (Human-in-the-Loop)
- Governance Engine can require manual approval for high-risk changes.
- AI suggestions are advisory until accepted by policy + human approval where required.

### Observability & Auditability
- Every stage emits structured events with correlation IDs.
- All decisions must include rationale and provenance pointers.

---

## Ownership Matrix (Condensed)

| Component | Primary Owner | Secondary Stakeholder |
|---|---|---|
| CLI | Platform DX | Core Platform |
| Orchestrator | Core Platform | Architecture Governance |
| Parser Service | Language Infrastructure | Static Analysis |
| Discovery Service | Static Analysis | Core Modeling |
| Graph Service | Core Modeling | Governance |
| Knowledge Service | Architecture Intelligence | Governance |
| AI Gateway | AI Platform/Safety | Security |
| Compiler Service | Language Infrastructure | Build/Toolchain |
| Governance Engine | Architecture Governance | Security |
| Storage Service | Data Platform | Reliability Engineering |

---

## Phase 3 Runtime Hand-off
This component map defines the execution participants and boundaries required to model runtime behavior in **Phase 3 — Runtime**, including:
- lifecycle/state machine per orchestrated command,
- sync vs async stage boundaries,
- failure semantics and compensations,
- policy checkpoints and HITL intervention points.
