# ADR-002 — Event System Governance

## Status
**ACCEPTED** (Implemented & Verified in Phase 1–3)

## Context
The LegacyExodus architecture requires loose coupling between pipeline stages (Discovery, Parsing, Symbol Extraction, Graph Construction, Flow Analysis) while maintaining a strict, audit-grade event ledger for all state modifications.

Key challenges:
1. Ensuring all pipeline actions emit structured, immutable events with timestamps and source attribution.
2. Maintaining deterministic event ordering during analysis runs.
3. Decoupling command handling from side-effect projection.

## Decision
1. **Typed Domain Events:** Define all lifecycle changes as strictly typed events implementing `DomainEvent` with unique event IDs, ISO-8601 UTC timestamps, aggregate IDs, and payload schemas.
2. **Synchronous In-Memory Event Bus:** Utilize an in-memory, deterministic publish-subscribe `EventBus` (`event-bus.ts`) for stage coordination within single-process CLI runs.
3. **Event Stores and Journal:** Preserve emitted events in append order for replay, with the current durable journal providing persisted execution facts at its defined commit boundary.
4. **Pure State Reduction:** Project state is computed from events via pure reducers (`event-reducer.ts`), ensuring state reproducibility.

## Alternatives Considered
* **Direct Function Call Coupling:** Calling stage functions directly without domain events. Rejected because it eliminates the audit trail, makes event-sourced state reconstruction impossible, and prevents plugin extensibility.
* **Asynchronous Message Broker (RabbitMQ / Kafka):** Rejected for single-process CLI runs to avoid external network dependencies and non-deterministic event arrival order.

## Consequences
* **Positive:** Ordered events support deterministic state replay and audit evidence for covered lifecycle facts. This does not imply complete provenance for every derived analysis datum.
* **Positive:** Extensible plugin system can subscribe to events without modifying core stage implementations.
* **Tradeoff:** Minimal memory overhead for maintaining in-memory event ledgers, cleared or projected upon stage completion.

## Verification / Evidence
* **Source Implementation:** [`src/core/events/domain-event.ts`](../../legacy-exodus-core/src/core/events/domain-event.ts), [`src/core/events/event-bus.ts`](../../legacy-exodus-core/src/core/events/event-bus.ts), [`src/core/events/event-reducer.ts`](../../legacy-exodus-core/src/core/events/event-reducer.ts), [`src/core/events/event-store.ts`](../../legacy-exodus-core/src/core/events/event-store.ts)
* **Test Suite:** `event-bus.test.ts`, `event-reducer.test.ts`, `event-store.test.ts` (100% passing tests).

## Related Documentation
* **[docs/architecture/communication-patterns.md](../architecture/communication-patterns.md):** Event schemas and messaging patterns.
* **[docs/architecture/components/orchestrator.md](../architecture/components/orchestrator.md):** Orchestrator event handling.
* **[GOVERNANCE.md](../../GOVERNANCE.md):** Architectural event and boundary rules.
