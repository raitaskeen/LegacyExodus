# Runtime Architecture

## How the system actually runs

LegacyExodus runs as a deterministic, event-driven modernization engine.  
A user-triggered command enters through a CLI boundary, is validated and planned by the orchestrator, and then progresses through staged workers connected by an internal event bus.

The runtime is designed around five core principles:

1. **Deterministic execution** (same input + same policies => same run plan)
2. **Event-sourced state transitions** (append-only audit trail)
3. **Isolated stage workers** (clear capability boundaries)
4. **Human-in-the-loop control points** for risky modernization actions
5. **Replayability and resumability** for reliability and compliance

---

## High-level runtime flow

```text
User
  |
CLI Command / API Trigger
  |
Orchestrator (validate, plan, enforce policy)
  |
Event Bus (durable, ordered per run)
  |
Pipeline Stage Executor
  |-----------------------------------------------|
  | VyrixScout -> NolaraStruct -> ZelvoxForge -> VymosGate |
  |-----------------------------------------------|
  |
Domain Services (parsers, graph, generation, validation)
  |
Storage (events, projections, artifacts, reports)
```

---

## 1) Processes

At runtime, the system is composed of cooperating processes/services:

### 1.1 Entry process (CLI/API)
- Accepts user commands (e.g., workspace path, profile, target language/runtime).
- Performs boundary validation (schema, auth context, required flags).
- Submits a normalized command envelope to the orchestrator.

### 1.2 Orchestrator process
- Central control-plane for execution lifecycle.
- Validates command against policy and project constraints.
- Creates and advances a **run** through the four pipeline stages.
- Appends authoritative events to the event store.
- Handles retries, compensations, and manual approval gates.

### 1.3 Event bus
- Internal transport for command/result/status events.
- Guarantees per-run ordering semantics.
- Decouples orchestrator from stage workers and projections.

### 1.4 Stage workers
- Worker pools grouped by stage:
  - **VyrixScout workers**: discovery and inventory
  - **NolaraStruct workers**: semantic extraction and graphing
  - **ZelvoxForge workers**: transformation planning/generation
  - **VymosGate workers**: verification and compliance checks
- Workers execute scoped tasks and emit results/intents back to orchestrator.

### 1.5 Projection/read-model updaters
- Consume domain events and build query-optimized views:
  - run status and progress
  - stage metrics
  - risk/approval queue
  - artifact index

### 1.6 Storage services
- Event store (append-only)
- Snapshot/checkpoint store
- Artifact/object store (generated code, reports, manifests)
- Knowledge graph persistence
- Operational metadata DB (runs, locks, queues, users, approvals)

---

## 2) Execution lifecycle

A modernization run follows a strict lifecycle:

### 2.1 Command intake
1. User invokes CLI/API.
2. Input is validated and normalized.
3. `RunRequested` event is appended.

### 2.2 Planning and guardrails
1. Orchestrator resolves:
   - workspace/repository scope
   - modernization profile
   - policy/risk settings
2. Stage plan is materialized.
3. Human approval gates are inserted where required.
4. `RunPlanned` event is appended.

### 2.3 Stage execution (ordered progression)
The run advances through four ordered stages:

1. **VyrixScout (Discover)**
   - inventory files, binaries, frameworks, dependencies
   - detect language/runtime boundaries
   - output: discovery manifest  
   - emits: `DiscoveryStarted`, `DiscoveryCompleted`

2. **NolaraStruct (Understand)**
   - parse source/assets
   - build semantic model + dependency graph
   - output: unified intermediate representation (UIR)  
   - emits: `StructuringStarted`, `GraphBuilt`, `StructuringCompleted`

3. **ZelvoxForge (Transform)**
   - generate transformation plans and modernization candidates
   - apply safe transformations in controlled batches
   - request HITL approval for high-risk deltas
   - output: transformed artifacts + rationale  
   - emits: `TransformationProposed`, `TransformationApplied`, `ApprovalRequired`, `ApprovalGranted`

4. **VymosGate (Validate)**
   - run policy, security, consistency, and quality checks
   - execute equivalence/regression gates
   - output: validation report + release readiness decision  
   - emits: `ValidationStarted`, `ValidationPassed|ValidationFailed`

### 2.4 Completion semantics
- Final states:
  - `Succeeded`
  - `PartiallySucceeded` (non-blocking failures with documented exceptions)
  - `Failed`
  - `Cancelled`
- `RunCompleted` event closes lifecycle.
- Artifacts, reports, and full audit trail are persisted.

---

