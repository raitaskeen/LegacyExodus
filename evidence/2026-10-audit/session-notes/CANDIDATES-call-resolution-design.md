# Design: `CANDIDATES` call-resolution state (F-002 follow-up)

Role: Design (`legacyexodus-architecture-design`). Class: ARCHITECTURE_CHANGE (design only) with a
RESEARCH measurement. No production, test or repository file was changed. Evidence time 2026-10-21T12:09Z.

Verdict: **READY_FOR_SCOPED_IMPLEMENTATION**, on two conditions: F-002 lands first, and a human decides
the four questions in §11. Readiness does not authorize implementation. Independent design review is
**OUTSTANDING**: this report was written and self-reviewed by one context only.

---

## 0. Intake and scope contract

| Field | Value |
|---|---|
| OBJECTIVE | Design a third call-resolution state that brings back the possible-target information F-002 removed, without presenting it as proof. |
| IN_SCOPE | Contract, candidate algorithms (`this.m()`, rebound bindings, receivers and containers), every consumer and schema, snapshot compatibility, test model, measurement on express, fastify and the engine itself. |
| OUT_OF_SCOPE | Implementation, tests, ground-truth edits, DFG use of candidates, `super.m()`, points-to analysis, changes to F-002's proof rules. |
| ALLOWED_FILES | This report and probe scripts in the shared notes folder; scratchpad. |
| FORBIDDEN | Any repository edit, commit, push or PR. Executing analyzed repositories. |
| EXPECTED_BASELINE | `main` = `origin/main` = `af48a64b58046f61adf97531937f2fe60c3d7d93` (local refs; not fetched, so remote freshness is not claimed). |
| CANDIDATE UNDER DESIGN | F-002, **uncommitted** in worktree `LegacyExodus-f002-call-resolution`, branch `fix/f002-call-resolution-soundness` @ `af48a64`. Full diff `git hash-object` = `1067af58728ef8c5db24d95040def2f6373896a4` (792 lines, 9 modified files). Untracked `tests/unit/semantic/call-resolution-soundness.test.ts` sha256 `776d6a5b…80f6`. `call-graph-builder.ts` diff hash `c93c10ba…10cb`. |
| CORPORA | express `4.21.2` @ `1faf2289…3f0f`; fastify `v5.3.3` @ `220b5320…e1bca` (both pinned in `benchmarks/corpus/*.json` and cached in the F-002 worktree). "self" means `legacy-exodus-core/` of this worktree at `af48a64`, which is clean and has no `node_modules`, `.cache` or `.discovery`. |
| ENVIRONMENT | Windows 11, Bun 1.4.2. Baseline engine: the main checkout (clean, at `af48a64`). Candidate engine: the F-002 worktree. Both have identical `package.json` and `bun.lock`. |
| STOP CONDITIONS | Kernel stops; F-002 changing before implementation (this design must then be re-checked against it). |

---

## 1. PROBLEM

F-002 found that the call graph labelled flow-insensitive guesses `RESOLVED`, and that `RESOLVED` feeds
`ProvenCallTarget` in the DFG. The strict fix keeps `RESOLVED` only for provable targets:
- private `#methods`;
- `new C()` receivers that never change or are proven by flow;
- function, import and container bindings that are never rebound.

Everything else is now `UNRESOLVED`. That makes the proven set sound, but it throws away information
that the analyzer does have. For a public `this.m()` the possible targets are known; they just cannot
be proven. Dead-code detection and fidelity both get worse as a result.

---

## 2. CURRENT_BEHAVIOR (demonstrated)

### 2.1 Reproduction of the F-002 loss — VERIFIED

Probe `dump-calls.ts` replicates the command-handler pipeline (discover → parse → extract →
dependency graph → `buildForFile`, in sorted order) for each engine. `diff-calls.ts` then joins the
two outputs by call id.

| Corpus | Files | Calls | RESOLVED, baseline | RESOLVED, F-002 | Demoted | Gained | Target changed |
|---|---|---|---|---|---|---|---|
| express | 152 | 9,193 | 1,109 | 1,040 | **69** | 0 | 0 |
| fastify | 287 | 29,959 | 1,361 | 1,339 | **22** | 0 | 0 |
| self | 289 | 23,913 | 5,746 | 5,251 | **495** | 0 | 0 |

This reproduces the reported 69 and 495. F-002 only ever demotes calls: it never adds a `RESOLVED`
call and never changes a target.

### 2.2 What the demoted calls are (classified by baseline target) — VERIFIED

| Corpus | Shape | Count | Baseline correct? |
|---|---|---|---|
| express | `this.k()` inside a function stored on a container (`app.x = function`, `res.x = …`, `proto.x`, `View.prototype.x`) | 69 | Plausible but not provable. `this` is whatever object invokes the function; express mixes `proto` into app functions. |
| fastify | `this.k()` inside `Reply.prototype.x = function` and similar | 10 | Plausible but not provable. |
| fastify | `reply.send()` on a handler **parameter** | 12 | **Wrong.** This was a name coincidence with an unrelated `reply.send = () => {…}` in another test (`test/async-await.test.js:121-123` vs `:419-421`). F-002 demoted it correctly. |
| self | `this.m()` in a TS class method, target = that class's own method | 492 | Plausible. Every one of these classes is a candidate for override or borrowing. |
| self | Rebound `let r = () => {}; new Promise(res => { r = res; }); r()` | 3 | **Wrong.** At the call the binding holds the Promise resolver, not the initial arrow (`tests/unit/runtime-shutdown-cleanup.test.ts:360-401`). |

