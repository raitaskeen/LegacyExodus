# ADR-008 — Edit-Stable Fact Identity

## Status
**PROPOSED** (design, BA-18; not implemented). Must be implemented before the IR schema is frozen and before incremental runs (S6).

## Context
Every fact id hashes its source position:

- symbols: `sha256(path:kind:name:line:column)` (`javascript-symbol-extractor.ts`, `createSymbol`);
- calls: `sha256(path:caller:callee:line:column)`; identifier references, routes, CFG statements and data-flow definitions, uses and sinks follow the same pattern.

The ids are deterministic, but not stable across revisions. Inserting one line at the top of a file changes the id of every symbol, call and flow below it. The IR phase needs the reverse. Migration units, proof obligations, incremental re-analysis and "what changed between two snapshots" all have to survive unrelated edits.

The ids are also the largest part of the output. Repeated 64-hex ids make up most of the 1.6 GB written for Ghost (see the S4/S5 notes in the remediation queue).

## Decision
Every fact gets two independent parts: an **identity** that does not depend on position, and a **location** that is kept for display and evidence only.

1. **Structural key.** It is a readable string built from the facts that define the construct, never from its position:
   - Symbol: `<path>#<container path>/<name>:<kind>`. The container path is the chain of enclosing named declarations (namespace, class, function), for example `src/a.ts#Users/find:method`.
   - Anonymous construct (arrow function, class expression, callback): `<container path>/<anon kind>@<ordinal>`. The ordinal counts constructs of that kind within the same container in source order. When a binding names the construct (`const f = () => …`), its key is the binding's key.
   - Disambiguator: when two siblings share container, name and kind (overloads, duplicate `var`, reopened namespaces), append `~<n>`, numbered in source order. Unique names, which are almost all of them, carry no suffix.
   - Facts inside a body (call, reference, CFG statement, definition, use, sink): `<enclosing symbol key>/<fact kind>:<subject>@<ordinal>`. The subject is the callee or the binding name. The ordinal counts facts with the same kind and subject within the enclosing symbol. An edit therefore renumbers only facts of that kind and subject inside the one function it touches.
   - Routes: `<path>#route:<METHOD> <full path>~<n>`; module edges: `<from path>-><to path>:<kind>`.

2. **Id = short digest of the key.** `id = base32(sha256(domain ‖ key))[0..20]`, about 100 bits. Each fact kind has its own domain string. The key is stored next to the id in the projection that defines the fact, so it can be read and audited. Other projections refer to the fact by id only. A collision is detected when the symbol table is built and fails the run (`IDENTITY_COLLISION`); it is never resolved silently.

3. **Location stays a field.** `location {start, end}` remains on every fact for display, evidence and source maps. It never feeds an id.

4. **File identity is the repository-relative path.** A rename is a delete plus an add. Linking renames (for example from git rename detection) is a later, separate mapping layer over keys. It does not change the key.

5. **Determinism invariant.** Ordinals and disambiguators are assigned in code-point order of source position within one file, so two runs over the same input produce identical ids. Edits that do not change a construct's container chain, name, kind or same-kind ordinal leave its id unchanged.

## Rollout
1. Add `key` and the new id beside the current fields in the symbol table; build the keys for symbols first. Fact-diff gains an identity check: every symbol keeps its key under an insert-a-line mutation of each corpus file.
2. Switch calls, references, CFG and data-flow facts to keys derived from the enclosing symbol.
3. Switch the ids, in one PR, and bump the projection schema. The fact-diff tool matches old and new facts by structural fields, not by id, so the diff stays reviewable.
4. Drop the position-based ids. Shorter ids are expected to shrink Ghost output by roughly a third; the reduction is measured, not assumed.

## Alternatives Considered
- **Keep position ids and diff by content.** Rejected: every consumer (IR, cache, migration plans) would need its own fuzzy matcher.
- **Content hash of the construct's text.** Rejected: any edit inside a function changes the function's identity, and a moved but unchanged function cannot be told apart from a copy.
- **Full 64-hex digests of keys.** Rejected: collision resistance far beyond need, at twice the size of the dominant output cost.

## Consequences
- **Positive:** IR units, caches (S6) and migration steps can refer to code across revisions. "What changed" becomes a set difference of keys.
- **Positive:** smaller output, since 20-character ids replace 64-character ones.
- **Tradeoff:** renaming a function or moving it to another container changes its identity. That is a real change for migration purposes and is reported as remove plus add.
- **Tradeoff:** a one-time schema bump; old snapshots are refreshed, not reused.

## Related Documentation
- Audit finding BA-18 and the S track in `audits/2026-10-28-blind-audit/REMEDIATION-QUEUE.md` (audit branch).
- [ADR-005 Storage Strategy](ADR-005-storage-strategy.md).
