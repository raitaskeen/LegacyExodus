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

## Limitations

- Installed `node_modules` versions aren't fingerprinted (only `bun.lock` is), nor are symlinked files under `src`.
- The record is unsigned and covers only `manifest.json`, so other projection files edited by hand would still be reused. That's acceptable for a local test cache.
- After #198 merges, this fingerprint duplicates `src/runtime/analyzer-fingerprint.ts` and should switch to it.

## Follow-ups (not in this PR)

- `benchmarks/fidelity/runner.ts` still labels results FRESH or STALE by comparing against HEAD, so uncommitted edits show as FRESH.
- `acquireRepository` ignores the exit code of `git checkout <revision>` in its clone fallback.

## Review

Reviewed independently by a session other than the one that wrote it: diff read and governance tests and typecheck re-run, no blocking issues found.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