So the losses were not all true information. 15 of the 586 demotions were false targets.

### 2.3 Consumer behavior at baseline (IMPLEMENTATION)

- `ProvenCallTarget` is built from `RESOLVED` calls at two places:
  `core/orchestration/command-handler.ts:548-553` (canonical paths) and
  `flow/flow-analysis-engine.ts:20-26` (raw paths).
- Dead code (`semantic/semantic-engine.ts:39-44`) treats only `reference.resolvedSymbolId` as a reference.
  Effect of F-002 (measured with `dead-delta.ts`) — symbols newly reported `unreferenced-local-symbol`:
  express **+19**, fastify **+9**, self **+15**.
- Fidelity (`governance/fidelity/fidelity-matcher.ts:100,168`) compares `resolutionState` exactly.
  F-002 relabelled 5 express ground-truth facts to `UNRESOLVED`.
- Snapshot reuse (`command-handler.ts` reuse path) parses `semantic.json` with
  `semanticAnalysisPayloadSchema`. Any parse failure falls back to fresh discovery.
  On `main` today, reuse is **not** bound to engine identity. F-001's analyzer fingerprint is on an
  unmerged branch (`140ec83`).
- The symbol extractor records no superclass. `ClassDeclaration` and `ClassExpression` both have a
  `superClass` AST child (`javascript-node-mapper.ts:55-56`). `ClassExpression` produces no class symbol.
- Pass 1 builds every symbol table. Pass 2 streams one AST at a time and builds calls and the DFG
  context together (`command-handler.ts:470-560`). **Pass 2 has no other file's AST.**

---

## 3. REQUIRED_INVARIANTS

I1. **The proof barrier is unchanged.** `ProvenCallTarget`, `CallFlowBinding` and interprocedural flows
    are derived only from `RESOLVED`. A `CANDIDATES` call never yields any of them, even with one
    closed-world candidate.

I2. **`RESOLVED` is identical to F-002.** For every input, the set of `RESOLVED` calls and their
    targets must equal F-002's output. Candidate rules run only after proof has failed.

I3. **Unknown stays unknown.** `CANDIDATES` requires value evidence for the receiver or callee:
    a hierarchy, a container, or binding writes. There are no name-only matches. Parameters, catch
    and for-of bindings, undeclared globals and import receivers without a resolvable edge stay
    `UNRESOLVED`.

I4. **A candidate is a possible target, not an observed one.** Each candidate has a write, declaration
    or hierarchy path that can make it the callee. Whether that execution is feasible is not established.

I5. **`openWorld = false` claims completeness under named assumptions.** The runtime target is in the
    set, assuming A0 and that the syntactic checks in §6.6 pass. `openWorld = true` claims nothing about
    completeness. The default is `true`. Every check that fails or cannot be evaluated keeps it `true`.

I6. **Determinism.** Candidate ids and reasons are deduplicated and sorted. The output does not depend on
    file visit order beyond what F-002 already depends on.

I7. **Compatibility fails closed.** Neither an old reader nor a new reader may silently turn
    `CANDIDATES` into `UNRESOLVED` or `RESOLVED`. Snapshots older than this contract are not reused.

A0 is the assumption set F-002 already uses for proof (`collectBindingWrites` doc comment):
no `eval` or `with`; no computed-key or reflective writes that change the relevant property or binding;
no mutation of this module's objects from other modules. Closed-world candidates inherit A0. They are
not stronger than F-002 proofs.

---

## 4. OPTIONS

### 4.1 How the possible targets are carried

| Option | Description | Assessment |
|---|---|---|
| **C1 (recommended)** | A third `resolutionState: "CANDIDATES"` with flat fields `candidateTargetSymbolIds`, `openWorld`, `candidateBasis`, `openWorldReasons`. | Explicit. Consumers that filter on `RESOLVED` stay correct without changes. Old readers fail closed on the enum (I7). |
| C2 | Keep two states; add optional `candidateTargetSymbolIds` on `UNRESOLVED`. | Rejected. `UNRESOLVED` would mean two things. An old zod reader would **silently strip** the field (non-strict objects), losing information without any error. Fidelity could not tell the states apart. |
| C3 | A separate `possibleCallEdges[]` collection beside `calls`. | Rejected. One call site would have two sources of truth, and every consumer would need a join. It is less invasive, but it duplicates identity. |
| C4 | Reuse `INFERRED` from flow `AnalysisState`. | Rejected. `INFERRED` means one hypothesis. A candidate set with a completeness flag is a different claim, and the name would blur the CONSERVATIVE/INFERRED distinction the kernel keeps. |

