# Failure Recovery

> **Status: TARGET ARCHITECTURE — NOT IMPLEMENTED.** This document describes a future recovery design. The current core runs analysis in one process and has no worker pools, checkpoints or dead-letter queues; a failed run is rerun from the start.

## Purpose

LegacyExodus is a long-running, multi-stage modernization system.  
Failure recovery is a core architectural concern because runs can span large repositories, multiple worker pools, asynchronous dependencies, and human approval gates.

This document defines how LegacyExodus preserves progress, recovers safely from failures, and escalates when automation is no longer trustworthy.

---

## Recovery principles

1. **Never lose authoritative state**  
   All lifecycle transitions are event-sourced and append-only.

2. **Resume instead of restart**  
   Stage-level checkpoints allow continuation from the last consistent boundary.

3. **Retry only when safe**  
   Retries are policy-driven, bounded, and idempotent.

4. **Isolate poison work**  
   Dead-letter handling prevents one bad task from blocking global progress.

5. **Escalate with context**  
   Human operators receive complete evidence and decision options.

6. **Preserve traceability**  
   Every failure, retry, escalation, and rollback action is auditable.

---

## High-level failure flow

```text
Migration Job
      |
      v
Checkpoint Created
      |
      v
Stage Execution
      |
      |
   Failure?
      |
 ----------------
 |              |
No             Yes
 |              |
Continue       Retry
                |
          Retry Limit?
                |
          No -----> Retry with Backoff
          |
          Yes
          |
          v
      Human Review
          |
   ------------------------
   |          |           |
Resume     Rollback     Cancel
```

---

## 1) Failure domains

Failures are classified by domain because each domain has different recovery behavior.

## 1.1 Transient infrastructure failures
- Network timeout
- Temporary service unavailability
- Queue delay/lease expiration
- External API rate limiting

**Default action:** bounded retry with exponential backoff + jitter.

## 1.2 Deterministic processing failures
- Parser crash on specific construct
- Contract/schema mismatch
- Policy rule hard-fail
- Non-recoverable transformation invariant violation

**Default action:** do not blind-retry; escalate or route to dead letter based on policy.

## 1.3 Resource failures
- OOM/CPU throttling
- Disk pressure in workspace
- Artifact store quota exceeded

**Default action:** retry after resource rebalance or move to constrained recovery lane.

## 1.4 Human-gated failures
- Approval timeout
- Explicit rejection
- Missing mandatory reviewer role

**Default action:** pause run, notify owners, await decision.

---

## 2) Checkpoints

Checkpoints are durable consistency boundaries that enable safe resume.

## 2.1 Checkpoint scope
LegacyExodus creates checkpoints at:
1. Run initialization
2. End of each pipeline stage
3. Before and after high-risk transformation batches
4. Before validation gate execution
5. On manual pause/escalation transitions

## 2.2 Checkpoint contents
Each checkpoint stores:
- `run_id`, `stage`, `checkpoint_id`
- input artifact references + hashes
- completed task ids
- pending task queue snapshot
- policy/profile version
- worker/runtime metadata
- projection offset / event sequence watermark

## 2.3 Checkpoint integrity
- Checkpoint write is atomic
- Content-addressed references protect against silent drift
- Corrupt/incomplete checkpoints are rejected and flagged for operator action

---

## 3) Resume capability

Resume restores execution from the latest valid checkpoint instead of replaying entire pipeline compute.

## 3.1 Resume triggers
- Worker crash/restart
- Orchestrator restart
- Manual operator resume
- Post-escalation approval to continue

## 3.2 Resume algorithm (logical)
1. Load latest valid checkpoint for run/stage
2. Verify artifact hash consistency
3. Rebuild in-memory state from event stream + checkpoint watermark
4. Requeue only incomplete/idempotent-safe tasks
5. Reacquire stage lock
6. Continue execution from checkpoint boundary

## 3.3 Resume guarantees
- No duplicate authoritative state commits
- Deterministic continuation under same policy/profile
- Explicit event emitted: `RunResumed` (with reason and checkpoint id)

---

## 4) Retries

Retries are applied only when failure class is retryable and operation is idempotent-safe.

## 4.1 Retry policy model
Per task type:
- `max_attempts`
- `initial_delay_ms`
- `backoff_multiplier`
- `max_delay_ms`
- `jitter_ratio`
- `retryable_error_codes`

## 4.2 Retry decision
A failure is retried only if:
1. error class is retryable
2. attempt count < max_attempts
3. idempotency contract is satisfied
4. task is not policy-blocked

Otherwise task is escalated or dead-lettered.

## 4.3 Retry observability
Each retry attempt emits:
- `TaskRetryScheduled`
- attempt number
- prior error fingerprint
- next execution time
- correlation and causation ids

---

## 5) Dead letter handling

Dead-letter queues (DLQ) isolate poison tasks and prevent pipeline-wide blocking.

