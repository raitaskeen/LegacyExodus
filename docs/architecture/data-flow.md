# Data Flow

## Migration journey through LegacyExodus

This document explains how data moves through the LegacyExodus modernization pipeline—from a legacy codebase to validated, memory-safe output.

The flow is stage-driven and artifact-centric: each phase produces explicit outputs that become the controlled inputs of the next phase.

---

## High-level migration path

```text
Legacy Repository
      |
      v
VyrixScout
      |
      v
Discovery Artifacts
      |
      v
NolaraStruct
      |
      v
Knowledge Graph
      |
      v
ZelvoxForge
      |
      v
Rust Application
      |
      v
VymosGate
      |
      v
Validated Modernized Output
```

---

## 1) Stage-by-stage flow

## 1.1 Legacy Repository -> VyrixScout (Discover)

**Input**
- Source code (multi-language possible)
- Build files and dependency manifests
- Config files, scripts, infra descriptors
- Binary/interface definitions where available

**What happens**
- Repository is scanned and fingerprinted
- File types, frameworks, runtimes, entrypoints, and dependency surfaces are identified
- Structural and operational metadata is extracted

**Output artifacts (Discovery Artifacts)**
- `inventory.json` (files, modules, languages, counts)
- `dependency-map.json` (declared and inferred dependencies)
- `runtime-surface.json` (services, endpoints, jobs, schedulers, I/O boundaries)
- `risk-seeds.json` (unsafe patterns, complexity hotspots, migration blockers)
- `discovery-report.md`

---

## 1.2 Discovery Artifacts -> NolaraStruct (Understand)

**Input**
- Discovery artifacts from VyrixScout
- Original repository sources for semantic parsing

**What happens**
- Parsers create AST/semantic models per language
- Cross-module relationships are resolved
- Control flow, data flow, and type/contract relationships are stitched into a unified model
- Domain boundaries and ownership zones are inferred

**Output artifacts (Knowledge Graph package)**
- `uir.bundle` (Unified Intermediate Representation)
- `kg.nodes.parquet` (entities: modules, services, tables, APIs, jobs)
- `kg.edges.parquet` (depends-on, calls, reads, writes, emits, consumes)
- `contracts.json` (API/schema/event contracts)
- `ownership-map.json` (team/domain ownership hints)
- `struct-report.md`

---

## 1.3 Knowledge Graph -> ZelvoxForge (Transform)

**Input**
- UIR + Knowledge Graph
- Policy profile (security, compliance, coding standards)
- Target architecture constraints (Rust runtime, async model, interface strategy)

**What happens**
- Transformation planner selects migration strategy by component risk and coupling
- Candidate rewrites are generated for selected units
- Unsafe patterns are replaced with memory-safe and concurrency-safe equivalents
- Integration shims/adapters are generated when full cutover is not immediate
- Human approval gates are applied for high-risk transformations

**Output artifacts (Rust Application package)**
- Rust workspace/crates structure
- Generated Rust source modules
- Adapter/shim layers
- Config and manifest updates
- Migration rationale and trace mappings:
  - `trace-map.json` (legacy symbol -> modern symbol)
  - `decision-log.json` (why each transform was applied)
  - `forge-report.md`

---

## 1.4 Rust Application -> VymosGate (Validate)

**Input**
- Generated Rust application and adapters
- Trace map and transformation decision log
- Validation policy set

**What happens**
- Build, lint, static checks, and policy checks execute
- Behavioral/regression equivalence checks run against defined baselines
- Security and compliance gates evaluate output
- Evidence is attached to each pass/fail decision

**Output artifacts (Validated Modernized Output)**
- `validation-report.md`
- `gate-results.json` (gate-by-gate outcomes)
- `equivalence-report.json`
- `sbom.spdx.json` (when enabled)
- `release-readiness.json`

---

## 2) Artifacts

Artifacts are first-class pipeline objects. They are immutable per run and versioned for traceability.

