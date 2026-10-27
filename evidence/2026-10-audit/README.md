# October 2026 audit remediation: evidence and handoff

This branch preserves raw evidence and handoff notes from the audit remediation work, so nothing depends on one machine. It is not meant to be merged into `main`.

## State of each finding (2026-10-27)

| Finding | PR | Head | State |
|---|---|---|---|
| F-001 snapshot reuse trust | #198 | `7e72c92` | Review fix pushed for the red-team FAIL on `140ec83`. **Needs independent re-review**, then merges first. |
| Fidelity helper identity | #199 | `51221a3` | Review fix pushed for the red-team FAIL on `521b86e`. **Needs independent re-review**. Merges after #198 and #200. Both #198 and #199 add a `preload` line to `bunfig.toml`; combine them into one list when updating #199 onto `main`. |
| F-002 call resolution | #200 | `ca568f2` | Review fix pushed: all 24 counterexamples from the red team on `efe425a` are closed. **Needs independent re-review**. Merges after #198. |
| F-003 CFG loop headers + dominators | #201 (draft) | `7153b83` | Candidate with the option-A dominator fix. **Needs independent review.** |
| F-010 benchmark audit gate | #202 (draft) | `12a2d13` | Candidate. **Needs independent review**, plus a docs follow-up for the "10/10" claims. |
| F-004 DFG loops/switch/try | none | none | Design stage. Reproduced: 23 of 27 programs miss a real taint flow on `af48a64` (`f004-design/`). The user approved option B (structured joins in `data-flow-builder.ts`), which is not yet implemented. |

Merge order: #198 → #200 → #199. #201 and #202 touch none of their files. Each merge requires an independent red-team PASS on the exact head, per `.agents/`.

## Layout

- `session-notes/`: the shared notes folder of the remediation sessions.
  - Red-team reports: `review-198-199.md` and `review-200.md`, with the probe harness and programs in `review-200-evidence/`.
  - Writer handoffs and evidence for F-003 and F-010: `f003-*`, `f010-*`.
  - The fidelity helper handoff.
  - The CANDIDATES call-resolution design.
- `f001-review-fix/`, `f199-review-fix/`, `f002-review-fix/`: RED and GREEN logs, commit messages and PR descriptions for the review fixes.
  - `f002-review-fix/*-diff.txt` lists every resolved call lost or gained on express, fastify and core against `efe425a`.
- `f002-earlier/`: logs and PR texts from the earlier F-002 and F-001 rounds.
- `probes/`: differential probe programs and tools used for F-002.
- `f004-design/`: the F-004 reproduction (`cases.ts`, `probe-dfg.ts`, results on `af48a64`).

Paths inside the logs refer to the original machine's temp folders.
