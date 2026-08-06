# Communication Patterns

## Purpose

This document defines how LegacyExodus components communicate across the modernization runtime.  
The system uses explicit message types and strict contracts so that behavior is deterministic, auditable, and safe.

Communication is organized into five patterns:

1. **Commands** (intent to change state)
2. **Events** (facts that state changed)
3. **Queries** (read-only state retrieval)
4. **APIs** (external and inter-service interfaces)
5. **Internal contracts** (schemas, versioning, compatibility rules)

---

## 1) Core model at a glance

```text
Client (CLI/API)
   |
   | Command
   v
Orchestrator  -----> Command Handlers
   |                      |
   | emits                | appends facts
   v                      v
Event Bus ------------> Event Handlers / Projections
                              |
                              | updates
                              v
                         Read Models / State Views
                              ^
                              | Query
                        CLI / API / Services
```

---

## 2) Commands

Commands are requests to perform an action that may change system state.  
They are **imperative**, **validated**, and **handled exactly once logically** (with idempotency protection).

## 2.1 Command characteristics
- Represent user/system intent
- Target one bounded context/aggregate
- Include correlation + causation metadata
- Must pass schema and policy validation before execution
- Produce zero or more events

## 2.2 Command envelope (logical shape)
```json
{
  "command_id": "cmd_01J...",
  "type": "StartMigration",
  "run_id": "run_01J...",
  "timestamp": "2026-08-06T00:00:00Z",
  "actor": {
    "type": "user",
    "id": "raitaskeen"
  },
  "payload": {},
  "metadata": {
    "correlation_id": "corr_01J...",
    "causation_id": "cause_01J...",
    "idempotency_key": "idem_..."
  }
}
```

## 2.3 Example commands
- `StartMigration`
- `PauseMigration`
- `ResumeMigration`
- `CancelMigration`
- `RunDiscovery`
- `BuildKnowledgeGraph`
- `ProposeTransformationBatch`
- `ApplyTransformationBatch`
- `RequestApproval`
- `RecordApprovalDecision`
- `RunValidationGate`
- `FinalizeMigration`

## 2.4 Command handling rules
1. Validate schema
2. Validate authorization/policy
3. Acquire run/stage lock
4. Execute domain logic
5. Append resulting events
6. Return acknowledgment/result handle

If command fails validation, no domain event is emitted.

---

## 3) Events

Events are immutable facts describing something that already happened.  
They are **past tense**, append-only, and form the primary audit trail.

## 3.1 Event characteristics
- Immutable and timestamped
- Ordered per run/aggregate
- Consumable by multiple handlers
- Safe for replay (idempotent consumers required)

## 3.2 Event envelope (logical shape)
```json
{
  "event_id": "evt_01J...",
  "type": "MigrationStarted",
  "run_id": "run_01J...",
  "sequence": 42,
  "timestamp": "2026-08-06T00:00:01Z",
  "payload": {},
  "metadata": {
    "correlation_id": "corr_01J...",
    "causation_id": "cmd_01J...",
    "schema_version": 1
  }
}
```

## 3.3 Example events
- `MigrationStarted`
- `DiscoveryStarted`
- `DiscoveryCompleted`
- `KnowledgeGraphBuildStarted`
- `KnowledgeGraphBuilt`
- `TransformationProposed`
- `TransformationApplied`
- `ApprovalRequired`
- `ApprovalGranted`
- `ApprovalRejected`
- `ValidationStarted`
- `ValidationPassed`
- `ValidationFailed`
- `MigrationCompleted`
- `MigrationFailed`
- `MigrationCancelled`

## 3.4 Event consumption
Consumers include:
- Stage dispatchers
- Projection builders (read models)
- Notification services
- Audit/compliance recorders
- Metrics/telemetry processors

Delivery is at-least-once; consumers must deduplicate by `event_id`.

---

## 4) Queries

Queries retrieve state without modifying it.  
They run against read models/projections, not command handlers.

## 4.1 Query characteristics
- Side-effect free
- Optimized for read use-cases
- Can aggregate multiple event-derived projections
- May include authorization filtering

## 4.2 Query examples
- `GetProjectState`
- `GetRunStatus`
- `GetStageProgress`
- `GetApprovalQueue`
- `GetArtifactLineage`
- `GetValidationResults`
- `GetRiskSummary`
- `GetTransformationTraceMap`

