## Summary

Fixes audit finding **F-002**: the call graph marked calls `RESOLVED` whose runtime target can differ, and `RESOLVED` calls feed the DFG as proven call targets. A call is now `RESOLVED` only when its target is provable.

Five commits:
- `7424525` makes the resolution rules sound for the shapes F-002 named.
- `0c556c8` closes five classes of counterexample found when the first commit was reviewed (see **Review fixes** below).
- `0e13553` matches container methods and receivers by binding instead of by name (see **Binding identity fixes** below).
- `efe425a` requires a container method's definition to take effect before the call can run (see **Definition-before-call fix** below).
- `ca568f2` closes the 24 counterexamples an independent red-team review found in `efe425a` (see **Independent review fixes** below).

> [!IMPORTANT]
> **Merge after #198 (F-001).** Without #198's analyzer fingerprint, `main` keeps reusing snapshots written by the previous analyzer, so the unsound targets this PR removes would survive in existing `.discovery` output. With #198 merged, this PR's change to `src/**` invalidates those snapshots (checked end to end). Both PRs edit `command-handler.ts` in different places; merging #198 and then this PR is conflict-free, and the merged result passes every check (below).

## What now counts as `RESOLVED`

| Call shape | Before | After |
|---|---|---|
| `this.m()` (public) | RESOLVED to the enclosing class's method | **UNRESOLVED**: subclasses, `.call`/`.apply`, borrowed methods, prototype mutation and instance fields can all change the target |
| `this.#m()` (private) | RESOLVED | RESOLVED unless the file writes `this.#m` |
| `x.m()` with `x = new C()` | RESOLVED whenever any `new C()` reached `x` | RESOLVED only if `x` is written once, or every write is in the call's function, none sits in a loop around the call, the latest write before the call always runs and constructs `C`, and nothing writes `x` in between. The nearest declaration of `C` must be that class, never rebound or decorated. Neither `C` nor a base class may return an object from its constructor, and every base class must be declared in the file. `m` must be a method declared in `C`'s body, not a getter, or a field initialized with a function, with no other write of that name |
| `f()`, `require(...)` | RESOLVED even if the binding was reassigned | RESOLVED only if the binding is declared and never reassigned, from any scope |
| Imported `f()`, `ns.f()` | RESOLVED to the export | also requires the exporting module never to reassign it (ES imports are live), and a CommonJS module to assign `module.exports` once |
| `obj.m()` / `x.m()` method dispatch | RESOLVED by name | `m` must be defined on the same binding the call's receiver names (not a same-named parameter, block local or catch parameter) and never be written elsewhere in the file: `.m =`, `["m"] =`, `delete`, `Object.assign`/`defineProperty`/`setPrototypeOf`, `Reflect` writers. A write with a dynamic key blocks public-method dispatch in that file |
| `app.init()` with `app.init = f` | RESOLVED wherever the call is | also requires that the call cannot run before the definition: `app` starts as a fresh object literal or function without `init`, the definition always runs earlier in the call's function, or the call is inside `f` itself |
| `C.s()` on a class | RESOLVED to any member named `s` | only a static method or static function field declared in `C`'s body |
| `f.call(…)`, `f.apply(…)`, `f.bind(…)(…)` | RESOLVED as `f` | also requires that no write can replace `call`, `apply` or `bind` |
| Receiver or container that is an undeclared global | RESOLVED | UNRESOLVED |

Straight-line code keeps its precision, for example `let s = new S(); s.start(); s = other();` still resolves `s.start()`.

## Evidence

- **Regression suite:** `tests/unit/semantic/call-resolution-soundness.test.ts`, 127 tests.
  - 7424525: on `af48a64`, 17 fail exactly as F-002 predicts.
  - 0c556c8: on `7424525`, 22 new tests fail. The rest are controls that must stay `RESOLVED`, plus one guard.
  - 0e13553: on `0c556c8`, 11 of the 17 new tests fail: 10 counterexamples and the exported-class `new C()` control. The other 6 are controls.
  - efe425a: on `0e13553`, the 10 new counterexample tests fail; the 4 new controls pass on both.
  - ca568f2: on `efe425a`, the 28 new counterexample tests fail; the 7 new controls pass on both.
