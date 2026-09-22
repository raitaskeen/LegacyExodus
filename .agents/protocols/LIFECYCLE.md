# Canonical task lifecycle

This is the single current agent execution sequence. Skills supply specialized
checks, not alternate pipelines. Load Level 0, select role/skill and relevant
Level 1 context, then follow this lifecycle.

## Intake and baseline

Classify: BUG_FIX, SEMANTIC_CHANGE, ARCHITECTURE_CHANGE, PERFORMANCE_CHANGE,
SECURITY_CHANGE, DOCS_ALIGNMENT, TEST_ONLY, GOVERNANCE, EXPERIMENT, or RESEARCH.
Capture a scope contract: OBJECTIVE, IN_SCOPE, OUT_OF_SCOPE, ALLOWED_FILES,
FORBIDDEN_FILES, ALLOWED_MUTATIONS, FORBIDDEN_MUTATIONS, EXPECTED_BASELINE,
KNOWN_LIMITATIONS, SUCCESS_CRITERIA, STOP_CONDITIONS.

Verify repository identity, branch, status, worktrees, local HEAD, and relevant
remote ref live. Freeze the exact source SHA; a remembered SHA is only an
expectation. Record discrepancies before proceeding. Read-only offline inspection
may report local evidence, but cannot claim remote freshness or satisfy a required
live-baseline gate. Do not alter refs just to inspect them.

For mutation, use the Git preparation procedure in the selected Git skill
before editing: exact frozen source, dedicated temporary branch and isolated
worktree, clean initial task tree. An unrelated dirty primary tree is preserved;
it does not prevent a separate clean task worktree. Recheck candidate identity
at every handoff; after edits include a diff and untracked-file content identity.

## Execution by class

| Class | Required evidence and gates |
|---|---|
| BUG_FIX / SEMANTIC_CHANGE / SECURITY_CHANGE | Remediation sequence below; semantic/security invariants, positive/negative controls, unchanged valid behavior, independent red team |
| ARCHITECTURE_CHANGE | Design-only contract first; explicit implementation scope before writing; code gates and independent review when implemented |
| PERFORMANCE_CHANGE | Comparable measured baseline first; semantics preserved; code gates plus performance comparison |
| TEST_ONLY | Prove intended expectation independently of implementation; explain RED or missing coverage; affected and full code gates; independent test-quality review |
| DOCS_ALIGNMENT | Frozen source/test truth, claim and link checks, independent docs verification, scoped diff |
| GOVERNANCE | Inventory, minimal design, references/roles consistency, realistic routing simulations, scope/diff review |
| EXPERIMENT / RESEARCH | Reproducible bounded question and limitations; no promotion to production or closure |

Read-only tasks finish with evidence and handoff. Docs writing is a separate
authorized role after docs audit, not a hidden capability of the audit skill.
Governance writing is an explicitly scoped implementation role; engine gates
are not relevant when only agent documents change.

## Remediation sequence

1. Verify/freeze baseline and prepare isolated feature worktree.
2. Reproduce against current code; deduplicate by root cause. Establish one
   canonical finding record; opening an external issue needs explicit permission.
3. State semantic invariant, prove root cause, and define smallest safe boundary.
   If the contract is unclear, hand off to design before any patch.
4. Add a focused regression and prove it fails for the expected reason on the
   unchanged baseline. Preserve the failure evidence.
5. Classify adjacent findings separately; stop if fixing this one requires them.
6. Implement the minimum correction inside the approved allowlist.
7. Verify targeted behavior and controls; execute canonical verification layers
   using the verification skill. Static typecheck precedes the candidate focused
   and full runs; baseline RED necessarily precedes implementation.
8. Perform adversarial self-review; hand frozen candidate and evidence to
   independent verification/red-team. Self-review never supplies that verdict.
9. Resolve independent verdict: FAIL Path A returns to step 6 (or design if the
   boundary is false); FAIL Path B returns to step 4 with a justified test
   correction and new baseline RED proof. Preserve old evidence and valid tests.
   Both paths rerun affected and downstream required gates. INCONCLUSIVE blocks
   candidate acceptance. A green suite cannot override a valid counterexample.
10. Review full diff including untracked files, scope and documentation impact.
    Freeze reviewed content and compile the candidate report.
11. Human-authorized delivery only through the Git governor. Otherwise return
    CANDIDATE_READY or the evidenced blocker and NOT_AUTHORIZED delivery status.
12. After authorized operations verify actual refs/status and report; STOP.

Candidate withdrawal means mark rejected and preserve evidence; only undo
specifically owned edits when authorized and safe. No automatic rollback.
Review follow-ups validate the new claim, apply a bounded correction through
the relevant step, and rerun invalidated gates; do not restart unrelated audits.

## Test and completion discipline

Classify new failures: PRODUCT_BUG, TEST_BUG, UNSUPPORTED_BEHAVIOR,
ENVIRONMENT_FAILURE, EXPECTED_CHANGE. A TEST_BUG requires independent contract
evidence, explicit explanation of the changed expectation, preserved prior
evidence, and independent review. Existing test removal or scope change requires
human authorization; never remove a failing test as a convenience.

Each gate reports PASS, FAIL, NOT_RUN, or NOT_APPLICABLE with evidence.
NOT_APPLICABLE needs a scope-based reason; NOT_RUN never satisfies a required
gate. Reuse only evidence tied to identical candidate content and environment.
Record skips explicitly; never present skipped tests as executed passes.
Unrelated failure triggers stop and report, not unrelated repair.

Candidate acceptance, authorized delivery, and finding/issue closure are separate.
Root cause, dedicated regression, all required gates, independent red-team pass,
and clean reviewed scope are needed for remediation acceptance. Human risk
acceptance cannot be reported as passing evidence. Closure requires human
decision; issue mutation is a separately authorized Git-governor action.
Unperformed authorized work is PENDING; unauthorized work is NOT_AUTHORIZED.
No invented commit, push, CI, or clean-tree claim. A reviewed uncommitted candidate
is expected to be dirty only within its allowlist. Clean-tree postconditions
apply after authorized commit/delivery, never by deleting retained evidence.

Return a report and the compact handoff. Missing evidence yields INCONCLUSIVE,
SAFE_WITH_REQUIRED_FOLLOW_UP, or BLOCKED, never false closure.
