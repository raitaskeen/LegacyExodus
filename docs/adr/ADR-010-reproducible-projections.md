# ADR-010: Byte-Reproducible Projections

## Status
**ACCEPTED** (2026-11-08, owner). Finding NA-06 of the 2026-11-08 fresh audit. Implemented in its own PRs, each with fact-diff 0/0 (only the identity fields move): decisions 1, 3 and 4 in #276, decision 2 (stable project id) in the PR that adds `src/discovery/project-identity.ts`.

## Context
Two `legacy-exodus analyze` runs of the same repository produce different bytes in 7 `.discovery` files, although every fact is the same. The audit showed this by normalising the ids: the facts were then identical across runs, timezones, locales and working directories.

The cause is run identity written into fact artifacts:
- `src/cli/commands/analyze.ts` creates a random `projectId` and command id (`randomUUID()`) for every run;
- `projectId`, `analysisRunId` and `generatedAt` are written into `semantic.json`, `data-flow.json`, `control-flow.json`, `knowledge.json`, `dependency-graph.json` and the manifest;
- the manifest's artifact digests then differ too.

The benchmark harness pins its ids, which is why Ghost's output is byte-identical across days and the CLI's is not.

This blocks three things the product needs:
- customers checking an analysis with a plain `diff` or checksum;
- the planned audit-trail and compliance reports, which must show "same input, same evidence" as identical bytes;
- caching by content (S6), which needs output that is a pure function of its input.

## Decision (proposed)
1. **Run identity lives in `manifest.json` only.**
   - Fact artifacts carry no `projectId`, `analysisRunId` or timestamp, so they are a pure function of the source, the engine and the configuration.
   - The manifest keeps them in its `analysis` block, next to the artifact digests, which are now stable.
2. **A stable `projectId` per repository.**
   - It is read from `.legacy-exodus/config.json` (written by `init`).
   - Without one, it is derived as `HMAC(localKey, canonicalPath)`. That is stable on one machine and puts no path in any artifact (BA-26).
   - Run ids stay random: they name a run, not its content.
3. **Contract version bump** for the projection schemas. Old snapshots are refused as `SCHEMA_MISMATCH` and re-analysed, and now reported (NA-11).
4. **Storage is unchanged.** Records keep `projectId` and `analysisRunId`; they are run-scoped by design.

## Invariants
- Same source, engine fingerprint and configuration give byte-identical fact artifacts. A CI test runs `analyze` twice and compares the bytes.
- No fact is lost or changed: fact-diff 0/0 on every corpus. Only the identity fields move.
- Snapshot trust (HMAC binding to location and key) is unchanged.

## Alternatives considered
- **Deterministic run ids** (a digest of the inputs). This makes repeated runs share an id, which breaks run-scoped storage and the event journal. Rejected.
- **Normalising before diffing.** This leaves the bytes non-reproducible, which is the actual requirement. Rejected.

## Consequences
- Consumers that read `projectId` from a fact artifact must read the manifest instead. Inside the engine that is the reuse path in `command-handler.ts`.
- One more CI check: a two-run byte comparison on the governance fixture.
