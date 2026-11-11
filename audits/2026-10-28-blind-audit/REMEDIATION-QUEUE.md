# Remediation queue and resume guide

The live plan for fixing the audit findings ([FINDINGS.md](FINDINGS.md)), plus the scale and storage
work the Ghost run showed is needed before the IR phase. This file is the hand-off point: a new
session resumes from here.

## Rules (owner decisions, 2026-10-28; updated 2026-11-02)

- **Branches:** `main` is the only truth; `core-foundation` and `docs-foundation` are retired (do not delete them without an explicit OK).
- **One finding per PR**, branch from the latest `origin/main` (or stack on an open PR that touches the same files), with the RED test committed or shown first.
- **File allowlist = lock:** no two running items touch the same file. The exception is `tests/conformance/known-gaps.ts`, where each fix edits only its own finding's group.
- **Parallelism:** at most 3 sessions or agents at once.
- **Who does the work (2026-11-02):** the owner asked for no subagents. The lead session writes, tests and self-reviews every item itself.
- **Merge gate:**
  - required checks green (Verify Core, Windows Path Smoke);
  - fact-diff with no unexplained lost facts;
  - each fix removes its own ledger entries;
  - owner decision (2026-11-02): with no subagents, merge on green CI. The lead self-reviews, and the fact-diff evidence goes in the PR. This replaces the independent red-team PASS. After each merge, confirm `origin/main^{tree}` equals the reviewed head's tree.

  Merge with `gh pr merge <n> --auto --squash --match-head-commit <sha>`. `main` requires up-to-date branches, so after another PR merges, merge `origin/main` into the waiting branch, push, and re-arm.
- **Red-team FAIL → Path A:** fix on the same branch, then send the fixed head back to the same reviewer. After two FAILs, go back to design.
- **Engine invariants (every item):**
  - Deterministic: byte-identical output across runs, code-point ordering, no wall-clock or locale in facts.
  - Proven-only: RESOLVED means proven, and an unknown stays visible as UNRESOLVED or REQUIRES_REVIEW, never absent.
  - Secure: no network during analysis, HMAC-bound snapshots, no plaintext paths in shared artifacts (BA-26).
  - Fast: no stage superlinear in file or function count.
  - No over-engineering: build only what a finding, a failing case or a measured budget demands.

## Current status (2026-11-09, evening). Read this first

The latest audit is [`../2026-11-10-blind-audit/AUDIT-REPORT.md`](../2026-11-10-blind-audit/AUDIT-REPORT.md): main `d30ffaa`
scored about 72 (7.18), not the 77 self-assessed in [`STATUS-2026-11-09.md`](../2026-11-08-fresh-audit/STATUS-2026-11-09.md).
Eight findings, XA-01 to XA-08. Owner decisions: fix order XA-01, 02, 03, 04, then 05 to 07; `closedWorld` stays
off; Fact Diff and Scale Gate are now required checks on main; #195 closed; #111, #112 and #117 stay open.

## Track 2026-11-09: engine plan to 85-90 (ENGINE-PLAN-TO-88.md, owner-approved)

| Item | What | State |
|---|---|---|
| A1 | Reason on every UNRESOLVED call | **Merged** #301 (`79b52d7`) |
| A2 | Coverage table in the fact diff, `coverage` command | **Merged** #302 |
| A3 | Call oracle on Express and Fastify | **Merged** #304; corpora #303; its first finding OR-01 fixed #305 (`3fe46ec`); gate #306 |
| A4 | CFG block oracle (flow oracle: unreachable and dead-code claims) | **Merged** #307 (`67f9e62`): 0 contradictions on Express and Fastify |
| B1 | EXTERNAL package and Node module calls (ADR-012) | **Merged** #309 (`2ef5a7b`); oracle lockfiles #310; upgrade rule #308 |
| B1b | EXTERNAL standard globals and CommonJS require | **Merged** #311 (`410509f`) |
| B1c | EXTERNAL aliases of globals and built-in methods on literal values | **Merged** #314 (`d2aa6aa`): src EXTERNAL 24.9% -> 33.3%, 0 lost on 9 corpora |
| A2b | Coverage split: source files vs test files | **Merged** #313 (`7470e0e`) |
| B2 | `require` in TypeScript compiled to CommonJS (nearest tsconfig) | **Merged** #318 (`781e1d5`): Ghost 967 upgraded, 0 lost; module-load 1,060 -> 93; 0 change on 10 other corpora |
| C | Receiver tracking, see PHASE-C-DESIGN.md | C1 **Merged** #312 (`7ea08c4`): Fastify oracle recall 7.1% -> 34.3% (CI), 0 contradictions. C2 + C2b **Merged** #315 (`fdc37f3`): prototypes, `Object.create(P)`, ES5 inheritance; 0 lost on 11 corpora, mongoose +132 resolved; Ghost 190.6 s vs 206.1 s. C3 **Merged** #316 (`3039c44`): CommonJS export objects, own-alias writes, factory copies, re-export hop; Express oracle recall 29.4% -> 49.3%, 0 contradictions; facts-lost-explained (owner OK): Ghost 216 = 148 dfg refinements + 68 unused exports now called; review fix c68564a (plain module.exports read). Next: B2 (TS compiled to CommonJS), B3, C4-C6 |
| D-H | See the plan | Queued |

