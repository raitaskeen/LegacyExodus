# CLI Command Reference

LegacyExodus provides a command-line interface for runtime checks, workspace metadata initialization, deterministic repository analysis, test exploration, and repository verification.

---

## Global Options

The root command exposes only:

| Option | Description |
|---|---|
| `-V, --version` | Output the version number. |
| `-h, --help` | Display structured help for command or root CLI. |

Output and theme options are declared by the individual commands that support them; they are not universal root options.

---

## 1. `legacy-exodus status [options]`

Reports runtime health, storage readiness, and composed engine dependencies `[read-only]`.

```bash
# Standard status card
legacy-exodus status

# Aurora theme
legacy-exodus status --theme aurora

# Pure JSON health probe
legacy-exodus status --json
```

---

## 2. `legacy-exodus init <path> [options]`

Initializes a new LegacyExodus workspace configuration in the target directory `[mutates workspace]`.

```bash
# Initialize a project directory
legacy-exodus init ./my-project

# Initialize current directory
legacy-exodus init .

# Machine-readable output
legacy-exodus init ./app --json
```

---

## 3. `legacy-exodus analyze <path> [options]`

Analyzes repository structure, ASTs, symbols, dependencies, and projections. Source files are observed rather than rewritten, but the command writes LegacyExodus-owned `.discovery/` artifacts and may write SQLite storage when configured `[mutates analysis outputs]`.

### Options
| Option | Description |
|---|---|
| `--json` | Emit a machine-readable analysis summary in JSON to `stdout`. |
| `--theme <name>` | Visual theme: `classic` (default), `aurora`, `mono`. |
| `--refresh` | Force fresh discovery and bypass existing snapshot reuse. |
| `--storage-driver <driver>` | Storage driver to use (`memory`, `sqlite`). Defaults to `memory`. |
| `--storage-path <path>` | Database file path for SQLite storage. Auto-infers `sqlite` driver; rejects conflicting `--storage-driver memory`. |

```bash
# Analyze web application
legacy-exodus analyze ./apps/web

# Analyze current workspace with aurora theme
legacy-exodus analyze . --theme aurora

# Stream JSON discovery inventory to stdout
legacy-exodus analyze ./repo --json

# Force fresh discovery, ignoring any valid cached snapshots
legacy-exodus analyze ./repo --refresh

# Persist analysis records to a SQLite database file
legacy-exodus analyze ./repo --storage-path ./exodus.db
```

### Presentation & Output Modes

The `analyze` command provides deterministic reporting across three presentation modes:

1. **Interactive TTY Mode (default in interactive terminals):**
   - Renders formatted summary cards (`Project Overview`, `Artifact Breakdown`, `Quality & Performance`) and a final status banner.
   - **Clean Analysis Banner:** Displays `✓ Analysis and graph persistence completed successfully.` when discovery completed cleanly with zero parser failures, zero symbol extraction failures, and zero enumeration failures.
   - **Degraded Analysis Banner:** Displays `⚠ Analysis completed with isolated non-fatal faults.` whenever non-fatal faults occur (parser failures > 0, symbol extraction failures > 0, enumeration failures > 0, or incomplete discovery).
   - Prominently surfaces exact failure counts in the `Quality & Performance` card (`N ISOLATED` or `N FAULTS`).

2. **Plain / CI Mode (non-TTY, `CI=true`, or `NO_COLOR`):**
   - Renders a plain-text summary header: `"Discovery completed"` for clean runs, or `"Analysis completed with isolated non-fatal faults"` for degraded runs.
   - Outputs line-by-line metrics including `Files analyzed`, `Parser failures`, `Symbol extraction failures`, `Enumeration failures`, and `Discovery complete: yes|no`.

3. **JSON Mode (`--json`):**
   - Emits an unadorned machine-readable `AnalyzeProjectReport` JSON object to `stdout`.
   - Preserves typed counters: `parserFailures`, `symbolExtractionFailures`, `enumerationFailures`, and `discoveryComplete`.

### Analysis Integrity & Classification Invariants

- **Discovery Completeness vs Clean Analysis:** Discovery completeness (`discoveryComplete: true`) confirms the file scanner enumerated repository artifacts without filesystem or permission aborts. It does not imply clean analysis; an analysis run with complete discovery remains classified as degraded if non-fatal syntax parsing or symbol extraction failures occur.
- **Manifest Degradation vs Supported Absence:** When a project manifest (such as `package.json`) exists but contains malformed JSON or invalid schema properties, the detector records manifest degradation (`discoveryComplete: false` and incremented enumeration failures). In contrast, the standard absence of a manifest (for projects without `package.json`) is supported and does not induce false degradation.
- **Exit Code Behavior:** Completed analysis commands exit with code `0`, regardless of whether analysis was clean or degraded with isolated non-fatal faults. Exit code `1` is reserved for fatal runtime exceptions, invalid CLI options, or post-commit projection failures.

### Projection failure after durable commit

For a fresh run, analysis records commit before `.discovery` materialization. If that materialization fails, `analyze` exits nonzero and reports `DISCOVERY_PROJECTION_FAILED_AFTER_COMMIT` with the project path, run ID, and underlying cause. The error means the requested filesystem artifacts are incomplete; it does not mean the canonical analysis transaction rolled back. When SQLite is configured, the committed run remains queryable after restart. The current CLI has no projection-only retry command, so operators must correct the output-path failure before re-executing and should not assume that re-execution performs only materialization.

---

## 4. `legacy-exodus test [domain] [options]`

Explores and executes test suites filtered by architectural domain `[read-only]`.

```bash
# View domain taxonomy and file counts
legacy-exodus test --list

# Run focused JavaScript/TypeScript parser tests
legacy-exodus test parser

# Run parser tests with detailed execution log
legacy-exodus test parser --verbose

# Run symbol extraction and export tests
legacy-exodus test symbols

# Run call-graph & receiver resolution tests
legacy-exodus test semantic

# Run CFG and DFG flow analysis tests
legacy-exodus test flow

# Run all test suites, aborting on first failure
legacy-exodus test all --bail

# Emit parsed JSON test results
legacy-exodus test parser --json
```

**Available Domains:**
`runtime`, `discovery`, `parser`, `symbols`, `semantic`, `flow`, `storage`, `governance`, `plugins`, `cli`, `integration`, `architecture`, `all`.

---

## 5. `legacy-exodus verify [options]`

Executes complete 4-gate repository verification `[read-only]`:
1. **Static Typecheck:** Zero compiler errors (`tsc --noEmit`).
2. **Test Suite:** All unit, integration, and architecture test suites (`bun test`).
3. **Benchmark Governance:** 10-point benchmark system self-audit (`bun run benchmark audit`).
4. **Working Tree Hygiene:** Git diff whitespace and file hygiene check (`git diff --check`).

```bash
# Run verification dashboard
legacy-exodus verify

# Themed verification
legacy-exodus verify --theme aurora

# Monochrome CI verification
legacy-exodus verify --theme mono
```

---

## 6. `legacy-exodus plugins list [options]`

Lists registered plugins and discovery extensions in an auto-aligning table `[read-only]`.

```bash
# Formatted table of loaded plugins
legacy-exodus plugins list

# JSON array of plugin metadata
legacy-exodus plugins list --json
```

---

## Related Documentation

* **[CLI Configuration](configuration.md):** Environment variables, path resolution, and themes.
* **[CLI Design & Architecture](../../implementation/cli-design.md):** Presentation layer, tables, layout, and error boundaries.
* **[Command Contracts](../../api/command-contracts.md):** Programmatic command schemas and message envelopes.
