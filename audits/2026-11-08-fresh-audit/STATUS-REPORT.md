# LegacyExodus status report, 8 November 2026

Checked live on 8 Nov 2026 against `origin/main` at `b29d8ac` (#258). Sources: draft PR #203 and its
reports (on `origin/audit/2026-10-28-blind-audit`, last commit `3f2fec6`, 4 Nov), the remediation
queue, `git log`, GitHub (`gh`), `benchmarks/corpus/scale/ghost.json`, and the local Claude Code
transcripts. Nothing was changed in the repo or on GitHub.

## 1. The draft PR (#203)

- **State:** draft, open since 28 Oct, marked "not for merge". It has 36 commits, no reviews and no comments.
- **What it holds:** README, FINDINGS (485 lines, 28 findings, each with a reproduction), ENGINE-ASSESSMENT
  (scorecard, 13 IR readiness gates), DOCS-CONDITION, WAVE3-DFG-DESIGN, REMEDIATION-QUEUE (the work log
  every session has resumed from), and `evidence/` (probes, logs, sample outputs).
- **Audit baseline:** `main` at `c694d64`. Then: 1,812 tests / 152 files green, benchmark audit 8/8.
- **Verdict then:** engine **50/100** (foundation about 7.4/10, semantic content about 3.7/10). Not ready to
  implement the IR: 9 of 13 gates failed, 1 was partial.
- **Findings by severity:** 0 P0, 9 P1, 15 P2, 4 P3.
- **Problem:** the README and CURRENT_IMPLEMENTATION point readers to this draft PR for the BA ids. The audit
  record lives only on an unmerged branch.

## 2. All 28 findings and what happened to each

| ID | Sev | Finding (short) | Fixed by |
|---|---|---|---|
| BA-01 | P1 | Valid `.ts`/`.d.ts` failed to parse (JSX on for every file) | #210 |
| BA-02 | P1 | TS enums, namespaces, interfaces and type aliases not modelled | #214 |
| BA-03 | P1 | TS `./x.js` imports and commented tsconfig aliases never resolved | #213 |
| BA-04 | P1 | `res.send(req.body)` gave no taint flow | #221 (within a file), #222 (across files) |
| BA-05 | P1 | F-004: no joins for loops, switch, try or short-circuit (23 of 27 flows missed) | #220–#221 (data flow rebuilt on the CFG) |
| BA-06 | P1 | Conditional values labelled CONFIRMED; a branch condition became a source | #221 |
| BA-07 | P1 | Hard-coded, name-based taint policy (7 of 9 flows missed) | #228, then #244 (review found main caught only 1 of 5 real flows) |
| BA-08 | P1 | Express routes CONFIRMED but wrong | #207 (label), #231 (model) |
| BA-09 | P2 | Namespace imports bound to an arbitrary export | #217 |
| BA-10 | P2 | Dynamic `import()` and computed `require()` left no reference | #219 |
| BA-11 | P2 | Dead-code and unused-export findings mostly false | #233 (engine `src` 425 → 0) |
| BA-12 | P2 | Compiled CommonJS resolved no calls | #218 |
| BA-13 | P2 | Class expressions lost their class; switch and static-block scopes | #216 |
| BA-14 | P2 | CFG adjacents | #211; later CFG coverage #237, #243, #246 (every CFG RESOLVED) |
| BA-15 | P2 | No ignore policy; framework guessed from folder names | #227; **security follow-up #245**: analyzed repos could run their own git `core.fsmonitor` programs |
| BA-16 | P2 | Output order depended on ICU collation | #205 |
| BA-17 | P2 | Huge output; whole run held in memory | #225, then ADR-009 #251–#257 |
| BA-18 | P2 | Ids hashed `line:column` (not edit-stable) | ADR-008 #229, #238–#250 |
| BA-19 | P2 | Knowledge graph: file/symbol nodes, contains/imports edges only | **Not remediated.** No queue item; `src/knowledge/knowledge-graph.ts` still allows only `file`/`symbol` nodes |
| BA-20 | P2 | Suite green while canonical cases failed; first run cloned GitHub by tag | #204, #206, #208, #209, #212 (conformance ledger, fact-diff CI job, pinned corpora) |
| BA-21 | P1 | README overstated VERIFIED | #207, #215. **Stale again since 29 Oct** (section 5) |
| BA-22 | P2 | Stale sync markers; branch model out of date | #207, #230 |
| BA-23 | P2 | Docs condition (122 empty files) | #230, #234. Left: Diátaxis layout, `.discovery` schema reference |
| BA-24 | P3 | `React` reported unused in classic JSX | #233 |
| BA-25 | P3 | Plugin runtime is a registry with an empty frozen context | **Not remediated.** No queue item; the docs still describe the context as capability-empty |
| BA-26 | P3 | Manifest stored the absolute local path | #232 (HMAC `locationDigest`) |
| BA-27 | P3 | CONFIRMED/INFERRED read a module-global WeakRef map | #221 (per the queue) |
| BA-28 | P2 | Data-flow cost superlinear in file size | #223 (×1.5/×1.7/×2.1 per doubling) |

**Correction to the 4 Nov report.** That report said every audit finding was "fixed or explicitly
closed". In fact **26 of 28 are fixed. BA-19 and BA-25 were never scheduled.** Both are design-level
findings with no conformance case, which is why the empty ledger (`tests/conformance/known-gaps.ts`)
doesn't show them. Neither one blocks the IR gates.

**Smaller follow-ups the queue still lists as open:**
- Parser fallback for unlisted TS extensions (small).
- Fact-diff residual gaps: dominators, lifetimes, unused definitions, first taint hop.
- `.d.ts` implicit exports.
- Surfacing tsconfig diagnostics.
- Namespace calls through aliases.
- `paths` longest-prefix selection.
- Compiled-CJS interop (`__exportStar`, getter re-exports, `__importDefault`).
- Literal `require()` in expression position.
- Long single functions are still quadratic.
- ADR-009 step 4b (taint over summaries), deferred with your OK.
- S6 (incremental runs) and S7 (worker processes).

**IR gates now:** every gate is met except one. Ghost wall time has not been confirmed on a cool machine.
The synthetic 10k-file repo passes the Scale Gate in CI.

## 3. Ghost benchmark history

The corpus is TryGhost/Ghost v6.73.0, pinned by commit `5794cfd` and tree hash. It has about 9,170 files,
of which about 7,170 are analyzed. It is cached at `C:\Projects\LegacyExodus\legacy-exodus-core\benchmarks\.cache\ghost`.

| When | Change | Wall time | Peak memory |
|---|---|---|---|
| 29 Oct (audit era) | first run, before fixes | about 26 min | about 10.2 GB (output 1.6 GB, 18% of calls resolved) |
| 3 Nov, #223/#224 | Wave 3 done, Ghost pinned | 768 s | 11,431 MiB |
| 3 Nov, #225 | BA-17 memory pass | 328 s | 6,166 MiB |
| 3 Nov, #235/#236 | regression found by bisect: path index rebuilt per call | 663 → 215 s | about 7.5 GiB |
| 3 Nov, #238–#250 | stable keys and ids grew the facts held | — | 6.4 → 9.9 GB |
| 3–4 Nov, #253 | ADR-009 step 1 (fact lists on disk) | — | 8,030 MB |
| #254 | step 3a | 211 s | 3,919 MB |
| #255 | step 4a (same-session A/B) | 288 → 241 s | 3,468 → 2,732 MB |
| #256 | step 2 | — | 2,668 → 2,057 MB |
| #257 | step 5 | — | 2,613 → **1,847 MiB** |
| 4 Nov, #258 | arrays frozen only in tests | 374 → **258 s** | unchanged |

- **Budgets** (`ghost.json`): 360 s and 2,560 MiB.
- **Caveats:**
  - Ghost is **not run in CI**. Only the synthetic 10k-file Scale Gate is: 2,800 MiB ceiling, CI measured
    2,212 MiB in 115 s.
  - Times vary 215–544 s on your hot machine, so only same-session A/B comparisons count.
  - Every step had a Ghost fact-diff of 0 lost / 0 gained.
- **Open:** memory still grows linearly with file count (synthetic 10k: 1.67 GB, 20k: 2.97 GB). Bounding it
  for 100k–500k files needs S7 worker processes. You rejected the alternative (batch commits) for trust reasons.

## 4. Repo, GitHub and CI

- `main` has 435 commits (5 Aug – 4 Nov); 416 are yours. No pushes since 4 Nov. Last CI on `main` is green.
- The repo is private, MIT-licensed, homepage legacyexodus.tech.
- **Branch protection (corrected later the same day):** `main` is protected by the ruleset `main-branch-protection`. It requires a PR (0 approvals) and the Verify Core and Windows Path Smoke checks, and blocks force-push and deletion. Only the classic protection API returns 404.
- **Open PRs:** #203 (audit draft) and 6 dependabot PRs from September and October.
- **Open issues:** #111, #112, #117. These look covered by #231, #228 and #226; I haven't confirmed that.
- **Leftovers:** about 75 remote branches, 22 old worktrees in `C:\Projects\.w2`, and 4 untracked report
  files in the main checkout.
- **Copilot review:** has failed on quota since #227. Self-review is the only review.

## 5. Docs drift (to fix next)

- **README.md and docs/CURRENT_IMPLEMENTATION.md** were last updated in #215 (29 Oct).
  - They still list BA-04–07, BA-09, BA-10, BA-12 and BA-13 as open.
  - They don't mention ADR-008 or ADR-009.
  - They link BA ids to draft PR #203.
- **ROADMAP.md** was last updated 3 Sep. It says 800 tests and has no Wave 6–8 plan (IR → JS-to-TS migration → PHP, Java, Ruby).

## 6. Your last Claude Code sessions on this machine

| Session | Dates | What happened |
|---|---|---|
| `e6dc2bfe`, `625cbe97`, `abb6cab3` | 28–29 Oct | The blind audit and the start of remediation, run with subagents |
| `7b381fa2` (the main one, 129 of your messages) | 28 Oct – 7 Nov | All remediation through #258; the 4 Nov full report; competitor research; time-to-product estimate; second-product ideas (Roman Urdu explanation); the quantum-safe reports and the 10-page PDF on 6 Nov |
| `a92a0f4d` (legacyexodus-web) | 29–30 Oct | Fixing the Cloudflare deploy for legacyexodus.tech (build token; the site showed "hello world") |

Your **last request**, on 7 Nov at 16:57 UTC, was "give me a complete report about the first product
of safety net". **It was never answered.** The session hit the weekly limit, which resets on 9 Nov at
8 am Pakistan time.

I can only see Claude Code sessions stored on this PC. Chats on claude.ai, including any on another
account, are not visible to me. The memory export you attached is the only part of those I have.
