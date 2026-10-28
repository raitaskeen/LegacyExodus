# Engine assessment, IR readiness and path forward — 2026-10-28

Companion to [`FINDINGS.md`](FINDINGS.md). The score and the readiness verdict are this auditor's
judgment (INFERENCE) built on the evidence there; weights are stated so they can be challenged.

## 1. How the engine works today (as built at `c694d64`)

One `analyze` run, in `src/core/orchestration/command-handler.ts`:

1. **Snapshot reuse check.** If `.discovery/manifest.json` is HMAC-signed by this analyzer build for this
   exact location and every artifact hash matches, results are restored without re-analysis
   (`discovery/discovery-validator.ts`, `discovery/snapshot-trust.ts`; key in `LEGACY_EXODUS_HOME`).
2. **Discovery.** Recursive scan (symlinks skipped; `.git`, `node_modules`, `.discovery`,
   `.legacy-exodus` ignored), language and file kind by extension, root `package.json` dependencies, and
   framework hints (`discovery/file-scanner.ts`, `project-detector.ts`).
3. **Parse.** Babel 8 parses each JS/TS file with one option set. The Babel AST is mapped to a generic
   frozen `ASTNode { type, role, location, attributes, children }` tree, validated by zod, and written
   to a run-scoped AST store (`parser/adapters/javascript/*`, `core/orchestration/run-scoped-ast-store.ts`).
4. **Symbols.** Per file: declarations, scopes (block, function, loop, catch), imports/exports for
   ESM and CommonJS, and module references with source anchors (`symbols/javascript-symbol-extractor.ts`).
5. **Dependency graph.** Relative and `tsconfig`-alias specifiers resolve to repository files;
   import→export edges follow re-exports; Tarjan SCC cycles (`graph/*`).
6. **Per-file second pass** (files sorted by path):
   - The call graph resolves a call only when its target is *proven*: lexical binding, no rebinding,
     stable export, known receiver class (`semantic/call-graph-builder.ts`, 1,661 lines, the most
     rigorous component, hardened by F-002).
   - Express route extraction (`semantic/semantic-engine.ts`).
   - The CFG gets loop headers, dominators, natural loops and exception edges
     (`flow/control-flow-builder.ts`, hardened by F-003).
   - The DFG is built from the AST, not the CFG: definitions, uses, `if` joins, intra-file call
     bindings, and taint against a built-in policy (`flow/data-flow-builder.ts`).
7. **Synthesis.** Semantic analysis (calls, references, dead code, unused imports/exports, entry
   points, routes); cross-file flow connection with a worklist (`flow/flow-analysis-engine.ts`); a
   knowledge graph of files, symbols, contains and imports (`knowledge/knowledge-graph.ts`).
8. **Commit.** All records and the ordered event journal go to memory or SQLite storage in one
   transaction (`core/orchestration/orchestrator.ts`, `storage/*`).
9. **Projection.** Thirteen `.discovery/*.json` artifacts are written atomically, with a signed manifest
   (`storage/projections/*`).

Cross-cutting: every fact id is a SHA-256 over path, name and position; output order is sorted;
`INFERRED` / `CONFIRMED` / `RESOLVED` / `UNRESOLVED` labels are carried on facts. Verified by this audit:
two runs over six real corpora produced identical artifacts.

The **product vision** (README, ROADMAP, `.agents/context/ENGINE.md`):

- Four stages: **VyrixScout** discovery → **NolaraStruct** program understanding → **ZelvoxForge**
  migration planning and transformation → **VymosGate** validation and approval.
- A bounded AI layer, **Jev**, that reasons about the engine's evidence but never becomes its authority.
- The target chain from ENGINE.md: snapshot → discovery → frontends → symbols/scopes → modules → calls
  → CFG → DFG → taint/effects → semantic evidence → **Semantic IR** → repository knowledge → migration
  units → proof obligations → bounded Jev → deterministic transformation → verification → human gate.
- Your stated order on 2026-10-28: JavaScript, TypeScript, TSX, JSX and Node.js first, then PHP, Ruby
  on Rails, Java and others.

Today the engine implements stages 1–2 for JavaScript, partially for TypeScript, up to the DFG. Nothing
from Semantic IR onward exists.

## 2. Verified strengths

These held under adversarial probing and are worth protecting:

- **Determinism.** Six real corpora (engine `src` and `tests`, zod, pino, commander, @babel/parser), two
  `--refresh` runs each, gave identical artifacts after excluding timestamps and run ids.
- **Honest unknowns in call resolution.** No fabricated call target was found in any sample. Unknown
  module and alias cases stayed `UNRESOLVED` (BA-03, BA-12) rather than guessing. On its own source the
  engine resolves 22.9% of calls. That is low, but every resolution is proof-backed.
