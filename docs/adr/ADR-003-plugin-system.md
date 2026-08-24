# ADR-003 — Plugin System Architecture

## Status
**ACCEPTED** (Implemented & Verified in Phase 1–3)

## Context
LegacyExodus requires an extensibility mechanism to allow custom language analyzers, third-party framework detectors, and specialized projection exporters without modifying the core compiler engine.

Key challenges:
1. Providing a clean plugin interface (`LegacyExodusPlugin`).
2. Scoping plugin access to logger, event bus, and storage (`PluginContext`).
3. Preventing faulty plugins from destabilizing core pipeline execution.

## Decision
1. **Contract-First Plugin Interface:** Define `LegacyExodusPlugin` requiring `initialize(context)` and `shutdown()` lifecycle methods.
2. **Controlled Context Injection:** Plugins receive a scoped `PluginContext` with access only to `Logger`, `EventBus`, and `StorageManager`.
3. **Dynamic Plugin Registry & Loader:** Implement `PluginRegistry` and `PluginLoader` to validate plugin manifests via Zod schemas before activation.

## Alternatives Considered
* **Direct Monkey-Patching / Subclassing:** Rejected because mutable subclassing creates tight coupling and breaks engine determinism.
* **Process-Isolated RPC Plugins (gRPC):** Deferred for future remote plugin execution; in-process TypeScript plugins provide immediate low-overhead extensibility on Bun.

## Consequences
* **Positive:** Extensible ecosystem for custom rules and exporters.
* **Positive:** Clear lifecycle management with graceful shutdown.
* **Tradeoff:** In-process plugins run in the same memory space as the engine.

## Verification / Evidence
* **Source Implementation:** [`src/plugins/plugin.ts`](../../legacy-exodus-core/src/plugins/plugin.ts), [`src/plugins/plugin-registry.ts`](../../legacy-exodus-core/src/plugins/plugin-registry.ts), [`src/plugins/plugin-loader.ts`](../../legacy-exodus-core/src/plugins/plugin-loader.ts).
* **Test Suite:** `plugins.test.ts` (100% passing tests).

## Related Documentation
* **[Plugin Architecture](../architecture/plugin-architecture.md):** Architectural specification.
* **[Plugin API Specification](../api/plugin-api.md):** Plugin API contracts.
