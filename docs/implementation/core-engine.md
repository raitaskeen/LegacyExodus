# Core Engine Implementation

**State:** `IMPLEMENTED`; lifecycle and integration behavior are covered by current tests.

`LegacyExodusEngine` in `legacy-exodus-core/src/core/engine/` is the public application boundary used by the CLI and programmatic callers.

## Composition

`createLegacyExodusEngine()` constructs an engine context containing the runtime, orchestrator, event infrastructure, storage manager/provider, projection service, plugin registry/loader, parser manager, and analysis services. Concrete composition lives in `src/runtime/composition/services.ts`.

The CLI does not import individual analysis implementations to execute work.

## Lifecycle

```text
created -> running -> stopping -> stopped
```

- `initialize()` starts the application runtime and composed services.
- `execute()` requires a running engine and tracks in-flight commands.
- `shutdown()` waits for in-flight work, delegates cleanup to the runtime, coalesces concurrent callers, and leaves the engine stopped.
- A stopped engine instance cannot be restarted.

`status()` reports engine/runtime state and readiness for events, plugins, and storage. Readiness is lifecycle status, not a deep external-service health probe.

## Commands

Current engine execution supports system status and project analysis. Analysis is event-driven, persists run-scoped records, and projects fresh results. Valid reused snapshots can restore prior analysis state without projecting a new run.

## Evidence

- Core source: `legacy-exodus-core/src/core/engine/`
- Composition: `legacy-exodus-core/src/runtime/composition/services.ts`
- Lifecycle: `legacy-exodus-core/src/runtime/application.ts`
- Tests: current engine, runtime, orchestration, integration, and snapshot-reuse suites on `main`

See [Current Implementation](../CURRENT_IMPLEMENTATION.md) for the synchronized core SHA and limitations.
