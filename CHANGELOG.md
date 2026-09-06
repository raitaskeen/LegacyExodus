# Changelog

All notable changes to the LegacyExodus core engine will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to deterministic semantic contracts and verifiable engineering baselines.

---

## [Unreleased]

- **Lookup-Map Key Path Canonicalization in Orchestration Pipeline (CodeRabbit #3941957284):**
  - Canonicalized key indexing for `tablesByPath`, `symbolsByPath`, and `importsByFile` in `command-handler.ts` using `canonicalizePath(table.filePath)`.
  - Canonicalized lookup keys when resolving symbols in `symbolsByPath.get(canonicalizePath(file.path))` and filtering call source file paths in `canonicalizePath(call.sourceFilePath) === canonicalizePath(file.path)` during data-flow context construction and proven call target extraction.
  - Eliminated cross-file call resolution failures (`UNRESOLVED`) and dropped data-flow call bindings when project discovery produces paths with non-canonical segments (`./src/file.js`), redundant separators, or platform-specific Windows backslashes (`src\file.js`).
  - Added dedicated regression test suite (`lookup-map-canonicalization.test.ts`) covering cross-file call resolution and data-flow bindings across non-canonical path representations and Windows backslashes.
  - Expanded test baseline to **995/995 passing tests across 112 files** (9,351 assertions, 0 failures) with zero regressions across all 4 verification dashboard gates.

- **Durable Event Atomic Sequence Reservation & Transactional Ordering (F-002):**
  - Eliminated the read-modify-write concurrency window in durable event sequence allocation by introducing transactional batch commitment (`storage.commitBatch({ records, events })`) across both `SqliteStorageProvider` and `MemoryStorageProvider`.
  - In `SqliteStorageProvider`: serialized sequence reservations and journal persistence within `BEGIN IMMEDIATE` transactions, querying the committed maximum sequence directly from storage and persisting facts and journal entries in a single atomic transaction.
  - Enforced engine-level sequence uniqueness in SQLite via a partial unique index `idx_durable_events_seq` on `(project_id, sequence)` where `type = 'domain-event'`, physically preventing sequence collisions or duplicates across concurrent executions and multi-process writers.
  - In `MemoryStorageProvider`: implemented synchronous per-aggregate sequence allocation and duplicate sequence checks, guaranteeing concurrency safety under asynchronous event loops.
  - Refactored `Orchestrator.execute()` to commit execution domain records and journal events atomically via `storage.commitBatch()`, ensuring durable sequence allocation and event persistence share the exact same atomicity boundary before post-commit subscriber notification.
  - Expanded test baseline to **993/993 passing tests across 111 files** (9,335 assertions, 0 failures) with zero regressions across all 4 verification dashboard gates.

- **Semantic Call-Graph Lexical Shadowing Precision:**
  - Implemented lexical scope shadowing verification (`isLexicallyShadowed()`) in `DeterministicCallGraphBuilder`, enforcing strict ECMAScript scope precedence (`nearest lexical binding > enclosing lexical binding > file-level import > fallback/unresolved`).
  - Hardened direct call resolution in `visit()`: guarded `importsByFile` queries with `!isLexicallyShadowed(calleeName, nextContext, table)`, ensuring local parameter bindings (`function run(charge)`), local variable declarations (`const charge = ...`), local function declarations, catch clause parameters, and loop variables shadow file-level imports and correctly resolve to local symbols or remain safely `UNRESOLVED` instead of falsely resolving to imported functions.
  - Hardened member receiver call resolution in `resolveLocalCall()`: guarded imported namespace receiver resolution (`resolveNamespaceCall()`) with `!isLexicallyShadowed(receiver, context, table)`, ensuring shadowed namespace receivers (`function run(billing) { billing.charge(); }`) are not routed to namespace exports.
  - Expanded test baseline to **989/989 passing tests across 111 files** (9,324 assertions, 0 failures) with zero regressions across all 4 verification dashboard gates.
- **Control-Flow Finally Graph Bloat & Back-Edge Routing Integrity (F-14):**
  - Eliminated speculative over-allocation and unconditional AST statement cloning of candidate finalizer landing pads (`thrownFinalizer`, `returnedFinalizer`, `brokenFinalizer`, `continuedFinalizer`, and `labeledFinalizers`) in `DeterministicControlFlowGraphBuilder.buildTry()`.
  - Enforced demand-driven finalizer instantiation: candidate landing pads are populated with AST statements and routed to outer completion targets if and only if actual incoming transfer edges exist (`hasIncomingEdges()`), with unreached landing pads safely pruned via `removeBlock()`.
  - Hardened scope continuation tracking in `buildStatements()`: marked `TryStatement` termination state dynamically based on whether the post-try continuation block (`after`) received any incoming edges, eliminating false fall-through edges to scope exits when try/catch/finally paths unconditionally terminate.
  - Added isolated empty unreachable block cleanup in `FlowState.finish()`: safely pruned orphan empty blocks (blocks with zero statements, zero predecessors, and zero successors) that were speculatively allocated but unreferenced, eliminating phantom unreachable blocks and false-positive dead-code reports (`cfg.deadCodeNodeIds`) across clean `try-finally` blocks while strictly preserving genuine dead-code detection, loop back-edges, and dominator trees.
  - Expanded test baseline to **982/982 passing tests across 110 files** (9,273 assertions, 0 failures) with zero regressions across all 4 verification dashboard gates.
- **CI & CodeRabbit Forensic Remediation Checkpoint:**
  - **Linux CI Universal Batch Script Prohibition (`verify.ts`):** Removed platform-gated `win32` condition in `runCommand`, enforcing uniform cross-platform prohibition of `.bat` and `.cmd` batch scripts for subprocess isolation and resolving the Linux CI runner test failure.
  - **Durable Event Replay Ordering (`orchestrator.ts` & `durable-event-journal.ts`):** Enforced monotonic sequence numbering across executions within an aggregate and prioritized timestamp-first sorting (`timestamp || sequence || id`), eliminating cross-execution event interleaving during durable state replay.
  - **Subprocess Timeout Termination Lifecycle (`verify.ts`):** Refactored `runCommand` timeout handling to attempt `SIGTERM` escalation to `SIGKILL` via a fallback timer.
  - **Second-Pass Parse Failure Isolation (`command-handler.ts`):** Guarded second-pass per-file reading and AST parsing with isolated error handling, emitting `ParserFailure` domain events on syntax or I/O failure and allowing multi-file analysis to proceed to completion for healthy files.
  - **Semantic Default-Import vs Namespace-Call Isolation (`call-graph-builder.ts`):** Restricted `resolveNamespaceCall()` strictly to namespace imports (`sourceSymbolName === "*"`), preventing ESM default imports (`import api from "./api"; api.ping()`) from falsely resolving to named exports.
  - **Flow Array Immutability (`flow-analysis-engine.ts`):** Ensured `connect()` freezes a defensive copy `[...controlFlowGraphs]` instead of mutating the caller-provided array in-place.
  - Expanded test baseline to **974/974 passing tests across 109 files** (9,231 assertions, 0 failures) with zero regressions across all 4 verification gates.
- **Windows Drive Letter Path Canonicalization & Graph Resolution (F-11):** Enforced canonical lowercase Windows drive letter normalization in `canonicalizePath` (`C:/...` -> `c:/...`, `/C:/...` -> `/c:/...`), eliminating cross-platform path identity divergence across Windows file paths with mixed drive casing and separator styles. Hardened `DeterministicCallGraphBuilder` map indexing (`tablesByPath` and `importsByFile`) and lookup resolution by keying and querying with `canonicalizePath`, ensuring deterministic cross-file dependency edge generation, cycle detection, and imported/namespace call resolution across differing Windows drive casing without false negatives or dropped edges. Expanded test baseline to 968/968 passing tests across 105 files (9,215 assertions, 0 failures) with zero regressions across all 4 verification gates.
- **Contextual `this.method()` Call Resolution Hardening (SEM-08):** Hardened member call resolution in `DeterministicSemanticAnalysisEngine` by introducing lexical container tracking (`containerName`) in `ResolutionContext`. Enforced strict container affinity on prototypal/contextual `this.method()` calls, eliminating false-positive resolution of standalone and nested regular functions to unrelated object/prototype methods in the same file. Restored multi-container method disambiguation across sibling objects (e.g. `app.init` vs `router.handle`), and enabled source-location class symbol resolution in `findClassSymbolId` for `export default class` declarations. Expanded test baseline to 954/954 passing tests across 104 files (9,175 assertions, 0 failures) with zero regressions across all 4 verification gates.

### Planned & Upcoming (Track 4 — Enterprise Intelligence Scaling)
- Whole-repository multi-file ground-truth scaling.
- Template and fixture classification enhancements.
- TypeScript / multi-language fidelity expansion.

---

## [0.8.1] - Controlled Forensic Hardening, Lifecycle Integrity & Documentation Synchronization

- **Discovery Freshness & Fingerprint Verification (REUSE-01):** Hardened `DiscoveryValidator` to verify workspace freshness against target directory contents before reusing cached snapshots, validating file set, file sizes, and workspace source content digest (`computeWorkspaceDigest`).
- **Persisted Analysis Artifact Restoration (REUSE-02):** Reconstituted and restored full analysis records into storage on discovery snapshot reuse (`dependency-graph`, `symbol-table`, `knowledge-graph`, `semantic-analysis`, `control-flow-analysis`, `data-flow-analysis`, and terminal `analysis-run`), ensuring subsequent scoped queries retrieve complete persisted state.
- **In-Memory Validated Byte Consumption / TOCTOU Boundary (REUSE-03):** Refactored `DiscoveryValidator` and `AnalyzeProjectHandler` to return and consume validated in-memory artifact bytes (`validatedArtifacts: ReadonlyMap<string, string>`), completely eliminating disk TOCTOU race conditions between validation and downstream JSON parsing.
- **Discovery Root & Manifest Symlink Boundary (SEC-03):** Hardened `DiscoveryValidator` to verify that `.discovery/` directory root and `manifest.json` are not symbolic links (`lstat`) and physically resolve within the analyzed project workspace boundary.
- **CFG Loop Fall-Through Ownership & Finally Routing (CFG-01 / TEST-01 / TEST-02):** Corrected `control-flow-builder.ts` loop fall-through ownership so loop bodies terminate exclusively via back-edges without illegal duplicate fall-through edges to after-loop blocks, and hardened `try-finally` routing assertions (`continueBlock -> finalizer [finally] -> loop.headerBlockId [continue]`).
- **Runtime Awaitability, Barrier & Error Precedence (RUNTIME-01):** Hardened `ApplicationRuntime.initiateShutdown()` with a single-flight coalesced shutdown barrier (`this.shutdownPromise`), ensuring concurrent shutdown requests share a single execution path, and preserved primary startup errors when startup rollback encounters cleanup failures.
- **Storage Driver Auto-Inference & Path Validation (STORAGE-01):** Hardened CLI configuration to automatically infer `"sqlite"` storage driver when `--storage-path` is provided without an explicit driver, and added validation strictly rejecting `--storage-path` when combined with `--storage-driver memory`.
- **Event Reducer Metadata Lifecycle (EVENT-01 & EVENT-02):** Hardened `event-reducer.ts` to clear stale `analysisError` upon successful `AnalysisRunCompleted`, and clear stale `analysisDurationMs` upon `AnalysisRunFailed`.
- **Strongly Typed Symbol Derivation (TEST-03):** Replaced untyped `any[]` collections in discovery reuse integration tests with strongly typed symbols derived from `DiscoveryQueryService["getSymbolsForFile"]`.
- **Semantic Snapshot Reuse Assertion (TEST-04):** Replaced flaky wall-clock timing comparisons with deterministic semantic assertions (`isReused === true`).
- **Comprehensive Contract Documentation (DOC-01):** Added exhaustive TSDoc contract documentation across all touched core interfaces, functions, and state machines.
- **Empirical Baseline Scaling:** Expanded full test suite to **800/800 passing tests across 92 test files** (8,536 assertions, 0 failures), maintaining 10/10 benchmark governance checks and 4/4 verification dashboard gates.

---

## [0.8.0] - Security Boundary Hardening, Storage Immutability & Lifecycle Integrity

- **Git Subprocess Hardening (SEC-01):** Replaced shell-based `execSync` in `file-discovery-projection.ts` with direct process execution via `spawnSync("git", ["rev-parse", "HEAD"], { shell: false })`, eliminating shell interpretation risk at the Git revision lookup boundary when analyzing repository directories.
- **Discovery Manifest Path Traversal Hardening (SEC-02):** Hardened `DiscoveryValidator` with lexical boundary containment verification (`isPathWithinDirectory`), physical canonicalization via `realpath()`, and symlink rejection via `lstat()`. The validation is hardened against the investigated traversal and symlink-escape threat model.
- **SQLite Deserialization Deep Immutability (DAT-01):** Restored recursive immutability in `SqliteStorageProvider.deserializeRecord()` by applying `deepFreeze()` to deserialized record payloads, guaranteeing payload immutability across nested objects, arrays, and matrices without identified residual risk within the investigated SQLite deserialization boundary.
- **Event Reducer Terminal State & Replay Integrity (EVT-01):** Corrected `event-reducer.ts` to reduce `AnalysisRunCompleted` ($\to \text{COMPLETED}$) and `AnalysisRunFailed` ($\to \text{FAILED}$) with analysis and error metadata, ensuring `orchestrator.replay()` accurately matches live execution status without state divergence.
- **Persistent Storage Snapshot Reuse & Streaming Projections (P0.4):** Implemented discovery snapshot reuse bypassing re-parsing on unchanged repositories, bounded 64 KB chunked streaming atomic JSON writes (`StreamingJsonWriter`), and added `--refresh`, `--storage-driver`, and `--storage-path` CLI options.
- **CFG Loop Semantics & Runtime Lifecycle Safeguards (P0.5):** Corrected `DoWhileStatement` body-first execution and edge routing in `control-flow-builder.ts`, and guarded `ApplicationRuntime.registerService()` against duplicate service registrations.
- **Forensic Memory Scalability & Determinism Verification (PRF-01 & DET-01):** Validated in-memory AST lifecycle (explicit array release at `astResults.length = 0` prior to persistence), confirmed zero cross-project memory accumulation in multi-run isolation tests, and verified bit-for-bit deterministic JSON output and recursive canonical key-sorting in storage record hashing.
- **Empirical Baseline Scaling:** Expanded full test suite to **759/759 passing tests across 92 test files** (8,222 assertions, 0 failures), maintaining 10/10 benchmark governance checks and 4/4 verification dashboard gates.

---

## [0.7.0] - CLI Foundation, Command Discovery & Verification Hardening

- **Unified Visual Theme Engine:** Implemented 3 curated terminal themes (`classic`, `aurora`, `mono`) via `ThemeEngine` with semantic color roles (`brand`, `heading`, `text`, `muted`, `border`, `success`, `warning`, `error`, `info`, `active`), controlled by `--theme <name>` flag and `LEGACYEXODUS_THEME` environment variable.
- **Workflow-Structured Command Discovery (`HelpPresenter`):** Built structured root and subcommand help presenters grouping commands into logical workflows (`Workspace & Runtime`, `Repository Analysis`, `Quality & Verification`, `Plugins & Extensions`), documenting safety dispositions (`[read-only]` vs `[mutates workspace]`), option flags, and real-world examples.
- **Subsystem Test Explorer (`legacy-exodus test`):** Introduced dedicated test exploration and runner command with dynamic 12-domain taxonomy discovery (`test --list`), domain filtering (`test parser`, `test symbols`, `test flow`, etc.), `-v, --verbose` mode for detailed execution logs, `--bail` support, and pure `--json` output.
- **Multi-Gate Repository Verification (`legacy-exodus verify`):** Built unified 4-gate verification dashboard evaluating Static Typecheck, Unit/Integration Test Suite, Benchmark Governance Audit, and Working Tree Git Hygiene in a single command.
- **Narrow Terminal Viewport Safety (F-024):** Added terminal-width-aware column budgeting and ANSI-safe truncation in `TableRenderer` and `LayoutRenderer`, preventing horizontal overflow down to 24 columns without corrupting ANSI escape sequences.
- **Clean Machine-Readable Output Invariant:** Enforced strict separation between interactive TTY rendering, deterministic plain text CI output (`NO_COLOR=1` / non-TTY), and raw JSON payloads (`--json`).
- **Empirical Baseline Scaling:** Expanded full test suite to 660/660 passing tests across 87 test files (7,281 assertions, 0 failures), maintaining 10/10 benchmark governance checks and 3-tier bit-for-bit determinism.

---

## [0.6.0] - Core Foundation, Concurrency Hardening & Engine Governance

- **Idempotent Concurrent Runtime Shutdown & Draining (F-004 / F-006):** Hardened `LegacyExodusEngine.shutdown()` and `ApplicationRuntime.shutdown()` with state machine transitions (`stopping` -> `stopped`), preventing concurrent re-entry during active execution draining. `Orchestrator` tracks and drains in-flight analysis promises with a timeout, and `FileDiscoveryProjectionAdapter` drains active directory projection queues before database handles close.
- **Concurrent Atomic Projection Replacement (F-005):** Hardened `StreamingJsonWriter.writeAtomic()` with unique temporary filenames (`${destination}.${randomUUID()}.tmp`) and bounded exponential backoff retries (`replaceFile()`, up to 15 attempts with 10ms incremental backoff) for transient Windows filesystem contention (`EBUSY`, `EPERM`, `EACCES`), preserving zero-orphan cleanup and atomic publication guarantees.
- **SQLite Storage Provider & Schema Versioning (F-007):** Implemented `SqliteStorageAdapter` with schema compatibility enforcement (`PRAGMA user_version = 1`), `StorageSchemaVersionMismatchError`, busy timeout handling (`PRAGMA busy_timeout = 5000;`), WAL journaling (`PRAGMA journal_mode = WAL;`), and transactional batch atomicity.
- **Canonical Path Identity & Cyclic Dependency Resolution (F-008):** Hardened `ModuleResolver` and `DeterministicDependencyGraphBuilder` using normalized canonical POSIX path identity (`canonicalizePath`), WeakMap-cached lookups for `ReadonlySet<string>`, and `SymbolTable.filePath` canonicalization, ensuring correct graph resolution across cyclic, recursive, aliased, and path-based dependencies.
- **Dynamic Engine SHA Freshness Validation (F-023):** Enforced dynamic Git commit SHA extraction in benchmark and fidelity runners, preventing stale engine SHA reuse and strictly rejecting missing, empty, or non-string provenance before generating fidelity reports.
- **Semantic `.bind()` Receiver Invariant (F-001):** Hardened semantic call graph resolution for `.bind()` receiver calls (`fn.bind(this)`), ensuring the underlying function symbol is correctly resolved without semantic drift.
- **Symbol Extraction Error Classification (F-002):** Normalized `SymbolExtractionError` contract in `src/symbols/symbol-errors.ts`, ensuring deterministic error taxonomy across all AST extraction failure modes.
- **AST Validation Provenance & Immutability Trust Boundary:** Decoupled immutability from validation proof (`Frozen ≠ Validated`), establishing module-private `WeakSet` registries in `validateASTNode`, `validateASTResult`, and `validateParseResponse` to enable $O(1)$ fast-path validation of pre-validated deep-frozen AST objects while rejecting forged frozen structures.
- **Test Suite & Empirical Baseline Scaling:** Expanded full test suite to 613/613 passing tests across 82 test files (4,328 assertions, 0 failures), with 10/10 benchmark governance checks passing and bit-for-bit 3-run determinism across all benchmark tiers.

---

## [0.5.2] - Controlled Forensic Weakness Discovery & Remediation

- **Destructuring Pattern Binding Extraction (FINDING-SYM-04):** Implemented recursive `extractBoundNames` traversal for non-require destructuring declarations (`const { a, b: aliasB = 10, ...rest } = obj;`, `const [first, , ...tail] = list;`, `export const { a: b } = obj;`). Corrected severe defect where RHS initializer identifier (e.g. `obj`, `list`) was fabricated as a declared variable and exported symbol while actual bound variables were omitted from the symbol table.
- **Function Default Parameter Expression Filtering (FINDING-SYM-05):** Replaced unconditional recursive identifier extraction in `getParameters` with `extractBoundNames`, restricting traversal to the `left` binding pattern of `AssignmentPattern` nodes. Eliminated spurious parameter extraction for default-value expressions (e.g. `fallback` in `function test(x = fallback)`), preventing parameter scope pollution and variable shadowing in data-flow graphs.
- **Assigned Function `var` Scope Hoisting (FINDING-SYM-06):** Propagated `functionScopeId: fnScopeId` in `processAssignment` child context for assigned `FunctionExpression` and `ArrowFunctionExpression` nodes (`let h; h = function() { var inner = 1; };`). Corrected scoping failure where `var` declarations in assigned functions were hoisted to `"scope:module"` rather than the function's lexical scope.
- **Class Constructor Call Resolution (FINDING-SEM-02):** Expanded candidate matching in `nearestScoped` to include `(symbol.kind === "function" || symbol.kind === "class")`. Resolved semantic defect where constructor instantiations `new ClassName()` were marked as `UNRESOLVED` in the call graph and symbol references table.

---

## [0.5.1] - Pre-Claude Audit Evidence Integrity & Semantic Correctness Hardening

- **Fidelity Metric Mathematical Integrity (FINDING-FID-02):** Fixed metric semantic distortion where unmatched predictions in open-world sample validations were misclassified as `FALSE_POSITIVE`, artificially dropping reported precision to 2.4%–3.4%. Added `UNVERIFIED_SCOPED` match status under `worldScope: OPEN_WORLD_SAMPLE`, reporting open-world precision strictly as `N/A (Sample-Based)` and reserving `FALSE_POSITIVE` for disproven known negatives and exhaustive closed-world universes.
- **JavaScript `var` Hoisting & Scope Correctness (FINDING-SYM-01):** Hardened symbol extraction to assign `var` declarations in block statements, `if` statements, `for` loops, and `while` loops to the enclosing function scope (or `scope:module`) rather than the block's `scopeId`, while strictly preserving block scoping for `let` and `const`.
- **Deferred Function Assignment Extraction (FINDING-SYM-02):** Added support for deferred function and arrow expression assignments to previously declared variable bindings (`let h; h = function() {}` or `h = (x) => x`), enriching symbol tables with function identity, parameters, and location without fabricating identities for dynamic runtime values.
- **Scope-Aware Export Marking (FINDING-SYM-03):** Replaced linear name-only export marking with scope-aware lexical resolution, ensuring `module.exports = foo` and property exports match only the active or enclosing lexical binding and never mark shadowed child variables as exported.

---

## [0.5.0] - Phase 3 & Track 3 Milestones (Scalability & Migration Fidelity)

- **Controlled Whole-Repository Fidelity Expansion (P1.7B):** Expanded independent multi-category ground truth across 25 production and core architectural files for both Tier-2 (Fastify v5.3.3) and Tier-3 (Express v4.21.2) repositories without copying engine predictions or synthetic guessing. Fastify validation surface was expanded from 15 to 25 files covering 95%+ of core `lib/` modules (154 positive GT facts, 6,330 scoped predictions, 100.0% sample recall, 100.0% actionable correctness, 0 known-negative violations). Express validation surface was expanded from 15 to 25 files covering 100% of core `lib/`, 7 production application examples, and router integration test suites (142 positive GT facts, 4,165 scoped predictions, 100.0% sample recall, 100.0% actionable correctness, 0 known-negative violations). All 10 semantic categories verified across both repositories under the Three-Universe model, with absolute migration-safety verdict strictly maintained as `MIGRATION_SAFETY_NOT_YET_ESTABLISHED`.
- **Express Semantic Fidelity Hardening — Prototype Symbols & Dynamic Call Resolution (P1.7A):** Hardened prototype and property-assignment symbol granularity (`proto.method = ...`, `app.listen = ...`, `req.header = ...`, `exports.application = proto`, `exports.json = ...`), unwrapped chained CommonJS export assignments (`exports = module.exports = createApplication;`), extracted assignment-level `require(...)` imports, and enabled constructor instantiation (`NewExpression`) and `.apply`/`.call` unwrapping (`server.listen.apply`). Express v4.21.2 overall recall moved from 90.1% to 98.0% (99/101 TP), with Call Recall reaching 100.0% (10/10 TP), Export Recall reaching 100.0% (10/10 TP), Import Recall reaching 100.0% (10/10 TP), Dependency Edge Recall reaching 100.0% (12/12 TP), and Symbol Recall reaching 90.0% (18/20 TP), while maintaining 100.0% actionable correctness, 0 known-negative violations, and preserving Fastify regression recall at 99.0%.
- **Repository Boundary & Execution-Context Hardening (P1.6):** Centralized benchmark and governance path resolution into `legacy-exodus-core/benchmarks/paths.ts`, anchoring all internal caches (`.cache`), results (`results`), corpus manifests (`corpus`), and fidelity outputs (`results/fidelity/fidelity-report.json`) to the canonical package root (`legacy-exodus-core/`). Eliminated working-directory (CWD) leakage to Git root (`LegacyExodus/`), ensured user-supplied repository paths preserve caller-CWD resolution semantics, cleaned up misplaced root artifacts, and established failure-first regression tests for both Git-root and package-root executions.
- **Evidence Freshness Lock & Provenance Verification (P1.5 Hardening):** Implemented `DiscoveryArtifactProvenance` and automated `manifest.json` generation containing deterministic SHA-256 hashes of all projection artifacts, repository identity, git revision, engine commit SHA, and analysis run ID. Enforced strict freshness lock in fidelity validation rejecting missing manifests, missing required artifacts, corrupted artifacts (SHA-256 mismatch), repository mismatch, engine mismatch, or stale revisions with loud, deterministic errors.
- **Tier-3 Migration Fidelity Validation (P1.5):** Established an independent 101-fact ground truth baseline across 15 stratified architectural files of Express v4.21.2, achieving 90.1% overall recall, 100% actionable correctness on verified true positives, and zero known-negative false positives.
- **Stage-Bounded Storage Lifecycle (P1.4):** Implemented stage-bounded memory disposal, pruning ASTs after flow analysis and clearing in-memory storage records on runtime shutdown.
- **Deterministic Streaming Serialization (P1.3):** Built `StreamingJsonWriter` with bounded 64KB chunk buffer, native backpressure handling, atomic writes, and canonical JSON indentation, reducing Fastify peak RSS from 1,693 MB to 1,074 MB (-36.6%).
- **Migration Fidelity Deep Validation (P1.2):** Introduced the Three-Universe validation model (Positive Ground Truth, Known Negatives, Unvalidated Predictions), ensuring non-sampled predictions are never miscounted as false positives.
- **CommonJS Export Granularity (P1.1):** Enhanced export extraction for `module.exports = { ... }` and `module.exports = identifier` object literal patterns.
- **Automated Benchmarking Harness (Phase 3A/3B):** Whole-repository benchmarking suite across Tier-1 (`cookie-parser`, `debug`, `ms`, `express-session`), Tier-2 (`fastify`), and Tier-3 (`express`) repositories with 10-point governance self-audit and 3-run bit-for-bit determinism validation.

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
- **Multi-Language Expansion (PHP, Java, C/C++, Rust):** Planned for future phases following JavaScript/TypeScript real-repository validation.
- **Automated Transformation / Modernization:** Planned for later phases following verified zero-hallucination semantic baseline.