- **This branch:** full suite 1741 pass, 1 skip, 0 fail. `call-graph-builder.ts` has 100% line coverage.
- **Merged with #198:** checked on `efe425a`: 1731 pass, 1 skip, 0 fail; typecheck clean; `benchmark audit` 10/10. A snapshot saved by #198 alone is refused and reanalyzed. To be rechecked once #198 lands.
- **Typecheck:** clean. **`benchmark audit`:** 10/10. **CLI `--help`:** passes. **`git diff --check`:** clean.
- **Determinism:** one digest per corpus over 3 runs.
- **Differential probes:** the author's 71 programs, plus the independent reviewer's 36 probe directories, each executed to record which function really runs. On `ca568f2` the reviewer's harness reports no mismatch except one labelling artifact (a `new B()` call on a marker line). The remaining wrong `RESOLVED` results come only from the assumptions listed under **Known limits**.

## Impact on real code (`af48a64` → this branch)

| Corpus | Resolved calls | Taint flows | Possibly-dead symbols |
|---|---|---|---|
| express | 1109 → 1039 | 16 → 16 | 1311 → 1331 |
| fastify | 1361 → 1312 | 0 → 0 | 5107 → 5118 |
| LegacyExodus core | 5746 → 5246 | 0 → 0 | 1605 → 1623 |

The drop is almost entirely public `this.m()` calls. Possibly-dead symbols rise because methods reached only through `this` no longer count as referenced.

Some of the lost resolutions were **wrong** targets in the old code:
- 12 of fastify's first 22 losses: an unrelated `reply.send = …` sharing the name.
- 3 of the core's: a variable later reassigned to a Promise resolver.

## Review fixes (`0c556c8`)

A red-team pass over `7424525` found programs where a call was still `RESOLVED` while another function runs:

1. **Private field reassigned.** `this.#m = …` was recorded without its `#`, so the private check never saw it.
2. **Shadowed class name.** In `function make(C) { new C().m() }`, `C` was matched by name to a visible class instead of to the nearest declaration (the parameter).
3. **Computed and reflective method writes.** `C.prototype["m"] =`, `this["m"] =` in a constructor, dynamic keys, `delete`, `Object.assign`/`defineProperty`/`setPrototypeOf` and `Reflect` writers went uncounted, including an aliased `Object.defineProperty`.
4. **Exports reassigned by their own module.** Live ES bindings, namespace members, re-exports and aliased exports were affected, as were CommonJS modules that assign `module.exports` twice.
5. **Function-valued writes from nested scopes.** For `f = () => …` inside a function, the extractor's symbol for the arrow was taken as a new declaration, hiding the write. This was found while fixing (4). In real code, the CLI shell's `statusColor`, reassigned in five branches, was resolved to the first arrow.

How the fixes work:
- Writes now record `#name`, static computed keys, deletions and statically keyed `Object`/`Reflect` writes.
- A write whose property name is unknown blocks public-method dispatch in its file. Private names stay provable, since computed and reflective writes cannot reach them.
- A first pass over each module records exports whose value can change. The pipeline computes this during symbol extraction, so every importer sees it.

Cost against `7424525`: express −1, fastify −1, core −5 resolved calls; taint unchanged.
- Two of these were wrong targets: core's `statusColor`, and fastify's `logger.child`, whose receiver is a parameter.
- The rest come from writes with dynamic keys, such as array index writes in `control-flow-builder.ts` and `delete users[id]`, which may name any method.

## Binding identity fixes (`0e13553`)

Two lookups matched names where they needed the binding a name refers to:

1. **Container methods matched by name.** `app.init = …` was taken as the target of any `app.init()` in the file, including through a parameter, block local or catch parameter named `app` that holds another object. It also applied when the definition was on a same-named binding elsewhere, and when a parameter shadowed a class whose static method is called. Fastify's `logger.child` has this shape: it is defined on a local null logger and called on a `logger` parameter.
2. **Member symbols taken for declarations.** The symbol table records `o.x = …`, object literal keys, methods and export records under the same scope and name as bindings. A member named `x` inside a function made `x` look declared there, which hid writes to the real `x`: `x.m()` was proven to call `A.m` while `B.m` runs. Export records also made `new C()` and `C.m()` unprovable for `export class C`, a precision loss introduced in `0c556c8`.

The fix:
- A container method now counts only when it was defined on the binding the call's receiver names.
- Binding lookups consider only symbols that declare a binding: imports, classes, functions and declared variables.

Cost against `0c556c8`: express ±0, fastify −5, core ±0 resolved calls; taint unchanged. All five were wrong targets: fastify route handlers' `reply.send(200)` was resolved to a test stub, `reply.send = (err) => …`, defined on another test's local `const reply = {}`.

## Definition-before-call fix (`efe425a`)

`app.init = f` proved `app.init()` wherever the call was. But the call can run while `app` still holds another `init`:
- before the definition;
- on a path that skips it, such as a branch or a setup function not yet called;
- from another function that runs first;
- on an object that came with an `init`: a factory result, a parameter, a literal with a spread or `__proto__`, an inherited `Object.prototype` method, or an inherited class static.

These cases are also on `main`. The call is now `RESOLVED` only when one of these holds:
1. **The container cannot already have the method.** It starts as a fresh object literal (static keys only, no spread or `__proto__`) or a function, and the name is not a standard object or function property. An earlier call then throws instead of running another function.
2. **The definition always runs first.** It is unconditional and earlier in the call's own function.
3. **The call is inside the defined function.** That code exists only once the definition has run, as in express's `route-map` example, where `app.map` calls itself.

Options that used only (1) or only (2) were measured and rejected:
- (1) alone loses factory objects defined and called in the same function.
- (2) alone loses every call from another function, and two of this PR's own controls.

Cost against `0e13553`: no resolved call gained, lost or retargeted in express, fastify or core; output is identical. The only two calls on these corpora that rely on this rule, `app.map` in express's `route-map` example, are kept by cases (2) and (3).

## Independent review fixes (`ca568f2`)

An independent red-team review of `efe425a` ran 24 calls marked `RESOLVED` where another function runs:
- 2 were regressions this PR introduced (a parameter-scope closure, a TypeScript parameter property).
- 2 were holes in `efe425a`'s own rule (`??=`, `||=`).
- 20 already existed on `main`.

Each root cause is fixed in `call-graph-builder.ts`:
1. **`new C()` returning another object.** A constructor, or a base constructor, with `return <value>` makes the instance unprovable. So does a base class the file does not declare.
2. **Class fields.** Fields count as property writes, so a field (own or inherited) hides a method of its name. A field initialized with a function is itself a target when its initializer is the only write.
3. **Replaced `call`/`apply`/`bind`.** `f.call()` is resolved as `f` only while nothing can write those properties.
4. **Members filed under the wrong class.** The symbol table files object-literal and class-expression methods inside a class body under that class. Only methods declared in the class body now count. Getters and setters are not methods, and `C.s()` needs a static member.
5. **Scopes the symbol table does not model.**
   - Lexical declarations in a `switch` case or a static block, and `var` in a function with parameter expressions, block resolution through that name. A write past them may reach any outer binding of the name.
   - Named function and class expressions bind their name in a frame of their own.
   - A class expression is never matched to a same-named class declaration.
