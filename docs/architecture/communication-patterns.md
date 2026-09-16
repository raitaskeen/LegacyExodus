# LegacyExodus Communication Patterns

> **Status:** `PARTIAL`. The current core has typed command handlers, immutable domain events, an append-only journal, a synchronous deterministic event bus, and storage-backed projections. Distributed messaging, asynchronous brokers, multi-tenant metadata, migration commands, governance approval commands, dashboards, and cross-service CQRS read models are `TARGET ARCHITECTURE`.

## 1. Purpose

This document defines how components inside LegacyExodus communicate to coordinate modernization work safely and predictably.

It answers:

- How requests are issued
- How state changes are announced
- How read access is separated from write operations
- How contracts keep cross-layer interactions stable

---

## 2. Communication Model Overview

The current core uses a local command/event separation inspired by message-oriented and CQRS patterns:

- **Commands** trigger intent to change state.
- **Events** record facts that state changed.
- **Queries** read current or historical state without causing mutation.

This model provides:

- deterministic orchestration for safety-critical flows
- replayable evidence for governance and audit
- loose coupling among implemented discovery and analysis components

---

## 3. Core Message Types

## 3.1 Commands (Intent to Change State)

Commands are imperative requests handled by one responsible component.

Current and target examples (check their state before use):

- `AnalyzeProjectCommand`
- `StartMigrationCommand` (`NOT IMPLEMENTED`)
- `ApproveMigrationCommand` (`NOT IMPLEMENTED`)

Command characteristics:

- directed to a single handler (single owner)
- validated before execution
- idempotency key required for retry safety
- produce zero or more events as outcomes

Example intent:

- `AnalyzeProjectCommand` → start discovery pipeline for a target system
- `StartMigrationCommand` → initiate approved transformation plan execution
- `ApproveMigrationCommand` → authorize release transition after governance checks

---

## 3.2 Events (Facts About Completed Change)

Events represent immutable facts that something happened.

Examples:

- `ProjectDiscovered`
- `DependencyMapped`
- `KnowledgeCreated`
- `TransformationCompleted`
- `ValidationPassed`

Event characteristics:

- append-only and immutable
- timestamped with provenance metadata
- may be consumed by multiple downstream subscribers
- form the auditable evidence chain for modernization decisions

Example outcomes:

- `ProjectDiscovered` emitted after inventory baseline is persisted
- `DependencyMapped` emitted when dependency topology is captured
- `KnowledgeCreated` emitted when normalized graph artifacts are committed
- `TransformationCompleted` emitted when staged artifacts are produced
- `ValidationPassed` emitted when policy/test gates succeed

---

## 3.3 Queries (Read-Only Access)

Queries retrieve information without changing system state.

Examples:

- `GetProjectState`
- `GetKnowledgeGraph`
- `GetMigrationStatus`

Query characteristics:

- side-effect free
- optimized for read models / projections
- can expose current snapshot and historical trend views
- access-controlled by trust boundary and role policy

---

## 4. Event-Driven Architecture in LegacyExodus

The current core coordinates discovery and analysis through local domain events. The following complete four-stage flow is `TARGET ARCHITECTURE`:

1. Discovery emits early facts (`ProjectDiscovered`, `DependencyMapped`).
2. Intelligence consumes discovery events and emits knowledge events (`KnowledgeCreated`).
3. Transformation consumes approved planning events and emits execution events (`TransformationCompleted`).
4. Governance consumes transformation + validation streams and emits gate outcomes (`ValidationPassed`, approval/hold events).

Benefits:

- asynchronous decoupling between producers and consumers
- resilient recovery through replay/reprocessing
- explicit operational timeline of modernization lifecycle

---

## 5. CQRS Application

LegacyExodus applies CQRS to separate concerns:

- **Command Side (Write Path):**
  - handles intent, policy checks, orchestration, and state mutation
  - source of truth captured as events + authoritative state stores

- **Query Side (Read Path):**
  - builds denormalized projections for dashboards, status, and audit views
  - optimized for governance reporting and operator decision support

Why CQRS here:

- modernization workflows have strict control requirements (writes)
- stakeholders need rich, fast visibility (reads)
- auditability requires immutable change history and independently verifiable projections

---

## 6. Communication Contracts

Contracts define the schema and behavioral guarantees for commands, events, and queries.

Each contract must specify:

- message name and version
- required/optional fields
- correlation identifiers
- causation/source metadata
- idempotency expectations
- error semantics
- backward compatibility policy

Minimum metadata (all message types):

- `messageId`
- `messageType`
- `messageVersion`
- `timestamp`
- `correlationId`
- `causationId`
- `tenantOrOrgId` (if multi-tenant)
- `actor` (user/service identity)

Compatibility rules:

1. New consumers must tolerate unknown fields.
2. Breaking schema changes require new version.
3. Deprecated fields must have migration windows.
4. Governance-critical message contracts require approval before rollout.

---

## 7. Message Flow (Canonical)

```text
[Legacy System Input]
        |
        v
AnalyzeProjectCommand
        |
        v
(ProjectDiscovered, DependencyMapped) ----------------------+
        |                                                   |
        v                                                   v
NolaraStruct consumes events                      GetProjectState / GetKnowledgeGraph
        |
        v
KnowledgeCreated
        |
        v
StartMigrationCommand
        |
        v
TransformationCompleted
        |
        v
Validation + Policy Checks
        |
        v
ValidationPassed
        |
        v
ApproveMigrationCommand
        |
        v
[Modern System Released]
```

Only the discovery/static-analysis portion of this diagram is currently implemented. Migration, validation, approval, and release transitions remain `TARGET ARCHITECTURE`.
