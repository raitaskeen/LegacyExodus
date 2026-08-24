# CLI Configuration & Runtime Options

This document details configuration options, path resolution semantics, and runtime flags for the **LegacyExodus CLI**.

---

## 1. Path Resolution Semantics

LegacyExodus applies strict path normalization rules:

1. **User-Supplied Paths:** Paths provided to `legacy-exodus analyze <path>` are resolved relative to the user's current working directory (Caller-CWD).
2. **Internal Benchmark Anchors:** Benchmark fixtures, caches (`.cache/`), and results are anchored strictly to `legacy-exodus-core/` via `import.meta.dir`, ensuring **CWD-independent execution**.
3. **Artifact Path Normalization:** All internal file identities (`FileId`) are POSIX-normalized relative to the analyzed repository root.

---

## 2. Tsconfig Path Alias Resolution

LegacyExodus automatically inspects and resolves path aliases declared in `tsconfig.json` (e.g. `@core/*`, `@shared/*`):

* Maps path aliases to absolute physical file targets within the repository boundary.
* Unmatched or third-party aliases resolve cleanly to `null` (out-of-boundary).

---

## 3. Output Formats

| Flag | Description | Output Target |
|---|---|---|
| *(default)* | Human-readable terminal table summary | `stdout` |
| `--json` | Machine-readable streaming JSON payload | `stdout` |
| `--output <dir>` | Streams discovery and flow projections to files | Directory path |

---

## Related Documentation

* **[CLI Commands](commands.md):** Command-line reference.
* **[CLI Troubleshooting](troubleshooting.md):** Troubleshooting analysis execution.
