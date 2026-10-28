# October 2026 audit remediation: evidence and handoff

This branch preserves raw evidence and handoff notes from the audit remediation work, so nothing depends on one machine. It is not meant to be merged into `main`.

## State of each finding (2026-10-28)

| Finding | PR | Head | State |
|---|---|---|---|
| F-001 snapshot reuse trust | #198 | merged `f43fe7f` | **Merged** 2026-10-27 after independent re-review PASS (basic depth). |
| Fidelity helper identity | #199 | merged `35312b9` | **Merged** 2026-10-27 after independent re-review PASS (basic depth). |
| F-002 call resolution | #200 | merged `fcb3797` | **Merged** 2026-10-27 after independent re-review PASS (basic depth). |
| F-003 CFG loop headers + dominators | #201 | merged `7b6f1b3` | **Merged** 2026-10-28 after independent review PASS on `7153b83` (`review-201.md`). |
| F-010 benchmark audit gate | #202 | merged `c694d64` | **Merged** 2026-10-28 after independent review PASS on `12a2d13` (`review-202.md`), plus a docs commit `13fe46f` replacing the "10/10" claims. The docs commit was written by the reviewer and has not been independently reviewed. |
| F-004 DFG loops/switch/try | none | none | Design stage. Reproduced: 23 of 27 programs miss a real taint flow on `af48a64` (`f004-design/`). The user approved option B (structured joins in `data-flow-builder.ts`), which is not yet implemented. |

#198, #200, #199, #201 and #202 are merged into `main` (head `c694d64`), in that order. Each was updated onto the latest `main` and passed the required CI before merging. F-004 is the remaining finding.

Adjacent findings recorded by the #201 and #202 reviews, none fixed yet:

- CFG: dead tails after `break`/`return` still emit `loop-back`, giving spurious loops (A2). Labelled loops get no clause exception edges (A3). Copied `finally` blocks repeat statement ids within one graph.
- Audit: check 1 misses `src` imports of `benchmarks/` deeper than `../../`, single-quoted, `require` or dynamic (A5). Check 2 passes on any `.cache` substring, and check 3 accepts any non-empty revision (A6).

## Layout

- `session-notes/`: the shared notes folder of the remediation sessions.
  - Red-team reports: `review-198-199.md` and `review-200.md`, with the probe harness and programs in `review-200-evidence/`. Second-round re-reviews: `review-198-199-r2.md`, `review-200-r2.md`.
  - `review-201.md` (F-003), with its oracle probes (`probes/probe.ts`, `probes/perf.ts`) and verify logs in `review-201-evidence/`.
  - `review-202.md` (F-010), with its verify logs in `review-202-evidence/`.
  - Writer handoffs and evidence for F-003 and F-010: `f003-*`, `f010-*`.
  - The fidelity helper handoff.
  - The CANDIDATES call-resolution design.
- `f001-review-fix/`, `f199-review-fix/`, `f002-review-fix/`: RED and GREEN logs, commit messages and PR descriptions for the review fixes.
  - `f002-review-fix/*-diff.txt` lists every resolved call lost or gained on express, fastify and core against `efe425a`.
- `f002-earlier/`: logs and PR texts from the earlier F-002 and F-001 rounds.
- `probes/`: differential probe programs and tools used for F-002.
- `f004-design/`: the F-004 reproduction (`cases.ts`, `probe-dfg.ts`, results on `af48a64`).

Paths inside the logs refer to the original machine's temp folders. The #201 and #202 review logs were renamed from `.log` to `.txt` because the repository ignores `*.log`; they refer to `C:\Projects\.f003-review` and `C:\Projects\.f010-review` on the new machine. `review-201-evidence/logs/merged-{test,audit,typecheck}.txt` come from a `git archive` copy with no `.git`: its 6 test failures and audit 8/10 are environment-only (`git rev-parse HEAD`), and the verdict rests on the `wt-*-verify.txt` worktree runs. Raw logs keep their original trailing whitespace.
