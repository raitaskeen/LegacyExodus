# Phase C design: following objects (receiver tracking)

Written 2026-11-10 from call-oracle data on main after B1. Plan: `ENGINE-PLAN-TO-88.md`, Phase C.

## What the data says

Exercised calls (ones the tests really make) that the engine leaves `receiver-not-proven`:

| Corpus | Sites | Top patterns (callee → where the run went) |
|---|---|---|
| Express | 1,941 of 2,415 unresolved | `app.use/get/set/enable/render/param` → `lib/application.js` (~900, copied onto `express()`'s result by `merge-descriptors`); `res.send/json/sendFile/render/status/...` → `lib/response.js` (~450, the response prototype); `router.use/handle/get` → `lib/router/index.js` |
| Fastify | 5,254 of 6,480 unresolved | `fastify.inject/get/listen/addHook/ready/post/route` → `fastify.js` (~2,900, methods of the object literal `fastify()` returns); `reply.send/code/header` → `lib/reply.js` (~830, `Reply.prototype`); `req.validateInput` → `lib/request.js` |

Almost every such call is a method on an object built at run time by a factory in the repository.

## Rules, each a separate PR, each checked by the call oracle

**C1. Factory-returned object literals.** Resolve `x.m()` to the function at property `m` of an object literal when all of these hold:
- `x` is a binding written once, from a call RESOLVED to a repository function `F`;
- every return of `F` returns the same local binding `o`, initialised with an object literal, which is never reassigned;
- `o`'s literal defines `m` as a function, method or a binding of one, with no other property named `m` (and no spread before it);
- no file writes a property named `m` by name (the XA-03 rule, run-wide), and `F`'s file has no computed write whose key could be the string `m`. A key that is a `const` bound to `Symbol(...)` is not a string, so it does not count.

**C2. `Object.create(proto)` and prototypes.** `const res = Object.create(P)` (or `Object.setPrototypeOf(o, P)`), with `P` a module-level object whose property `m` is assigned once as a function (`P.m = function …`), resolves `res.m()` to it under the same no-write conditions.

**C3. Copy operations with fixed semantics.** `Object.assign(target, source)` and the package `merge-descriptors` copy own properties. A target's property `m` then comes from `source.m` if no later write replaces it. `merge-descriptors` is a package, so its semantics are a stated model, listed in Current Implementation, and checked by the oracle on Express.

**C4. Callback parameters.** Out of scope for C: `res`, `reply` and `req` arriving as handler parameters are framework semantics (Phase E), modelled per framework.

## Gates for every C PR

- **Call oracle:** 0 contradictions on Express and Fastify, and recall reported (today: Express 28%, Fastify 7%).
- **Fact diff:** 0 lost, with gains listed as upgrades.
- **Ghost:** within budget.
- **Conformance:** a positive case and a control for every condition above.
