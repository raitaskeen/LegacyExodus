# CLI Command Reference

LegacyExodus provides a command-line interface implemented via Commander.js.

---

## 1. `legacy-exodus status`

Prints the engine version, runtime environment, and operational component health.

```bash
bun run src/cli/index.ts status
```

**Output Example:**
```text
LegacyExodus CLI v0.1.0
Runtime: Bun v1.3.14 (win32-x64)
Components:
  Discovery: OK
  Parser (Babel): OK
  Symbol Extractor: OK
  Module Graph: OK
  Semantic Engine: OK
  Flow Engine: OK
  Storage (Streaming): OK
```

---

## 2. `legacy-exodus init <name>`

Initializes an analysis workspace configuration in the target directory.

```bash
bun run src/cli/index.ts init my-legacy-project
```

---

## 3. `legacy-exodus analyze <path>`

Performs multi-stage deterministic static analysis on the target repository.

```bash
# Standard table output
bun run src/cli/index.ts analyze ../path/to/legacy-repo

# JSON output to stdout or file
bun run src/cli/index.ts analyze ../path/to/legacy-repo --json

# Custom projection output directory
bun run src/cli/index.ts analyze ../path/to/legacy-repo --output ./results
```

**Options:**
* `--json`: Outputs structured analysis results in JSON format.
* `--output <dir>`: Specifies destination directory for projection artifacts.

---

## 4. `legacy-exodus plugins`

Lists all loaded and registered plugins in the current runtime environment.

```bash
bun run src/cli/index.ts plugins
```

---

## Related Documentation

* **[CLI Configuration](configuration.md):** CLI options and environment variables.
* **[CLI Troubleshooting](troubleshooting.md):** Resolving common CLI analysis errors.
* **[Command Contracts](../../api/command-contracts.md):** Programmatic command schemas.
