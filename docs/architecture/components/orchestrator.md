# Orchestrator Component

> **Status:** `PARTIAL`. The current orchestrator validates and coordinates implemented discovery and static-analysis commands, durable storage commit, synchronous post-commit delivery, and projection. Four-stage migration execution, policy authorization, retries, pause/resume, quarantine, distributed coordination, AI routing, and migration checkpoints are `TARGET ARCHITECTURE`.

## Overview

The Orchestrator is the current analysis workflow coordinator and the intended future control boundary for LegacyExodus.
It presently coordinates implemented analysis stages and preserves their commit semantics.

It is the single authoritative runtime coordinator between commands and stage execution:

```text
Commands
   |
   v
Orchestrator
   |
   +---- VyrixScout
   |
   +---- NolaraStruct
   |
   +---- ZelvoxForge
   |
   +---- VymosGate
```

The Orchestrator does not replace stage logic.  
Instead, it controls **when**, **how**, and **under what policies** each stage executes.

---

## 1) Purpose

The Orchestrator exists to:

1. Translate user/system commands into governed execution plans.
2. Sequence stage execution across the four-stage pipeline.
3. Enforce trust boundaries and policy gates.
4. Coordinate retries, checkpoints, and failure recovery.
5. Provide deterministic state transitions and auditability.
6. Prevent uncontrolled stage-to-stage coupling.

### Core Objective

Enable AI-assisted, plugin-extended modernization while keeping system behavior deterministic, auditable, and safe.

---

## 2) Responsibilities

### 2.1 Command Intake and Planning
- Accept execution commands (run, resume, validate-only, dry-run, etc.).
- Validate command intent, scope, and permissions.
- Resolve applicable policies, architecture constraints, and environment profile.
- Build an execution plan with explicit stage transitions.

### 2.2 Stage Orchestration
- Invoke stages in authoritative order:
  1. VyrixScout
  2. NolaraStruct
  3. ZelvoxForge
  4. VymosGate
- Enforce input/output contract validation between stages.
- Prevent stage skipping unless explicitly allowed by policy (e.g., validate-only from existing artifacts).

### 2.3 Governance Enforcement
- Require policy decision points before sensitive transitions.
- Ensure AI interactions occur only through AI Gateway controls.
- Ensure provenance continuity across all produced artifacts.

### 2.4 State and Progress Management
- Track run state, stage state, retry state, and checkpoint lineage.
- Persist deterministic run timeline for replay and audit.
- Emit normalized events for observability and external systems.

### 2.5 Reliability Coordination
- Handle transient failures with bounded retry policies.
- Escalate non-recoverable failures to terminal states.
- Support resumable execution from valid checkpoints.

---

## 3) Lifecycle Management

The Orchestrator manages each modernization run as a state machine.

### 3.1 Run Lifecycle (Normative)

```text
Created -> Planned -> Authorized -> Running -> (Paused | Completed | Failed | Quarantined | Cancelled)
```

### 3.2 Stage Lifecycle (Per Stage)

```text
Pending -> Ready -> Executing -> (Succeeded | Retrying | Failed | Quarantined | Skipped)
```

### 3.3 Transition Rules

- A stage may enter `Ready` only when all upstream prerequisites are satisfied.
- A stage may enter `Executing` only after contract + policy checks pass.
- `Succeeded` requires output schema validity and provenance linkage.
- `Retrying` requires retry policy eligibility.
- `Quarantined` is mandatory for policy/security violations.
- `Completed` requires required pipeline gates to pass (including VymosGate).

---

## 4) Event Handling

The Orchestrator is event-driven and emits/consumes typed events.

### 4.1 Event Categories

- **Command Events**: run requested, paused, resumed, cancelled.
- **Stage Events**: started, progress, completed, failed.
- **Policy Events**: allow, deny, quarantine decisions.
- **Checkpoint Events**: created, restored, invalidated.
- **Audit Events**: evidence recorded, compliance markers.
- **System Events**: timeout, dependency unavailable, degraded mode.

### 4.2 Event Handling Rules

- All incoming events must be schema-validated.
- Duplicate events must be idempotently handled.
- Out-of-order events must not corrupt run state.
- Event processing failures must be observable and retriable when safe.

### 4.3 Minimum Event Metadata

Each event should include:

- `run_id`
- `stage`
- `event_type`
- `event_version`
- `timestamp`
- `correlation_id`
- `actor/service_identity`
- `policy_context` (when applicable)

---

## 5) Retry Coordination

Retries are coordinated centrally by the Orchestrator, not by ad hoc stage behavior.

### 5.1 Retry Policy Model

Retries must be:

- bounded (max attempts)
- classified (transient vs terminal)
- backoff-controlled (e.g., exponential + jitter)
- policy-aware (no retry on denied/quarantined policy states)

### 5.2 Retry Eligibility

A failure may be retried only if:

- failure type is explicitly retryable
- no trust-boundary violation occurred
- no irreversible side effect violates idempotency guarantees
- retry budget remains available

### 5.3 Non-Retryable Failures (Examples)

- schema contract violation
- provenance break
- policy deny/quarantine
- security control breach

---

## 6) Checkpoint Management

Checkpoints allow safe pause/resume and partial replay.

### 6.1 Checkpoint Purpose

- Reduce reprocessing cost for long-running workflows.
- Provide deterministic recovery points.
- Support controlled rollback/resume behavior.

### 6.2 Checkpoint Boundaries

Recommended checkpoint points:

1. Post-VyrixScout artifact finalization
2. Post-NolaraStruct knowledge model snapshot
3. Post-ZelvoxForge transformation bundle generation
4. Pre/post-VymosGate verification outputs

### 6.3 Checkpoint Rules

- Checkpoints must reference immutable artifact hashes.
- Checkpoints must capture policy and contract versions.
- Resume is allowed only from validated checkpoints.
- Corrupt/incomplete checkpoints must be invalidated and quarantined.

---

## 7) Failure Handling

The Orchestrator enforces fail-safe behavior.

### 7.1 Failure Classification

- **Transient**: infrastructure/network/provider temporary issues
- **Deterministic**: schema mismatch, invalid contract, policy conflict
- **Security**: trust boundary breach, secret leakage risk, unauthorized access
- **Dependency**: unavailable model/provider/service

### 7.2 Failure Actions

- Transient: retry within budget.
- Deterministic: fail stage/run with actionable diagnostics.
- Security: immediate quarantine, high-severity audit event, halt downstream execution.
- Dependency: fallback strategy or controlled pause, based on policy.

### 7.3 Fail-Closed Principle

When uncertainty affects safety, policy, or integrity, default action is **deny/quarantine**, not continue.

---

## 8) Communication Contracts

The Orchestrator communicates with stages and subsystems through explicit contracts only.

### 8.1 Contract Requirements

For every command, stage invocation, and stage output:

- typed schema
- version identifier
- capability declaration (where plugin-based)
- provenance requirements
- policy context

### 8.2 Prohibited Communication Patterns

- direct stage-to-stage hidden dependencies
- mutable shared state without contract mediation
- undocumented side channels bypassing event bus/API contracts
- AI/provider direct calls that bypass AI Gateway

### 8.3 Compatibility Policy

- Backward-compatible changes use minor contract increments.
- Breaking changes require major contract version changes and rollout controls.
- Unsupported contract versions must be rejected at runtime.

---

## 9) Security and Governance Invariants

The Orchestrator must always enforce:

1. Stage order and trust-boundary order are preserved.
2. Untrusted inputs are sandboxed before parsing/analysis.
3. AI access is policy-gated through AI Gateway only.
4. Provenance chain remains unbroken across artifacts.
5. Validation authority remains with VymosGate and governance policy.
6. Human approval gates remain required for critical execution decisions.

---

## 10) Observability and Auditability

### Required Operational Signals

- run throughput and completion rate
- stage latency percentiles
- retry counts and exhaustion rates
- checkpoint restore success/failure
- quarantine/deny decision rates

### Required Audit Signals

- who/what initiated run
- policy versions applied
- contract versions used
- artifact lineage and hashes
- final decision path (including approvals)

---

## 11) Summary

The Orchestrator is the deterministic control layer that makes LegacyExodus safe to scale:

- It coordinates all stages.
- It enforces governance and trust boundaries.
- It manages retries, checkpoints, and failures.
- It preserves auditability and execution integrity.

Without the Orchestrator, the platform becomes a set of disconnected capabilities.  
With it, LegacyExodus operates as a controlled modernization system.