6. **Function-local `require`.** An import names a call only where it is the visible binding.
7. **Hoisting.** A hoisted `var` or uninitialized `let`/`const` hides an outer constant from computed keys.
8. **TypeScript write targets.** `as`, `satisfies`, `!`, `<T>` and parenthesized targets, and constructor parameter properties, are recorded as writes.
9. **Decorators.** Decorated methods and classes are never proven.
10. **Logical assignment.** `&&=`, `||=` and `??=` are conditional definitions.

This also removes two former known limits: static and instance members are now distinguished, and getters are no longer taken for methods.

Cost against `efe425a`: express ±0, fastify −21, core ±0 resolved calls; taint unchanged. All 21 fastify losses are `fn.call(this, …)` in files that also write computed keys (`context[kReplySerializerDefault] = …`): a computed key may name `call`. That is sound but coarse, the same as the existing rule for method dispatch.

## Changes to existing tests (please review)

- **Expectations flipped to `UNRESOLVED`**, each with a comment giving a runtime counterexample:
  - SEM-08 scenarios 3–6;
  - the contextual public-`this` case in `receiver-resolution-integrity`;
  - Case A3 in `computed-member-call-graph`;
  - Scenario 5 in `dynamic-call-resolution`;
  - one case in `semantic-engine`;
  - `this.handle` in `phase-2.9-golden` (the class is exported, so importers can subclass it).
- **Switched to private methods** so their original intent still holds: G5 (`#validate`) and the `.bind` test (`#process`). All their original assertions pass.
- **Express ground truth:** `gt-call-app-lazyrouter`, `gt-call-app-default-config`, `gt-call-router-route`, `gt-call-res-set` and `gt-call-res-get` are relabelled `UNRESOLVED`. The file already marks `app.init` `UNRESOLVED` because express mixes `proto` into `app`. These calls run on the same mixed-in object, on the per-instance router function, or on the per-request response prototype. **No threshold changed.**
- **`call-graph-scaling.test.ts`:** passes the new `buildForFile` argument. One expectation is flipped: two imports bound to the same name are no longer resolved to the first one. After `var shared = require("./first.js"); var shared = require("./second.js");`, a later `shared()` runs the second export.
- **Fastify ground truth:** `gt-call-route-addNewRoute` is relabelled `UNRESOLVED`. Every call is `addNewRoute.call(this, …)` in `lib/route.js`, which writes computed keys, so the engine cannot prove `.call` is the builtin. **No threshold changed.**

## Known limits and follow-ups (not in this PR)

- **Assumed not to happen:**
  - property writes from other modules, including copying helpers such as `mixin` or `_.extend`;
  - `Object`/`Reflect` reached through another object (`globalThis.Object`);
  - property assignments that do not store their value (setters, frozen objects, read-only properties);
  - code that adds properties to `Object.prototype` or `Function.prototype`;
  - direct `eval` and `with`;
  - non-strict `arguments` aliasing of parameters;
  - non-strict (Annex B) block function declarations.
- **Computed-key writes block method dispatch and `.call`/`.apply`/`.bind` unwrapping in their file.** That is sound but coarse. A later refinement could exempt keys that cannot name a method, such as Symbols.
- **`CANDIDATES` state:** designed separately. It would keep the possible targets instead of dropping them, recovering the lost calls without feeding them to taint.
- **Fixed separately in #199:** the fidelity tests' helper reused stale projections when engine edits were uncommitted. Until #199 lands, local fidelity runs on this branch need `benchmarks/.cache/*/.discovery` cleared. The numbers above were taken that way.

## Docs impact

**Required:** README statements about call resolution should say that public `this.method()` calls are `UNRESOLVED` and describe the assumptions above. Not changed here, per the remediation rules.

## Review

The fixes in `0c556c8`, `0e13553` and `efe425a` came from red-team passes by the author. An independent red-team review of `efe425a` failed it with the counterexamples fixed in `ca568f2`. An independent re-review of `ca568f2` is required before acceptance.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