## 3) Concurrency model

LegacyExodus uses controlled parallelism while preserving deterministic outcomes.

### 3.1 Parallelizable units
- File hashing and inventory traversal
- AST parsing per file/module
- Independent graph enrichment tasks
- Transformation candidate scoring
- Validation/test shards

### 3.2 Deterministic state commitment
- Workers run tasks in parallel but **do not commit shared state directly**.
- Orchestrator is the single authoritative committer of run-state events.
- Event commit order is deterministic per run aggregate.

### 3.3 Isolation boundaries
- Per-run workspace isolation
- Resource quotas per worker pool
- Concurrency caps by stage/profile
- Cancellation tokens propagated across active tasks

### 3.4 Idempotency
- Every task has an idempotency key.
- Re-delivered jobs produce same result envelope or are deduplicated.
- Safe replay enabled through event-sourced reconstruction.

---

## 4) Background jobs

Not all work is user-blocking. The runtime schedules background jobs for:

1. Incremental re-indexing after source changes
2. Knowledge graph compaction/enrichment
3. Artifact packaging and export bundles
4. Telemetry aggregation and operational rollups
5. Retry queues for transient errors (network/toolchain/parser)
6. Cleanup of expired temp workspaces and caches

Background jobs are:
- resumable
- idempotent
- traceable via the same event/audit model

---

## 5) Workers

Workers are capability-scoped executors.

### 5.1 Worker contract (logical)
Each worker receives:
- task envelope (task id, run id, stage, payload)
- execution context (policy, limits, tool adapters, cancellation token)
- correlation metadata (trace id, causation id)

Each worker returns:
- success/failure result
- produced artifacts/metrics
- emitted observations/findings
- optional follow-up task intents

### 5.2 Security posture
- Least-privilege runtime permissions
- Sandboxed execution for untrusted transformations/tools
- No direct write access to authoritative run-state tables
- Secrets obtained through short-lived scoped credentials

### 5.3 Failure behavior
- Retry on transient failure with bounded exponential backoff
- Fast-fail on policy violations or deterministic hard errors
- Dead-letter routing for poison tasks
- Escalation events surfaced to operator/HITL queue

---

## 6) Event handling

Event handling is the backbone of runtime coordination.

### 6.1 Core pattern
`Command -> Validate -> Append Event -> Dispatch -> Handle -> Project`

### 6.2 Event classes
- **Lifecycle events**: run/stage started, completed, cancelled
- **Domain events**: inventory built, graph updated, transform proposed
- **Control events**: approval required/granted/rejected
- **Operational events**: retry scheduled, worker timeout, dead-lettered
- **Audit events**: actor actions, policy decisions, gate outcomes

### 6.3 Delivery guarantees
- At-least-once delivery on internal bus
- Per-run ordered consumption where required
- Idempotent handlers for duplicate deliveries

### 6.4 Projections/read models
Asynchronously maintained projections provide:
- real-time progress dashboards
- stage duration and throughput metrics
- approval queue state
- artifact lineage and traceability views

### 6.5 Auditability
Every critical decision point is reconstructable:
- who triggered it
- what inputs/policies were active
- what action was taken
- which evidence justified the decision
- what outputs were produced

---

## Runtime sequence (typical modernization run)

```text
1. User submits command
2. Orchestrator validates + plans run
3. RunStarted event appended
4. VyrixScout tasks dispatched/executed
5. DiscoveryCompleted event appended
6. NolaraStruct tasks dispatched/executed
7. GraphBuilt + StructuringCompleted events appended
8. ZelvoxForge proposes transformations
9. ApprovalRequired event emitted (if high risk)
10. Human approves/rejects
11. Approved transformations applied
12. VymosGate executes validation gates
13. ValidationPassed/Failed event appended
14. RunCompleted event appended
15. Reports/artifacts finalized
```

---

## Operational characteristics

- **Scalable**: horizontal worker pools by stage
- **Resilient**: retries, checkpointing, dead-letter handling
- **Deterministic**: single-writer event commitment
- **Explainable**: end-to-end event/audit trail
- **Governable**: policy and HITL integrated into runtime flow

---

## Summary

LegacyExodus “actually runs” as a staged, event-orchestrated execution system:

- commands enter through a strict boundary,
- orchestrator controls lifecycle and policy,
- workers perform isolated stage tasks concurrently,
- events coordinate transitions and persistence,
- validation gates determine final modernization readiness.

This architecture enables safe, auditable modernization at enterprise scale without sacrificing control, determinism, or traceability.
