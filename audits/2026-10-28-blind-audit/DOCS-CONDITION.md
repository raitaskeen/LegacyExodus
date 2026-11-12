# Documentation condition — 2026-10-28

Input for the docs session that follows this audit. Read-only: no document was changed. Implementation
truth is `main` at `c694d64`; claims were checked against that code and against this audit's
reproductions ([`FINDINGS.md`](FINDINGS.md)). The scan script is `evidence/probes/docs-scan.ts`, and its raw
output is in `evidence/logs/docs-scan.txt`.

## Inventory

218 project Markdown files (not counting `legacy-exodus-core/benchmarks/.cache`, which holds third-party
docs cloned by the test suite). **0 broken relative links or anchors.** All 166 link failures the scan found
are inside that cache.

| Area | Files | Empty (0 bytes) | Total lines | Condition |
|---|---|---|---|---|
| repo root (`README`, `ROADMAP`, `CHANGELOG`, …) | 9 | 0 | 855 | Live, but README status table and sync markers are wrong (BA-21, BA-22); ROADMAP counts stale |
| `.agents/` | 14 | 0 | 961 | Current and coherent; the agent operating system |
| `.github/` | 7 | 0 | 499 | Templates current; `copilot-instructions.md` (303 lines, 2026-09-01) is a second, older agent policy with no reference to `.agents/` |
| `docs/` root files | 8 | 0 | 2,695 | Mixed: `CURRENT_IMPLEMENTATION.md` stale; `GLOSSARY.md` 1,812 lines; `DOCUMENTATION_RULES.md` 460 lines; `AI_CONTEXT.md` and `PROJECT_CONTEXT.md` overlap `.agents/context/ENGINE.md` |
| `docs/adr` | 7 | 0 | 274 | Useful; ADR-004 (AI gateway) and ADR-007 (migration pipeline) describe target architecture |
| `docs/api` | 6 | 3 | 225 | Half empty |
| `docs/architecture` | 27 | 5 | 3,520 | Largest live area. Much is target architecture; `failure-recovery.md` (381 lines) describes worker pools, checkpoints and dead-letter queues in the present tense with no status label at all |
| `docs/development` | 19 | 8 | 995 | Live core (`cli/commands.md`, `contribution-guide.md`, `local-development.md`, `testing-strategy.md`), updated for F-010; 8 empty |
| `docs/implementation` | 10 | 3 | 531 | Partly current (`storage-layer.md`, `cli-design.md`) |
| `docs/governance` | 2 | 0 | 774 | `AGENT_OPERATING_MODEL.md` and `PERMANENT_CHARTER.md`: superseded by `.agents/` per the kernel; historical |
| `docs/domain` | 17 | 16 | 154 | Only `symbol-model.md` has content |
| `docs/security` | 14 | 13 | 50 | Only `security-principles.md` has content |
| `docs/pipeline` | 13 | 12 | 51 | Only `pipeline-overview.md` has content |
| `docs/integrations` | 12 | 12 | 12 | All empty (AI providers, databases, languages) |
| `docs/product` | 9 | 9 | 9 | All empty (vision, problem statement, competitive positioning, …) |
| `docs/research` | 9 | 9 | 9 | All empty |
| `docs/operations` | 8 | 8 | 8 | All empty |
| `docs/reviews` | 7 | 7 | 7 | All empty |
| `docs/templates` | 6 | 6 | 6 | All empty |
| `docs/decisions` | 5 | 5 | 5 | All empty |
| `docs/guides` | 4 | 4 | 4 | All empty |
| `docs/community` | 3 | 2 | 18 | Mostly empty; duplicates root `CODE_OF_CONDUCT.md` |
| `legacy-exodus-core` (benchmarks docs) | 2 | 0 | 161 | `BENCHMARK_REPORT.md` dated 2026-08-24, predates F-010 |

