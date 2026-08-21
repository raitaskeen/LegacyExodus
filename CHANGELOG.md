# Changelog

All notable changes to the LegacyExodus core engine will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to deterministic semantic contracts and verifiable engineering baselines.

---

## [Unreleased]

### Planned & Upcoming (Phase 3 — Real-Repository Validation)
- Automated benchmarking harness for third-party open-source repositories.
- Tiered repository validation suite (`express-session`, `cookie-parser`, `systemjs`, `fastify`, `Ghost`).
- Real-repository metrics tracking (discovery funnel, resolution rates, extraction loss, determinism diffs).
- Execution timing and memory profiler integration for whole-program repository scans.

---

## [0.3.0] - Phase 2.9 Hardening (Evidence & Analysis Taxonomy)

### Added
- **Analysis Outcome Taxonomy:** Explicit categorization distinguishing analyzable source files, unsupported source files, and non-source repository artifacts (Markdown, CSS, JSON, config files).
- **Structured CLI Observability:** `--json` output reporting `filesDiscovered`, `filesAnalyzed`, `parserFailures`, `symbolExtractionFailures`, `unsupportedFiles`, `nonSourceArtifacts`, and `durationMs`.
- **Golden Fixture Regressions:** End-to-end fixture assertion suite verifying deterministic counts across discovery, parsing, symbol extraction, CFG, DFG, and knowledge graphs.

### Changed
- **CLI Telemetry:** Corrected file classification metrics so repository configuration files and documentation are no longer counted as unsupported source files.
- **Contract Normalization:** Canonical sorting applied to symbols, graph nodes, and dependency edges prior to serialization and storage record persistence.

### Fixed
- Fixed misleading CLI exit codes on partial analysis where non-source files were encountered.
- Fixed non-deterministic ordering in analysis summary collections.

---

## [0.2.8] - Phase 2.8 Hardening (Core Semantic Hardening & Resolution)

### Added
- **Lexical Scope Resolution:** Scope-chain-aware call resolution matching local bindings, parent scopes, and enclosing blocks before attempting global lookups.
- **Container & Class-Aware Resolution:** Class method identification preserving container evidence; method name collisions across distinct classes now resolve to discrete symbols.
- **Receiver Construction Provenance:** Static `new Service()` receiver resolution enabling deterministic `service.method()` to `Service.method` call resolution.
- **Class-Context Method Invocations:** Deterministic resolution for `this.method()` inside proven class declarations.
- **Object Literal Method Extraction:** Explicit symbol generation for object methods without fabricating class container identities.
- **Cross-File Data-Flow Analysis (DFG):** Whole-program propagation connecting consumer inputs across file boundaries to exported function parameters and return values.
- **Interprocedural Flow Coordination:** Direct linkage between semantic call targets and data-flow parameter/return chains.
- **CommonJS Static Flow:** Static modeling for `module.exports`, `exports.name`, `require("./path")`, and destructured imports.
- **Taint Analysis Hardening:** Precision guard to ensure `RegExp.exec()` and regex methods are not misclassified as command execution sinks (`child_process.exec`).
- **Failure Isolation Boundaries:** Implemented independent `ParserFailure` and `SymbolsExtractionFailure` event dispatching, preventing malformed source files from aborting the entire repository analysis.

### Changed
- **ESM Re-Export Provenance:** Corrected `export { foo as bar }` linkage to track local origin `foo` rather than exported alias `bar`.
- **Conservative Dynamic Call Handling:** Unprovable dynamic calls, unknown factories, and computed properties now strictly resolve to `UNRESOLVED` rather than generating speculative bindings.
- **Symbol Extraction Contracts:** Enforced validation rejecting empty module specifiers and requiring valid symbol identity fields.

### Fixed
- Fixed `SYMBOL_TABLE_INVALID` errors caused by variable declarations (`export const / let / var`) losing declarator names in AST traversal.
- Fixed duplicate symbol generation on empty `export {};` statements.
- Fixed `defaultExport` flag missing on named default re-exports (`export { foo as default }`).
- Fixed shadowing resolution where inner block-scoped declarations were bypassed in favor of outer declarations.

### Testing
- Test suite expanded to 141 passed tests, 532 assertions across 36 test files with zero failures.
- Comprehensive unit coverage added for CFG branches, loops, switches, exception handlers (`try/catch/finally`), DFG def-use chains, lifetimes, and cross-file transfers.

---

## [0.2.0] - Phase 2.0 (Deterministic Semantic Foundation)

### Added
- JavaScript, TypeScript, JSX, and TSX parsing via normalized AST contracts.
- ECMAScript Module (ESM) symbol extraction and dependency graph edge construction.
- Cycle detection identifying circular import and re-export chains.
- Control-Flow Graph (CFG) engine supporting basic blocks, dominators, loop detection, and reachability analysis.
- Data-Flow Graph (DFG) engine tracking definitions, uses, and variable lifetimes.
- Knowledge graph builder aggregating semantic artifacts and dependency relationships.

---

## [0.1.0] - Phase 1.0 (Core Architecture & Discovery)

### Added
- Deterministic repository discovery engine identifying project manifests, frameworks, and source files.
- Domain event contracts (`FileDiscovered`, `FileParsed`, `SymbolsExtracted`, `ProjectInitialized`).
- Pluggable parser architecture and storage record abstractions.
- Initial CLI structure for repository analysis.

---

## Deferred Architectural Capabilities
- **Intermediate Representation (IR):** Intentionally deferred until multiple distinct language frontends provide empirical requirements for a shared abstraction.
- **Persistent Storage (SQLite):** Intentionally deferred to maintain flexibility during active semantic schema stabilization.
- **Multi-Language Expansion (PHP, Java, C/C++, Rust):** Planned for future phases following JavaScript/TypeScript real-repository validation.
- **Automated Transformation / Modernization:** Planned for later phases following verified zero-hallucination semantic baseline.

# LegacyExodus Codeowners
# Defines the primary maintainers responsible for reviewing code, architecture, and contracts.

* @raitaskeen