### 4.2 Where the class hierarchy comes from

| Option | Description | Assessment |
|---|---|---|
| **H1 (recommended for increment 1)** | Superclass edges come from the current file's AST, resolved through the builder's existing lexical bindings. | No contract change. Sound: a cross-file subclass needs the base class to escape its file, and an escaping class already forces `openWorld = true` (`exported-class`). It is incomplete only for the candidate *list* of open-world hierarchies. |
| H2 (follow-up) | The extractor records `superClass` on class symbols (`{form:"identifier",name,scopeId} \| {form:"member",path} \| {form:"expression"}`). Pass 2 resolves it through lexical bindings and `targetByImportId`. | Adds cross-file subclasses and inherited methods. **Measured value is small:** +1 candidate in 499 self sites (`MemoryStorageProvider.findScoped`, overridden in `tests/unit/discovery/discovery-query-service.test.ts:19`), and 0 on express/fastify. Cost: changes the `CodeSymbol` schema, `symbols.json` and symbol-table payloads. |
| H3 | A whole-program AST pre-pass over `astStore` before pass 2. | Rejected. It doubles AST reads and breaks pass 2's one-AST-at-a-time memory bound. |

### 4.3 Promoting a closed-world singleton to `RESOLVED`

| Option | Assessment |
|---|---|
| **P0 (recommended)** Never promote; it stays `CANDIDATES`. | Matches the user's strict choice. `ProvenCallTarget` keeps F-002's assumption set. |
| P1 Promote non-escaping, unborrowed, unwritten singletons. | Deferred to a human decision (Q3). 131 self sites qualify (128 of them in `FlowState`, `flow/control-flow-builder.ts:42`, which is not exported). |

### 4.4 Dead code

| Option | Assessment |
|---|---|
| **D1 (recommended)** Candidate ids count as references, so the symbol is not reported. | The finding's reason is literally "unreferenced". A symbol that may be referenced does not meet it. |
| D2 Report it with `state: "REQUIRES_REVIEW"`. | Keeps it visible but changes the meaning of the finding for every consumer. Available if a human prefers it (Q4). |

---

## 5. TRADEOFFS

- **C1 costs a little compatibility to gain explicitness.** Old engines cannot reuse new snapshots: they
  fall back to fresh analysis. Old query services reading a new database throw `LegacyExodusError`
  (`discovery-projection-service.ts:204-206`). Both fail closed.
- **`openWorld` will usually be `true`** on real libraries: 100% of express and fastify candidates,
  and 73.7% of self. The flag is honest, but most candidate sets are a lower bound. Consumers must
  not treat `CANDIDATES` as complete without checking `openWorld`.
- **R2 (container `this`) has weak evidence.** The only evidence is that the two functions belong to the
  same container, and the receiver is chosen by the caller. It is always open-world, by design. It
  still recovers all 69 express losses with the intended target.
- **H1 defers 1 measured candidate** to save a symbol contract change.

---

## 6. BOUNDED_DESIGN

### 6.1 Contract — `semantic/semantic-contracts.ts`

```ts
export type CallResolutionState = "RESOLVED" | "CANDIDATES" | "UNRESOLVED";
export type CandidateBasis = "class-hierarchy" | "container-membership" | "binding-writes" | "receiver-writes";
export type OpenWorldReason =
  | "exported-class"          // a hierarchy class escapes its file (export, module.exports, value use)
  | "unresolved-superclass"   // a lookup reached a superclass outside the analyzed hierarchy before finding m
  | "prototype-access"        // `X.prototype` is referenced for a hierarchy class (mutation/borrow vector)
  | "method-value-read"       // `.m` is read as a value in a declaring file (borrowing with a foreign this)
  | "property-write"          // `.m` is assigned on a receiver not tracked to the hierarchy/container
  | "accessor-member"         // m resolves to a getter/setter, whose returned callee is unknown
  | "caller-chosen-receiver"  // `this` of a container function (R2)
  | "escaping-container"      // container binding exported, passed, returned, aliased or mixed in
  | "unknown-write-value";    // some write to the binding/receiver has no analyzable value

interface SemanticCallBase { readonly id: string; readonly sourceFilePath: string; readonly callerName: string; readonly calleeName: string; readonly location?: { readonly line: number; readonly column: number } }
interface NoCandidates { readonly candidateTargetSymbolIds?: never; readonly openWorld?: never; readonly candidateBasis?: never; readonly openWorldReasons?: never }
export type SemanticCall =
  | (SemanticCallBase & NoCandidates & { readonly resolutionState: "RESOLVED"; readonly targetSymbolId: string })
  | (SemanticCallBase & NoCandidates & { readonly resolutionState: "UNRESOLVED"; readonly targetSymbolId?: never })
  | (SemanticCallBase & {
      readonly resolutionState: "CANDIDATES";
      readonly targetSymbolId?: never;                       // targetSymbolId keeps meaning "proven"
      readonly candidateTargetSymbolIds: readonly string[];  // non-empty, unique, sorted
      readonly openWorld: boolean;                           // === openWorldReasons.length > 0
      readonly candidateBasis: CandidateBasis;
      readonly openWorldReasons: readonly OpenWorldReason[]; // unique, sorted
    });
```

