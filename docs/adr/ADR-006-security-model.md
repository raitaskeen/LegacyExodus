# ADR-006 — Security & Trust Boundary Model

## Status
**ACCEPTED** (Implemented & Verified in Phase 1–3)

## Context
LegacyExodus is designed to ingest and analyze third-party and legacy codebases that may contain malicious structures, malformed syntax, circular symlinks, or sensitive embedded secrets.

Key security requirements:
1. Preventing repository traversal boundary escapes and infinite symlink loops.
2. Preventing environment and host system path leakage in analysis artifacts.
3. Ensuring fail-closed conservative behavior when encountering unverified or malicious constructs.
4. Distinguishing current static analysis sandboxing from future target code execution sandboxes.

## Decision
1. **Symlink Traversal Isolation:** Ingest only regular files. `FileScanner` explicitly detects and skips symbolic links (`entry.isSymbolicLink()`), preventing directory traversal escapes and infinite directory cycles.
2. **Relative Path Hashing & Privacy:** All artifact identities (`FileId`, `SymbolId`, `ASTNodeId`) are derived from POSIX-normalized relative paths and SHA-256 content hashes. Absolute host file paths are never serialized into emitted artifacts.
3. **Fail-Closed Conservative Resolution:** Dynamic or ambiguous syntax (e.g. `app[dynamicKey]()`, third-party module imports) strictly resolves to `UNRESOLVED` / `null`. The engine never fabricates relationships or executes arbitrary untrusted code during static analysis.
4. **Subprocess Invocation Hardening (SEC-01):** Git revision lookups invoke Git directly with explicit argument arrays and `shell: false` (`spawnSync`), eliminating shell interpretation risk at the investigated Git subprocess boundary.
5. **Manifest Path Containment & Symlink Hardening (SEC-02):** Discovery manifest artifact path validation enforces lexical containment (`isPathWithinDirectory`), physical canonicalization (`realpath()`), and symlink rejection (`lstat()`).
6. **Discovery Root & Manifest Symlink Boundary (SEC-03):** The `.discovery` root directory and `manifest.json` are strictly verified via `lstat()` to reject symbolic links, and their canonical paths (`realpath()`) must reside strictly within the project workspace boundary.
7. **In-Memory Validated Byte Consumption (REUSE-03):** Discovery snapshot validation returns in-memory byte contents (`validatedArtifacts`), which the orchestrator consumes directly, eliminating any filesystem TOCTOU race conditions between manifest verification and downstream parsing.
8. **Current Implementation vs Target Architecture:**
   * **Current / Implemented:** Read-only AST parsing with Babel in error-recovery mode, direct subprocess execution without shell, manifest path containment, directory root and manifest symlink rejection, in-memory validated byte consumption, symlink skip protection, deterministic relative ID hashing, zero code execution during analysis.
   * **Target / Planned:** Ephemeral Docker/gVisor sandboxes for `VymosGate` target compilation (`cargo check`), automated secret redaction, and prompt injection defense layers for LLM gateways.

## Alternatives Considered
* **Following Symlinks with Cycle Detection:** Rejected because symlinks pointing outside the repository root violate repository boundary contracts and can expose host files.
* **Executing Source in VM Sandbox (e.g. Node vm2):** Rejected for analysis stages because static AST parsing via Babel provides complete inspection without runtime execution hazards.

## Consequences
* **Positive:** Zero risk of arbitrary code execution during static analysis.
* **Positive:** Emitted artifacts can be shared safely across environments without disclosing developer file paths.
* **Positive:** Discovery manifest cannot escape `.discovery/` directory via relative traversal or symlink redirection.
* **Positive:** In-memory byte consumption eliminates local filesystem TOCTOU tampering vectors.
* **Tradeoff:** Projects relying heavily on internal repository symlinks require explicit directory root configuration.

## Verification / Evidence
* **Source Implementation:** [`src/discovery/file-scanner.ts`](../../legacy-exodus-core/src/discovery/file-scanner.ts), [`src/discovery/discovery-validator.ts`](../../legacy-exodus-core/src/discovery/discovery-validator.ts), [`src/storage/projections/file-discovery-projection.ts`](../../legacy-exodus-core/src/storage/projections/file-discovery-projection.ts).
* **Test Suite:** `file-scanner.test.ts`, `discovery-validator.test.ts`, `file-discovery-projection.test.ts` (100% passing tests).
* **Governance Evidence:** `bun run benchmark audit` Check 8 passes with zero symlink traversal regressions.

## Related Documentation
* **[docs/architecture/security-architecture.md](../architecture/security-architecture.md):** Detailed security architecture.
* **[GOVERNANCE.md](../../GOVERNANCE.md):** Repository boundary contracts and execution rules.