## Track 2026-11-11: cross-file audit B findings (XB-01 to XB-09)

Audit by Shahzaib Hassan on `fdc37f3` (`audits/2026-11-10-blind-audit-b/AUDIT-REPORT.md`, ~70). XB-01 to XB-08 reproduced on `3039c44` (2026-11-11) with Node as ground truth. Order: B2, then XB-01, XB-04, XB-02 with B3, XB-03, XB-05 to XB-08, then C4 to C6.

| ID | Severity | Finding | State |
|---|---|---|---|
| XB-01 | High | Arrow functions and function expressions get no data-flow summary, so taint stops at them | **Fixed** #319 (`e527165`): facts-lost-explained (owner OK), 541 lost = call result now flows into the arrow/function-expression return value; ~47k data-flow facts gained, Ghost +26 taint (real flow through a SHA-256 arrow helper in tools/gx). Caller label (calls inside arrows labelled `module`) left for its own PR |
| XB-02 | Medium | `#imports` and package self-references are EXTERNAL with no module edge | Open (with B3) |
| XB-03 | Medium | A global, built-in prototype or package patched through an alias, or by same-file `Object.assign`, stays EXTERNAL | Open |
| XB-04 | Medium | C1 matches the returned name by string: block shadow or destructuring gives a false RESOLVED | In progress (branch fix/xb04-factory-bindings): also catches catch-parameter shadow and for-of rebind |
| XB-05 | Low | C2: an `Object.prototype` name called before its assignment resolves to the later method | Open |
| XB-06 | Low | `async` or generator factory resolves `make().m()` | Open |
| XB-07 | Low | `Object.assign(this, opts)` in a constructor function: prototype method still RESOLVED | Open |
| XB-08 | Info | ESM directory import resolves through `main`; Node throws | Open (wording) |
| XB-09 | Info | CI blocked by Actions billing | Closed: running again since 2026-11-10 17:19; Copilot review rule removed from rulesets and drafts skip CI (#317, `df5e290`) |

## Track 2026-11-09: cross-file audit findings (XA-01 to XA-08)

| ID | Severity | Finding | State |
|---|---|---|---|
| XA-01 | High | An HTML escaper cut taint for every sink | **Fixed** #294 (`d6aa5e3`) |
| XA-02 | High | Exported subclass left its internal base closed | **Fixed** #295 (`6bff174`) |
| XA-03 | Medium | Method written on an exported instance in another file ignored | **Fixed** #296 (`e5f9e1e`) |
| XA-04 | Medium | Computed read borrowing a method in the same file not seen | **Fixed** #297 (`d1e2121`), narrow rule (owner) |
| XA-05 | Low | Call before its CommonJS `require` binds is RESOLVED | **Fixed** #298 (`4986949`) |
| XA-06 | Low | Validator stack overflow drops a parsable file as `PARSER_EXECUTION_FAILED` | **Fixed** #299 (`65328f2`) |
| XA-07 | Low | README/CI wording says more than the code proves | **Fixed** #300 (`e33eb87`) |
| XA-08 | Info | `closedWorld` cannot be switched on | Closed: stays off (owner), documented in #300 |

## Track 2026-11-08: fresh audit findings (NA-01 to NA-15)

The fresh read-only audit of `main` at `b29d8ac` is in [../2026-11-08-fresh-audit/](../2026-11-08-fresh-audit/):
- `AUDIT-REPORT.md`: findings, red team, scorecard (about 67/100) and feature-fit;
- `STATUS-REPORT.md`: the whole record from 28 Oct to 8 Nov (all 28 BA findings, Ghost history, sessions);
- `SAFETY-NET-CRITIQUE.md`: the next product, with a critique of the Gemini blueprint.

**Owner decisions on 2026-11-08:**
- Fix every open finding in the best way, and avoid both hallucination and over-engineering.
- Strengthen the accuracy harness, with graphs and measured accuracy, before the IR phase.
- NA-01 goes first.
- The next product is the Behaviour Safety Net (test generator), not quantum-safe. It runs in parallel and never edits `legacy-exodus-core/src`.
- The owner works from two Claude accounts on one PC, and both share `~/.claude` memory. This file plus memory is the hand-off. Never run two writers on one branch.

| Order | Item | Sev | Allowlist (lock) | Status |
|---|---|---|---|---|
| 1 | NA-01 every call site is a fact: unnamed callees UNRESOLVED (`mk().run`, `new K().m`, `o[<dynamic>]`, `super.m`, `<function>`); tagged templates call their tag | P1 | `src/semantic/call-graph-builder.ts`, `tests/conformance/cases.ts` | **merged #259** `318f3f0` (2026-11-08): Ghost +68,646 call facts, 0 lost; main tree verified, main CI green. Flaky readdir test fixed in #260 `8ce20c5` |
| 2 | NA-02 `with` / direct `eval` make names in scope UNRESOLVED (`dynamic-scope`) | P2 | call-graph-builder scope resolution | **merged #262** (2026-11-08): fact-diff 0/0 on all 5 corpora incl. Ghost; main tree verified |
| 3 | NA-05 enforce gates: `--fail-on-loss`; Express and Fastify in the CI fact-diff; ask the owner to add Fact Diff and Scale Gate to required checks | P2 | `.github/workflows/ci.yml` | **merged #261** `71983f1`: the gate is live (first run passed). **Owner action still open:** add Fact Diff + Scale Gate to the required checks of ruleset main-branch-protection |
| 4 | NA-04 scale gate measures the engine, not the harness read-back: production mode, re-baseline Ghost, nightly Ghost | P2 | `benchmarks/scale.ts`, `benchmarks/harness.ts`, `ghost.json` | **merged #265** (2026-11-08): fresh-only, engine-only measurement, harness JSON reads typed; main tree verified, CI green |
| 5 | NA-06 byte-reproducible CLI output (no random ids or times in artifacts) | P2 | `src/cli/commands/analyze.ts` plus projection | ADR-010 ACCEPTED (#271 merged). Step 1 **PR #276** (fact artifacts without run identity, manifest schema 3; fact-diff 0/0 on all 5 incl. Ghost; auto-merge). Step 2 (stable projectId) todo |
| 6 | NA-07 report skipped symlinks in `excludedPaths` | P2 | `src/discovery/file-scanner.ts` | **merged #263** (2026-11-08); main tree verified |
| 7 | NA-08 SQLite concurrent runs: classified error plus busy retry | P2 | `src/storage/adapters/sqlite-storage.ts` | **merged #264** `f1fe4c9` (2026-11-08) |
| 7b | NA-16 snapshot reuse parses every artifact into memory (Ghost 8,939 MiB on reuse vs ~2 GB fresh) | P2 | `src/core/orchestration/command-handler.ts` reuse path | **ADR-011 ACCEPTED** (owner, 2026-11-08; PR #271): verify-while-copying spool, FactArray restore, reuse budget in the scale gate. Ready to implement |
| 8 | NA-03 taint policy packs (fs/path, SQL, SSRF, NoSQL); callbacks; destructured-require helpers | P2 | `src/flow/taint-policy.ts`, flow builders | **Done.** 03a #266, 03b #270, 03c #279, 03d #281, 03e #282 merged (main tree = head tree, CI green each). Conformance known-gaps ledger is empty |
| 9 | NA-09 dead code: duplicate declarations and Annex B; NA-12 hoisting | P3 | extractor, call graph | NA-09 **merged #272** (fact-diff 0/0 incl. Ghost after narrowing to function declarations). NA-12 **merged #283** (Ghost first caught a class field calling a later private method; methods excluded, then 0/0 on all five corpora) |
| 10 | NA-10 resource-limit label; NA-11 report a rejected snapshot; NA-13 the "read-only" label | P3 | parser adapter, validator, CLI help | NA-10 #267, NA-13 #268, NA-11 #269: **all merged**, main verified |
| 11 | NA-14 dependabot PRs (fact-diff for `@babel/parser`) | P3 | lockfile | #138, #135, #181, #137 merged (Babel Ghost 0/0 locally). **PR #280** pino + @types/node merged (supersedes #194/#195). #195 still open: owner to close (classifier blocked the close) |
| 12 | NA-15 docs truth refresh (README, CURRENT_IMPLEMENTATION, ROADMAP), BA-19/BA-25 decision | — | docs | **#275 merged** 2026-11-09 (docs state NA-03c/d/e fixed). Docs part 2 (visual layout, Mermaid, ADR index) next after NA-12 |
| — | Accuracy harness: per-category precision/recall against ground truth (Express, Fastify, plus new probes), graphs in the benchmark report, trend per PR | — | `benchmarks/**` | PR #273: `benchmarks/cli.ts accuracy` (recall/precision per category plus Mermaid chart, CI summary, fails on regression); PR #274: audit probes as runtime-proven cases, 3 owned gaps |
| — | 2026-11-09 night | — | — | Merged and verified: #283 NA-12, #284 ADR-010 step 2 (stable projectId), #285 + #286 ADR-011 (NA-16: Ghost reuse 11,610 -> ~1,000 MiB, 79 -> 25 s; Scale Gate reuse step, CI 708 MiB vs 1,800 ceiling). Every NA finding is now merged. #287 docs visual pass (auto-merge). #195 waits for the owner to close. #287 merged. #288 (ghost.json reuse note) auto-merge. Website PR LegacyExodus/legacyexodus-web#4 open for owner review; not merged, since a merge may publish |
| — | 2026-11-09, website and call resolution | — | — | Website PR LegacyExodus/legacyexodus-web#4 merged and live (products page, Ghost benchmarks, SEO; Cloudflare previews fixed with an empty `[previews]` block). Unresolved-call study (Ghost 84% unresolved, 77% of them in tests; causes in STATUS-2026-11-09). Fixed: #290 function-level `require` binds in its function (also removed a false RESOLVED class), #291 directory requires through `package.json` `main` (Fastify +962), #292 `this.method()` in classes that do not escape their file (`src/semantic/class-hierarchy.ts`; Ghost +36, engine +63). All merged with the owner's `facts-lost-explained` label (state changes only), main tree verified, CI green. Owner decision open: `closedWorld` for exported classes (Ghost +891) |
| — | After all findings, docs and issues close (owner 2026-11-08) | — | — | separate session: website legacyexodus.tech (test generator and modules, research), SEO for leads. Docs: accuracy first, then Mermaid workflows and illustrations in the site palette (see memory brand-and-docs-direction) |

## Status

| Wave | Item | Findings | Allowlist (lock) | Depends on | Status |
|---|---|---|---|---|---|
| 0 | Fact-diff tool | — | `benchmarks/fact-diff.ts`, `benchmarks/cli.ts`, its test | — | merged #204 `6c14e0d` |
| 0 | Code-point ordering | BA-16 | sort comparators in `src/**`, `src/shared/ordering.ts` | — | merged #205 `9b31888` |
| 0 | Truth-label reset | BA-21, BA-22, BA-08 label | `README.md`, `docs/CURRENT_IMPLEMENTATION.md`, route state + test | #205 | merged #207 `5a95e9f` |
| 0 | Conformance corpus + ledger | BA-20 (1) | `tests/conformance/**` | #204 | merged #206 `5ba1e21` |
| 1 | Parser dialect per extension | BA-01 | `src/parser/adapters/javascript/**`, parser tests, BA-01 ledger group | #206 | merged #210 `24c3d3b` |
| 1 | CFG adjacents (A2, A3, `finally` ids) | BA-14 | `src/flow/control-flow-builder.ts`, CFG tests, BA-14 ledger group | #206 | merged #211 `d7e51f1` (after one FAIL on nested `finally` ids; fixed by collision-free probing). Lead decisions: keep dead-tail `loop-back`; loops wholly in dead code are not natural loops |
| 1 | CI fact-diff job (PR summary of facts lost/gained) | BA-20 | `.github/workflows/ci.yml`, workflow tests | #204 | merged #208 `5ef17de` |
| 1 | Pin corpora by commit and tree hash | BA-20 (2) | `benchmarks/corpus/**`, `tests/unit/governance/test-fidelity-helpers.ts` | — | merged #212 `57aaa52` |
| 1 | Harden conformance (#206 review) | BA-20 (3) | `tests/conformance/cases.ts` | #206 | merged #209 `0ffd0c2` |
| 1 | Parser fallback honours `language: typescript` for unlisted extensions (#210 review; unreachable in production today) | BA-01 | `src/parser/adapters/javascript/**` | #210 | queued (small) |
| 1 | Fact-diff residual gaps (dominators, lifetimes, unused definitions, first taint hop) | — | `benchmarks/fact-diff.ts` | #204 | queued (low) |
| 2 | TS module resolution | BA-03 | `src/graph/**`, tsconfig loader, `command-handler.ts` aliases | Wave 1 | merged #213 `bbf10ce` |
| 2 | TypeScript declarations | BA-02 | symbol extractor, `symbol-contracts.ts`, kind lists in `src/` | Wave 1 | merged #214 `56acd69` (after one FAIL: specifier exports, regex, reopened-namespace soundness) |
| 2 | Docs truth update after BA-02 and BA-03 | BA-21 follow-up | `README.md`, `docs/CURRENT_IMPLEMENTATION.md` | #213, #214 | merged #215 `de960f7` |
| 2 | Class expressions; switch and static-block scopes | BA-13 | symbol extractor, call graph | BA-02 | merged #216 `1a55f86` (after one FAIL: Annex B target, class-expression dead code) |
| 2 | Namespace imports | BA-09 | `dependency-graph-builder.ts`, `semantic-engine.ts`, `module-resolver.test.ts` | #216 | merged #217 `6a15716` |
| 2 | Compiled CommonJS | BA-12 | symbol extractor (`void 0`), `call-graph-builder.ts` | #217 (stacked) | merged #218 `16c51ec`. Follow-up: getter re-exports, `__exportStar`, `__importDefault`/`__importStar` interop |
| 2 | Dynamic `import()` and computed loads | BA-10 | module-reference and graph contracts, extractor, graph builder, semantic engine, `fact-diff.ts` | #218 (stacked) | merged #219 `7210e8d`. Follow-up: literal `require('./x')` in expression position |
| 2 | Follow-ups: `.d.ts` implicit exports; surface tsconfig diagnostics; namespace calls through aliases; `profile.ts` alias reader | BA-02, BA-03 | per item | #213, #214 | queued |
| 3 | Data flow rebuilt on the CFG; design in WAVE3-DFG-DESIGN.md (steps 3a–3d) | BA-05, BA-04, BA-06, BA-27, BA-28 | 3a: `control-flow-builder.ts` (`buildAllWithNodes`), new `cfg-dataflow.ts` | design done | 3a merged #220 `041ccee` (core, not wired). 3b merged #221 `9abc7e9`: the CFG verdict decides same-function taint, while the legacy builder keeps defs, uses and cross-call paths. Closes BA-05, BA-06, BA-27 and BA-04 within a file; ledger 35 → 9. 3c merged #222 `405d56f`: cross-file `argumentSourceIds`, so BA-04 is fully closed. 3d merged #223 `09aa02f`. On the BA-28 shape the stage now grows ×1.5/×1.7/×2.1 per doubling (9.7 s → 0.5 s at 4k functions). The scale gate test is in, and Ghost v6.73.0 is pinned as the `scale` tier with ceiling budgets. Still open: long single functions are quadratic, and the Ghost run waits for the owner |
| 3 | Taint policy packs | BA-07 | flow policy module | DFG rebuild | merged #228 `841dbea`: one versioned policy (`builtin-1`) keyed by resolved bindings (module sinks through any local name, Express handler params from proven receivers, destructured sources); fact-diff 0/0 on CI corpora |
| S | Scale and storage track (from the Ghost run, below) | BA-17, BA-28, new | per item | see track | queued; S1 rides with 3d |
| 4 | Discovery policy | BA-15 | `src/discovery/**` | Wave 3 | merged #227 `1e24e42`: full gitignore semantics (tracked files kept, as git does), root `.legacyexodusignore`, every exclusion in `excludedPaths`, minified bundles `generated`, frameworks from manifests only. Ghost: 3 tracked files kept, +519 workspace dependencies |
| 4 | Express model | BA-08 | `semantic-engine.ts` | Wave 3 | merged #231 `583b564`: per-router stacks in registration order, mounts joined, handler is the last argument, path arrays per path, trailing slash kept. Ghost: middleware chains 15 → 23, routes re-pathed through mounts |
| 4 | Dead-code precision; React | BA-11, BA-24 | `semantic-engine.ts`, extractor (`member` flag), `workspace-loader.ts` | BA-08 (stacked) | merged #233 `d590050` (engine `src` dead code 425 → 0; Fastify 5,118 → 1,347; extractor fixes: body bindings not exported, spreads are not properties, TS parameter properties are members, assigned functions are values; ESLint `after-used` params): namespace/re-export/package-entry exports used; properties never unreferenced locals; JSX uses `React` |
| 5 | Stable identity (ADR first) | BA-18 | ids | Wave 4 | **done.** Keys #238–#242 (symbols, calls, references, CFG, data flow, routes, middleware); ids = stableId(domain, key) #247–#249; ADR-008 marked implemented #250. Production builds no position ids |
| 5 | Manifest location without plaintext path (merged #232 `e2105aa`: `locationDigest` HMAC, schema 2, no path in `project.json`; conformance checks every artifact) | BA-26 | `src/storage/projections/**`, `src/discovery/discovery-validator.ts`, `snapshot-trust.ts`, tests | Wave 4 | queued. Design (lead, 2026-10-28): the validator binds reuse to the canonical absolute path (`discovery-validator.ts:280, :405`, the F-001 location binding), so a relative path alone would weaken trust. Replace `repository.path` with `repository.locationDigest = HMAC(localKey, canonicalPath)`, recomputed on validate, and bump the manifest contract so old snapshots refresh |
| Docs | Docs/governance session | BA-23, BA-22 rest | `docs/**`, root docs, `.agents/**` | anytime | merged #230 `c0e47cc`: one branch of truth everywhere, 122 empty files removed, failure-recovery fenced. Governance archived and Copilot policy folded into a checklist: #234. Left: Diátaxis layout, `.discovery` schema reference |

## Scale and storage track (Ghost run, 2026-10-29)

Measured on TryGhost/Ghost:
- 9,168 files discovered, 7,202 analyzed, 0 parse failures;
- about 26 min wall time, about 10.2 GB peak RSS, 1.6 GB projected output;
- 18% of calls resolved;
- only 17,872 of 47,644 imports are relative; most of the rest are `@tryghost/*` workspace packages that never resolve.

Each item is the smallest change that moves a measured number. Every one keeps output byte-identical except where the item says otherwise.

| Step | Change | Budget / gate | Findings |
|---|---|---|---|
| S1 | Ghost pinned as a benchmark (commit and tree hash, like the other corpora). The stage timer and peak RSS are recorded in the benchmark report | Baseline recorded; from then on a run may not regress time or RSS by more than 10% | BA-28. Pinned in #223 (`cli.ts scale ghost`). First run 2026-11-03: 768 s (was about 26 min), 11,431 MiB peak, 1.6 GB output, 17 taint flows; budgets set to measured +10% in #224 `e18a19c` |
| S2 | Linear-cost data flow (Wave 3a–3b persistent state, no per-`if` scope copies) | Stage doubling ratio ≤ 2.5× at 1k→2k→4k functions | BA-28, BA-05. Done in #223 (×1.5/×1.7/×2.1). Long single functions are still quadratic: shared-prefix taint paths and persistent CFG state, only if Ghost needs them |
| S3 (merged #226 `475ec53`: module edges +3,470, import edges +7,844, 3,277 more calls resolved, −1,314 unused exports on Ghost) | Workspace package resolution: read `workspaces` (npm/yarn) and `pnpm-workspace.yaml`, then map package names to their source roots via each package's `exports`/`main`/`types`. No network, no `node_modules` crawling | Ghost import bindings rise from 37.5% relative-only; the fact-diff gains are explained | new (coverage) |
| S4 | Streamed, per-file sharded output. Write each file's facts when the file is done and drop its AST. The project-level indexes are built from shards, and the HMAC manifest covers shard digests | Peak RSS bounded by the largest file plus the indexes, not the repository. Target for Ghost: under 3 GB | BA-17 |
| S5 | Compact storage. Minified JSON shards. The knowledge graph references symbol ids instead of duplicating symbol records. Projections written once, not re-serialized | Ghost output under 400 MB with no fact lost (fact-diff 0/0) | BA-17 |
| S6 | Incremental runs: a shard keyed by content hash plus engine and config version is reused when unchanged, and invalidation follows the module graph | Second Ghost run with one file changed in under 10% of the full run; output byte-identical to a clean run | new (speed) |
| S7 | Parallel per-file stages (parse, symbols, CFG) on a bounded worker pool, merged in code-point order | Wall time scales with cores; outputs byte-identical to a single worker (CI check) | new (speed) |

Order: S1 with 3d; S2 is Wave 3; S3 after Wave 2 merges (it touches `src/graph/**`); S4 and S5 together after Wave 3; then S6, then S7. BA-18 (stable identity) lands before S6, since cache keys and IR units need edit-stable ids.

## Road to IR, migration and new languages

1. **Finish Waves 2–5 and the S track.** Exit criteria for the IR phase:
   - every P0/P1 finding fixed;
   - the conformance ledger is empty, or each remaining entry has an owner decision;
   - stable identity (BA-18) is in;
   - Ghost runs within its S budgets;
   - two runs are byte-identical.
2. **IR phase.** A language-neutral IR built from the proven facts only (symbols, module graph, proven calls, CFG/DFG). Each IR unit carries its evidence state, and unknowns stay explicit. The IR gets its own conformance cases and fact-diff category before any migration code is written.
3. **Migration.** Plans are generated from the IR, with ordering from the module graph and cycles, and verified by running the target's tests. Every plan step is traceable to IR evidence.
4. **New languages (PHP, Ruby on Rails, Java).** Each language enters through the existing adapter seams (parser adapter, symbol extractor, resolver) and gets its own conformance corpus and pinned real-world benchmark. It is not "supported" until its ledger is empty and its benchmark meets budgets. No language-specific logic goes into the IR or migration layers.

Notes:
- BA-03 design question: TS importers now resolve to a `.d.ts` sibling over `.js` (TS semantics), which drops runtime call/data-flow facts through that import (pino `test/helper.js`). Consider linking the declaration to its implementation for runtime analysis. Also: surface `getTsConfigDiagnostics()` to users; read `allowJs`.
- Corpus pinning residual (accepted): a `benchmarks/.cache` entry whose name matches no manifest is skipped, not refused. Consider failing closed on unknown entries. A half-cloned cache (no `HEAD`) fails the pinned-tree check; delete that cache folder and rerun.
- Lead decision (2026-10-28): the hotspot split is dropped. Wave 2 items lock disjoint files, so splitting adds risk without enabling parallelism.
- BA-01 known limitation: with the Flow plugin, a statement that is only the identifier `type`, `declare` or `opaque` at the end of a line, followed by an assignment on the next line (valid JS via ASI), now misparses as Flow. No corpus hits it. Revisit if a real repository does.
- BA-03: since #205 the generic `paths` alias `@/*` beats `@/_internal/*`. ICU order matched tsc's longest-prefix rule only by accident. Implement longest-prefix selection.
- BA-09 design: references carry no member-access context, so every export a namespace object exposes counts as used (sound). Precise member tracking is a possible later refinement under BA-11.

## How to resume (new session or after a usage limit)

1. `git -C C:\Projects\LegacyExodus fetch origin`, then read this file on `origin/audit/2026-10-28-blind-audit`.
2. `gh pr list --repo raitaskeen/LegacyExodus --state open` shows in-flight PRs. No PRs are open after #225 (2026-11-03). BA-17 first pass merged as #225 `c54905e`:
- Ghost went from 768 s / 11,431 MiB to **328 s / 6,166 MiB**; zod from 3,044 to 1,305 MiB. Output is byte-identical.
- Causes fixed: sort keys built per comparison; scopes cost files × references; whole-payload record copies; all projection payloads held at once.
- Ghost budgets are now 360 s / 6,785 MiB.

S4/S5 investigated 2026-11-03, nothing merged:
- **Live data is not the peak on mid-size repos.** After a forced GC, zod's live heap is about 290 MB against a 1.5 GB peak; the rest is short-lived garbage collected late. On Ghost, live heap is 1.9 GB against a 6.0 GB peak.
- **Compact records plus a spooled CFG record** (identical ids, all tests green) made zod worse: 1,496 → 1,607 MB and 36 → 48 s. JSON strings held more than the objects they replaced. Reverted.
- **Explicit GC at phase boundaries:** zod −20%, but Ghost only −2% at +10% time. Reverted.
- **Compact output JSON** would save only about 24% (1.6 → 1.24 GB); repeated 64-hex ids dominate. That belongs with BA-18 (identity).
- **Conclusion:** going below about 6 GB on Ghost needs a streaming execution model, where the cross-file passes consume per-file results from disk, not a storage tweak. That is a design decision; it is parked until a larger repository needs it.

Status 2026-11-03 (later): S3, BA-15, BA-07, ADR-008 and the docs session are merged (#226–#230). Then BA-08 #231, BA-26 #232, BA-11/BA-24 #233 and the governance archive #234. **Ledger empty; no PRs open.** After a squash merge, rebase a stacked branch with `git rebase --onto origin/main <old parent sha>`.

Later (2026-11-03): CFG expression branches merged #237 (engine `src` CFGs 1,940/1,940 RESOLVED; data-flow fact-diff 0/0). Ghost regression found by bisect and CPU profile: namespace-call path index rebuilt per call (#235: 663 s -> 215 s, same machine); extractor function lookup made linear (#236). Ghost absolute times vary 215-544 s on the hot machine, so verdicts use same-session A/B. Peak memory ~7.3-7.6 GiB vs 6.8 GiB budget: open.

Re-review (2026-11-03, Copilot reviews had failed on quota): #243 CFG gaps (private methods, static blocks, defaults), #244 taint policy (main found 1 of 5 real flows), #245 SECURITY (git on analyzed repos ran repo-configured core.fsmonitor), #246 last CFG gaps (every graph RESOLVED: engine src 2,002/2,002, Fastify 8,813/8,813).

IR gate status: P0/P1 fixed, ledger empty, byte-identical runs, stable identity (BA-18), every CFG RESOLVED: met. Ghost time within budget after #235 (re-confirm on a cool machine); peak memory over budget. Missing: BA-18 implementation (ADR-008), and the CFG expression-branch gap (36% of engine `src` CFGs are `UNSUPPORTED` because `?:`, `&&`, `||`, `??`, `?.` are not split into edges).

Next by impact:
- CFG expression branches (new, Wave 6): split blocks at `?:`, `&&`/`||`/`??`, `?.` and logical assignment, so the `UNSUPPORTED` label is no longer needed; measure on engine `src` and Ghost.
- Implement ADR-008 (BA-18), step 1: symbol keys plus the insert-a-line identity check in fact-diff.
- Extractor: `symbols.find` per function expression is quadratic in symbols per file.
- Coverage audit: every construct the parser accepts is either analysed by every stage or reported as an explicit unknown. No silent gaps.
- S4+S5 stay parked: Ghost is about 6 GB / 1.6 GB, and ADR-008's short ids are expected to shrink output.
ADR-009 (streaming, sharded execution), 2026-11-03 night. The owner approved it; it lands before IR, and Wave 8 order is PHP, Java, Ruby.
- #251: ADR-009 ACCEPTED.
- #252: key building without per-node strings, one-shot ids. Engine 6-34% faster; memory -1%.
- #253: step 1, whole-run fact lists (CFG, DFG, calls, references, scopes) live on disk as FactArray. Records hold handles; the projection streams them.
- #254: step 3a, calls and references written file by file, already in sorted order; synthesis needs only FactUsage.
- Ghost peak RSS by stage: 9,878 MB (main before) -> 8,030 (#253) -> **3,919 MB, 211 s** (#254). Budgets 6,785 MB / 360 s are met.
- Every step so far: fact-diff 0/0 on five corpora and byte-identical artifacts.
- #255: step 4a, DFG bodies on disk plus #253 review fixes. Same-session A/B: main 288 s / 3,468 MB vs **241 s / 2,732 MB**.
- #256: step 2, full symbol tables on disk (one spool file), cross-file stages read summaries (imports, exports, exported declarations, module references). Ghost fact-diff 0/0 (7,172 files). Back to back: peak 2,668 -> 2,057 MB, live heap after pass 1 677 -> 243 MB.
- 4b measured and deferred (owner OK): cross-file taint state is ~30 MB JSON on Ghost (137k transfers); summary-based taint would change path choice.
- #257: step 5, dependency and knowledge graph lists sorted on disk (sortedFactArray), Scale Gate CI job (synthetic 10k files, 2,800 MiB ceiling; CI measured 2,212 MiB / 115 s), Ghost budget 6,785 -> 2,560 MiB. Ghost back to back 2,613 -> 1,847 MiB. Ghost fact-diff 0/0.
- OPEN (next memory item): memory still grows with files. Synthetic 10k 1.67 GB, 20k 2.97 GB. Live heap is only ~22 KB/file (225 MB at 10k after forced GC); the rest is late GC garbage that scales with the live heap. Per-file live state: events/records committed at the end, summary symbols, sparse call bindings. Periodic GC gave only ~10%.
- Per-file live state, found 2026-11-04: in Bun/JSC every frozen array is ArrayStorage with a SparseArrayValueMap (273 vs 113 bytes; about 28 per file). Records and events are held until the final commit (about 7 KB per file). Options, each an owner decision: relax DAT-01 deep freeze for arrays, commit records and events per batch, S7 worker processes.
- #258 (owner approved, for speed): arrays frozen only in tests/CI (immutable()/isImmutable()). Ghost 374 -> 258 s, fact-diff 0/0 incl. Ghost; memory unchanged. Fix 2 (batch commit) rejected by owner. Bounding memory for 500k files = S7 worker processes, before enterprise.
- NEXT: IR phase (Wave 6), first path JS -> TypeScript.
- Remaining: step 4b (taint over summaries), step 5 (100k-file scale gate, re-baseline Ghost budgets).
- Known limit: the SQLite driver serializes fact lists in full at commit (S6).
- Target machine: the owner accepts 32 GB for enterprise scale; the dev machine has 16 GB.

3. When an item merges, mark it here (commit to the audit branch) and start the next queued item whose dependencies are merged.
4. Ledger check: `bun test tests/conformance` on `main` must pass, and `known-gaps.ts` lists exactly the open findings.

## PR template

```
Wave <n> of the audit remediation (audit: #203), finding <BA-xx>.
**Problem** <one paragraph from FINDINGS.md>
**Change** <what and where>
**Evidence** RED on main (test + failing output) · GREEN · full suite (pass/fail/files) ·
typecheck · benchmark audit · conformance (ledger entries removed) · fact-diff main→head on
corpora (lost/gained with explanation)
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