- The `?: never` fields keep existing reads such as `calls.map((c) => c.targetSymbolId)` compiling.
  They also make it a **type error** to put a target on a non-`RESOLVED` call.
- `SymbolReference`: for `kind: "call"` the state may be `CANDIDATES`, with
  `candidateSymbolIds: readonly string[]`, mirroring `resolvedSymbolId`. Identifier references stay
  `RESOLVED`-only.
- Zod: replace `resolutionStateSchema` with a `z.discriminatedUnion("resolutionState", …)` per entity,
  plus refinements:
  - `RESOLVED` ⇒ `targetSymbolId` is present.
  - `CANDIDATES` ⇒ non-empty, unique, sorted ids; `openWorld === reasons.length > 0`; no `targetSymbolId`.
  - `UNRESOLVED` ⇒ neither a target nor candidates.

  Historical two-state records still parse; the builder never wrote `UNRESOLVED` together with a target
  (`call-graph-builder.ts:98-101`).
- `createSemanticAnalysis` must also freeze the candidate arrays. `freezeSorted` freezes only one level.

Candidate ids are drawn only from symbol kinds `function`, `method` and `class`, plus R3 import targets
(the `export` symbols from dependency edges). R1/R2/R4 also allow `variable` symbols that hold a function
value (class field arrows).

### 6.2 Resolution order — `semantic/call-graph-builder.ts`

1. F-002 proof, unchanged. If it proves a target: `RESOLVED`.
2. Otherwise apply the first candidate rule whose precondition holds. If it yields a non-empty set:
   `CANDIDATES`.
3. Otherwise `UNRESOLVED`.

`ResolutionContext` gains `thisBinding`:
`{kind:"class-element", classId, static} | {kind:"container-function", container} | {kind:"none"}`.
It is set only where `this` is bound:
- class methods, accessors, field initializers and static blocks set `class-element`;
- a `FunctionExpression` that is the `right` of a member assignment `X.k = …` or `X[k] = …` sets
  `container-function` for `X` (the object of the left side, including computed keys);
- `ObjectMethod`, and `ObjectProperty` function values inside `const X = {…}`, set `container-function` for `X`;
- `FunctionDeclaration` and any other `FunctionExpression` set `none`;
- arrow functions inherit.

This is needed because the existing `containerName` is overwritten by nested member assignments.
Evidence: in `this._router = new Router({ caseSensitive: this.enabled(…) })` at express
`lib/application.js:147-148,575`, `containerName` becomes `"this"`, so even the baseline missed these
calls. The estimator, which uses this rule, finds them (3 new express candidates).

### 6.3 Rule R1 — class `this` dispatch (`candidateBasis: "class-hierarchy"`)

**Applies when:** the callee is `this.m(…)`, `m` is not private, and `thisBinding` is a class element
of class K. (Private `#m` is already `RESOLVED` under F-002.)

**Runtime classes:** RT(K) = {K} ∪ the transitive subclasses of K. Static elements use the same
hierarchy for static members only.

**Lookup:** for each D in RT(K), `lookup(D, m, static)` walks D's superclass chain and returns the
first declaration of `m`. An instance field `m` takes precedence over a prototype method at the same
level. The chain contributes:
- a method symbol, or the anchored function symbol of a field initializer;
- `accessor-member` if it reaches a getter or setter;
- `unresolved-superclass` if it reaches an unknown superclass before finding `m`.

**Instance writes:** `this.m = v` inside any element of RT(K) adds `targets(v)`.
A `v` of the form `this.m.bind(…)` resolves to the same targets as `this.m`, because bound functions
call the same body. Any other unknown `v` adds `unknown-write-value`.

**Open-world reasons:**
- `exported-class`: any class in RT(K) or K's chain is exported, appears in an export symbol, or is
  used as a value anywhere except `new`, `extends`, a static member access or `instanceof` (checked
  in-file);
- `prototype-access`: `X.prototype` is referenced for X in RT(K);
- `method-value-read`: `.m` is read as a non-call value in the declaring file;
- `property-write`: some analyzed file has a member-assignment symbol named `m` whose receiver is not
  `this` inside RT(K). This uses a global name index built once from symbol tables (available in pass 2).

**Hierarchy source:** H1 in increment 1.

**No candidates:** an empty set (for example, `this.m()` where `m` is static-only) gives `UNRESOLVED`.

### 6.4 Rule R2 — container `this` dispatch (`candidateBasis: "container-membership"`)

**Applies when:** the callee is `this.m(…)` and `thisBinding` is a container function for X.

**Candidates:** the `method` or `function` symbols named `m` that are declared on container X in this
file. A member is declared there by `containerName === X` with no `containerId`; `exports` and
`module.exports` are treated as aliases.