## 4.3 Example query flow
```text
CLI: GetProjectState(run_id)
   -> Query API
   -> Read Model Store
   -> ProjectState DTO returned
```

## 4.4 Query response model
Responses should include:
- requested state snapshot
- projection timestamp (staleness visibility)
- pagination cursors where applicable
- optional consistency token/etag

---

## 5) APIs

LegacyExodus exposes APIs at two boundaries:

1. **External APIs** (CLI and/or HTTP/gRPC) for users/platforms
2. **Internal APIs** for service-to-service coordination

## 5.1 External API principles
- Contract-first schema definitions
- Strong validation and typed errors
- Idempotency for mutation endpoints
- Long-running operations return operation/run handles

### External API examples
- `POST /migrations` -> issues `StartMigration`
- `POST /migrations/{runId}/pause` -> issues `PauseMigration`
- `GET /migrations/{runId}` -> `GetRunStatus`
- `GET /migrations/{runId}/state` -> `GetProjectState`
- `GET /migrations/{runId}/artifacts` -> artifact index

## 5.2 Internal API principles
- Prefer async messaging for stage transitions
- Use sync RPC only for bounded low-latency dependencies
- Enforce mTLS/service identity where applicable
- Propagate trace/correlation ids end-to-end

### Internal API examples
- Orchestrator -> Worker Dispatcher: submit stage task
- Worker -> Artifact Service: publish artifact metadata
- Gate Service -> Policy Service: evaluate rule set
- Projection Service -> Event Store: subscribe/read events

---

## 6) Internal contracts

Internal contracts keep components decoupled while preserving compatibility.

## 6.1 Contract categories
1. **Message contracts**: command/event/query schemas
2. **Artifact contracts**: artifact metadata + content schema
3. **Service contracts**: API request/response definitions
4. **Policy contracts**: rule input/output schema
5. **Identity contracts**: actor, approval, and ownership records

## 6.2 Contract rules
- Every contract has explicit version (`v1`, `v2`, …)
- Backward-compatible changes are additive
- Breaking changes require:
  - new version
  - migration plan
  - dual-read/dual-write window (if needed)
- Unknown fields must be safely ignored where defined
- Required fields must never be silently removed

## 6.3 Schema governance
- Schemas stored in a central contract registry directory
- CI validates compatibility on pull requests
- Runtime rejects unknown-breaking payloads
- Contract tests verify producer/consumer alignment

---

## 7) Canonical examples

## 7.1 Command example
**Command:** `StartMigration`

Intent: begin a modernization run for a target repository/workspace.

Possible outcomes:
- Accepted -> emits `MigrationStarted`
- Rejected -> validation/authorization error (no event)

## 7.2 Event example
**Event:** `MigrationStarted`

Fact: run lifecycle has entered active state and planning/dispatch may begin.

Downstream consumers:
- stage scheduler
- progress projection
- audit logger

## 7.3 Query example
**Query:** `GetProjectState`

Read model returns:
- current stage
- stage completion percentages
- pending approvals
- latest artifacts
- gate status summary

---

## 8) Error and reliability patterns

## 8.1 Commands
- Validation errors -> synchronous reject
- Conflict errors (lock/version mismatch) -> retry guidance
- Timeout/transient infra errors -> retry with same idempotency key

## 8.2 Events
- Failed consumers -> retry with backoff
- Poison events -> dead-letter queue + operator alert
- Replay supported for projection rebuilds

## 8.3 Queries
- If projection lag exists, response includes `as_of` timestamp
- Optional strong-consistency mode can block until minimum event offset is reached

---

## 9) Security and trust boundaries

- All command issuers are authenticated and authorized
- Approval commands require elevated policy scope
- Sensitive payload fields are redacted in logs where required
- Event and API access is scoped by actor/project permissions
- Full traceability maintained via correlation/causation ids

---

## 10) Summary

LegacyExodus communication is built on explicit, typed interactions:

- **Commands** express intent (`StartMigration`)
- **Events** record facts (`MigrationStarted`)
- **Queries** read state (`GetProjectState`)
- **APIs** expose controlled external/internal interfaces
- **Internal contracts** guarantee compatibility and safe evolution

This model ensures modernization workflows remain predictable, scalable, and auditable across all four pipeline stages.