**122 of the 186 files under `docs/` (66%) are empty placeholders** created on 2026-08-05/06 and never
filled. They make the tree look complete while saying nothing, and they cost navigation time for people
and agents alike.

## Claim problems to fix first

| Document | Claim | Reality | Category |
|---|---|---|---|
| `README.md:15-19` | JS/TS parsing, symbols/relationships, CFG/DFG/taint, knowledge graph all `VERIFIED` | Contradicted by BA-01–07, BA-19 | ARCH_INFLATION |
| `README.md:76-80`, `docs/CURRENT_IMPLEMENTATION.md:5-7` | main at `6f88ec5`, core-foundation at `204f123` are the synchronized truth | main is `c694d64`, 27 commits past core-foundation | STALE_CLAIM |
| `README.md:133-135` | `core-foundation` is implementation integration truth | All October fixes landed on `main` only | STALE_CLAIM / governance |
| `README.md:18` | "conservative taint facts" | Taint both misses most real flows and over-labels some (BA-04–07) | CONTRADICTED |
| `ROADMAP.md:35-36, 44` | "660/660", "800/800 tests", "10/10 governance checks" | 1812 tests; audit is 8/8 since F-010 | STALE_CLAIM (historical rows; label them as such or drop counts) |
| `ROADMAP.md:57` | V1.0 "Unified IR / SSA" as the only IR milestone | No IR readiness track, no prerequisites listed | OMISSION |
| `docs/architecture/failure-recovery.md` | Worker pools, checkpoints, dead-letter queues | None exists | ARCH_INFLATION (no label) |
| `.github/copilot-instructions.md` | Full reviewer persona and policy | Competes with `.agents/` kernel | DUPLICATION |
| `docs/AI_CONTEXT.md`, `docs/PROJECT_CONTEXT.md` | Project context for agents | Overlaps `.agents/context/ENGINE.md` | DUPLICATION |
| `legacy-exodus-core/benchmarks/BENCHMARK_REPORT.md` | Benchmark results | Predates F-010's audit contract | STALE_CLAIM |

## Recommended shape for the docs session

These are proposals for the human to decide; the docs writer needs an explicit allowlist (kernel rule).

1. **Delete the 122 empty files.** Keep one `ROADMAP.md` entry or GitHub issue per topic that still
   needs writing. An empty file is not a plan.
2. **Archive, don't delete, historical governance**: move `docs/governance/*` to `docs/archive/` with a
   one-line header pointing to `.agents/`. Fold `copilot-instructions.md` into a 20-line pointer to
   `.agents/` so there is one agent policy.
3. **One current-state page.** `docs/CURRENT_IMPLEMENTATION.md` becomes the single capability table,
   using the ENGINE.md states (IMPLEMENTED / PARTIAL / …) and citing tests or benchmarks for every
   VERIFIED cell. The README links to it instead of repeating it. Remove hand-written SHA markers; if a
   marker is wanted, generate it in CI.
4. **Diátaxis layout** (the kernel already references Diátaxis):
   - *Tutorials*: first analysis of a sample repo.
   - *How-to*: CLI tasks, SQLite storage, CI usage.
   - *Reference*: CLI, `.discovery` artifact schemas, truth labels, configuration.
   - *Explanation*: architecture as built, the target architecture clearly fenced, and ADRs.
5. **Fence target architecture.** Every page under `docs/architecture` either describes current code,
   or starts with a `TARGET ARCHITECTURE` banner and lives under `docs/architecture/target/`.
6. **Artifact reference is missing and matters most**: there is no schema reference for `.discovery/*.json`,
   which is the product's actual output. Generate it from the zod contracts.
7. **Trim `GLOSSARY.md`** (1,812 lines) to terms the code or current docs use.
8. **Rewrite `ROADMAP.md`** around the IR readiness program in [`ENGINE-ASSESSMENT.md`](ENGINE-ASSESSMENT.md),
   with completed history moved to `CHANGELOG.md`.