**Open-world:** always `openWorld = true` with reason `caller-chosen-receiver`.
Counterexample: the F-002 borrowing case (`other.init()` runs `app.init` with `this === other`).

**No candidates:** an empty set gives `UNRESOLVED`.

### 6.5 Rules R3 and R4 — values of rebound bindings and receivers

**R3** (`candidateBasis: "binding-writes"`) applies when a bare `f(…)` or `new F(…)` was refused by
F-002 because the binding is rebound (`isRebound`). This covers function, class, import and variable
bindings.

The candidate set is the union, over every write in F-002's `BindingWrites.writeSites` for that key,
of `targets(value)`. The writes include declaration initializers, function and class declarations,
assignments and implicit writes. `targets(value)` is:

| Value | Targets |
|---|---|
| Function, arrow or class expression | Its anchored symbol |
| Declaration of the binding itself | Its symbol |
| Identifier `g` | `g`'s proven target if F-002 proves `g`; otherwise recurse with a cycle guard; otherwise unknown |
| Import or `require` initializer | `targetByImportId` of its import symbol |
| `x.bind(…)` | `targets(x)` |
| Anything else (calls, member reads, parameters, catch, for-of, compound operators) | Unknown → `unknown-write-value` |

Lexical bindings can only be written within the file (under A0). So if every write value is known,
`openWorld = false`. The union ignores write order. That makes it a sound over-approximation for the
flow-ordering cases F-002 could not prove.

**R4** (`candidateBasis: "receiver-writes"`) applies to `v.m(…)` where `v` is a declared, non-parameter
binding and F-002 did not prove the call.

- **Constructed values.** For each write to `v`:
  - `new D()` with D a never-rebound class contributes `lookup(D, m)`. D is the exact class, so its
    subclasses are not added.
  - `v.m = fn`, on the same binding, contributes `targets(fn)`.
  - Any other value contributes `unknown-write-value`.
- **Object or function containers.** `v`'s in-file declared members named `m`, plus its `v.m = fn` writes.
- **Reasons:**
  - `prototype-access` (D);
  - `property-write`;
  - `escaping-container`: `v` is exported, passed as an argument, returned, assigned elsewhere, mixed in,
    or computed-written.
- **Never candidates:** parameter, catch, for-of and undeclared receivers stay `UNRESOLVED`. This is the
  oracle for the fastify `reply.send` case.

### 6.6 Closed-world checks (when `openWorld` may be `false`)

`openWorld = false` only when **all** of these hold:
- A0;
- R1: no `exported-class`, `unresolved-superclass`, `prototype-access`, `method-value-read`,
  `property-write`, `accessor-member` or `unknown-write-value` reason applies;
- R3: every write value is known;
- R4: no reason applies.

R2 is never closed-world. If an implementation cannot evaluate a check, it must add a reason instead
of skipping the check.

### 6.7 Consumers and schemas

| Surface | Change |
|---|---|
| `semantic/semantic-contracts.ts` | §6.1 types, discriminated-union schemas, refinements, deep freeze. |
| `contracts/discovery-storage.ts` | `semanticAnalysisPayloadSchema` gets the variants automatically through `.extend`. Add `callResolutionContract: z.literal("call-resolution-candidates-v1").optional()`, following the R01 `analysisDisposition` pattern ("current reuse requires this nested capability; historical projections remain readable"). |
| `core/orchestration/command-handler.ts` | Set `callResolutionContract` on the `semantic-analysis` record. On the reuse path, throw (and so fall back to fresh analysis) when `semantic.json` lacks the current marker. This also stops pre-F-002 snapshots with unsound `RESOLVED` from being reused. The `createProvenCallTargets` filter (`:548-553`) needs no logic change; the union type makes a mistaken `!== "UNRESOLVED"` filter fail to typecheck. |
| `flow/flow-analysis-engine.ts:20-26` | No logic change. Same type protection. Optional: one exported helper `selectProvenCallTargets(calls, filePath)` used by both call sites, so the `RESOLVED`-only predicate is defined once. If adopted, keep each site's current path comparison: aligning canonical vs raw paths is adjacent finding A2, not this change. |
| `flow/flow-contracts.ts` | `ProvenCallTarget` is unchanged. Its doc comment is tightened to: "built only from `RESOLVED` calls; `CANDIDATES` never qualify". No schema change. |
| `semantic/semantic-engine.ts:39` | `referencedSymbolIds` includes `candidateSymbolIds` from `CANDIDATES` call references (D1). `unusedImports` and `unusedExports` are not affected: candidates are not import bindings, and export use comes from dependency edges. |
| `contracts/fidelity.ts:95` | `GroundTruthCall.resolutionState` becomes `"RESOLVED" \| "CANDIDATES" \| "UNRESOLVED"`. Add optional `openWorld?: boolean`. |
| `governance/fidelity/fidelity-matcher.ts` | State comparison stays exact. Do **not** let `UNRESOLVED` match `CANDIDATES`; that would hide candidate regressions. Compare `openWorld` when the ground truth specifies it. `isFactActionable`: `CANDIDATES` is actionable when `candidateTargetSymbolIds` is non-empty. |
| `benchmarks/fidelity/express-ground-truth.ts` | Relabel the 5 facts F-002 changed (`gt-call-app-lazyrouter`, `gt-call-app-default-config`, `gt-call-router-route`, `gt-call-res-set`, `gt-call-res-get`) to `CANDIDATES` with `openWorld: true`. The estimator gives exactly the intended target as a singleton at every site (5/5, 1/1, 1/1, 17/17, 9/9). This changes ground-truth expectations (EXPECTED_CHANGE) and needs the human's manual verification. fastify ground truth: no call fact changes. |
| `.discovery` snapshots | **New engine, old snapshot:** schema parses, the marker is missing, fresh analysis runs. **Old engine, new snapshot:** the enum rejects `CANDIDATES`, the existing catch runs fresh analysis. **Old query service, new DB rows:** `latestPayload` throws an explicit error. `symbols.json` and the DFG artifacts are unchanged under H1. H2 would change `symbols.json`. F-001's analyzer fingerprint, once merged, is an additional and independent barrier. |
| CLI, knowledge graph | No `resolutionState` consumers found (grep of `src/`). |

