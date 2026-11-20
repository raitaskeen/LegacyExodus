# LegacyExodus blind audit — 2026-10-28 (DRAFT)

> **Draft for human review. Not for merge into `main`.** Findings are DISCOVERED, not accepted. Each
> needs a human decision before remediation, and each remediation follows `.agents/` (RED test →
> fix → independent red team → human merge).

| | |
|---|---|
| Baseline | `main` at `c694d6451ebd8457d7c0eb808286cf19d2c665d3` (after #198, #200, #199, #201, #202) |
| Method | Blind: no prior audit report was used. The old report is lost; only F-004's reproduction was reused, as a regression check |
| Mode | Read-only. Nothing under `legacy-exodus-core/` was modified. Execution ran in a detached worktree and scratch copies |
| Environment | Windows 11 Pro, Bun 1.4.4 (repo pins 1.4.2), Git 2.56; one machine |
| Agent rules | `.agents/` kernel, lifecycle, code-audit, docs-audit and performance-audit skills; report contract `templates/REPORTS.md` |

## Verdict

| Question | Answer |
|---|---|
| Overall engine score | **50 / 100**: strong foundation (about 7.4/10), weak semantic content (about 3.7/10). See [ENGINE-ASSESSMENT.md §3](ENGINE-ASSESSMENT.md#3-scorecard) |
| Ready for the IR phase? | **No, not for implementation.** 9 of 13 readiness gates fail and 1 is partial. **Yes, for IR design** (ADR, schema, identity model) in parallel. See [§4](ENGINE-ASSESSMENT.md#4-is-it-ready-for-the-ir-phase) |
| Findings | **28**: 0 × P0, **9 × P1**, 15 × P2, 4 × P3. See [FINDINGS.md](FINDINGS.md) |
| Docs condition | 218 docs, 0 broken links, but **122 of 186 under `docs/` are empty** and the README overstates verification. See [DOCS-CONDITION.md](DOCS-CONDITION.md) |

### The nine P1 findings

1. **BA-01** Valid `.ts` and `.d.ts` files fail to parse. Real zod and commander files are affected.
2. **BA-02** TypeScript enums, namespaces, interfaces and type aliases are not modelled, and namespace members leak as fake module exports.
3. **BA-03** TS ESM `./x.js` imports and commented `tsconfig.json` aliases never resolve.
4. **BA-04** `res.send(req.body)`, the canonical vulnerable shape, produces no taint flow.
5. **BA-05** F-004 is still open: 23 of 27 structured flows (loops, switch, try, short-circuit) are missed.
6. **BA-06** Conditional values are labelled CONFIRMED, and a branch condition is reported as a data source.
7. **BA-07** The taint policy is hard-coded and name-based; 7 of 9 realistic Express handler flows are missed.
8. **BA-08** Express routes labelled CONFIRMED have wrong middleware, handlers and paths, plus fake routes.
9. **BA-21** The README labels parsing, symbols, CFG/DFG/taint and the knowledge graph VERIFIED.

## Real-code measurements

Two `analyze --refresh` runs per corpus; artifacts compared after removing timestamps and run ids.

| Corpus | Files | Analyzed | Parse failures | Time per run | `.discovery` size | Identical runs |
|---|---|---|---|---|---|---|
| Engine `src/` | 142 | 126 | 0 | 8.7–9.7 s | 42 MB | yes |
| Engine `tests/` | 159 | 156 | 0 | 29.6–36.3 s | 73 MB | yes |
| zod | 828 | 812 | 4 (all valid TS; BA-01) | 157–187 s | 275 MB | yes |
| pino | 179 | 151 | 1 (deliberate syntax-error fixture, correct) | 10.7–23.7 s | 31 MB | yes |
| commander | 12 | 7 | 1 (valid `.d.ts`; BA-01) | 1.4–1.9 s | 5 MB | yes |
| @babel/parser | 9 | 3 | 1 (valid `.d.ts`; BA-01) | 9.6–12.3 s | 33 MB | yes |

Single-file scaling (BA-28): a generated file of 1,010 / 2,010 / 4,010 / 8,010 lines takes
1.4 / 4.2 / 32.9 / 114 s (median). The data-flow stage is the superlinear part.

Baseline gates on `c694d64` all pass: typecheck clean, **1812 tests / 152 files**, benchmark audit
**8/8**, `git diff --check` clean (`evidence/logs/baseline-verify.txt`). That suite passes while
BA-01, BA-02 and BA-04 fail on minimal inputs (BA-20).

## What held up

See [ENGINE-ASSESSMENT.md §2](ENGINE-ASSESSMENT.md#2-verified-strengths):
- Deterministic re-runs on six real corpora.
- No fabricated call target in any probe.
- HMAC-signed snapshot reuse.
- A `git.exe` planted in the analyzed repo was not executed.
- Parameterized SQLite.
- Pinned CI.
- A coherent agent operating system.

## Recommended next steps

1. **You decide** which findings to accept and their order. The suggested order is in
   [ENGINE-ASSESSMENT.md §5](ENGINE-ASSESSMENT.md#5-ir-readiness-program-recommended-order): start
   with a canonical-semantics corpus (BA-20), then parser dialects (BA-01), then TypeScript declarations
   and resolution (BA-02/03).
2. **One design decision is needed before F-004**: implement option B in the AST-based DFG, or move
   the DFG onto the CFG (the form the IR will need).
3. **Cheap truth fixes now**: downgrade Express route state and the README status table (BA-08, BA-21).
4. **Docs session**: [DOCS-CONDITION.md](DOCS-CONDITION.md) has the inventory, the claim fixes and a
   proposed structure.
5. **Not done here:** opening issues for findings. That is an external action that needs your approval.

## Contents

| File | Purpose |
|---|---|
| [FINDINGS.md](FINDINGS.md) | All 28 findings with severity, confidence, location, reproduction, root cause, recommendation, verification plan |
| [ENGINE-ASSESSMENT.md](ENGINE-ASSESSMENT.md) | How the engine works, strengths, scorecard, IR readiness gates and program, vision and differentiation, coverage limits |
| [DOCS-CONDITION.md](DOCS-CONDITION.md) | Documentation inventory, claim problems, proposed structure for the docs session |
| `evidence/probes/` | Sample programs (`samples.ts`), runners and inspectors, corpus/perf/stage/docs scripts |
| `evidence/f004/` | F-004 reproduction (from `evidence/2026-10-audit`), re-run here |
| `evidence/cfg/` | CFG oracle probe from the #201 review, re-run here |
| `evidence/samples-output/` | Projected `.discovery` artifacts and CLI output for every sample |
| `evidence/logs/` | Baseline verify, F-004 and CFG re-runs, corpus and perf results, docs scan, security checks |

### Reproducing

From a `c694d64` checkout with dependencies installed, in `legacy-exodus-core`:

- Samples: `bun run <evidence>/probes/run-samples.ts`, then `inspect.ts`. The paths at the top of each
  script point at the auditor's scratch directories (`C:/Projects/.audit/...`); change them for another
  machine.
- Sample `s13` (planted binary) is not in `samples.ts`. It is a copy of a harmless system executable
  named `git.exe`; see `evidence/logs/security-and-collation-checks.txt`.
- F-004: `bun <evidence>/f004/probe-dfg.ts <legacy-exodus-core path>`.
- CFG: run `<evidence>/cfg/cfg-oracle-probe.ts` from the `legacy-exodus-core` directory.
