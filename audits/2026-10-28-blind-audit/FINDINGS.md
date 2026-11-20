# Findings — 2026-10-28 blind audit

Baseline `c694d6451ebd8457d7c0eb808286cf19d2c665d3` (`main`, after #202). Read-only audit; nothing in
`legacy-exodus-core` was changed. Every reproduction below runs the real CLI
(`bun run src/cli/index.ts analyze <dir> --refresh --json`) from a detached worktree at the baseline
and reads the projected `.discovery/*.json`, unless it says otherwise. The sample programs, harnesses
and raw outputs are in [`evidence/`](evidence/).

## Severity and confidence

| Severity | Meaning |
|---|---|
| **P0** | Security compromise, data loss, or silently wrong migration-critical output with no warning. |
| **P1** | A first-class capability is wrong or missing for common input, or output carries a stronger truth label (CONFIRMED / VERIFIED) than the evidence supports. |
| **P2** | Significant accuracy, coverage, scale or reproducibility gap with bounded impact, or a documented limitation that blocks the next phase. |
| **P3** | Minor defect, hygiene, or design smell with low current impact. |

Confidence follows the repository report contract: **CONFIRMED** (reproduced), **LIKELY** (strong code
evidence, not fully reproduced), **POSSIBLE** (plausible risk), **DESIGN_QUESTION** (needs a decision).
Status for every finding is **DISCOVERED** unless noted; none has been fixed.

No P0 was found. Security-sensitive boundaries that were probed held (see the README's "Verified
strengths").

## Summary

| ID | Sev | Conf | Subsystem | Title |
|---|---|---|---|---|
| BA-01 | P1 | CONFIRMED | Parser | Valid `.ts` files fail to parse: JSX is enabled for every file |
| BA-02 | P1 | CONFIRMED | Symbols (TS) | TypeScript declarations are not modelled; namespace members leak as module exports |
| BA-03 | P1 | CONFIRMED | Module resolution | TypeScript ESM `./x.js` imports and commented `tsconfig.json` aliases never resolve |
| BA-04 | P1 | CONFIRMED | DFG / taint | A source passed directly to a sink or a cross-file call is dropped (`res.send(req.body)`) |
| BA-05 | P1 | CONFIRMED | DFG / taint | F-004 still open: no joins for loops, switch, try, short-circuit (23/27 flows missed) |
| BA-06 | P1 | CONFIRMED | DFG / taint | Conditional values reported CONFIRMED; a branch condition becomes a data source |
| BA-07 | P1 | CONFIRMED | Taint policy | Hard-coded, name-based taint policy misses common sources, sinks and aliases |
| BA-08 | P1 | CONFIRMED | Framework semantics | Express routes marked CONFIRMED carry wrong middleware, handlers, paths and fake routes |
| BA-09 | P2 | CONFIRMED | Dependency graph | Namespace imports bind to an arbitrary export, inverting unused-export facts |
| BA-10 | P2 | CONFIRMED | Symbols / graph | Dynamic `import()` and computed `require()` leave no module reference at all |
| BA-11 | P2 | CONFIRMED | Semantic findings | Dead-code and unused-export findings are mostly false positives |
| BA-12 | P2 | CONFIRMED | Call graph (CJS) | Compiled CommonJS (tsc/Babel output) resolves no calls |
| BA-13 | P2 | CONFIRMED | Symbols | Class expressions lose their class; switch and static-block scopes not modelled |
| BA-14 | P2 | CONFIRMED | CFG | Known CFG adjacents still open: spurious loops, labelled-loop clause edges, duplicate ids |
| BA-15 | P2 | CONFIRMED | Discovery | No ignore policy (`.gitignore`, build output); root-only manifest; directory-name framework guesses |
| BA-16 | P2 | CONFIRMED | Determinism | Artifact order depends on ICU collation (`localeCompare`), not code points |
| BA-17 | P2 | CONFIRMED | Scale | Very large output and whole-run in-memory accumulation; memory bound not established |
| BA-18 | P2 | DESIGN_QUESTION | Identity | Every id hashes `line:column`; no edit-stable identity for IR or migration units |
| BA-19 | P2 | CONFIRMED | Knowledge graph | Knowledge graph holds only file/symbol nodes and contains/imports edges |
| BA-20 | P2 | CONFIRMED | Tests | Suite is green while canonical cases fail; first run clones GitHub repos by tag |
| BA-21 | P1 | CONFIRMED | Docs truth | README and Current Implementation label CFG/DFG/taint, parsing and knowledge graph VERIFIED |
| BA-22 | P2 | CONFIRMED | Docs / governance | Stale sync markers; `main` is 27 commits past `core-foundation`, the declared core truth |
| BA-23 | P2 | CONFIRMED | Docs condition | 122 of 186 files under `docs/` are empty; superseded governance docs still in tree |
| BA-24 | P3 | CONFIRMED | Semantic findings | `React` reported unused in classic-runtime JSX files |
| BA-25 | P3 | CONFIRMED | Plugins | Plugin "runtime" is a registry with an empty frozen context; no extension points |
| BA-26 | P3 | CONFIRMED | Privacy / portability | Manifest records the absolute local project path |
| BA-27 | P3 | POSSIBLE | DFG internals | CONFIRMED/INFERRED decision reads a module-global `WeakRef` map |
| BA-28 | P2 | CONFIRMED | Performance | Data-flow cost grows superlinearly with file size (8k-line file ≈ 2 min) |

---

## BA-01 — Valid `.ts` files fail to parse: JSX is enabled for every file

- **Severity P1 · CONFIRMED · Parser** — `src/parser/adapters/javascript/javascript-parser-options.ts:3-8`,
  `javascript-parser.ts:36-39`.
- **Observed** (sample `s01-ts-parse`):
  - `export const n = <number>someValue;` in `src/cast.ts` → `initial-parser-failure`, code `UnterminatedJsxContent`.
  - `export const id = <T>(x: T): T => x;` in `src/generic-arrow.ts` → `SingleTypeParameterWithoutTrailingComma`.
  - Both are valid TypeScript (`tsc` accepts both in `.ts`; both are only invalid in `.tsx`).
- **Observed on real packages** (`evidence/logs/corpus-results.json`):
  - zod: `src/v3/helpers/parseUtil.ts`, `src/v3/helpers/util.ts` and two test files fail with
    `SingleTypeParameterWithoutTrailingComma`.
  - commander `typings/index.d.ts` fails with `DeclarationMissingInitializer`, and
    `@babel/parser` `lib/index.d.ts` with `MissingPlugin`. Declaration files are parsed without
    Babel's `dts` mode, so valid ambient declarations are rejected.
  - Control: pino's only failure is `test/fixtures/syntax-error-esm.mjs`, a deliberate syntax error,
    which is correct.
- **Root cause**: one frozen option set, `plugins: ["jsx", "typescript", "decorators"]` with
  `sourceType: "unambiguous"`, is used for `.js .jsx .mjs .cjs .ts .tsx .mts .cts` alike. The parser
  never looks at the file extension, so every `.ts` file is parsed as TSX and every `.js` file as TS+JSX.
- **Blast radius**: whole files drop out of symbols, graphs and flows. Angle-bracket casts and
  single-parameter generic arrows are common in older TypeScript, which is exactly the legacy code a
  migration platform targets. `.js` files are parsed with TypeScript syntax enabled, which accepts
  non-JavaScript and can misread `a < b > (c)`; `.cjs`/`.cts` get module-or-script guessed instead of
  fixed by extension.
- **Defect** (not a documented limitation; the README calls JS/TS parsing VERIFIED).
- **Recommendation**: choose dialect per extension: `.d.ts/.d.mts/.d.cts` → `typescript` with
  `dts: true`; `.ts/.mts/.cts` → `typescript`; `.tsx` →
  `typescript + jsx`; `.js/.jsx/.mjs/.cjs` → `jsx` (no TS); `sourceType` fixed to module for
  `.mjs/.mts`, script for `.cjs/.cts`, unambiguous otherwise. Record the dialect in AST metadata.
- **Verification**: RED tests for both snippets in `.ts`, the same snippets failing in `.tsx`, a `.js`
  file using `a < b > (c)`; re-run Tier corpora for unchanged results on `.js`.

## BA-02 — TypeScript declarations are not modelled; namespace members leak as module exports

- **Severity P1 · CONFIRMED · Symbols (TS)** — `src/symbols/javascript-symbol-extractor.ts:81-226`
  (no `TS*` declaration cases), `findDeclaredNames` at `:838-859` (Class/Function/Variable only).
  No file in `src/` mentions `TSEnumDeclaration`, `TSModuleDeclaration`, `TSInterfaceDeclaration`,
  `TSTypeAliasDeclaration`, `TSImportEqualsDeclaration` or `TSExportAssignment`.
- **Observed** (sample `s02-ts-symbols`):
  - `defs.ts` exports `enum Color`, `const enum Dir`, `namespace NS { export function f() }`,
    `interface Shape`, `type Id`, `declare function external`, `abstract class Base`.
    The symbol table contains only `export Base`, `class Base` **and `export f` + `function f`**.
  - `export f` does not exist: `f` is `NS.f`. The extractor treats the namespace body's
    `export function f` as a module-level export. This is a fabricated fact.
  - Of six imports in `use.ts`, only `Base` gets an import→export edge.
  - `legacy.ts` (`import fs = require('fs')`, `export = defs`) produces no symbols and no module edges.
- **Root cause**: the visitor has cases only for ESM/CJS JavaScript constructs; TS declaration nodes
  fall through to `visitChildren`, which then meets the nested `ExportNamedDeclaration` and records it
  with module scope.
- **Blast radius**: every TS codebase. Enums and namespaces are runtime values, so missing them breaks
  call/flow resolution as well as type knowledge; interfaces/type aliases are the type surface an IR
  and a migration planner need.
- **Recommendation**: model TS declarations as symbol kinds (`enum`, `namespace`, `interface`,
  `type-alias`, with `declare`/ambient flags), give namespaces their own scope, add import-equals and
  export-assignment as module references, and mark type-only symbols with their phase.
- **Verification**: per-construct symbol tests; edges for each import in `s02`; a regression that a
  namespace member never becomes a module export.

## BA-03 — TypeScript ESM `./x.js` imports and commented `tsconfig.json` aliases never resolve

- **Severity P1 · CONFIRMED · Module resolution** — `src/graph/module-resolver.ts:111-128`
  (candidate list), `src/core/orchestration/command-handler.ts:735-747` (`readPathAliases`).
- **Observed** (sample `s03-ts-resolution`): only `import { hello } from './a'` resolves.
  - `import { hello } from './a.js'` (the required form under `moduleResolution: node16/nodenext`,
    and common under `bundler`) → no module edge, call `UNRESOLVED`.
  - `import { hello } from '@lib/a'` with a `tsconfig.json` containing a comment and a trailing comma
    (what `tsc --init` generates) → `UNRESOLVED`: `JSON.parse` throws, the catch returns `{}`, and the
    aliases are silently dropped.
- **Also by inspection** (LIKELY): no `.mts`, `.cts`, `.d.ts` candidates; `extends` is not followed;
  only the root `tsconfig.json` is read (no per-package or `jsconfig.json`); `baseUrl`-only imports
  are unsupported; alias patterns are tried in `localeCompare` order instead of TypeScript's
  longest-prefix rule; resolution is case-sensitive even on case-insensitive filesystems.
- **Blast radius**: modern TypeScript ESM projects lose almost every import edge, and with it
  cross-file calls, flows and dead-code facts. Results stay conservative (UNRESOLVED, not wrong), so
  this is a coverage defect, not a soundness one.
- **Recommendation**: parse `tsconfig` as JSONC and follow `extends`; implement TypeScript's
  extension substitution (`.js→.ts/.tsx`, `.mjs→.mts`, `.cjs→.cts`), `.d.ts` and `baseUrl`;
  longest-prefix alias matching; record why each specifier stayed unresolved.
- **Verification**: resolution matrix tests per `moduleResolution` mode; Tier corpora unchanged.

## BA-04 — A source passed directly to a sink or a cross-file call is dropped

- **Severity P1 · CONFIRMED · DFG / taint** — `src/flow/data-flow-builder.ts:817-819` (sink
  arguments come from `collectDefinitions` only), `:942` (`collectDefinitions` skips sources),
  `src/flow/flow-analysis-engine.ts:62-74` (cross-file bindings carry `argumentDefinitionIds` only).
- **Observed**:
  - `s06-taint` handler `/h`: `res.send(req.body)` → **no taint flow**.
  - `s14-taint-hops` `/z`: `res.json({ data: req.body })` → no flow.
  - `s14-taint-hops` `/y`: `const v = pass(req.body); res.send(v)` with `pass` imported from another
    file → no flow.
  - Controls work: `const v = req.body; res.send(v)` → CONFIRMED; `reply(res, v)` into another file's
    `res.send` → CONFIRMED.
- **Root cause**: a sink records which *definitions* reach its arguments, never which *sources* do,
  unless the call is in the "staged" assignment form. A source expression has no definition, so a
  direct source argument contributes nothing. Cross-file call bindings drop `argumentSourceIds` the same
  way.
- **Blast radius**: the single most common vulnerable shape (`res.send(req.query.x)`) is a false
  negative. No test feeds a source straight into a sink (`grep` over `tests/` finds none in flow tests).
- **Recommendation**: give each source occurrence a synthetic definition (or carry source ids on sink
  and binding records) so direct and indirect paths share one mechanism.
- **Verification**: RED tests for direct, object-wrapped and cross-file direct-argument cases; the
  F-004 case file (`evidence/f004/cases.ts`) extended with them.

## BA-05 — F-004 still open: no joins for loops, switch, try or short-circuit expressions

- **Severity P1 · CONFIRMED · DFG / taint** — `src/flow/data-flow-builder.ts:154-205`: only
  `IfStatement` forks and joins scopes; `ForOf/ForIn` use `iteration()`; `While`, `DoWhile`, `For`,
  `Switch`, `Try`, `LogicalExpression`, `ConditionalExpression` and logical assignment are visited
  as straight-line code.
- **Observed**: the F-004 reproduction from the evidence branch, re-run on `c694d64`
  (`evidence/logs/f004-on-main.txt`): **23 of 27 programs miss a real taint flow**, the same as on the
  audit baseline `af48a64`. #201 (F-003) did not change this; the DFG is not CFG-derived.
- **Status**: known finding F-004; option B (structured joins in `data-flow-builder.ts`) approved,
  not implemented.
- **Recommendation**: implement option B, or derive the DFG from the CFG (now sound after F-003) as
  the longer-term design the IR will need anyway. Fold BA-04 and BA-06 into the same test model.

## BA-06 — Conditional values reported CONFIRMED; a branch condition becomes a data source

- **Severity P1 · CONFIRMED · DFG / taint** — `collectSources` (`data-flow-builder.ts:889-936`)
  walks every child of a `ConditionalExpression`, including `test`; no join is created.
- **Observed** (`s06-taint` `/f`):
  `const x = req.query.flag ? req.body : 'safe'; res.send(x);` → **two CONFIRMED flows** into `res.send`:
  one from `req.body` (only on one branch, so it should be at most INFERRED) and one from
  `req.query.flag`, whose value never reaches `x` (a control dependency reported as a confirmed data flow).
- **Why it matters**: CONFIRMED is the label a migration or security decision would trust. Here it is
  both too strong and, for the condition, simply wrong.
- **Dedup**: same missing-join root as BA-05 for the first flow; the condition-as-source part is
  separate (it would survive a join that still walks `test`).
- **Recommendation**: treat the condition as a use, not a value; join the two arms like `if/else`.

## BA-07 — Hard-coded, name-based taint policy misses common sources, sinks and aliases

- **Severity P1 · CONFIRMED · Taint policy** — `src/flow/data-flow-builder.ts:40-42`,
  `source()` at `:1052`, `sanitized()` at `:1072`.
- **Policy**: sources `process.env`, `req.body`, `req.params`, `req.query`; sinks
  `child_process.exec`, `res.send`, `res.json`; sanitizers `validator.escape`, `sanitize`. Matching is
  on the textual member path, so any variable called `res` is a sink and any other name is not.
- **Observed** (`s06-taint`, 9 handlers, each with a real flow): only 2 reported (`/f`, `/g`).
  Missed: destructured `const { body } = req`, renamed `(request, response)`, destructured
  `const { exec } = require('child_process')`, `req.headers`, `eval(req.body.code)`, `res.write`,
  `res.redirect`, plus the direct case of BA-04.
- **Dedup**: open issue IA-HIGH-003 ("Replace hardcoded taint policy boundary") covers the policy
  shape; this finding adds the measured miss rate and the aliasing cases.
- **Recommendation**: a versioned, data-driven policy keyed by resolved symbols (import of
  `child_process`, parameter positions of a proven Express handler) rather than spellings; built-in
  packs for Node core, Express, common DB clients; explicit UNSUPPORTED reporting for unknown sinks.

## BA-08 — Express routes marked CONFIRMED carry wrong facts

- **Severity P1 · CONFIRMED · Framework semantics** — `src/semantic/semantic-engine.ts:79-112`
  (`findHttpCalls`).
- **Observed** (`s05-express-routes`), all with `state: "CONFIRMED"`:
  - `GET /public` lists middleware `[auth]`, but `auth` was registered on `admin`, a different router.
  - `app.get('env')` (an Express settings read) is reported as a route `GET env`.
  - `app.get('/x', auth, handler)` reports `handler=auth`.
  - `admin.get('/secret')` is reported as `/secret`; the mount `app.use('/admin', admin)` is not
    applied, and `admin` itself appears in `middlewareChains` as a middleware name.
  - `app.use(express.json())` is dropped (call-expression middleware has no name).
- **Root cause**: one file-wide `middleware` array accumulates every `.use` on every receiver; the
  handler is the first named argument; a one-argument `get` is not excluded; mounts are not modelled.
- **Blast radius**: route inventories are the backbone of a service migration plan and of auth
  review. A missing or misattributed auth middleware under a CONFIRMED label is the worst kind of
  error for this product.
- **Recommendation**: per-receiver middleware stacks in registration order, mount-path composition,
  handler = last argument, `get(name)` with one argument excluded, unknown middleware recorded as
  UNRESOLVED; downgrade the route state to INFERRED until then.

## BA-09 — Namespace imports bind to an arbitrary export, inverting unused-export facts

- **Severity P2 · CONFIRMED · Dependency graph** — `src/graph/dependency-graph-builder.ts:146-158`
  (`findDirectExport` with `"*"` returns the first local export), `src/semantic/semantic-engine.ts:43`.
- **Observed** (`s07-namespace-import`): `import * as lib from './lib.js'; lib.b();` creates the edge
  `import lib → export a`. The call `lib.b` resolves correctly to `export b`, but `unusedExports`
  (derived from edges only) reports **`b` unused** and treats `a` as used.
- **Recommendation**: a namespace import targets the module (all exports), not an export; compute
  export usage from resolved references and calls as well as edges.

## BA-10 — Dynamic `import()` and computed `require()` leave no module reference

- **Severity P2 · CONFIRMED · Symbols / graph** — Babel 8 emits `ImportExpression`; nothing in `src/`
  handles it. `requireArgument` (`javascript-symbol-extractor.ts:991-996`) drops non-literal requires.
- **Observed** (`s09-dynamic-import`): `await import('./lib.js')` produces no module edge, and
  `lib.js:lazy` is reported as an unused export. `require(name)` leaves no trace.
- **Why P2**: the kernel rule is "unknown remains unknown". Today unknown becomes *absent*, and absence
  then feeds unused/dead findings.
- **Recommendation**: record every dynamic or computed module reference with form and resolution
  state (RESOLVED for literal `import('./x')`, UNRESOLVED otherwise).

## BA-11 — Dead-code and unused-export findings are mostly false positives

- **Severity P2 · CONFIRMED · Semantic findings** — `src/semantic/semantic-engine.ts:42-44`.
- **Observed**: on the engine's own `src/` (126 files), the engine reports 353
  `unreferenced-local-symbol` findings (334 "variable", 19 "method") and 312 unused exports. The same
  code passes `tsc` with `noUnusedLocals` and `noUnusedParameters`, so no local or parameter in it is
  actually unused. Many "variables" are object-literal keys the extractor files as variables, and the
  finding text calls them locals. Analysed with the engine's real `tsconfig.json`
  (`evidence/logs/engine-self-with-tsconfig.json`); a run without it gives the same 353.
- **Related measurement**: in the same run only 303 of the 581 relative or aliased imports get an
  import→export edge. Most of the rest likely import interfaces and type aliases, which BA-02 shows
  have no export symbols (LIKELY, not itemised).
- **Label**: findings are `INFERRED`, which is truthful. The problem is precision: as-is they cannot
  drive any pruning decision in a migration plan.
- **Recommendation**: compute liveness from the call graph plus references plus entry points; never
  report members, properties or exports of entry modules as dead; add a precision benchmark.

## BA-12 — Compiled CommonJS (tsc/Babel output) resolves no calls

- **Severity P2 · CONFIRMED · Call graph** — `collectUnstableExportIds`
  (`src/semantic/call-graph-builder.ts:465-490`), `callName` (`:1283`).
- **Observed** (`s11-ts-compiled-cjs`, standard `tsc` CommonJS output):
  - `exports.hello = void 0; … exports.hello = hello;` → two export records for one slot, so the
    export is "unstable" and `lib_1.hello()` stays `UNRESOLVED`.
  - `(0, lib_1.hello)()`, the call form tsc emits for imported functions, is not recorded as a call at all.
  - `Object.defineProperty(exports, "__esModule", …)` is not modelled.
- **Blast radius**: much legacy JavaScript in the wild is compiled output. Soundness is preserved
  (UNRESOLVED), so this is coverage, but it is near-total for that shape.
- **Recommendation**: recognise the `void 0` pre-declaration as a declaration, not a rebinding; unwrap
  `(0, expr)` callees; model `__esModule` interop.

## BA-13 — Class expressions lose their class; switch and static-block scopes not modelled

- **Severity P2 · CONFIRMED · Symbols** — `javascript-symbol-extractor.ts:182-188` handles
  `ClassDeclaration` only.
- **Observed** (`s08-class-expression`): `export const Inner = class { n() {} }` → no class symbol;
  method `n` has no container (compare `m` → `Outer`).
- **By inspection** (POSSIBLE): `switch` bodies and class `static {}` blocks are lexical scopes in
  JavaScript but get none, so `let/const` inside them are filed under the enclosing scope.
- **Recommendation**: treat `ClassExpression` like a declaration with an anonymous or inferred name;
  add `SwitchStatement` and `StaticBlock` scopes in both the extractor and the call graph.

## BA-14 — Known CFG adjacents still open

- **Severity P2 · CONFIRMED · CFG** — re-run of the F-003 oracle probe on `c694d64`
  (`evidence/logs/cfg-oracle-on-main.txt`):
  - A2: dead tails after `break`/`return` still emit `loop-back`, giving spurious loops (p12, p19, p22).
  - Copied `finally` blocks repeat statement ids within one graph (p02).
  - A3: labelled loops get no clause exception edges (p10 shows only the body edge).
- **Status**: recorded as adjacent findings in the #201 review; unchanged.
- **Recommendation**: prune unreachable tails before back-edge emission; suffix copied `finally`
  statement ids with their copy context; route labelled loops through the same clause-edge path.

## BA-15 — No ignore policy; root-only manifest; directory-name framework guesses

- **Severity P2 · CONFIRMED · Discovery** — `src/discovery/file-scanner.ts:11`,
  `src/discovery/project-detector.ts:87, 152-167`.
- **Observed**: `s01` `dist/bundle.min.js` is analyzed as source. Only `.git`, `.legacy-exodus`,
  `.discovery` and `node_modules` are skipped; `.gitignore`, `dist`, `build`, `coverage`, vendored and
  minified files are not.
- **Observed** (`s15-rails-app`, a 4-file Ruby on Rails app with `Gemfile`, `app/controllers`,
  `app/views/components`): the CLI reports `"frameworks": ["express", "react"]`. Any `controllers` or
  `routes` directory yields `express`, and any `components` directory yields `react`. This works
  directly against the PHP/Rails/Java roadmap.
- **By inspection**: only the root `package.json` is read, so workspace and monorepo packages
  contribute no dependencies; `Gemfile`, `composer.json` and `pom.xml` are not read at all.
- **Recommendation**: honour `.gitignore` plus a configurable ignore list, and flag
  generated/minified files as `fileKind: generated`; read workspace manifests; report directory
  heuristics as INFERRED hints, never as detected frameworks.

## BA-16 — Artifact order depends on ICU collation, not code points

- **Severity P2 · CONFIRMED (behaviour) / POSSIBLE (cross-machine diff) · Determinism** —
  39 `localeCompare` sorts in 16 files (e.g. `file-scanner.ts:220`, `dependency-graph-builder.ts:83-86`,
  `data-flow-builder.ts:1073`).
- **Observed** (`s10-order`): `files.json` order is `_x.js | a.js | ä.js | B.js | Z.js`; code-point
  order is `B.js | Z.js | _x.js | a.js | ä.js`. In Bun 1.4.4, `"ä.js".localeCompare("ä.js")`
  (NFC vs NFD) is `0` although the strings differ, so the order of such pairs falls back to filesystem
  `readdir` order.
- **Why it matters**: the product promise is bit-for-bit determinism across machines. Collation
  depends on the ICU version and locale, which differ between Bun releases, operating systems and
  user settings.
- **Recommendation**: one shared code-point comparator (`a < b ? -1 : a > b ? 1 : 0`) for every
  artifact ordering; a test that sorts NFC/NFD and mixed-case names.

## BA-17 — Very large output and whole-run in-memory accumulation

- **Severity P2 · CONFIRMED (measured) · Scale** — `command-handler.ts:383-688` builds every record
  for the run before one `commitBatch`; per-file DFG/CFG/semantic payloads are all retained.
- **Measured** (Windows 11, Bun 1.4.4, two `--refresh` runs each; see `evidence/logs/corpus-results.json`):
  see the corpus table in the README. Headlines:
  - The engine's own `src/` (126 analyzed files, about 16.6k lines) produced **42 MB** of `.discovery`
    JSON; its `tests/` (156 files) **72 MB**.
  - zod (812 analyzed files) took **157–187 s** per run and produced **275 MB**.
  - The largest artifacts are `data-flow.json` (11.3 MB for `src/`), `control-flow.json` (10.8 MB) and
    `semantic.json` (8.9 MB).
  - By linear extrapolation (INFERENCE), a 10k-file repository would take roughly 35 minutes and
    3 GB of output, before BA-28's superlinear per-file cost.
- **Memory/OOM neutrality was not established by this audit.** No repository larger than a few hundred
  files was run.
- **Recommendation**: per-file artifact shards with a manifest index, ids instead of repeated strings,
  optional detail levels, streaming commit per file; add a 2k–10k-file scale benchmark with RSS limits.

## BA-18 — Every id hashes `line:column`; no edit-stable identity

- **Severity P2 · DESIGN_QUESTION · Identity** — symbol ids `sha256(path:kind:name:line:column)`
  (`javascript-symbol-extractor.ts:778-783`); call, definition, use, sink and route ids follow the same
  pattern.
- **Effect**: adding one line at the top of a file changes the id of every symbol, call and flow below
  it. Deterministic, but not stable across revisions.
- **Why it matters for the IR phase**: migration units, proof obligations, incremental re-analysis and
  "what changed between two snapshots" all need identities that survive unrelated edits. This must be
  decided before the IR schema is frozen.
- **Recommendation**: a design ADR for a two-level identity: a structural key (container path +
  name + kind + disambiguator) for stable reference, plus the location for display.

## BA-19 — Knowledge graph holds only file/symbol nodes and contains/imports edges

- **Severity P2 · CONFIRMED · Knowledge graph** — `src/knowledge/knowledge-graph.ts` (52 lines):
  node kinds `file | symbol`, edges `contains | imports`. Files that failed to parse are absent.
- **Gap vs. stated role**: calls, references, routes, flows, types, modules, packages and the
  CFG/DFG are not in it; the README labels the knowledge graph VERIFIED.
- **Recommendation**: define the repository knowledge model as part of the IR design rather than
  growing this one ad hoc.

## BA-20 — Suite is green while canonical cases fail; first run clones GitHub repos by tag

- **Severity P2 · CONFIRMED · Tests** — baseline verify: 1812 pass / 0 fail across 152 files, audit
  8/8, typecheck clean (`evidence/logs/baseline-verify.txt`).
- **Gaps**:
  - No test parses an angle-bracket cast or generic arrow in `.ts` (BA-01).
  - No flow test passes a source straight into a sink (BA-04).
  - No test declares a TS enum, namespace or interface (BA-02).
- **Network dependency**: `tests/unit/governance/test-fidelity-helpers.ts:38-78` clones express and
  fastify with `git clone --depth 1 --branch <tag>` into `benchmarks/.cache` on first run. That
  happened during this audit's verify. Offline CI fails, and tags are mutable with no content hash
  check (related to F-010 adjacent A6).
- **Recommendation**: a canonical-semantics corpus (one small program per language construct ×
  analysis) with expected facts; corpora pinned by commit SHA plus a tree hash, or vendored.

## BA-21 — README and Current Implementation overstate verification

- **Severity P1 · CONFIRMED · Docs truth** — `README.md:15-19`, `docs/CURRENT_IMPLEMENTATION.md`.
- **Claims**: "JavaScript/TypeScript discovery and Babel-based parsing — VERIFIED", "Lexical symbols,
  ESM/CommonJS relationships … — VERIFIED", "Knowledge graph, semantic call analysis, CFG, DFG,
  conservative taint facts — VERIFIED".
- **Reality**: contradicted by BA-01 (valid TS fails to parse), BA-02/03 (TS declarations and
  resolution), BA-04–07 (taint misses most real flows and over-labels some), BA-19 (knowledge graph
  scope). The taint facts are not conservative in either direction.
- **Why P1**: the project's own kernel forbids VERIFIED beyond evidence, and "stay honest" is the
  headline promise. Users will trust these labels.
- **Recommendation**: re-label to PARTIAL with explicit bounds now; generate the status table from a
  canonical-semantics benchmark later (BA-20).

## BA-22 — Stale sync markers; branch model no longer matches practice

- **Severity P2 · CONFIRMED · Docs / governance** — `README.md:76-80`,
  `docs/CURRENT_IMPLEMENTATION.md:5-7`.
- **Observed**: both pin `origin/main` at `6f88ec5` and `origin/core-foundation` at `204f123`. Actual
  `main` is `c694d64`, 27 commits ahead of `core-foundation` (and 14 behind it by ancestry; squash
  merges carry most of that content). 93 files under `legacy-exodus-core/` differ. The October audit
  fixes (#198–#202) landed on `main` only, while the README still calls `core-foundation` the
  "implementation integration truth".
- **Recommendation**: decide the branch model (likely: `main` is truth, retire or re-sync
  `core-foundation`/`docs-foundation`), then remove hand-maintained SHA markers or generate them.

## BA-23 — Documentation condition

- **Severity P2 · CONFIRMED · Docs condition** — full inventory in [`DOCS-CONDITION.md`](DOCS-CONDITION.md).
- 218 project Markdown files; **122 of the 186 under `docs/` are empty (0 bytes)**. The domain,
  product, research, reviews, operations, integrations, decisions, templates and pipeline-stage
  sections are almost entirely empty.
- Superseded governance (`docs/governance/AGENT_OPERATING_MODEL.md`, `PERMANENT_CHARTER.md`) and a
  pre-`.agents` `.github/copilot-instructions.md` are still present.
- `ROADMAP.md` completed rows carry stale counts (660/800 tests, "10/10").
- The positive: 0 broken relative links or anchors across all 218.

## BA-24 — `React` reported unused in classic-runtime JSX files

- **Severity P3 · CONFIRMED** — `s04-jsx`: `Card.tsx` `import React from 'react'` → `unused-import`.
  Under the classic JSX runtime JSX compiles to `React.createElement`, so removing it breaks the file.
  JSX component references themselves resolve correctly (`<Button />` → RESOLVED).
- **Recommendation**: read the JSX runtime from `tsconfig`/Babel config; treat `React` as used under
  classic runtime.

## BA-25 — Plugin runtime is a registry with an empty frozen context

- **Severity P3 · CONFIRMED** — `src/plugins/plugin-loader.ts:7`; 128 lines in `src/plugins/`.
  No hook into parsing, analysis, policy or projection exists, so no third-party frontend, framework
  model or taint pack can be added. The README's "Plugin runtime contracts — IMPLEMENTED" is
  accurate only in that narrow sense.
- **Recommendation**: design extension points together with the IR (frontends emit IR; framework
  models and policies consume it).

## BA-26 — Manifest records the absolute local project path

- **Severity P3 · CONFIRMED** — `src/storage/projections/file-discovery-projection.ts:191-193`.
  `manifest.json` `repository.path` is e.g. `C:\Projects\.audit\samples\s13-planted-git`, which
  exposes user names and directory layout when `.discovery` is shared, and makes manifests
  machine-specific.
- **Recommendation**: store a path relative to the analysis root, or omit it from shared artifacts.

## BA-27 — CONFIRMED/INFERRED decision reads a module-global `WeakRef` map

- **Severity P3 · POSSIBLE · DFG internals** — `src/flow/data-flow-builder.ts:15-16, 113-130`.
  `computeTaintFlows` treats a definition as a join only while its `JoinInputs` object is still alive
  in the module-level `joinInputsById` map. Current callers keep states alive until `connect()`
  finishes, so this audit saw no wrong label. But label semantics now depend on object lifetime and
  process-wide state, and that can break silently under refactoring or concurrent builds.
- **Recommendation**: keep joins in the per-build state that is passed to `computeTaintFlows`.

## BA-28 — Data-flow cost grows superlinearly with file size

- **Severity P2 · CONFIRMED (measured) / LIKELY (root cause) · Performance** —
  `data-flow-builder.ts:207-257` (`conditional()` copies every frame of the scope chain, including the
  whole module scope, at each `if`), `:866-870` (`addTransfer` deduplicates with a linear `some`),
  `:997-1005` (whole-set fixed point); minor: `javascript-symbol-extractor.ts:162-168`.
- **Measured** (`evidence/logs/perf-scaling.txt`, `stage-timer` output; one generated file of N small
  functions, each with one `if`):

  | N functions | Lines | CLI median | DFG stage | Other stages combined |
  |---|---|---|---|---|
  | 500 | 1,010 | 1.4 s | 0.36 s | 0.41 s |
  | 1,000 | 2,010 | 4.2 s | 1.94 s | 0.73 s |
  | 2,000 | 4,010 | 32.9 s | 28.6 s | 1.58 s |
  | 4,000 | 8,010 | 113.8 s (75–153 s) | — | — |

  Doubling the input multiplies the DFG stage by about 5 and then about 15. The same 2,000-function file
  with the `if`s removed takes 6.2 s in the DFG, so the per-branch scope copy is the main cause and
  something else (likely the linear transfer dedupe) is also superlinear. The 4,000 row's variance
  is above 3% because other probes ran concurrently; treat its exact factor as INCONCLUSIVE. The
  trend is not in doubt.
- **Blast radius**: large legacy files (generated code, long controllers, bundled vendor files that
  BA-15 does not exclude) can take minutes to hours each.
- **Recommendation**: copy-on-write scope frames, or joins keyed only on names written in the branch;
  index transfers by `source:target`; worklist propagation (as `flow-analysis-engine.ts` already does
  across files). Add a scaling test that fails on superlinear growth.