---

## 7. MEASUREMENT — information recovered (estimator)

The instrument is `estimate-candidates.ts`, scratch-only and **not an implementation**. It applies
R1–R4 to every call F-002 leaves `UNRESOLVED`, using the F-002 engine's parser, extractor and
dependency graph. It is simpler than §6:
- scope resolution is name-within-declaring-subtree;
- escape detection covers export, `module.exports` and export symbols only;
- R3 only follows function-literal values;
- callee names it cannot rebuild (computed members, `.call`/`.apply`, bind chains) are left unmatched:
  express 21, fastify 53, self 4.

**Every demoted call was matched and evaluated** (69, 22 and 495).

| Metric | express | fastify | self |
|---|---|---|---|
| F-002-demoted calls | 69 | 22 | 495 |
| → `CANDIDATES` | **69 (100%)** | **10 (45%)** | **495 (100%)** |
| → still `UNRESOLVED` | 0 | 12 (parameter receiver; the baseline targets were false, §2.2) | 0 |
| Baseline target in the candidate set | 69/69 | 10/10 | 495/495 |
| Singleton sets | 69 | 10 | 495 (H1) / 494 (H2: one pair) |
| Mean set precision 1/\|T\| | 1.00 | 1.00 | 1.00 (H1) / 0.999 (H2) |
| `openWorld = false` | 0 | 0 | 131 (`FlowState` 128, `benchmarks/sample.ts` 2, `streaming-json-writer.ts` 1) |
| Open-world reasons (sites) | caller-chosen-receiver 72 | caller-chosen-receiver 10, exported-class 2 | exported-class 365, property-write 16, prototype-access 4, unknown-write-value 3, method-value-read 2 |
| New `CANDIDATES` beyond the demoted calls | 3 (`this.enabled`, the context clobbering in §6.2) | 2 (R1, exported classes) | 4 |
| Total `CANDIDATES` / evaluated `UNRESOLVED` | 72 / 8,132 | 12 / 28,567 | 499 / 18,658 |
| Dead code: symbols newly reported by F-002 → cleared by D1 | 19 → 19 | 9 → 8 | 15 → 15 |

The remaining fastify dead-code report is the `reply.send = () => {…}` override, whose only baseline
"reference" was the false name match. The 3 self R3 sets contain the initial arrow and carry
`unknown-write-value`. The real target, the Promise resolver, is outside the analyzed code. This is
exactly the case open-world exists for.

**What this does and does not show.**
- The candidate sets are as tight as the old guesses: almost all are singletons and they contain the
  old target.
- No false targets come back: the 12 spurious fastify matches stay `UNRESOLVED`.
- The express targets are structurally consistent (same container), not runtime-verified.
- Production overhead was **NOT_RUN**. The estimator's runtime is not a proxy for it.

---

## 8. NON_GOALS

- DFG or taint propagation through candidates. A future design could add may-call flows with
  `EvidenceState: "INFERRED"`.
- Promoting closed-world singletons (P1; Q3).
- H2 cross-file hierarchy (follow-up).
- Points-to and alias analysis.
- Mixin modelling (`mixin(app, proto)`, `Object.assign`, `util.inherits`).
- `super.m()`: `memberName` returns `undefined` for `Super`, so no call is recorded today.
- `ClassExpression` class symbols (extractor gap A5): `this.m()` inside them stays `UNRESOLVED`.
- Changing F-002 proof rules or its assumption set A0.
- A candidate-count cap. No truncation; the cost is bounded by class and write counts. Measured
  maximum set size is 2.

---

## 9. RISKS

1. **Consumers reading `CANDIDATES` as proof**, including Jev/LLM summaries. Mitigations: the state
   name, `openWorld`, the type-level `ProvenCallTarget` barrier, the I1 test, and exact fidelity states.
