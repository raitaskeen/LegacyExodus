## Summary

Snapshot reuse no longer trusts any self-consistent `.discovery` manifest. A snapshot is reused only if it records the canonical absolute project path, is authenticated with a machine-local key kept outside analyzed repositories, and was produced by the running analyzer build. Reuse is now visible in the CLI report.

> **Independent review outstanding.** Per `.agents` governance, remediation acceptance needs an independent red-team pass by a reviewer other than the writer. That has not happened yet; this PR is the reviewable candidate.

## Finding / Objective

**F-001 (HIGH): snapshot reuse trusts artifacts that aren't tied to the engine version and aren't authenticated**, from the 2026-10-21 independent audit of `main@af48a64`. Reproduced on baseline:

- A `.discovery` artifact edited and re-hashed (taint flows removed), with a manifest claiming a forged engine identity, was reused by a default `analyze .`. Stored results had 0 taint flows instead of 1, and the CLI showed no sign of reuse.
- `manifest.engine` was recorded but never compared, so engine fixes were silently skipped for previously analyzed repositories.
- `repository.path` was stored as the CLI argument (for example `.`) and resolved against the current working directory.

## Scope

- **In Scope:** reuse authorization (location, authenticity, analyzer identity); manifest signing at projection time; reuse visibility in engine result and CLI; test isolation for the new key.
- **Out of Scope:** moving snapshots out of the analyzed repository (audit F-020); reporting *why* reuse was refused; other audit findings (F-002 onward); documentation edits (separate docs task, see below).

## What Changed

**Discovery**
- `discovery-manifest.ts` (new): manifest schema (moved unchanged), plus optional `analyzer.fingerprint` and `integrity` fields. HMAC-SHA256 over a canonical, key-sorted encoding of every field except `integrity`, with a domain-separation prefix. Constant-time comparison.
- `snapshot-trust.ts` (new): `SnapshotKeyStore`, a 32-byte key in `LEGACY_EXODUS_HOME` or else `~/.legacy-exodus/snapshot-hmac.key`. The key is published atomically (temp file plus hard link), so concurrent first use converges on one key. A corrupt key is refused and never overwritten. Reads never create a key.
- `discovery-validator.ts`:
  - New `authorizeReuse` mode with statuses `UNAUTHENTICATED` and `ANALYZER_MISMATCH`.
  - The order is canonical location, then MAC, then analyzer fingerprint, so no unauthenticated field explains a rejection.
  - A key stored inside the analyzed project is refused.
  - The base path check now compares canonical paths on both sides (needed for Windows 8.3 short paths).
  - Integrity-only validation is unchanged when `authorizeReuse` is not requested.

**Runtime**
- `analyzer-fingerprint.ts` (new): hash of analyzer `src/**` (excluding `.discovery`, `.git`, `node_modules`), `package.json`, `bun.lock`, `tsconfig.json`, installed versions of runtime dependencies, and the Bun version. Code-unit ordering, cached per process. When it can't be computed, reuse is disabled (fails closed).
- `composition/services.ts`: one trust bundle shared by the projection writer and the validator. New optional `EngineCompositionOptions.analyzerFingerprint` override.

**Storage**
- `file-discovery-projection.ts`: writes the canonical absolute path and the fingerprint, then signs. If a key is unavailable, the key directory is inside the project, or the manifest is outside its contract (for example a non-string `version` in the analyzed `package.json`), the manifest is written unsigned. Signing never fails a committed analysis.

**Core**
- `command-handler.ts` requests `authorizeReuse`.
- The orchestrator accepts an injected validator.
- Results carry `snapshotAnalysisRunId` when reused.

**CLI**
- The `analyze` report adds `reused` and `snapshotAnalysisRunId`.
- Text output adds `Snapshot reused: yes, from analysis run … (pass --refresh for fresh analysis)` **only** when a snapshot was reused. Fresh-run output is byte-identical to before.

## Regression & Test Coverage

New `tests/integration/snapshot-reuse-trust.test.ts`. Each scenario below ran against the unchanged baseline first:

| Scenario | Result on `af48a64` (RED) | Result now |
|---|---|---|
| Control: untouched snapshot, same analyzer and key, reused | pass | pass |
| Artifact edited and re-hashed | reused (`Received: true`) | not reused; taint flow restored |
| Manifest engine identity rewritten | reused | not reused |
| Snapshot signed by another key (foreign `.discovery`) | reused | not reused |
| Different analyzer build; then same build reuses | reused | rejected, then reused |
| cwd-relative path selecting another directory's snapshot | reused | not reused |
| CLI report exposes `reused` and source run ID | field undefined | present |
| Key stored under configured home, never in project | `ENOENT` | 32-byte key outside project |
| Non-string repository version: analysis still publishes, never reused | pass (control) | pass |

