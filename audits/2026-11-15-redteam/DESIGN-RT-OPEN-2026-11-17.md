# Design: the five open red-team findings (2026-11-17)

Every probe below was run on main `37f5783` with Node 24 as ground truth. Probe folders are kept in the main session's scratchpad (`rtd/`); each fix PR copies its probes into conformance cases.

The bar is the same as for every rule: a RESOLVED or EXTERNAL claim must never be false. Correct claims may be given up only where a fact diff measures and explains the cost.

## RT-L9 and RT-L8: Annex B block functions (one PR)

**Probes.**

| Probe | Code | Node | Engine on main |
|---|---|---|---|
| p06 | `var express = require("./lib"); if (true) { function express() {…fake} } var b = express(); b.use()` | FAKE use | `express` RESOLVED to lib's `export:default`; `b.use` RESOLVED to lib's `realUse` |
| annexb-c3a | lib.js: `function run(){…"top-run"} if (true) { function run(){…"block-run"} } module.exports = { run };` | block-run | `lib.run` RESOLVED to `export:run` (linked to the top `run`) |

**Cause.** In sloppy code, a function declared in a block assigns the enclosing function-scoped binding of the same name when the block runs (ECMAScript Annex B.3.3). `collectBlockFunctionVars` already finds these bindings, and local calls already refuse them (`annexb-local` is UNRESOLVED). Two paths do not:

1. An import binding: `visibleImport` and the direct import path (`call-graph-builder.ts:172`) never consult `blockFunctionVars`.
2. An export whose local binding has a block twin: `collectUnstableExportIds` does not mark it, so other files resolve through it.

**Design.**

1. An import binding whose key is in `blockFunctionVars` resolves nothing. Then the producer of `var b = express()` is unknown, so `b.use()` is UNRESOLVED too.
2. `collectUnstableExportIds` marks as unstable every export whose local name is bound at module scope while a sloppy module-level block declares a function of that name.

**Soundness.** Strict files (ES modules, `"use strict"`, class bodies) are already excluded by the existing strict tracking. A `const`/`let` binding cannot be replaced: Annex B is skipped there, since the `var` it implies would be an early error. The existing collector does not exclude these bindings, which errs on the safe side.

**Expected cost.** Near zero; real code rarely declares a block function named like an import or export. Measured by the fact diff.

## RT-M9: a circular `require` keeps a stale exports object

**Probes.** `a.js`: `const b = require("./b"); … module.exports = make;`. `b.js`: `const make = require("./a"); exports.go = () => make().run()`.

| Probe | Node (entry a.js) | Engine on main |
|---|---|---|
| cyc-factory | THROWS make is not a function (also when `go` runs later) | `make` RESOLVED to `export:default`; `x.run` RESOLVED |
| cyc-c3a (`module.exports = { run }`) | THROWS a.run is not a function | `a.run` RESOLVED |

**Cause.** If a.js loads first, its `require("./b")` runs b.js, which binds a's half-built exports object `{}`. a.js then replaces `module.exports`, but b keeps the old object for the rest of the run, not only during loading. If b.js is the entry point, the calls work. The entry point is not known statically.

**Design.**

1. **Per file**, record the line of every top-level `require` and every top-level `module.exports =` (replacing the value). Only top-level code runs while the file loads; a `require` inside a function runs later, after the file has loaded.
2. **Run-wide**, after resolution: build the graph of top-level require edges between repository files, and take its strongly connected components (cycles).
3. For a file A in a cycle: if A replaces `module.exports` after a top-level `require` that leads into its cycle, every export of A is unstable (`unstableExportIds`). Then both the default-import path and the namespace/C3a path refuse it. This also covers importers outside the cycle, which do see the final object. That over-approximation is accepted because the pattern is rare.
4. **Load-time reads.** A call at the top level of B through a binding of a module in B's own cycle is UNRESOLVED: that module may still be loading, and members it adds later are missing. A call inside a function keeps the existing documented assumption that it runs after the modules have loaded (XA-05, C2b).

