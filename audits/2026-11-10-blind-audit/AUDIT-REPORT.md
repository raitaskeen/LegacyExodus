# LegacyExodus cross-file blind audit (folder dated 10 Nov, run 9 Nov 2026)

| | |
|---|---|
| Baseline | `origin/main` at `d30ffaa` (#293), in a detached worktree. The engine was not changed |
| Mode | Read-only for the engine. Probe programs ran in the session scratchpad, outside the repo. The only repo change is this report, on the audit branch |
| Method | Read the newest code in full (`class-hierarchy.ts`, the #290 require scoping, the #291 directory `main` resolution). Ran small probe programs through `legacy-exodus analyze --refresh` and checked each fact against what Node does when it runs the same program. Also covered hostile inputs, determinism, snapshot reuse, Ghost scale, CI rulesets and README claims |
| How blind | Findings came from code and probes before I re-read the earlier reports. I had read `STATUS-2026-11-09.md` and the queue in the catch-up step the owner asked for, so this audit is not fully blind. Every finding rests on a probe run today, and none of XA-01..XA-06 appears in the earlier finding lists |
| Environment | Windows 11 Pro, 16 GB RAM, Bun 1.4.4 (the repo pins 1.4.2), Node for the runtime checks. One machine. Linux and macOS were not tested |
| Rules | `.agents/` kernel. One session, no subagents (owner instruction) |

## 1. Baseline gates on `d30ffaa`

| Gate | Result | Source |
|---|---|---|
| Typecheck | pass (exit 0) | `bun run typecheck` |
| Full suite | **2,370 pass, 1 skip, 0 fail**; 2,371 tests in 200 files; 491.6 s | `bun test` |
| Conformance accuracy | **189/189 planted (100%), 37/37 controls (100%)**; 0 known gaps, 0 regressions | `bun run benchmarks/cli.ts accuracy` |
| Ghost fresh run (7,172 of 9,171 files) | run 1: 575.4 s, peak 2,340 MiB, **over the 360 s budget** (one-second probes ran alongside it). Run 2, idle machine: **272.3 s, peak 2,150 MiB**, within budget (360 s, 2,560 MiB) | `bun run benchmarks/cli.ts scale ghost` |

The conformance suite is green. It did not catch any of the findings below, because it checks the cases that were written for each feature. The probes below are adversarial cases next to those features.

## 2. Findings

Severity: **High** = a false proven fact, or a missing security flow, on a common pattern. **Medium** = the same on a less common pattern. **Low** = a wrong label, noise, or a rare pattern.

| ID | Severity | Area | One line |
|---|---|---|---|
| XA-01 | High | Taint | An HTML escaper cuts taint for every sink, so path-traversal and command-injection flows disappear |
| XA-02 | High | Call graph (#292) | `this.m()` in an internal base class resolves even when an exported subclass lets outside code override `m` |
| XA-03 | Medium | Call graph (#292) | A method name written on an exported instance in another file is ignored, so `this.m()` resolves to the class's `m` |
| XA-04 | Medium | Call graph (#292) | A computed read (`c[key]`) that borrows a method in the same file is not seen |
| XA-05 | Low | Symbols / CommonJS | A call that runs before its `require` binding is RESOLVED, though it throws |
| XA-06 | Low | Parser | A 6,000-term expression parses, then the response validator overflows the stack. The file is dropped as `PARSER_EXECUTION_FAILED` and the cause is lost |
| XA-07 | Low | Docs / governance | The README says a target is `RESOLVED` "only when proven" and graphs use "proven facts only", but it does not state the assumptions; it also says "CI re-checks the gates", though Fact Diff and Scale Gate do not block a merge |
| XA-08 | Info | Call graph | The `closedWorld` switch cannot be turned on from the CLI or configuration |

### XA-01 (High): an HTML escaper cuts taint for every sink

- **Where.** `src/flow/data-flow-builder.ts:192` and `:957` (also `:1067`, `:1081`, `:1130`) cut taint whenever `policy.isSanitizer(call)` is true. `src/flow/taint-policy.ts:65-71` lists only HTML escapers: `validator.escape`, `escape-html`, DOMPurify `sanitize`. The cut does not depend on the sink.
- **Probe** (`tn1/app.js`, `escape-html` and `express` in `package.json`):
  ```js
  app.get("/file", (req, res) => { res.send(fs.readFileSync(escapeHtml(req.query.name), "utf8")); });
  app.get("/run",  (req, res) => { res.send(String(execSync(escapeHtml(req.query.cmd)))); });
  app.get("/raw",  (req, res) => { res.send(fs.readFileSync(req.query.name, "utf8")); });
  ```
- **Expected.** `req.query.name` reaches `fs.readFileSync`, and `req.query.cmd` reaches `execSync`. In Node, `escape-html` returns `"../../etc/passwd"` and `"ls; rm -rf /tmp/x"` unchanged; it escapes only `& < > " '`.
- **Actual.** Only `/raw` has flows (`readFileSync` and `res.send`, both CONFIRMED). `/file` and `/run` have **no flow at all**: no CONFIRMED, no REQUIRES_REVIEW. The missing flows are dropped silently.
- **Fix.** Give each sanitizer the sink kinds it neutralises (these four: the HTML response sinks only), and cut taint only on the way to those sinks. Add a conformance case with this probe (two planted flows, one control for `res.send(escapeHtml(...))`).

### XA-02 (High): an exported subclass reopens its internal base class

- **Where.** `src/semantic/class-hierarchy.ts:276` (`mayOverride`) checks only whether the class itself escapes (`:116`), not whether any class below it does.
- **Probe** (`ch1/lib.js`):
  ```js
  class Base { run() { return this.helper(); } helper() { return "base"; } }
  class Public extends Base {}
  module.exports = { Public };
  ```
- **Expected.** UNRESOLVED. A user of the package can write `class Mine extends Public { helper() { return "mine"; } }`, and then `new Mine().run()` returns `"mine"` in Node. I ran this to check.
- **Actual.** `lib.js:2 run -> this.helper RESOLVED method:Base.helper` (the probe files as run have one member per line, so line numbers refer to those files).
- **Fix.** In open-world mode, `mayOverride` returns true when the class or any class below it escapes. Regression test: this probe, plus a control where `Public` is not exported.

### XA-03 (Medium): a write on an exported instance in another file is ignored

- **Where.** `src/semantic/class-hierarchy.ts:248` keeps a file's written property names only if that file has a subclass. A named write in any other file (`obj.m = …`) never counts as an override.
- **Probe** (`ch2`):
  ```js
  // logger.js
  class Logger { log(m) { return this.format(m); } format(m) { return "[log] " + m; } }
  module.exports = new Logger();
  // app.js
  const logger = require("./logger");
  logger.format = function (m) { return "patched " + m; };
  logger.log("hi");
  ```
- **Expected.** UNRESOLVED. In Node, `logger.log("hi")` returns `"patched hi"`.
- **Actual.** `logger.js:2 log -> this.format RESOLVED method:Logger.format`.
- **Fix.** Count every file's named property writes as possible overrides of that name, not only files that hold a subclass. Measure what it costs with fact-diff on Ghost: #292 gained 36 calls on Ghost.

### XA-04 (Medium): a computed read that borrows a method in the same file is not seen

- **Where.** `src/semantic/class-hierarchy.ts:88-95`. A member read whose key is not a literal has no name, so nothing is added to `borrowedNames`. The header comment assumes computed reads away only in *other* files. The calling file is neither assumed nor checked.
- **Probe** (`ch3/a.js`):
  ```js
  class C { run() { return this.helper(); } helper() { return "C"; } }
  const c = new C(); const key = "run"; const f = c[key];
  f.call({ helper() { return "other"; } });
  ```
- **Expected.** UNRESOLVED (`run` runs with another `this`). In Node it returns `"other"`.
- **Actual.** `a.js:2 run -> this.helper RESOLVED method:C.helper`.
- **Fix.** Record a computed read that is not a call as "borrows any name" (`*`) for its file. `isBorrowed` is then true for any method of a class in that file.

### XA-05 (Low): a call before its CommonJS `require` binds is RESOLVED

- **Where.** CommonJS imports resolve through `visibleImport` / `scopedImport` (`src/semantic/call-graph-builder.ts:118`, `:1988`, `:2000`) with no check of where the call sits relative to the `require`. That is right for ESM, which is hoisted, but not for `require`.
- **Probe** (`rq1/main.js`):
  ```js
  a();
  const { a } = require("./m");
  function g() { b(); var { a: b } = require("./m"); }
  g();
  ```
- **Expected.** UNRESOLVED for both. In Node, line 1 throws `ReferenceError`; `b()` would throw `TypeError`.
- **Actual.** `main.js:1 module -> a RESOLVED export:a`; `main.js:3 g -> b RESOLVED export:a`.
- **Fix.** For a CommonJS import, resolve only a call inside a nested function or one after the declaration in the same function body. `isDefinedBeforeCall` already exists for object containers.

### XA-06 (Low): a long expression is dropped as an execution failure

- **Where.** `src/parser/manager/parser-manager.ts:27` calls `validateParseResponse`, which recurses over the AST and runs out of stack. The `RangeError` reaches `:45` and is wrapped as `PARSER_EXECUTION_FAILED`. The disposition in `summary.json` holds no cause.
- **Probe.** `export const y = x + x + … + x;` with 6,000, 10,000 and 14,000 terms (24 KB for 6,000).
- **Expected.** The parser succeeds (checked: the adapter returns no errors). Then either the file is analysed, or it is reported as `PARSER_RESOURCE_LIMIT`, as NA-10 does for parser overflow.
- **Actual.** `chain6000.js initial-parser-failure PARSER_EXECUTION_FAILED`, with no message. At 18,000 terms Babel overflows first and the code is `PARSER_RESOURCE_LIMIT`.
- **Fix.** Map a `RangeError` from validation to `PARSER_RESOURCE_LIMIT` with its message, or make the AST check iterative. Generated code (bundles, long string concatenations) does reach this size.

### XA-07 (Low): docs say more than the code proves

- `README.md:34`, `:40` and `:59` say a target is RESOLVED "only when proven" and the graphs use "proven facts only". `class-hierarchy.ts` states its assumptions (no computed or reflective access in other files, strict mode). The README and `docs/CURRENT_IMPLEMENTATION.md` state neither these assumptions nor that sanitizers ignore the sink kind. XA-01..XA-04 are cases the stated assumptions do not cover.
- `README.md:70` says "CI re-checks the gates on every pull request". The `main-branch-protection` ruleset requires only `Verify Core` and `Windows Path Smoke`. Fact Diff and Scale Gate run, but a red result does not block a merge. Ghost runs only locally.
- **Fix.** Add the assumptions and the sanitizer limit to Current Implementation, and link them from the README. Say "CI runs" rather than implying the gates block, until the owner makes them required (owner decision).

### XA-08 (Info): `closedWorld` cannot be switched on

`ClassHierarchy`'s third parameter (`class-hierarchy.ts`) is never passed (`call-graph-builder.ts:24-27`). Nothing in the CLI or configuration reaches it. That matches "off (now)" in the open decision. It is noted here so the docs do not describe it as a user setting.

## 3. Checked and holding

| Area | Probe | Result |
|---|---|---|
| Byte reproducibility | Governance fixture: fresh, fresh again, reuse, and a copy in another folder | All 12 fact files byte-identical. Only `manifest.json` differs (run id, time, MAC; and project id and location digest for the moved copy), as ADR-010 intends |
| Reuse follows manifests | `package.json` `main` changed from `one.js` to `two.js`, rerun without `--refresh` | `SNAPSHOT_STALE`, fresh run, call now resolves to `two.js` |
| Directory `main` (#291) | `require("./lib")` with `lib/package.json` `main`, plus `index.js` present | Resolves to the `main` file, not the index |
| Function-level `require` (#290) | Calls inside and after the requiring function | Scoped as the PR states (XA-05 is the one gap) |
| `this` in a nested `function` | `list.map(function () { this.helper(); }, other)` | UNRESOLVED (correct) |
| Decorated class (TS) | `@withLogging class Service { run() { this.helper() } }` | UNRESOLVED (correct) |
| Hostile inputs | Invalid UTF-8, BOM, 3,000-deep brackets, 4,000 nested calls, 30,000-term chain, 900 nested `if`s, 1,500 nested arrows | Exit 0. Each file analysed or given an explicit failure disposition. None dropped silently (XA-06 is a wrong label, not a silent drop) |
| Manifest key | `snapshot-trust.ts` | Random 32-byte machine-local HMAC key, not a key in the source |
| Symlink escape | `New-Item -ItemType SymbolicLink` | **Not tested**: Windows refused without admin rights. Linux CI does not test it either |

Not re-probed in this audit: CFG shapes beyond the conformance cases, SQLite storage, framework semantics beyond Express.

## 4. Scores (same 11 dimensions and weights)

| # | Dimension | Weight | Score | Evidence basis |
|---|---|---|---|---|
| 1 | Architecture and code quality | 10% | 8.0 | Clear stages, ADRs and immutable facts. `call-graph-builder.ts` is 2,263 lines in one file |
| 2 | Language frontend | 15% | 8.0 | Babel 8 with explicit dispositions on every hostile input. XA-06 drops a parsable file under the wrong code |
| 3 | Symbols, scopes, module resolution | 15% | 7.5 | #290 and #291 behave as stated, and reuse follows `package.json`. XA-05. `.d.ts` and `node_modules` are not resolved (stated) |
| 4 | Call graph | 10% | 6.0 | Three false RESOLVED facts in the newest code (XA-02..XA-04), each from a 3–8 line program that Node contradicts |
| 5 | CFG | 5% | 7.5 | Conformance 6/6. Not re-probed |
| 6 | DFG and taint | 15% | 6.0 | Conformance taint 51/51 and controls 11/11, but XA-01 silently loses path and command flows behind any HTML escaper |
| 7 | Framework semantics | 5% | 4.0 | Express only. Not re-probed |
| 8 | Determinism, trust, security | 10% | 9.0 | Byte-identical across fresh, reuse and a moved copy. Machine-local HMAC. Hostile inputs handled. Symlinks untested |
| 9 | Scale and performance | 5% | 7.5 | Peak memory stayed under budget in both Ghost runs (2,150 and 2,340 MiB). Wall time ranged from 272 s to 575 s on this laptop; the 183 s on record was not reproduced |
| 10 | Testing and verification | 5% | 7.5 | 2,370 green and 189/189, but the suites missed XA-01..XA-05. Fact-diff measures change, not truth |
| 11 | Docs and governance truthfulness | 5% | 6.5 | XA-07 and XA-08. Two of four CI gates do not block a merge |
| | **Overall** | | **≈ 72** (weighted 7.18) | Weighted sum × 10 |

## 5. Comparison with earlier reports and the ~77 self-assessment

| # | Dimension | 8 Nov audit | 9 Nov self-assessment | This audit | Why it differs |
|---|---|---|---|---|---|
| 1 | Architecture | 8.0 | 8.5 | 8.0 | Same evidence, weighed more strictly on the large call-graph file |
| 2 | Frontend | 8.0 | 8.5 | 8.0 | XA-06 |
| 3 | Symbols / resolution | 7.0 | 8.0 | 7.5 | #290 and #291 hold; XA-05 |
| 4 | Call graph | 5.5 | 7.0 | 6.0 | #292 added three ways to get a false RESOLVED |
| 5 | CFG | 7.5 | 7.5 | 7.5 | Not re-probed |
| 6 | DFG / taint | 5.0 | 7.0 | 6.0 | XA-01 is new and not in any earlier list |
| 7 | Frameworks | 4.0 | 4.0 | 4.0 | Unchanged |
| 8 | Determinism / trust | 8.5 | 9.0 | 9.0 | Re-verified today |
| 9 | Scale | 6.5 | 8.0 | 7.5 | Memory holds. Time varies 2x between runs, so one fast run is weak evidence |
| 10 | Testing | 7.0 | 8.5 | 7.5 | Green suites missed five probe-level bugs |
| 11 | Docs / governance | 5.0 | 7.0 | 6.5 | XA-07 |
| | **Overall** | **≈ 67** | **≈ 77** | **≈ 72** | |

- **Overlap with earlier findings.** None of XA-01..XA-06 is in the 28 Oct (BA), 8 Nov (NA) or 9 Nov status lists. BA-07 dealt with *which binding* a sanitizer name resolves to. XA-01 is about *which sinks* it protects.
- **Still open from earlier lists, and confirmed today.** Every `require(...)` is its own UNRESOLVED call (`rq1`: `module -> require UNRESOLVED`). BA-19 and BA-25 stay design-level.
- **The self-assessment was about 5 points high.** It scored the #292 work by its own tests and fact-diff gains. A gain in RESOLVED calls is not proof that the new facts are true, and three of the new paths make false ones.

## 6. Suggested fix order

1. **XA-01**: the security product promise; small and local to the taint policy.
2. **XA-02**: the most common false RESOLVED pattern; a one-function change in `mayOverride`.
3. **XA-03**, then **XA-04**: same file, same review. Measure each on Ghost.
4. **XA-05**, **XA-06**: small.
5. **XA-07**: docs, after the fixes, so the text describes the fixed code.

Probe sources are inline above. Each is a complete program, and each runs with `legacy-exodus analyze <dir> --refresh`.