- **Snapshot trust.** HMAC-signed reuse bound to analyzer identity and location (F-001, #198).
- **Subprocess safety.** A `git.exe` planted in the analyzed repository was *not* executed (`s13`; Bun
  resolves `git` from `PATH`). `shell: false` everywhere; SQLite fully parameterized.
- **Engineering discipline.** Strict TypeScript; zod-validated contracts at every boundary; atomic
  projections; run-scoped AST store; durable event journal; 1,812 passing tests; a fail-closed verify gate
  (F-010); pinned CI actions with read-only permissions; a coherent agent operating system in `.agents/`.

## 3. Scorecard

| # | Dimension | Weight | Score /10 | Basis |
|---|---|---|---|---|
| 1 | Architecture & code quality | 10% | 7.5 | Clean layering, contracts, immutability, run isolation (§2) |
| 2 | Language frontend (parse) | 15% | 4.0 | Valid TS, `.d.ts` and real zod files fail (BA-01) |
| 3 | Symbols, scopes, module resolution | 15% | 5.0 | Strong JS scoping; TS declarations, TS ESM resolution, dynamic import missing (BA-02, 03, 09, 10, 13) |
| 4 | Call graph | 10% | 6.5 | Sound by construction, low recall; compiled CJS blind spot (BA-12) |
| 5 | CFG | 5% | 7.0 | Oracle-checked after F-003; three known adjacents (BA-14) |
| 6 | DFG & taint | 15% | 2.5 | Misses 23/27 structured flows and the canonical direct case; CONFIRMED overclaims; hard-coded policy (BA-04–07) |
| 7 | Framework semantics | 5% | 2.0 | Express routes CONFIRMED with wrong facts; nothing else (BA-08, BA-15) |
| 8 | Determinism, trust & security | 10% | 8.0 | §2; collation dependence (BA-16) |
| 9 | Scale & performance | 5% | 3.0 | 275 MB for zod; superlinear DFG; no memory bound (BA-17, BA-28) |
| 10 | Testing & verification | 5% | 6.0 | Large green suite and strong gates, but canonical cases untested; network-dependent (BA-20) |
| 11 | Docs & governance truthfulness | 5% | 4.0 | Excellent agent OS; inflated README; 66% empty docs (BA-21–23) |
| | **Overall** | 100% | **50 / 100** | Weighted sum 5.03; judgment band ±5 |

Reading the number: the **foundation** (dimensions 1, 4, 5, 8) averages about 7.4/10 and is genuinely
good. The **semantic content** a migration platform depends on (2, 3, 6, 7) averages about 3.7/10 and
is not yet trustworthy.

## 4. Is it ready for the IR phase?

**Verdict: NOT READY to implement the Semantic IR. READY to start IR *design* in parallel.**

An IR is only as good as the facts lowered into it. Building it now would freeze today's gaps (missing TS
declarations, missing flows, unstable ids) into the central data model, and the migration layers above
would inherit them.

### Readiness gates

| Gate | Requirement | Today | Blocking findings |
|---|---|---|---|
| G1 | Every valid supported file parses in its correct dialect | FAIL | BA-01 |
| G2 | All runtime and type declarations of supported languages become symbols | FAIL | BA-02, BA-13 |
| G3 | Module graph matches the compiler's resolution for supported configurations | FAIL | BA-03, BA-09, BA-10, BA-12 |
| G4 | Data flow is CFG-consistent: joins at every merge, no control-as-data | FAIL | BA-04, BA-05, BA-06 |
| G5 | Truth labels never exceed evidence (CONFIRMED / VERIFIED) | FAIL | BA-06, BA-08, BA-21 |
| G6 | Unknown and dynamic constructs are explicit UNRESOLVED facts, never absent | FAIL | BA-10 |
| G7 | Edit-stable identity model decided | FAIL (no design) | BA-18 |
| G8 | Determinism independent of locale and ICU | PARTIAL | BA-16 |
| G9 | Per-file cost linear; bounded memory on a 10k-file repo | FAIL | BA-17, BA-28 |
| G10 | A canonical-semantics corpus proves G1–G6 per construct | FAIL | BA-20 |
| G11 | CFG (already sound for loops and exceptions) | PASS with adjacents | BA-14 |
| G12 | Call resolution never fabricates a target | PASS | — |
| G13 | Runs, storage and snapshot trust | PASS | — |

When G1–G10 pass, the JS/TS frontend is ready to lower into an IR.

## 5. IR readiness program (recommended order)

Each item is one bounded finding: remediation, then independent red team, then human merge, under
`.agents/`.

1. **Canonical-semantics corpus first (BA-20).** One tiny program per construct × analysis, each with
   expected facts, in-repo, no network. It becomes the RED for everything below and later the
   conformance suite every new language frontend must pass.
2. **Parser dialects (BA-01).** Small, high-yield, unblocks real TypeScript.
3. **TypeScript declarations (BA-02) and TS module resolution (BA-03).** Together these make TypeScript a
   first-class language rather than JavaScript-with-types.
