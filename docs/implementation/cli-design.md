# CLI Design & Error Boundary Architecture

This document describes the design and implementation of the **LegacyExodus CLI** located in `src/cli/`.

---

## 1. CLI Dispatch Architecture

The CLI is structured around **Commander.js** with isolated command registration and output formatters:

```mermaid
flowchart TD
    A[Terminal Command] --> B[src/cli/index.ts]
    B --> C[registerCommands]
    C --> D[analyze | status | init | plugins]
    D --> E[Command Handler / Engine API]
    E --> F[Output Formatters Table / JSON]
    E -->|Errors| G[CLI Error Boundaries]
```

---

## 2. Error Boundary Architecture

The CLI wraps all command executions in error boundaries (`src/cli/errors.ts`):
* Translates domain errors (`LegacyExodusError`) into clean, actionable terminal messages.
* Formats schema validation failures with precise offending fields.
* Returns appropriate exit codes (`0` for success, non-zero for fatal execution faults).

---

## 3. Implementation Evidence

* **Source Location:** [`src/cli/`](../../legacy-exodus-core/src/cli).
* **Tests:** `cli.test.ts`, `error-boundaries.test.ts`.
* **Related Documentation:** **[CLI Commands Reference](../development/cli/commands.md)**.
