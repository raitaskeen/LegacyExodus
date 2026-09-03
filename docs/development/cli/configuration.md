# CLI Configuration & Runtime Options

This document details configuration options, visual themes, output modes, path resolution semantics, and runtime flags for the **LegacyExodus CLI**.

---

## 1. Visual Themes & Color Schemes

LegacyExodus includes a theme engine with 3 palettes supporting TrueColor, 256-color, and monochrome environments:

| Theme | Description | Target Environment |
|---|---|---|
| `classic` *(default)* | Vibrant Sky/Emerald TrueColor palette | Modern interactive terminal emulators |
| `aurora` | Soft Lavender/Teal palette with gentle contrast | Dark-mode developer terminals |
| `mono` | High-contrast monochrome output with bold/dim accents | CI runners, accessibility, and high contrast |

### Theme Selection

Themes can be configured via command-line flags or environment variables:

```bash
# Via command-line option
legacy-exodus status --theme aurora

# Via environment variable
export LEGACYEXODUS_THEME=aurora
legacy-exodus analyze ./my-app
```

---

## 2. Output Modes & Standards Compliance

The CLI automatically detects terminal capabilities and selects the appropriate presentation mode:

| Mode | Trigger Conditions | Behavior |
|---|---|---|
| **Interactive TTY** | `stdout.isTTY = true`, no `CI`, no `NO_COLOR` | Rich cards, progress bars, styled tables, and TrueColor ANSI themes |
| **CI / Non-TTY** | `stdout.isTTY = false` or `CI=true` or `NO_COLOR` is present | Deterministic plain-text summaries without ANSI escape codes or cursor movement |
| **JSON Mode** | `--json` flag passed | Pure machine-readable JSON emitted directly to `stdout` (zero decorative text) |

### Color Suppression

LegacyExodus strictly complies with the **[NO_COLOR](https://no-color.org/)** standard:
* When `NO_COLOR` environment variable is present (regardless of value), all color output is disabled.
* When `--no-color` is passed as a CLI argument, ANSI escape sequences are omitted.

---

## 3. Path Resolution Semantics

LegacyExodus applies strict path normalization rules:

1. **User-Supplied Paths:** Paths provided to `legacy-exodus analyze <path>` or `legacy-exodus init <path>` are resolved relative to the user's current working directory (Caller-CWD).
2. **Internal Benchmark Anchors:** Benchmark fixtures, caches (`.cache/`), and results are anchored strictly to `legacy-exodus-core/` via `import.meta.dir`, ensuring **CWD-independent execution**.
3. **Artifact Path Normalization:** All internal file identities (`FileId`) are POSIX-normalized relative to the analyzed repository root.

---

## 4. Tsconfig Path Alias Resolution

LegacyExodus automatically inspects and resolves path aliases declared in `tsconfig.json` (e.g. `@core/*`, `@shared/*`, `@cli/*`):

* Maps path aliases to absolute physical file targets within the repository boundary.
* Unmatched or third-party aliases resolve cleanly to `null` (out-of-boundary).

---

## Related Documentation

* **[CLI Commands](commands.md):** Command-line reference.
* **[CLI Design & Architecture](../../implementation/cli-design.md):** Presentation layer, tables, layout, and error boundaries.
* **[CLI Troubleshooting](troubleshooting.md):** Troubleshooting analysis execution.