4. **Data flow on the CFG (BA-05 / F-004, with BA-04 and BA-06).** Either implement option B now, or move
   the DFG onto the CFG that F-003 made sound. The IR needs the CFG-based form, so the second option avoids
   doing the work twice. This is a design decision for you.
5. **Truth-label reset (BA-21, BA-08).** Downgrade Express route state and the README table immediately.
   This is cheap and stops users from trusting wrong facts.
6. **Identity ADR (BA-18)** and **code-point ordering (BA-16).** Both must be settled before an IR schema.
7. **Unknowns as facts (BA-10, BA-09), compiled CJS (BA-12), class expressions (BA-13).**
8. **Scale (BA-28, BA-17, BA-15).** Linear DFG, sharded artifacts, ignore policy, a 10k-file benchmark.

In parallel, as design only: the **Semantic IR ADR**:
- Module, declaration, type and CFG-based value graph with effects.
- A per-fact truth label and a source span on every node.
- The frontend contract every language must satisfy.
- How framework models and policies attach (this also fixes BA-25's missing plugin hooks).

## 6. Making LegacyExodus outstanding

The strongest position for this product is the one its kernel already describes: **a migration
platform whose every claim is evidence, not suggestion.** Competing tool categories (codemod and
recipe engines, AI coding assistants, SAST scanners, code search) usually optimize for coverage or
convenience. Few can show, for a whole migration plan, which facts are proven, which are assumed, and
which are unknown. That gap is the opportunity. Concretely:

1. **Evidence-carrying facts end to end.** Every IR node, migration unit and generated change keeps its
   truth label, source span and artifact digest. A reviewer can trace any line of a migration plan back to
   the code that justifies it.
2. **The unknowns map as a feature.** UNRESOLVED facts (dynamic imports, reflective calls, framework
   magic) become a ranked risk report: where humans or Jev must decide, and how much of the migration
   that touches. This turns the engine's conservatism from a weakness (low recall) into a planning asset.
3. **Reproducible, signed migration plans.** Extend the HMAC snapshot model so a plan can be re-verified
   in CI from the same inputs, bit for bit (after BA-16).
4. **Proof obligations plus differential verification (VymosGate).** Each transformation emits obligations
   (same exports, same routes, same data flows to sinks) that are checked mechanically, and equivalence is
   tested by running old and new code on recorded inputs.
5. **Continuous modernization, not one-shot.** Edit-stable ids (BA-18) and incremental re-analysis let a
   migration proceed over months while the legacy code keeps changing.
6. **Cross-language system graph.** For full-stack legacy systems, the most valuable edges cross languages:
   a PHP or Rails route, the JS client that calls it, the SQL it runs. Route and contract extraction per
   framework (done correctly, see BA-08) joined in one IR is a strong differentiator.
7. **Framework and policy packs as data, with conformance tests.** Express, NestJS, React, then Laravel,
   Rails and Spring, each validated by the canonical corpus. Taint policy becomes a versioned pack
   (BA-07).

### Language expansion (after G1–G10)

- **Frontend contract first.** A language is added only when its frontend passes the canonical-semantics
  corpus for that language. It emits the same normalized AST and symbol contracts, then IR.
- **Parser options to evaluate (design question):**
  - Tree-sitter grammars: uniform and error-tolerant, but concrete syntax only, so all semantics would
    have to be built in-house.
  - Each ecosystem's own parser run as a sidecar process: e.g. nikic/PHP-Parser, Ruby's Prism, JavaParser
    or Eclipse JDT. These are higher fidelity but add runtimes, which conflicts with the current Bun-only
    toolchain and the subprocess rules in the kernel.
- **Suggested order:** PHP before Rails. PHP is closer to the existing JS model: files, includes, routes.
  Rails depends on convention and metaprogramming, which needs the unknowns-as-facts machinery from item
  2 above to be mature. Java benefits most from a type-aware frontend.
- **Discovery is a precondition.** Its framework detection must become per-language and evidence-based
  first (BA-15). Today a Rails app is reported as Express + React.

## 7. What this audit did not cover

- **Memory/OOM neutrality was not established**: no repository above about 830 files was run, and no
  heap profiling was done.
- **Not exercised:**
  - SQLite persistence under concurrent writers.
  - Shutdown races beyond the existing tests.
  - The `test` and `verify` CLI commands on hostile input.
  - Plugin loading with third-party code (there is none to load).
- **Not re-reviewed line by line:**
  - `semantic/call-graph-builder.ts` beyond structure and probes (it passed two independent red-team
    rounds in F-002).
  - `discovery-validator.ts` and `snapshot-trust.ts` (reviewed in #198).
- **Not reproduced:** cross-machine collation differences (BA-16 shows the mechanism, not a diff between
  two machines).
