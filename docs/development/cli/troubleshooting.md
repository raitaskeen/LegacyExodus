# CLI Troubleshooting Guide

This document lists common issues encountered when executing the **LegacyExodus CLI** and explains how to resolve them.

---

## 1. Syntax & Parsing Recovery

**Symptom:**
The engine logs `Parser error encountered in <file>`, but analysis continues.

**Explanation:**
The Babel parser operates in `unambiguous` mode with error recovery enabled. Non-standard syntax in legacy templates (e.g. embedded EJS or ERB tags) may cause parse errors.

**Action:**
LegacyExodus records parsing failures in the discovery ledger without halting the pipeline. If files are non-JavaScript templates, verify they are categorized under `TEMPLATE` or `DATA`.

---

## 2. Unresolved Module or Dynamic Calls

**Symptom:**
Output shows `UNRESOLVED` for certain call targets or `resolvedPath: null` for imports.

**Explanation:**
This is **intentional conservative behavior**:
* Statically unprovable computed properties (`app[method]()`) resolve to `UNRESOLVED`.
* Third-party npm dependencies (`import express from 'express'`) resolve to `null` because they exist outside the local repository boundary.

**Action:**
No action required. This guarantees the engine never fabricates artificial call targets.

---

## 3. High Memory Consumption During Large Repository Scans

**Symptom:**
Node or Bun experiences memory pressure when projecting results for multi-megabyte repositories.

**Explanation:**
LegacyExodus uses `StreamingJsonWriter` with bounded 64KB buffers to stream analysis records directly to disk.

**Action:**
Ensure output is directed to a file path using `--output <dir>` rather than capturing giant JSON payloads in terminal buffers.

---

## 4. CLI Error Handling & Taxonomy

The CLI provides deterministic error response mapping via `toCliErrorResponse`:

| Error Class | Output Code | Behavior |
| :--- | :--- | :--- |
| `CliError` | Specific CLI code (e.g. `WORKSPACE_NOT_FOUND`, `WORKSPACE_INVALID`, `WORKSPACE_ALREADY_INITIALIZED`) | User-facing message formatted directly to stderr. |
| `ConfigurationError` | `CONFIG_INVALID` | Surfaces invalid runtime configuration without leaking stack traces. |
| `UnexpectedEngineResultError` | `CLI_ENGINE_RESULT_INVALID` | Surfaces engine command type mismatch with structured metadata. |
| `LegacyExodusError` | Specific domain code | Formats standard user-facing error message with stable domain error code. |
| Generic `Error` | `CLI_UNEXPECTED_ERROR` | Sanitized fallback preventing secret or internal path leakage. |

---

## Related Documentation

* **[CLI Commands](commands.md):** Command-line reference.
* **[CLI Configuration](configuration.md):** Path resolution and options.
* **[ADR-006: Security Model](../../adr/ADR-006-security-model.md):** Boundary isolation rules.
