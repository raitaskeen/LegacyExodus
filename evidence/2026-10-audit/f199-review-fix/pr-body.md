## Summary

The Express/Fastify fidelity tests could score **stale** analysis output. Their helper, `ensureDiscoveryProjections`, had two problems:

1. **Reuse check.** It reused a projection whenever the manifest's engine commit equalled `git rev-parse HEAD`, or any non-empty commit when Git was unavailable. HEAD doesn't change while engine edits are uncommitted, so local changes were tested against output from the old code.
2. **Regeneration.** When it did regenerate, it called the engine without `refresh`. On `main` the engine reuses an existing snapshot of an unchanged repository without checking which analyzer wrote it (F-001, #198). A probe showed a tampered stale artifact surviving that call and disappearing with `refresh: true`. Fixing only the first problem would have certified stale output as current.

Only two test files change; no engine code.

## The fix

- A projection is reused only if the helper generated it and saved a record beside it, `.discovery/fidelity-helper.identity`, holding:
  - a fingerprint of the analyzer source (`src/**` without `.discovery`, plus `package.json`, `bun.lock`, `tsconfig.json` and the Bun version);
  - the SHA-256 of the manifest it produced.
- Git is no longer consulted.
- Regeneration always passes `refresh: true`, and the old record is deleted first, so a failed run can't leave a record pointing at old output. The engine raises an error on every failure path.
- Always regenerating was measured at about 130 s extra per full run; the fingerprint takes about 40 ms.

## Test changes

- **Unchanged:** cases 2 and 4–6.
- **Updated:** cases 1 and 3 still expect reuse, now of a projection with a saved record (3 with Git disabled). Case 7 now expects regeneration, because a matching HEAD alone is no longer enough. A comment above the block explains why.
- **New, cases 8–13:**
  - a matching HEAD alone;
  - an uncommitted source edit;
  - changes to `package.json`, `bun.lock`, `tsconfig.json`, or an added file;
  - a control showing `.discovery` output inside `src` is ignored;
  - a rewritten projection the engine would otherwise reuse;
  - an unreadable analyzer folder (regenerates and saves no record).

No fidelity threshold or ground-truth fact changed.

## Evidence

| Check | Result |
|---|---|
| Old helper | cases 7, 8, 9, 10, 12 and 13 fail at the intended assertions; 1–6 and 11 pass |
| New tests | 30/30 |
| `tests/unit/governance` | 81/81 (re-run independently) |
| `bun run test` | 1620 pass, 1 skip (existing Windows-only skip), 0 fail |
| `bun run typecheck` | clean (re-run independently) |
| `bun run benchmark audit` | 10/10 |
| `bun run verify` | passes |
| CLI `--help` | passes |
| `git diff --check` | clean |
| Three repeat runs | identical results, no needless regeneration |

End to end in a scratch copy: an unchanged `src/` reused the Express projection (4 s); a one-line uncommitted edit made it regenerate (17 s); the next run reused again (1 s).

## Review fix (`51221a3`)

An independent red-team review of `521b86e` showed that the identity was still read too late. In one `bun test` process, earlier test files load the engine about 32 s before the helper module is evaluated. An engine edit in that window was recorded as the identity of output the old code produced, and a later run reused the projection.

- `tests/support/analyzer-identity.ts` fingerprints the analyzer when it loads. `bunfig.toml` preloads it, so it runs before any test file.
- Before writing its record, the helper fingerprints the source again and writes no record if it changed during the run.
- Case 3 now asserts Git is never consulted; its mock no longer reached the helper.
- New case 12b: a missing record forces a fresh run even when the engine itself would reuse its snapshot. Case 12 stops proving that once #198 authenticates snapshots.
- Cases 4–6 get the 30 s limit the other engine-run cases already have.

Evidence: 3 new tests fail on `521b86e` at the intended assertions (preload, load-time capture, mid-run change) and pass now. Full suite 1624 pass, 1 skip, 0 fail; typecheck clean; `benchmark audit` 10/10.

**Merging after #198:** both PRs add a `preload` line to `bunfig.toml`, so the merge combines them into one list.

## Limitations

- Installed `node_modules` versions aren't fingerprinted (only `bun.lock` is), nor are symlinked files under `src`.
- The record is unsigned and covers only `manifest.json`, so other projection files edited by hand would still be reused. That's acceptable for a local test cache.
- After #198 merges, this fingerprint duplicates `src/runtime/analyzer-fingerprint.ts` and should switch to it.

## Follow-ups (not in this PR)

- `benchmarks/fidelity/runner.ts` still labels results FRESH or STALE by comparing against HEAD, so uncommitted edits show as FRESH.
- `acquireRepository` ignores the exit code of `git checkout <revision>` in its clone fallback.

## Review

An earlier session other than the author read the diff and found no blocking issues. A later independent red-team review of `521b86e` failed it for the timing flaw fixed in `51221a3`. That fix needs an independent re-review before merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

