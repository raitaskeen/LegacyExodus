# LegacyExodus fresh audit, 8 November 2026

| | |
|---|---|
| Baseline | `origin/main` at `b29d8aca59a1dda446afcfef0075aad221b1c54c` (#258), frozen at the start |
| Mode | Read-only. Everything ran in a detached worktree in the session scratchpad. Nothing in the repo, its branches or GitHub was changed. These files are untracked |
| Method | Static: a pattern sweep over all 140 `src` files, plus targeted reading of call sites, scope resolution, discovery, git, snapshot trust and storage. Dynamic: the full gates, the Ghost scale run (twice), and probe repos for semantics, taint and attacks. GitHub: workflows, rulesets, settings |
| Not fully blind | The auditor (Claude, the same model that ran the 28 Oct audit) had read the old findings before starting. Every finding below rests on new evidence gathered today |
| Environment | Windows 11 Pro, 16-core laptop that runs hot, 16 GB RAM, Bun 1.4.4 (the repo pins 1.4.2), single machine. Linux and macOS were not tested |
| Rules | `.agents/` kernel plus the code-audit, performance-audit and red-team-review skills. One session, no subagents (owner instruction) |

## 0. Corrections found while fixing (later on 2026-11-08)

- **NA-04 cause, corrected.** The 9–10 GB `scale ghost` runs were **snapshot reuses**. The Ghost gate didn't
  remove `.discovery`, so runs 2–4 reused run 1's snapshot. Reuse peaks at 8,939 MiB, which is new finding
  **NA-16**. The harness read-back added to the peak too.
  - The claim that `NODE_ENV: "test"` freezes arrays in scale runs is **wrong**. `FREEZE_ARRAYS` reads the
    process environment.
  - Fresh engine runs, measured correctly (#265): 216 s / 1,677 MiB and 253 s / 2,213 MiB, within budget.
- **NA-05 / GitHub, corrected.** `main` is protected by a ruleset (see NA-05). The STATUS-REPORT's first
  version said "no branch protection".
- **New finding NA-16 (P2): snapshot reuse loads every artifact into memory.** `command-handler.ts`
  `JSON.parse`s all stored artifacts on reuse: Ghost peaks at 8,939 MiB on reuse against about 2 GB fresh.
  Reuse should stream or validate artifacts without materialising them.

## 1. Verdict

| Question | Answer |
|---|---|
| Overall engine score | **67 / 100**, up from 50 on 28 Oct. The scorecard is in section 5; treat it as ±5 |
| Is the foundation strong? | **Yes.** Determinism, snapshot trust and repository-attack resistance held under every probe. Ghost output is byte-identical to the 4 Nov run (1.8 GB, 13 artifacts) |
| What is weakest? | **Call-site completeness and taint breadth.** About 1 in 6 call sites on Ghost leave no call fact at all, not even UNRESOLVED (NA-01). `with` and `eval` make some RESOLVED calls unsound (NA-02). The taint policy has no file-system, SQL or outbound-request (SSRF) sinks (NA-03) |
| Ready for the IR? | **Not yet.** NA-01 breaks the core rule "unknown is never absent", and the IR would freeze that gap into its central model. The official Ghost scale gate measures its own JSON read-back (9–10 GB), not the engine, which uses 1.7 GB (NA-04) |
| Findings | **15 new**: 1 × P1 (NA-01), 8 × P2, 5 × P3, plus 1 governance/docs item. 0 × P0 |
| Attacks that failed | 10 of 10 executed attack classes were blocked (section 4). One attack could not be run (file symlinks need admin rights) |

## 2. Baseline gates (all pass)

| Gate | Result |
|---|---|
| `bun run typecheck` | clean |
| `bun test` | **2,317 pass, 1 skip (platform), 0 fail**, 22,246 assertions, 192 files, 336 s |
| `benchmarks/cli.ts audit` | PASS 8/8 |
| `git diff --check` | clean |

### Other corpora (pinned commits, 2 runs each)

| Corpus | Files | Determinism | Health gate | Fidelity sample |
|---|---|---|---|---|
| Express 4.21.2 | 234 discovered, 152 analyzed, 0 failures | PASS | NEEDS_REVIEW (completeness: template files, P2.1) | — |
| Fastify | 385 discovered, 287 analyzed, 0 failures | PASS | PASS | 100% on every sampled category (dependency 53/53 closed; symbol, import, export, edge, call, CFG and DFG samples). The sample is 25 files, so this isn't whole-repo proof |

## 3. Findings

Severity: P1 blocks the IR or a product claim; P2 is a significant correctness, trust or scale gap; P3 is minor.

### NA-01 (P1) Call sites without a nameable callee leave no fact at all
- **Where:** `src/semantic/call-graph-builder.ts:98-101`. `callName()` returns `undefined`, so the call is
  skipped with no UNRESOLVED record. `TaggedTemplateExpression` is not handled anywhere.
- **Reproduction:** in the `probes/sem2/chain.js` probe, 17 call sites produce only 10 call facts. These are absent:
  - ``mk().run()``, ``new K().m()`` and ``p.then(mk).catch(mk)`` (the `.catch`);
  - ``o[k]()`` and ``arr.map(mk)[0].run()``;
  - ``mk`tpl` ``, ``(() => mk())()`` and ``super.m()``.
- **Scale on Ghost:** 400,328 call sites plus 15,183 `new` expressions (counted with Babel, every parse
  succeeded), against **346,846 call facts. About 68,700 sites (≈16.5%) leave no trace.** By shape:
  - 62,008 calls on a call result (promise chains, builders);
  - 910 calls on a `new` expression;
  - 723 calls on an array;
  - 678 tagged templates;
  - 373 `super` calls.
- **Why it matters:** the kernel and the Copilot checklist both say an unknown stays explicit and is never dropped. Every planned feature needs these sites to be recorded:
  - reachability for security;
  - dead code;
  - safety-net boundaries;
  - migration units.

  A missing site reads as "no path", which looks like proof.
- **Fix direction:** emit an UNRESOLVED call fact for every call, `new` and tagged-template site. Model
  `super.m()` against the parent class. Add a conformance case for each shape.

### NA-02 (P2) `with` and direct `eval` don't poison scope, so some RESOLVED calls are unsound
- **Where:** nothing in `src/` handles `WithStatement` or direct `eval` in scope resolution. The mapper only maps the node (`javascript-node-mapper.ts:69`).
- **Reproduction** (`probes/sem/sloppy.cjs`):
  - `function w(o){ with (o) { return g(); } }` resolves `g` to the outer `function g` (**RESOLVED**). At
    runtime it may be `o.g`.
  - `function ev(code){ eval(code); return g(); }` resolves `g` the same way, but `eval` can declare a local `g`.
- **Fix direction:** inside a `with` body, or in a function with a direct `eval` in sloppy code, names resolve UNRESOLVED (reason `dynamic-scope`).

### NA-03 (P2) Taint: 9 of 14 planted flows found; the policy is narrow
`probes/taint/app.js` (Express, policy `builtin-2`). Found and labelled CONFIRMED:
- `req.query` → `res.send`;
- through a property, an array, a template, `await` and destructuring;
- `exec`, `eval`, `res.redirect`.

Both negative controls were correct (control-only use; killed by reassignment).

**Missed:**
- T2/T13: a helper from another file, imported with destructured `require` (`const {id} = require('./util')`);
- T7: a source passed to a callback (`[req.body].forEach(v => res.send(v))`);
- T10: `fs.readFile(req.params.p)`. There is no file-system sink at all;
- T16: string-built SQL through a db wrapper. There is no SQL sink.

The policy also has no outbound HTTP (SSRF), NoSQL, `new Function`, deserialization or prototype-pollution
sinks (`src/flow/taint-policy.ts:21-34`).

### NA-04 (P2) The Ghost scale gate measures the benchmark harness, not the engine
**Engine memory is fine.** The production command `legacy-exodus analyze <ghost> --refresh` peaked at
**1,724 MiB**. That is the OS peak working set, including the child process, and it matches the 1.85–2.0 GB that
`mem-probe.ts` measured on 3–4 Nov.

The **official gate** is `bun run benchmarks/cli.ts scale ghost`. It reports `maxRSS` for the whole process, and
that process does two extra things:
- after the analysis it parses `semantic.json` (593 MB) and `data-flow.json` (334 MB) back into memory for summaries (`benchmarks/harness.ts:49-52`);
- it runs the engine with `NODE_ENV: "test"` (`harness.ts:11`), which since #258 means deep-frozen arrays, so test-mode behaviour rather than production.

The previous session's own logs show `scale ghost` at 7.3–11 GB on 3 Nov too. The 1,847 MiB in `ghost.json` came from the probe script, not from this gate.

Today's gate runs on `b29d8ac` (7,172 of 9,171 files). Every run had byte-identical output, also identical to the 4 Nov run:

| Run | Conditions | Wall | Peak RSS |
|---|---|---|---|
| 1 | small probe processes running in parallel | 195.1 s | 3,699.6 MiB |
| 2 | idle | 85.5 s | 9,367.8 MiB |
| 3 | idle, 9.1 GB free beforehand | 95.4 s | 9,851.1 MiB |
| 4 | idle, `bun --smol` | 77.3 s | 10,512.7 MiB |
| — | synthetic 10k (the CI Scale Gate) | 88.9 s | 1,693.2 MiB |
| 5 | **production `analyze` CLI** (OS peak working set; the polling slowed the run) | 341 s | **1,724 MiB** |

- **Why it matters:**
  - The scale gate fails on every run, so it can't catch a real engine regression.
  - The budget was set from a different measurement.
  - Peak memory varies 2.8× with machine conditions.
  - Wall times with clean runs are 77–95 s.
- **Fix direction:**
  - Measure the engine phase on its own: take the peak before the read-back, or run the read-back in a separate process.
  - Run it in production mode.
  - Re-baseline from 3 idle runs.
  - Add a nightly Ghost job.

### NA-05 (P2) The fact-diff gate is not enforced
- **CI:** `ci.yml` runs `fact-diff` without `--fail-on-loss`, so lost facts never fail the job. It also diffs
  only the governance fixture and the engine's own `src`, not Express, Fastify or Ghost.
- **GitHub ruleset `main-branch-protection`:**
  - it requires a PR, but with **0 approvals**;
  - it requires only **Verify Core** and **Windows Path Smoke**, not Fact Diff or Scale Gate;
  - Copilot review is requested, but has failed on quota since #227.
- **Who can merge:** three accounts can write (`raitaskeen` admin; `rsexo` and `pamexo` write). Any one of them can merge a PR that loses facts.

### NA-06 (P2) CLI output is not byte-reproducible
- **Where:** `src/cli/commands/analyze.ts:58-61` puts a random `projectId` and run id into each run. With `generatedAt`, they land in 6 artifacts plus the manifest digests.
- **Observed:** two runs of the same repo differ in 7 files.
- **After normalising** the UUIDs and timestamps, runs are identical across:
  - repeat runs;
  - `TZ=Pacific/Kiritimati`;
  - `LC_ALL=tr_TR.UTF-8`;
  - a different working directory.

  So the facts are deterministic; the bytes are not.
- **Why it matters:** this blocks the planned audit-trail feature and simple `diff`-based checking by customers. Only the benchmark harness pins its ids.

### NA-07 (P2) Symlinked files and directories are skipped silently
- **Where:** `src/discovery/file-scanner.ts:318-320`. `if (entry.isSymbolicLink()) continue;` runs before the code that records `excludedPaths`.
- **Reproduction:** a junction `src/linkdir` → outside appears in no artifact and no `--json` output.
- **Why it matters:** BA-15 promised that every exclusion is reported. Skipping is right for safety; staying silent is not.

### NA-08 (P2) SQLite: concurrent runs fail
- **Reproduction:** 5 processes analyze with the same `--storage-path` at once. 2 exit 1 with
  `SQLiteError: database is locked`, reported as `CLI_UNEXPECTED_ERROR`.
- **No corruption:** `PRAGMA integrity_check` returns ok.
- **Status of the old question:** the earlier open item "cross-process locking unverified" is now answered. The database is safe, but not usable concurrently, and the error is unclassified.

### NA-09 (P3) Dead-code false positives that would delete live code
- **Duplicate declarations** (`probes/sem/sloppy.cjs`): `function d(){} function d(){}` then `d()`. Both `d` are
  reported `unreferenced-local-symbol`, and the call is UNRESOLVED.
- **Annex B:** a block-level `function bf` called after its block is reported unreferenced.
- **Implicit calls:** getters, setters, `toString`/`valueOf`, iterators and Proxies create no call edges (getter probe `o.p`).
- **Status:** these are labelled INFERRED, which is correct today. They rule out any "prune dead code" automation.

### NA-10 (P3) Resource-limit failures are mislabelled as syntax errors
`src/longexpr.js` is a 30,000-term `+` chain. Node parses it, but it is reported as `JAVASCRIPT_SYNTAX_ERROR`.
`deep.js`, 30,000 nested arrays, is the same: Node also overflows, but with a `RangeError`, not a syntax
error. The engine isolates the fault per file and doesn't crash; only the label is wrong.

### NA-11 (P3) A rejected snapshot is silent
A tampered `semantic.json`, a foreign HMAC key and a snapshot copied from another project are all
rejected correctly and re-analysed. The user is never told that a snapshot was rejected or why.

### NA-12 (P3) Flow-insensitive hoisting
`function hoist(){ f(); var f = function(){} }` resolves `f()` RESOLVED to the later function expression.
At that point `f` is `undefined`, so the call throws.

### NA-13 (P3) "read-only" label
`analyze` is labelled `[read-only]` in help, but it writes `.discovery/` into the analyzed repository. If
projection fails after commit, the analysis stays committed in storage (reported correctly as
`DISCOVERY_PROJECTION_FAILED_AFTER_COMMIT`).

### NA-14 (P3, GitHub) Supply-chain hygiene
- Dependabot alerts are disabled (API 403).
- No secret scanning or code scanning is reported.
- Actions are allowed from any source, and SHA pinning is not required. The workflows do pin SHAs themselves.
- 6 dependabot PRs are stale, including `@babel/parser` 8.0.4 → 8.0.6, which can change facts.
- `labeler.yml` uses `pull_request_target` safely: it checks out no PR code.

### NA-15 (governance/docs) Truth drift and unscheduled findings
- README, CURRENT_IMPLEMENTATION and ROADMAP lag behind `main` by about 40 PRs.
- BA-19 (knowledge graph) and BA-25 (plugin context) were never scheduled.
- The 4 Nov report said every finding was fixed.

## 4. Red team: attacks run

| # | Attack | Result |
|---|---|---|
| 1 | `core.fsmonitor` program in the analyzed repo's `.git/config` | **Blocked**, no marker written |
| 2 | `core.pager` program | **Blocked** |
| 3 | Planted `git.exe`, `git.cmd` and `git.bat` in the repo root (Windows search-order hijack) | **Blocked**, none ran |
| 4 | `.discovery` as a junction to a directory outside the repo | **Refused**: "Discovery projection output path is unsafe", outside file untouched |
| 5 | Tampered snapshot artifact | **Rejected**, re-analysed, file rewritten |
| 6 | Snapshot under a foreign HMAC key, or copied from another project | **Rejected** |
| 7 | Escape through `workspaces: ["../outside"]`, tsconfig `extends`/`paths` outside, `../../outside` import, a junction dir | **Not followed.** The junction skip is silent (NA-07) |
| 8 | Stack and complexity bombs (30k nesting, 30k-term expression, 3k nested `if`) | **Isolated** per file, no crash (labels: NA-10) |
| 9 | Odd file names (`we#ird@name.js`, `ünïcödé.js`) | Handled |
| 10 | Instructions embedded in a source comment | Inert. No LLM is in the loop; the comment is data |
| 11 | 5 concurrent writers on one SQLite file | No corruption; 2 runs failed (NA-08) |
| — | File symlinks into the repo | **Not run** (needs admin rights or Windows developer mode) |
| — | Network isolation during analysis | **Not verified** (no packet capture) |

## 5. Scorecard

The dimensions and weights match the 28 Oct scorecard.

| # | Dimension | Weight | 28 Oct | 8 Nov | Basis |
|---|---|---|---|---|---|
| 1 | Architecture and code quality | 10% | 7.5 | 8.0 | Contracts, stable ids, FactArray streaming; a few `any`s in the SQLite adapter |
| 2 | Language frontend | 15% | 4.0 | 8.0 | BA-01 fixed; label issue NA-10 |
| 3 | Symbols, scopes, module resolution | 15% | 5.0 | 7.0 | Shadowing and re-export chains correct; NA-02, NA-09, NA-12 |
| 4 | Call graph | 10% | 6.5 | 5.5 | Precise where it resolves, but NA-01 (16.5% of sites absent) and NA-02 |
| 5 | CFG | 5% | 7.0 | 7.5 | Every graph RESOLVED (per queue; no oracle re-run today) |
| 6 | DFG and taint | 15% | 2.5 | 5.0 | 9/14 flows, negatives correct; NA-03 |
| 7 | Framework semantics | 5% | 2.0 | 4.0 | Express per-router model; Express only |
| 8 | Determinism, trust, security | 10% | 8.0 | 8.5 | Section 4; NA-06, NA-07 |
| 9 | Scale and performance | 5% | 3.0 | 6.5 | Ghost 77–95 s clean, engine 1.7 GB; the gate itself is broken (NA-04); 1.8 GB output |
| 10 | Testing and verification | 5% | 6.0 | 7.0 | 2,317 tests, conformance ledger; probes found gaps the suite doesn't test |
| 11 | Docs and governance truthfulness | 5% | 4.0 | 5.0 | Strong agent OS; NA-05, NA-15 |
| | **Overall** | | **50** | **≈ 67** | Weighted 6.70 |

**Foundation** (dimensions 1, 4, 5, 8): about 7.4 → 7.4. NA-01 cancels the CFG and determinism gains.
**Semantic content** (2, 3, 6, 7): about 3.7 → 6.0.

## 6. Can it carry the planned feature list? (each claim checked)

| Feature as pitched | What exists | Gap and corrected claim |
|---|---|---|
| Behaviour Safety Net, "100% stable" with WASI/eBPF | Facts to choose PURE functions and boundaries | NA-01 must be fixed to know every boundary. WASI can't run Node apps. eBPF sees TLS ciphertext, and Keploy already ships it. See `SAFETY-NET-CRITIQUE-2026-11-08.md` |
| Dead code, "prune completely unreachable paths" with "the core Rust engine" | INFERRED unused-export and unreferenced-local findings | There is no Rust engine. Pruning is unsafe until NA-01 and NA-09 are fixed and implicit calls are modelled. Sell "review list", not "prune" |
| Security reachability, "proves input reaches… eliminating false positives", bug-bounty engine | CONFIRMED intra/inter-procedural flows for Express | A missing path isn't proof while NA-01 holds. Sinks are narrow (NA-03). There is no dependency-vulnerability database, no secret scanner and no weak-hash rules. Semgrep, CodeQL and Snyk lead here. "Bug bounty" means scanning code you don't own, which is a legal and positioning risk |
| PQC migration "without manual logic rewrites" | None | **On 6 Nov you decided this is a separate product.** Putting it back on the LegacyExodus list contradicts that. "No rewrites" is an overclaim |
| Migration "mathematically verify… matches perfectly" | No IR, no transformer | Differential tests give evidence on sampled inputs, not mathematical proof. The IR is not built |
| API breaking-change detection (ingress and egress, JSON schema) | Express routes, mounts, middleware | No request/response schema inference, no outbound-call model, no OpenAPI. A partial base only |
| Compliance "cryptographic proofs that the system adheres to business rules" | HMAC-bound manifests | HMAC uses a machine-local secret, so a third party can't verify it. That needs asymmetric signing (Sigstore, in-toto, SLSA) and byte-reproducible output (NA-06). "Adheres to business rules" can't be proven; "behaviour unchanged on recorded cases" can |
| "Respond in milliseconds" with Rust | Ghost full run 195 s | A whole-repo run in milliseconds isn't physically realistic. Milliseconds is realistic for **queries** over stored facts, and seconds for **incremental** re-analysis of a changed file (S6). Gains in order: incremental (S6), worker processes (S7, 5–10×), then a Rust parser (oxc, 10–30× on parsing). No full rewrite needed |

## 7. Strengths a startup can build on

1. **Determinism that holds**: identical facts across runs, timezones, locales, working directories and commits (1.8 GB on Ghost).
2. **Attack resistance against hostile repositories**: section 4. Rare among analysis tools.
3. **Explicit uncertainty**: RESOLVED, UNRESOLVED, INFERRED and CONFIRMED states, and a conformance ledger.
4. **Engineering discipline**: fact-diff, stable ids, ADRs, the agent OS. This is the "trust" story buyers need.
5. **Speed trend**: Ghost went from about 26 min to 195 s in 11 days.

## 8. Weaknesses that block a multi-million business today

1. **Completeness holes (NA-01) and narrow taint (NA-03).** Precision is good, but recall is not proven.
2. **One language and one framework.** Express only; no PHP, Java or Python.
3. **No external validation.** There is no head-to-head on public benchmarks, for example OWASP Benchmark or a
   SecBench.js-style set compared with Semgrep and CodeQL. That is also the strongest basis for the paper.
4. **No packaged product**: no report command, installer or licence.
5. **Solo founder, plus docs drift (NA-15) and unenforced gates (NA-05).** Investors and enterprise buyers check these.

## 9. Recommended order (owner decides)

1. **NA-01** call-site completeness, plus **NA-02** dynamic scope. Engine core, with conformance cases.
2. **NA-05**: make Fact Diff and Scale Gate required, add `--fail-on-loss`, and add Express and Fastify to the CI fact-diff.
3. **NA-04**: make the scale gate measure the engine (production mode, no read-back in the peak), re-baseline, and add a nightly Ghost job.
4. **NA-06, NA-07, NA-08, NA-10, NA-11**: small trust fixes.
5. **NA-03**: taint policy packs (fs/path, SQL, SSRF, NoSQL) and callback and destructured-`require` flows.
6. Docs truth refresh (NA-15). Then the IR, with the safety net alongside.
