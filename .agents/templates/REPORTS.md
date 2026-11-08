# Evidence reports and handoffs

Use only meaningful fields; explain missing required evidence. Reports belong
in the response or an authorized artifact path, not automatically in source.
Volatile state belongs here, with verification time and revision, not in durable
policy. No CURRENT_STATE file is maintained.

## Common evidence record

Claim; kind; conclusion status; exact SHA plus candidate content identity;
file/lines or command; cwd; environment/runtime; expected; actual; result;
coverage and limitations. Preserve raw failure/probe evidence safely.

## Finding and audit

BASELINE; SCOPE; COVERAGE (inspected and uninspected); EVIDENCE; FINDINGS;
UNCERTAINTY; MUTATIONS (normally none); VERDICT; HANDOFF.

Per finding: ID/title; P0-P3 severity with impact rationale; confidence
CONFIRMED/LIKELY/POSSIBLE/DESIGN_QUESTION; subsystem; revision/path/lines;
observed behavior; violated contract; root cause; blast radius; minimal
reproduction; expected/actual; defect versus limitation; deduplication relation;
bounded recommendation; verification plan; status
DISCOVERED/VALIDATING/CONFIRMED/NOT_REPRODUCED/REJECTED/DUPLICATE.
Confidence is a conclusion, not evidence.

## Remediation

BASELINE; REPRODUCTION (RED log); ROOT_CAUSE; CONTRACT; CHANGE; TESTS
(positive/negative and unchanged behavior); VERIFICATION (all ten layers);
RED_FLAGS; ADJACENT_FINDINGS; documentation impact REQUIRED/NONE with reason;
memory status; independent review; FINAL_CANDIDATE_STATUS; delivery permissions
and actual operations. Never imply an uncommitted candidate is delivered.

## Red team

CANDIDATE (base, complete diff, untracked content identity); COUNTEREXAMPLES;
UNCHANGED_BEHAVIOR; DETERMINISM; RESOURCE_EFFECT; SCOPE; test quality;
evidence for each of the eleven probes; VERDICT; required next boundary.
FAIL includes counterexample, expected, actual, why it invalidates the candidate,
and Path A or B. INCONCLUSIVE lists missing evidence, not a qualified pass.

## Design

PROBLEM; CURRENT_BEHAVIOR; REQUIRED_INVARIANTS; OPTIONS; TRADEOFFS;
BOUNDED_DESIGN; NON_GOALS; RISKS; TEST_MODEL; IMPLEMENTATION_READINESS.
Separate demonstrated facts from proposed contracts and unresolved choices.

## Compact handoff

TASK_ID
BASELINE_SHA
BRANCH / WORKTREE
SCOPE
FILES_CHANGED
EVIDENCE
TEST_RESULTS
KNOWN_LIMITATIONS
OPEN_QUESTIONS
VERDICT
NEXT_AUTHORIZED_ROLE

Include candidate identity and verification time within EVIDENCE. The recipient
rechecks live state and permissions rather than trusting conversational memory.
