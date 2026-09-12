---
name: legacyexodus-git-governance
description: Repository branch rules, commit discipline, synchronization protocols, and clean-tree standards for LegacyExodus.
---

# Skill: LegacyExodus Git Governance

## 1. Purpose
This skill defines the mandatory Git branching policies, commit standards, remote synchronization workflows, and merge safety gates for the LegacyExodus repository. It prevents permanent branch sprawl, accidental force-pushes, and cross-branch state contamination.

## 2. Scope
Applies to all Git operations across all local and remote branches in `LegacyExodus`.

## 3. When to Use
* Creating new branches for engineering tasks, bug fixes, or documentation work.
* Staging, formatting, and committing code changes.
* Synchronizing local branches with remotes (`origin`).
* Preparing pull requests and auditing branch cleanliness.
* Verifying post-merge synchronization.

## 4. When NOT to Use
* Writing implementation code (use `legacyexodus-forensic-remediation`).
* Auditing code quality (use `legacyexodus-code-audit`).

## 5. Authoritative Branch Architecture
LegacyExodus maintains exactly **three permanent engineering branches**:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                      PERMANENT BRANCH ARCHITECTURE                      │
├──────────────────┬──────────────────────────────────────────────────────┤
│ Branch           │ Responsibility & Scope                               │
├──────────────────┼──────────────────────────────────────────────────────┤
│ main             │ Canonical integration & release trunk. Authoritative.│
│ core-foundation  │ Implementation engineering trunk (legacy-exodus-core)│
│ docs-foundation  │ Architecture documentation & specification trunk     │
└──────────────────┴──────────────────────────────────────────────────────┘
```

### Temporary Task Branches
* All work MUST occur on temporary task branches.
* Standard prefixes:
  * `fix/<finding-id>`: Forensic bug remediations.
  * `feat/<feature-name>`: Verified new feature additions.
  * `chore/<maintenance-topic>`: Dependency, toolchain, or pipeline updates.
  * `docs/<documentation-topic>`: Documentation synchronization based on verified core truth.
  * `audit/<topic>`: Read-only investigative snapshots.
* **Deletion Invariant:** Temporary task branches MUST be deleted locally and remotely upon successful merge to prevent repository clutter.
* **Anti-Sprawl Invariant:** Contributors MUST NOT create permanent branches named `skills`, `skill.md`, `agent-governance`, or any variation thereof.

---

## 6. Operating Procedure

### Step 1: Pre-Flight Remote Synchronization & Clean Worktree Precondition
Before starting any new work or creating a branch:
```bash
git fetch --all --prune
git status
```
* **Clean Worktree Precondition:** `git status` MUST report `nothing to commit, working tree clean`. Any unexpected staged, unstaged, or untracked files MUST stop the task immediately. Do not proceed until the workspace is pristine.

### Step 2: Branch Creation from Remote Authoritative Base
Always branch from the fetched remote-tracking authoritative base branch (`origin/<base-branch>`):
```bash
git checkout -b <type>/<task-name> origin/<base-branch>
git rev-parse HEAD
```

**Authoritative Base Branch Mappings:**
* **Core Implementation Work (`legacy-exodus-core/`):** `<base-branch>` = `core-foundation` (`origin/core-foundation`)
* **Documentation Work (`docs/`, architecture, ADRs):** `<base-branch>` = `docs-foundation` (`origin/docs-foundation`)
* **Repository-Wide / Main Integration Work:** `<base-branch>` = `main` (`origin/main`) ONLY when genuinely appropriate (e.g., top-level repository governance foundation, release coordination).

### Step 3: Staging & Hygiene Audit
Before staging and committing:
1. Check modified files: `git status`. Verify only intended files are changed.
2. Check diff contents: `git diff`.
3. Verify diff hygiene:
   ```bash
   git diff --check
   ```
4. Stage strictly the intended files:
   ```bash
   git add <target-file-1> <target-file-2>
   ```

### Step 4: Conventional Commit Discipline
Commits MUST follow the Conventional Commits specification:
```text
<type>(<scope>): <concise imperative summary>

- Detailed bullet point 1
- Detailed bullet point 2

Co-authored-by: rsexo <raitaskeen.dev@gmail.com>
Co-authored-by: pamexo <raimrazzaq12@gmail.com>
```
* **Types:** `fix`, `feat`, `chore`, `docs`, `perf`, `test`, `refactor`.
* **Scopes:** `discovery`, `parser`, `symbols`, `graph`, `semantic`, `flow`, `storage`, `runtime`, `cli`, `governance`, `toolchain`.

### Step 5: Push Verification & Clean Worktree Postcondition
Push only when the user or task explicitly authorizes it, and only to the dedicated temporary task branch on origin:
```bash
git push origin <type>/<task-name>
```
* **Clean Worktree Postcondition:** Confirm immediately after pushing that `git status` reports:
  ```text
  nothing to commit, working tree clean
  ```
* If pushing is not authorized, stop after the local commit and report `PUSH: NOT AUTHORIZED`. Never infer permission to publish changes.

### Documentation Impact Gate
Every core change must answer: `Does this change alter documented product truth?`

* If **yes**, identify the affected README/docs and synchronize them from a temporary `docs/*` branch based on the latest `origin/docs-foundation`, using the verified `origin/core-foundation` SHA as evidence.
* If **no**, report `Documentation impact: NONE` with a concrete reason.
* Documentation must follow current source, tests, and verified runtime behavior. Never change production behavior merely to satisfy prose.
* Keep engine and documentation changes in separate logical commits and branch responsibilities.

### Step 6: Review Follow-Up Discipline
When addressing external review comments (e.g., CodeRabbit) on an already-verified task:
```text
validate review comment
        ↓
minimal change
        ↓
focused regression
        ↓
required global verification
        ↓
documentation impact gate
        ↓
small follow-up commit
        ↓
STOP
```
Do NOT automatically reopen the entire finding, discard established test baselines, or broadly re-audit unrelated subsystems.

---

## 7. Prohibited Behavior (Strict Invariants)
1. **NEVER Commit Directly to `main`:** All changes must land on `main` via verified Pull Requests.
2. **NEVER Force-Push Shared Branches in Normal Workflows:** Autonomous agents and contributors MUST NOT force-push (`git push --force` or `--force-with-lease`) to shared branches (`main`, `core-foundation`, `docs-foundation`). Normal engineering workflows MUST NEVER force-push. Human maintainers MAY execute a force-push ONLY as a deliberate, documented, and communicated emergency recovery operation.
3. **NEVER Merge `main` into `docs-foundation` Merely to Sync Core:** The stale `legacy-exodus-core` directory inside `docs-foundation` must remain untouched. Documentation agents must query core via `git show core-foundation:<path>`.
4. **NEVER Copy Core Files into `docs-foundation`:** Avoid duplicating codebase trees across branches.
5. **NEVER Commit Secrets or Credentials:** Any file containing an API token, private key, or password must be aborted and cleaned.
6. **NEVER Execute Destructive Tree Shortcuts on Unsaved Work:** Destructive commands (`git reset --hard`, `git clean -fd`, `git clean -fdx`, `git restore .`, `git checkout -- .`) must never be used when user or concurrent task work may be affected. When encountering a dirty worktree: inspect files $\to$ identify ownership $\to$ preserve work $\to$ STOP and seek clarification if uncertain.
