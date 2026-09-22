---
name: legacyexodus-git-governance
description: Prepare isolated task worktrees and perform only explicitly authorized Git delivery, PR, merge and cleanup operations with live evidence.
---

# legacyexodus-git-governance

## When to use

Prepare an isolated worktree; inspect Git state; deliver a reviewed candidate;
verify authorized PR/merge results. Do not use to fix content or bypass review.

## Context manifest

Mandatory: [kernel](../../core/KERNEL.md),
[lifecycle](../../protocols/LIFECYCLE.md),
[role matrix](../../protocols/ROLES.md), and the applicable
[report contract](../../templates/REPORTS.md).
Mandatory: repo identity, scope, selected base and operation permissions.
Optional: local CI configuration, current remote branch rules and existing PR
metadata when delivering. Irrelevant by default: engine source, all skills and
historical SHAs. No external action is implied by choosing this skill.

## Inputs and authority

Frozen source/ref, feature branch/worktree path, candidate evidence and exact
authorized operations. Git governor owns mechanical preparation/delivery, not
content edits. Inspection is read-only; preparation may update task Git metadata.

## Procedure

### Prepare

1. Inspect git status --short, branch, HEAD, remotes and git worktree list.
   Verify remote refs live (git ls-remote; bounded fetch when needed).
   Compare expected and actual SHA before pinning a source. Stop if it moved.
2. Select main for integrated/governance work, core-foundation for core work,
   docs-foundation for docs work unless task explicitly chooses another baseline.
   All three long-lived branches are inspection baselines, never experimental
   workspaces. Do not create new permanent branches.
3. Preserve dirty primary worktrees and all retained evidence. Create a clean
   isolated worktree at the exact frozen SHA with a dedicated temporary branch:
   git worktree add -b <task-branch> <authorized-path> <frozen-sha>.
   Follow explicit branch naming; otherwise use platform prefix rules and a
   descriptive temporary task name. Never switch a dirty checkout blindly.
4. Verify worktree HEAD/branch/status and filesystem permissions before mutation.
   Preparation is separate from read-only auditor execution.

### Deliver

1. Require reviewed frozen diff, all applicable gates, independent review where
   required, scope check and documentation impact. Recheck live refs and candidate
   identity; material changes invalidate approval/evidence for old content.
2. Check explicit authorization separately for commit, push and PR publication.
   If absent, report the concrete reviewable candidate and NOT_AUTHORIZED.
   Commit permission does not imply push or PR permission.
3. Review full tracked and untracked contents, secrets/artifacts and whitespace.
   Stage only allowlisted paths; inspect staged diff. Use an atomic Conventional
   Commit with truthful authorship. Preserve repository-required trailers when
   applicable: Co-authored-by: rsexo <raitaskeen.dev@gmail.com> and
   Co-authored-by: pamexo <raimrazzaq12@gmail.com>.
4. Push only the authorized temporary branch. If PR publication is authorized,
   use the correct base and verified claims; report its actual URL. Inspect CI
   and branch rules; passing local checks does not establish remote CI.
5. Merge requires explicit human authorization for this PR/candidate, unless
   already specifically preauthorized, plus required CI/reviews and branch rules.
   Never bypass protections. Verify merged target SHA, content, CI and state.
6. Cleanup is separately authorized: inspect exact branch/worktree ownership,
   clean state, merge proof and retained evidence before removing anything.
   Do not delete temporary branches or evidence automatically.
7. Verify task tree clean after authorized delivery, compare local/remote SHAs
   where appropriate, report exact completed operations, and STOP.

No automatic stash, reset, force-push, broad restore, clean, or evidence deletion.
No direct commits to long-lived branches. Never copy core into docs-foundation
or merge main merely to refresh its stale snapshot. No accidental generated
artifacts; no blanket staging. Cleanup is not a cure for unexpected state.

## Stop conditions

Kernel stops; ref drift, divergent history, unexpected files, missing operation
authorization, failed CI, or branch-rule rejection. Preserve candidate and report
the boundary. Tool permission does not substitute for human task authorization.

## Output and next handoff

Baseline/candidate/target SHAs, path/branch, exact authorized operations, commands,
CI/review evidence, final status and unperformed actions. Human for missing
delivery decisions; assigned writer for content corrections.
