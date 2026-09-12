# Runtime Architecture

## Current runtime

LegacyExodus runs as a local in-process Bun application. `createLegacyExodusEngine()` composes dependencies; `LegacyExodusEngine` owns the public lifecycle; `ApplicationRuntime` starts and stops registered services.

```text
CLI
  -> createLegacyExodusEngine
  -> initialize
  -> execute command
  -> orchestrator / analysis services
  -> storage and projections
  -> shutdown
```

### Lifecycle

- Engine: `created -> running -> stopping -> stopped`.
- Runtime: validates configuration, creates structured logging, starts services, and performs reverse-order cleanup.
- Concurrent shutdown calls coalesce; in-flight engine executions settle before runtime cleanup.
- A stopped engine instance cannot restart.

### Execution

Commands are validated at contract boundaries and dispatched through the engine/orchestrator. Project analysis executes discovery, per-file parser/symbol work, graph/semantic/flow construction, atomic run-scoped persistence, post-commit event publication, and `.discovery` projection for fresh runs. Recoverable per-file failures are categorized; terminal failures remain observable.

The durable commit is complete before fresh-run filesystem projection begins. A projection failure cannot roll back committed storage records or their durable event journal. The engine therefore rejects with `DISCOVERY_PROJECTION_FAILED_AFTER_COMMIT`, preserving the original cause and reporting `analysisCommitted: true` plus `projectionStatus: "failed"`. This is a failed command deliverable, not a failed or rolled-back analysis commit.

The current orchestrator is deterministic in-process coordination. It is not a distributed task queue and does not provide general retry scheduling, worker leases, or remote execution.

### Events

The event bus publishes synchronously in registration order. The in-memory event store preserves append order for replay. The durable journal records committed execution facts. This is an event-driven architecture; it should not be described as a complete distributed event-sourcing platform.

### Storage

The runtime injects either memory or SQLite storage behind `StorageManager`. SQLite configuration is local and embedded. Projection output is derived from validated completed-run records and published beneath the analyzed project's `.discovery/` directory. SQLite records remain queryable after a projection failure and process restart; memory-provider records remain limited to that runtime instance.

Each artifact is atomically replaced and the integrity manifest is written last, but the complete directory is not one atomic filesystem transaction. A mid-projection failure can therefore leave partial new artifacts or a prior manifest. Snapshot reuse still requires manifest hashes and workspace freshness to validate, so such output is not silently accepted as current. The internal projection service can regenerate artifacts from committed records, but the current CLI does not expose a projection-only recovery command.

### Plugins

The runtime composes an in-process plugin registry/loader and scoped plugin context. Dynamic package discovery, third-party sandboxing, marketplace distribution, and permission isolation are not implemented.

## Current non-goals

- No network service or REST API.
- No distributed worker pool or multi-tenant scheduler.
- No AI/model-provider runtime.
- No transformation, Rust generation, or compilation sandbox.
- No hosted telemetry/control plane.

## Target runtime

Future designs may introduce bounded worker execution, checkpointing, isolated compilation, policy services, observability, and distributed/multi-tenant operation. Those require separate contracts and evidence and remain `TARGET ARCHITECTURE`.