2. **A false `openWorld = false` from a bug in the syntactic checks.** Mitigations: default `true`;
   every unevaluable check adds a reason; red-team the F-002 counterexamples as completeness probes (§10).
3. **The inherited A0 assumptions are visible in express.** For example, `app[method] = function` is a
   computed write. A0 already bounds F-002's proofs, so this design inherits it and does not widen it.
4. **Weak R2 evidence.** It is labelled `caller-chosen-receiver` and never closed-world.
5. **Snapshot reuse on `main` without F-001.** The marker in §6.7 handles it. Until it lands, F-002 alone
   leaves pre-F-002 snapshots reusable (A1).
6. **Estimator limits** (§7). The numbers outside the demoted population are lower bounds.

**Adjacent findings** — recorded, not fixed, not required by this design:
- **A1.** F-002 does not version the semantic payload, so pre-F-002 snapshots carrying unsound
  `RESOLVED` stay reusable on `main` until F-001 or the §6.7 marker lands.
- **A2.** `ProvenCallTarget` filtering compares canonical paths in `command-handler.ts` but raw paths in
  `flow-analysis-engine.ts`.
- **A3.** `ResolutionContext.containerName` is overwritten by nested member assignments (§6.2).
- **A4.** 15 of the 586 F-002 demotions were false baseline targets (§2.2). "Lost 69/495" overstates
  the true information lost, except on express.
- **A5.** `ClassExpression` produces no class symbol.

---

## 10. TEST_MODEL (oracles)

Unit tests go in `tests/unit/semantic/`, in the style of `call-resolution-soundness.test.ts`.

Each F-002 counterexample there gains an exact `CANDIDATES` assertion **and** keeps
`not.toBe("RESOLVED")`. That makes the assertion more specific, not weaker. The change from
`UNRESOLVED` is EXPECTED_CHANGE, justified by this contract.

| # | Case | Expected (oracle derived from the concrete runtime counterexample) |
|---|---|---|
| T1 | Differential over every fixture plus the 3 corpora | `RESOLVED` id→target map identical to F-002 (I2). |
| T2a | `let x = new A(); if (…) x = new B(); x.m()` | `{A.m, B.m}`, closed, `receiver-writes`. |
| T2b | Captured receiver rebound after the closure is defined | `{A.m, B.m}`, closed. |
| T2c | `function f(){}; function g(){}; f = g; f()` | `{f, g}`, closed, `binding-writes`. |
| T2d | `for (x of [new B()])` overwriting `new A()` | `{A.m}`, open (`unknown-write-value`). B.m is reachable at runtime but outside the set, so `openWorld` must be `true`. |
| T2e | Base `run(){ this.m() }`, non-exported `Derived extends Base` overriding `m` | `{Base.m, Derived.m}`, closed. |
| T2f | Object container borrowed (`other.init()` with `this === other`) | `{app.helper}`, open (`caller-chosen-receiver`). The runtime target `other.helper` is not in the set, so `openWorld` must be `true`. |
| T2g | Prototype replaced / instance property shadow / method redefined | Reasons `prototype-access` / the arrow is included via the `this.m =` write / both definitions included. |
| T2h | Required binding reassigned | Import target in the set, open. |
| T3 | Parameter receiver `reply.send()` with an unrelated `reply.send = …` elsewhere | `UNRESOLVED` (fastify regression). |
| T3b | Same method name on an unrelated class | Never in the set. |
| T3c | `this.m()` in a `FunctionDeclaration` or top-level arrow | `UNRESOLVED`. |
| T4 | Exported class; `extends` from an import/external; non-exported closed hierarchy | `exported-class`; `unresolved-superclass`; `openWorld = false`. |
| T5 | `static s(){ this.t() }` with instance and static `t` | Only the static `t`. Instance `this.u()` where `u` is static-only → `UNRESOLVED`. |
| T6 | Inherited method in the same file | `{A.m}` for `this.m()` in `B extends A`. |
| T7 | `this.#p()` | Still `RESOLVED` (unchanged). |
| T8 | Schema | Rejects `RESOLVED` + candidates, `CANDIDATES` with no ids / with `targetSymbolId` / unsorted / duplicate ids / `openWorld` disagreeing with reasons, and `UNRESOLVED` + candidates. Historical two-state records parse. |
| T9 | Determinism | Two runs and reversed input order give a byte-identical semantic payload. |
| T10 | I1 at both sites | A closed singleton `CANDIDATES` call yields no `ProvenCallTarget`, `callBindings`, interproceduralFlows or taint path, via both the command-handler integration and `DeterministicFlowAnalysisEngine.analyze`. |
| T11 | Dead code (D1) | A method referenced only through candidates is not reported; an unreferenced one still is; the T3 override still is. |
| T12 | Snapshots | A snapshot with the marker round-trips candidate fields. One without it is not reused. Historical records stay readable through `DiscoveryQueryService`. A two-state enum rejects `CANDIDATES`. |
| T13 | Fidelity matcher | `CANDIDATES`↔`CANDIDATES` matches; `UNRESOLVED`↔`CANDIDATES` does not; `openWorld` compared when given; actionability. |
| T14 | `phase-2.9-golden` `this.handle` (exported `Service`) | `CANDIDATES` containing `Service.handle`, open (`exported-class`). |
| T15 | Benchmark (performance role) | analyze-time comparison against F-002 on express and fastify, and the corpus counts of §7 as the reference (reported, not gated, unless a human sets a gate). |