**Expected cost.** It applies only to modules in a require cycle that replace `module.exports` after the cycle's require, or to top-level calls into a cycle. Measured on 11 corpora; Ghost, with ~7k files, may have some.

## RT-N3: a file that fails to parse is never seen as a writer

**Probe n3-unparsed.** patch.js: `delete JSON;`; main.js: `require("./patch"); JSON.stringify({})`. Node: THROWS JSON is not defined. Engine: `JSON.stringify` EXTERNAL.

**Cause.** A `.js` file is parsed with Babel's `unambiguous` source type. Babel applies module (strict) rules first, so valid sloppy CommonJS (`delete x`, `with`, legacy octals) gets parse errors. The command handler then drops the file entirely (`initial-parser-failure`), including its writes.

**Census** (every file in 9 corpora, 8,891 files): only 2 files have parse errors. lodash's `vendor/firebug-lite/src/firebug-lite-debug.js` (`with`) parses cleanly as a script. mongoose's one file is a top-level `return` (`IllegalReturn`), which is valid CommonJS because Node wraps each file in a function. Ghost has none.

**Design.**

1. **Retry.** When an `unambiguous` parse reports errors and the program has no import/export syntax, parse again as a script with `allowReturnOutsideFunction` (Node's CommonJS wrapper). If the retry is clean, the file is analyzed fully. This fixes the probe, and both census files become analyzable.
2. **Recovered errors.** A file that still has recoverable errors (Babel `errorRecovery`) contributes only its write facts from the recovered tree. These are foreign writes, global writes, package writes and class-hierarchy written names, so its writes still count. It produces no symbols or calls, and its disposition stays `initial-parser-failure`.
3. **Unparseable files.** A file Babel cannot parse at all is assumed to write nothing. This is a documented assumption; such files are already counted as `parserFailures` in the run summary. Treating them as writing everything would wipe out repository-wide claims whenever one vendored file is broken.

**Expected cost.** Retried files add facts (gains). Their writes may block some names (losses, to be explained).

## RT-N2: a class method borrowed onto another object

**Probe n2c-other.** lib.js: `class P { patch() { this.m = () => "patched"; } } P.prototype.patch.call(require("./target"));`. target.js: `module.exports = { m() {…"orig"} }`. main.js: `require("./lib"); require("./target").m()`. Node: patched. Engine: `t.m` RESOLVED to target's `m`.

**Cause.** A `this.x = …` inside a class element is exempt from the cross-file name rule (XA-03, kept by RT-N1), on the assumption that the method runs on an instance. A method read as a value (`P.prototype.patch.call(o)`, `const { patch } = …`, passed as a callback) can run with any `this`.

**Design.**

- **Per file:** for each class method (not the constructor, which cannot be called without `new`), record the names it writes on `this`.
- **Run-wide**, in `ClassHierarchy`: if a method's name is borrowed (the existing run-wide `borrowedNames`, a name read as a value anywhere), the names that method writes on `this` count as foreign writes from its file.

**Expected cost.** `borrowedNames` is name-based. A method whose name is read as a value somewhere (`app.handle` as a callback) has its `this` writes treated as foreign. That blocks rule 1/2 calls whose method name equals such a field name. To be measured; if the cost is high, narrow it to borrowed reads of `C.prototype.<name>` and destructuring.

## Order

1. RT-L9 and RT-L8 (Annex B): smallest, no new assumption.
2. RT-N3 (parser retry and recovered writes): a coverage gain, plus one documented assumption.
3. RT-M9 (require cycles): a new run-wide pass.
4. RT-N2 (borrowed class methods): cost to measure.

Each is its own PR with the full harness: probes, isolated conformance cases that fail on main, the suite, the call oracle, a fact diff on 10 corpora and Ghost, and explained losses.
