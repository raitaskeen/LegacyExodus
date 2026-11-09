# Contributing to LegacyExodus

Thank you for contributing to LegacyExodus! To ensure deterministic reliability, architectural integrity, and professional release hygiene, please follow these guidelines.

---

## 1. Branch Taxonomy & Responsibility

`main` is the single implementation, documentation and release truth. `core-foundation` and `docs-foundation` are retired as integration branches (2026-10-28). Every change reaches `main` through a pull request; do **not** commit directly to `main`.

Work on a temporary task branch such as `fix/<finding>`, `docs/<topic>`, or `chore/<topic>`. Do not create additional permanent branches, force-push shared branches, or mix documentation reconciliation with core implementation changes.

---

## 2. Engineering Standard: One Finding, One PR

We adhere to a strict scoped engineering standard:
* **One Finding → One Fix → One Focused Regression Test → One PR.**
* Avoid combining multiple unrelated audit findings or refactors into a single PR.
* Every bug fix or security patch must include a dedicated regression test proving the invariant permanently.

---

## 3. Commit Discipline & Co-Authorship

Every commit must follow Conventional Commits:
```text
<type>(<scope>): <summary>

Co-authored-by: rsexo <raitaskeen.dev@gmail.com>
Co-authored-by: pamexo <raimrazzaq12@gmail.com>
Co-authored-by: shahzaib-h-dev <shahzaibdiraj480@gmail.com>
```

Types: `fix`, `feat`, `test`, `docs`, `perf`, `refactor`, `chore`.

---

## 4. Local Development & Verification Gates

All contributions must pass the complete core verification suite before opening a PR:

```bash
# In legacy-exodus-core/
bun install --frozen-lockfile
bun run typecheck        # Zero TypeScript compilation errors
bun test                 # Full test suite execution
bun run benchmark audit  # governance self-audit; non-zero exit unless every check passes
bun run src/cli/index.ts --help
git diff --check         # Zero whitespace or merge conflict artifacts
```

Run the smallest relevant focused test before the full suite. Do not weaken tests, strict compiler settings, benchmark limits, or validation contracts to obtain a passing result.

---

## 5. Pull Request Submission

1. Use the provided [PR Template](.github/pull_request_template.md).
2. Fill out all sections: Summary, Scope, Implementation, Tests, Benchmark Impact, Security Impact, Documentation Impact, and Checklist.
3. Link the corresponding GitHub issue (e.g. `Closes #123`).
4. State `Documentation impact: REQUIRED` with affected files, or `Documentation impact: NONE — <reason>`.
5. Confirm `package.json` and `bun.lock` remained unchanged unless dependency work was explicitly authorized.