## 2.1 Artifact classes
1. **Discovery artifacts** (inventory, dependencies, runtime surface)
2. **Structural artifacts** (UIR, graph nodes/edges, contracts)
3. **Transformation artifacts** (generated code, adapters, trace map, decisions)
4. **Validation artifacts** (test evidence, policy outcomes, readiness status)

## 2.2 Artifact requirements
- Deterministic naming by run/stage/task
- Content hashing for integrity and deduplication
- Metadata envelope on each artifact:
  - `run_id`
  - `stage`
  - `producer`
  - `timestamp`
  - `schema_version`
  - `input_hashes`

## 2.3 Artifact lineage
Each artifact records:
- parent artifacts it depended on
- transformation step that produced it
- downstream artifacts derived from it

This enables full provenance from final Rust output back to legacy source evidence.

---

## 3) Transformations

Transformations are controlled, explainable, and policy-aware modifications from legacy semantics to modernized Rust semantics.

## 3.1 Transformation units
- Function/method level rewrites
- Module/component extraction
- Data model hardening (ownership/borrowing-safe redesigns)
- Concurrency model upgrades (shared mutable state reduction)
- Interface normalization (typed boundaries, safer error models)

## 3.2 Transformation modes
- **Advisory mode**: propose-only (no direct apply)
- **Assisted mode**: apply low-risk automatically, gate high-risk
- **Strict mode**: enforce approvals for all non-trivial rewrites

## 3.3 Safety controls
- Policy checks before apply
- Idempotent apply semantics
- Rollback via artifact version lineage
- Mandatory trace mapping from source to generated output

---

## 4) Storage points

Data is persisted at multiple control points to support resumability, auditability, and scale.

## 4.1 Primary storage locations
1. **Event Store**
   - Append-only lifecycle/domain events
   - Source of truth for run progression

2. **Artifact Store (Object Storage)**
   - Stage outputs and evidence bundles
   - Immutable, content-addressed blobs

3. **Knowledge Graph Store**
   - Node/edge datasets and query indexes
   - Optimized for relationship traversal

4. **Operational Metadata Store**
   - Run metadata, task states, approvals, locks, retries
   - Query-friendly control-plane state

5. **Projection/Read Model Store**
   - Materialized status views, dashboards, metrics

## 4.2 Stage persistence checkpoints
- Post-discovery checkpoint
- Post-structuring checkpoint
- Post-transformation checkpoint
- Post-validation checkpoint

These checkpoints allow restart/resume without replaying completed heavy compute steps.

---

## 5) Ownership

Ownership defines who is accountable for artifacts, decisions, and approvals at each flow segment.

## 5.1 System ownership by stage
- **VyrixScout** owns discovery completeness and inventory fidelity
- **NolaraStruct** owns semantic correctness of UIR/graph construction
- **ZelvoxForge** owns transformation correctness and traceability
- **VymosGate** owns validation integrity and release decision evidence

## 5.2 Human ownership (HITL)
- Platform/operator owners approve policy exceptions
- Domain/team owners approve high-impact behavioral rewrites
- Security/compliance owners approve gated risk findings

## 5.3 Data ownership model
- Artifact producer owns artifact correctness at creation time
- Orchestrator owns lifecycle truth (state transitions)
- Governance owners own final go/no-go acceptance decision

---

## 6) End-to-end traceability

For any final Rust module, the system can answer:
1. Which legacy files and symbols contributed to this output?
2. Which transformations were applied, and why?
3. Which policies/gates were evaluated?
4. Who approved risk-bearing decisions?
5. What validation evidence supports readiness?

This is enabled by artifact lineage + event history + decision logs.

---

## Summary

LegacyExodus data flow is a governed migration chain:

- **Legacy Repository** is discovered by **VyrixScout**
- outputs become structured by **NolaraStruct** into a **Knowledge Graph**
- graph-driven plans are transformed by **ZelvoxForge** into a **Rust Application**
- final output is verified by **VymosGate** into **Validated Modernized Output**

Across the journey, artifacts are immutable, transformations are traceable, storage is checkpointed, and ownership is explicit.****
