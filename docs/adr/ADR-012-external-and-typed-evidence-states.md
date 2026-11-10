# ADR-012: EXTERNAL and RESOLVED-BY-TYPE Call States

## Status
**ACCEPTED** (2026-11-09, owner, with the plan `audits/2026-11-10-blind-audit/ENGINE-PLAN-TO-88.md`). EXTERNAL is
implemented in Phase B; RESOLVED BY TYPE is reserved for Phase D.

## Context
A call had two states: RESOLVED (proven to land on one function in the repository) and UNRESOLVED. Phase A1 recorded why
each UNRESOLVED call is unresolved. On the pinned corpora a large share are calls that provably leave the repository:
into a package or Node module (`fs.readFileSync`, `lodash.map`), or into a JavaScript or Node built-in (`JSON.parse`,
`setTimeout`). Counting them as unknown hides how much of a codebase is actually accounted for, and gives the IR and the
migration no record of the repository's boundary with the outside world.

## Decision
1. **EXTERNAL** is a third state. A call is EXTERNAL when it is proven to call into a package, a Node module or a
   standard built-in, and to stay there as far as the repository can affect it:
   - its callee, or the object it reads the callee from, is an import of a package or Node module, the binding is never
     rebound, and no file in the repository writes that member of that module (`require("fs").readFileSync = …`);
   - or (Phase B, step 2) its root is an unbound standard global that no file writes.

   An EXTERNAL call names where it goes: `external: { module, member }` (for example `{ module: "fs", member:
   "readFileSync" }`). It has no `reason` and no `targetSymbolId`. The engine never reads `node_modules`, so EXTERNAL says
   which package, not which function inside it.
2. **RESOLVED BY TYPE** (Phase D) will mark a call resolved through declared TypeScript or JSDoc types. Types are not proof
   (`any`, casts), so it stays apart from RESOLVED.
3. The manifest schema version rises from 3 to 4, so a reader knows the state set changed.
4. Only RESOLVED calls feed data flow as proven targets (`ProvenCallTarget`); EXTERNAL changes nothing there.
5. The call oracle (Phase A3) also checks EXTERNAL: a call labelled EXTERNAL whose run entered a function of the
   repository is a contradiction.
6. The fact diff counts an UNRESOLVED call that becomes EXTERNAL at the same site as an upgrade, not a loss (owner
   decision, 2026-11-09).

## Consequences
- "Calls accounted for" (RESOLVED plus EXTERNAL) becomes the coverage measure, with UNRESOLVED calls each carrying a reason.
- Calls through a package's own objects (`app.use()` on what `express()` returned) are not EXTERNAL yet: the object's
  origin is not proven. That is Phase C's receiver tracking.
- A repository that patches a package from a file that is not analysed breaks the proof; that is outside what static
  analysis of the repository can see, and is stated as an assumption.