## 5.1 When tasks go to DLQ
- Max retries exhausted
- Non-retryable deterministic failure
- Contract violation payload
- Security/policy hard block requiring manual intervention

## 5.2 DLQ payload requirements
DLQ record includes:
- original task envelope
- failure stack/reason
- retry history
- artifact refs
- worker/runtime context
- recommended triage action

## 5.3 DLQ operations
Operators can:
- inspect and classify
- patch/replay task with override token
- requeue to normal lane
- route to specialized recovery lane
- permanently close with documented rationale

Each action is evented and audited.

---

## 6) Rollback strategy

Rollback scope depends on what has already been committed and published.

## 6.1 Rollback levels
1. **Task rollback**  
   Revert local transient effects; no authoritative state reversal required.

2. **Stage rollback**  
   Rewind to prior stage checkpoint; invalidate stage outputs after rollback point.

3. **Run rollback**  
   Mark run as rolled back/cancelled; preserve full evidence for restart under new run id.

4. **Artifact rollback**  
   Revert promoted artifact pointers to last known good version (immutable blobs remain intact).

## 6.2 Rollback rules
- Never delete historical events (append compensating events instead)
- Never mutate immutable artifacts in place
- Use compensating transitions (e.g., `TransformationReverted`, `RunRolledBack`)
- Require elevated approval for rollback after cross-stage promotion boundaries

## 6.3 Forward-fix vs rollback
If failure is localized and safe to patch, forward-fix is preferred over broad rollback.  
Rollback is used when correctness or compliance confidence drops below threshold.

---

## 7) Human escalation

Automation stops at predefined trust boundaries and escalates with full context.

## 7.1 Escalation triggers
- Retry limit exceeded
- Repeated deterministic failures in same stage unit
- Policy/security hard-fail
- Ambiguous transformation semantics
- Approval timeout or conflict
- Validation uncertainty across critical gates

## 7.2 Escalation package
Human reviewers receive:
- run and stage summary
- checkpoint reference
- failure timeline
- impacted artifacts and lineage
- suggested options:
  - Resume
  - Skip non-critical unit
  - Rollback stage
  - Cancel run
  - Apply policy override (if permitted)

## 7.3 Decision accountability
Escalation decisions require:
- actor identity
- role/policy authority check
- rationale text
- timestamp and signature record

Decision events:
- `EscalationRaised`
- `EscalationAcknowledged`
- `EscalationResolved`
- `ManualOverrideApplied` (if applicable)

---

## 8) Stage-specific recovery behavior

## 8.1 VyrixScout (Discover)
- Re-scan can be partition-resumed by path shard
- Inventory merges are idempotent
- Missing shard retries do not invalidate completed shards

## 8.2 NolaraStruct (Understand)
- Parser unit retries at file/module granularity
- Graph build resume from partial node/edge batches
- Corrupt batch quarantined to DLQ for targeted triage

## 8.3 ZelvoxForge (Transform)
- Transformation batches are checkpointed before apply
- High-risk deltas require approval before irreversible promotions
- Failed batch can be rolled back without discarding prior successful batches

## 8.4 VymosGate (Validate)
- Gate execution can retry per gate/test shard
- Critical gate failure pauses promotion
- Non-critical gate behavior governed by policy profile

---

## 9) Operational controls and SLO alignment

## 9.1 Recovery controls
- Global kill switch for new task dispatch
- Per-run pause/resume controls
- Stage-level concurrency throttles during incident conditions
- Circuit breakers for unstable dependencies

## 9.2 Suggested SLO-aligned targets (example)
- Resume from checkpoint within defined recovery window
- Retry success ratio monitored per dependency
- DLQ growth rate alerting
- Mean time to human acknowledgment for escalations

(Exact numeric SLOs should be defined in operations policy.)

---

## 10) State machine (simplified)

```text
Queued
  -> Running
      -> (FailureDetected)
          -> Retrying
              -> Running
              -> Escalated
          -> Escalated
      -> Paused
          -> Resuming
              -> Running
      -> Completed
      -> Cancelled
      -> RolledBack
```

All transitions are event-backed and authorization-checked.

---

## 11) Audit and compliance

Recovery actions are first-class auditable events:
- checkpoint creation and restoration
- retry scheduling and outcomes
- DLQ routing and replay
- rollback decisions and compensations
- human escalation decisions and overrides

This ensures post-incident reconstruction and compliance reporting can be generated without ambiguity.

---

## Summary

LegacyExodus recovery architecture is built to keep long-running modernization jobs safe and controllable:

- **Checkpoints** preserve progress at deterministic boundaries  
- **Resume** continues from last valid state  
- **Retries** handle transient instability with bounded policy  
- **Dead-letter handling** isolates poison tasks  
- **Rollback** uses compensating, auditable strategies  
- **Human escalation** governs uncertainty and high-risk decisions

This model enables resilient modernization at enterprise scale without sacrificing traceability or governance.
