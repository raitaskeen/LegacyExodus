# Event System Implementation

This document describes the design and implementation of the synchronous event bus and event store in `src/core/events/`.

---

## 1. Components & Data Flow

```mermaid
flowchart LR
    A[Command Handler] -->|emit event| B[EventBus]
    B -->|append| C[EventStore]
    B -->|notify| D[Event Handlers & Plugins]
    B -->|reduce| E[EventReducer]
    E --> F[New ProjectState]
```

* **`EventBus` (`event-bus.ts`):** Synchronous publish-subscribe bus supporting typed subscriptions.
* **`EventStore` (`event-store.ts`):** Append-only in-memory ledger storing all events in chronological order.
* **`EventReducer` (`event-reducer.ts`):** Pure reducer applying event payloads to update `ProjectState`.

---

## 2. Invariants

* **Deterministic Delivery:** Event handlers execute in registration order.
* **Audit-Grade Traceability:** Every state mutation traces back to an immutable event with an ISO timestamp and aggregate ID.

---

## 3. Implementation Evidence

* **Source Location:** [`src/core/events/`](../../legacy-exodus-core/src/core/events).
* **Tests:** `event-bus.test.ts`, `event-reducer.test.ts`, `event-store.test.ts`.
* **Related ADR:** **[ADR-002: Event System Governance](../adr/ADR-002-event-system-governance.md)**.