The existing tests to re-examine are F-002's edited set: `call-resolution-soundness`,
`this-method-resolution-integrity`, `receiver-resolution-integrity`, `semantic-engine`,
`computed-member-call-graph`, `dynamic-call-resolution`, `call-graph-bind`, and `phase-2.9-golden`.
For each `UNRESOLVED` assertion:
- if value evidence exists, it becomes an exact `CANDIDATES` assertion;
- otherwise it stays `UNRESOLVED`.

Removing a test requires human authorization.

---

## 11. IMPLEMENTATION_READINESS

**READY_FOR_SCOPED_IMPLEMENTATION**, given the preconditions and decisions below.

**Preconditions**
- F-002 is merged. This design builds on its `BindingWrites` and `provenReceiverClass`.
- Re-baseline on the merged SHA and re-run the §7 probes.

**Human decisions needed**
- **Q1.** Contract C1 with flat fields as specified. Recommended.
- **Q2.** H1 now, H2 as a separately scoped follow-up. Recommended.
- **Q3.** P0: never promote closed-world singletons. Recommended. P1 would make 131 self sites
  `RESOLVED` under closed-world assumptions.
- **Q4.** D1: candidates count as references in dead-code detection. Recommended.

**Proposed allowlist for increment 1**
- `src/semantic/semantic-contracts.ts`
- `src/semantic/call-graph-builder.ts`
- `src/semantic/semantic-engine.ts`
- `src/contracts/discovery-storage.ts`
- `src/core/orchestration/command-handler.ts` (marker and reuse check only)
- `src/flow/flow-contracts.ts` (doc comment only)
- `src/contracts/fidelity.ts`
- `src/governance/fidelity/fidelity-matcher.ts`
- `benchmarks/fidelity/express-ground-truth.ts` (5 facts)
- the tests listed in §10

Optional: `src/flow/flow-analysis-engine.ts`, for the shared helper. ADR home if accepted:
`docs/adr/ADR-008-call-resolution-candidates.md` (requires a docs authorization).

**Gates:** typecheck, focused tests, full suite, T1 differential, T15, and an independent red team.
The red team should use the T2 completeness probes, plus any new counterexample to an
`openWorld = false` claim.

---

## Compact handoff

- **TASK_ID:** F-002-followup / CANDIDATES design
- **BASELINE_SHA:** `af48a64b58046f61adf97531937f2fe60c3d7d93` (`main` = `origin/main`, local refs).
  Candidate: F-002, uncommitted; diff hash `1067af58…96a4`.
- **BRANCH / WORKTREE:** design session `claude/hungry-mcclintock-8c0a36` (no changes);
  F-002 `fix/f002-call-resolution-soundness` @ `LegacyExodus-f002-call-resolution`.
- **SCOPE:** design only.
- **FILES_CHANGED:** none in any repository. Artifacts in the shared notes folder: this report and
  `candidates-design-probe/`. sha256:
  - `dump-calls.ts` `da41bd37…fc24`
  - `diff-calls.ts` `0ac13bbab…a897`
  - `estimate-candidates.ts` `a8564a39…d5553`
  - `dead-delta.ts` `f1d3297e…24cc`
  - `gt-impact.ts` `1c4737bb…2284`
  - `estimate-summary.json` `482e031b…df1`

  Usage: `bun dump-calls.ts <engineRoot> <corpus> <out.json>`, then `diff-calls.ts` and
  `estimate-candidates.ts`. `dead-delta.ts` and `gt-impact.ts` read the scratch outputs; edit their
  paths before reuse. Estimator reason names map to §6.1 names as follows:
  - `container-this-untracked` → `caller-chosen-receiver`
  - `untracked-property-write` → `property-write`
  - `container-aliasing-untracked` → `escaping-container`
- **EVIDENCE:** §2 (VERIFIED reproduction 69/22/495), §7 (estimator, PARTIALLY_VERIFIED: approximations
  stated), source citations at `af48a64`; measured 2026-10-21T12:09Z, Bun 1.4.2, Windows 11.
- **TEST_RESULTS:** NOT_APPLICABLE (no candidate code). The probes executed engine library code only;
  no analyzed repository was executed.
- **KNOWN_LIMITATIONS:** estimator simplifications (§7); production overhead NOT_RUN; express
  candidates not runtime-verified; independent design review OUTSTANDING.
- **OPEN_QUESTIONS:** Q1–Q4 (§11); adjacent A1–A5 (§9).
- **VERDICT:** READY_FOR_SCOPED_IMPLEMENTATION (conditional on F-002 merge and Q1–Q4).
- **NEXT_AUTHORIZED_ROLE:** Human (contract and scope decision) → separately authorized implementation.