The last row also caught a defect in an earlier draft of this candidate, which failed projection with `DISCOVERY_PROJECTION_FAILED_AFTER_COMMIT`. It was fixed before commit.

New `tests/unit/discovery/snapshot-trust.test.ts` (16 tests) covers:
- key store: no creation on read, single key under 8 concurrent creators, corrupt key refused and not overwritten;
- MAC: rejection of six distinct field mutations and a foreign key;
- each validator status, including failing closed when the fingerprint is unavailable;
- fingerprint determinism, sensitivity to source changes, and exclusion of `src/.discovery`.

**Existing tests touched (fixture construction only, no assertion weakened):** `f07-module-snapshot-compatibility` and `SCHEMA-001` tamper a snapshot to exercise schema rejection. Without changes they would still pass, but now because authentication rejects them first. They now re-sign the tampered manifest with the local key, and their integrity pre-check is strengthened to `authorizeReuse: true`. This proves the subsequent rejection still comes from the schema contract.

`bunfig.toml` adds a test preload that points `LEGACY_EXODUS_HOME` at a per-run temp directory, removed in `afterAll`. Verified: with `HOME`/`USERPROFILE` pointed at an empty folder, no `.legacy-exodus` appears there and no temp homes are left behind.

## Benchmark & Performance Impact

All gates were run locally on Windows (Bun 1.4.2) against the committed content:

| Gate | Result |
|---|---|
| `bun run typecheck` | exit 0 |
| `bun run test` | **1639 pass / 1 skip / 0 fail** (1640 tests, 147 files) |
| `bun run benchmark audit` (corpus cache present) | `PASS`, 10/10 |
| `bun run src/cli/index.ts --help` | exit 0 |
| `git diff --check` | clean |
| Semantic non-regression and determinism | express corpus, 3 fresh runs: normalized artifact digests identical to each other **and to baseline `af48a64`** |

- Fingerprint cost: about 14–34 ms, once per process.
- Reuse verification adds one HMAC over the manifest.
- Memory and OOM neutrality were not separately measured.
- Linux and macOS results will come from CI. Locally only Windows was run.

## Security Impact

- Repository content can no longer supply analysis results for reuse. Forging a reusable snapshot now requires the local key.
- **New on-disk secret:** a 32-byte key file, created on first analysis (`0600` and a `0700` directory on POSIX; default ACLs on Windows). Anyone with write access to the user's home directory can still forge snapshots.
- No network access, no new subprocesses, no new dependencies.

## Documentation Impact

- [ ] Documentation updated on `docs-foundation`
- [ ] No documentation changes required

**Impact:** REQUIRED

**Evidence / reason:** The README's "Persisted artifacts are schema- and integrity-validated before reuse" understated the old trust model and should now describe local-key authentication and analyzer binding. Also needed:
- docs for `LEGACY_EXODUS_HOME` and `~/.legacy-exodus/snapshot-hmac.key`;
- the CLI `analyze` output and JSON fields (`reused`, `snapshotAnalysisRunId`);
- a note that existing snapshots are re-analyzed once.

Core remediation does not edit docs per `.agents` governance; this needs a separate docs task.

**Docs synchronized against core-foundation:** N/A (pending)

## Breaking Changes

- [x] None (Backward-compatible)
- [ ] Yes (Explain migration path)

The API is additive (optional constructor and composition parameters, optional result and report fields). Behavior changes:
- Unsigned or old snapshots are re-analyzed once.
- The first analysis creates the key file.

## Related Issue

Refs audit finding F-001 (no tracking issue exists).

## PR Checklist

- [x] Typecheck passes (`bun run typecheck`)
- [x] Full test suite passes (`bun test`)
- [x] Benchmark audit passes (`bun run benchmark audit`)
- [x] Whitespace / Git diff check clean (`git diff --check`)
- [x] Required co-authors included in commit message
- [ ] Targeted branch aligns with responsibility (`core-foundation` for code, `docs-foundation` for docs). Targets `main` because the change builds on R01/R02 (#196, #197), which exist only on `main`; `core-foundation` is behind `main`.
- [x] Current, partial, planned, and target-architecture claims are explicitly distinguished

🤖 Generated with [Claude Code](https://claude.com/claude-code)
