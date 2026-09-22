# Role and component authority

All roles read only relevant authorized repository evidence. Scope below further
limits writes. A report in conversation is allowed for all roles; persisted
reports require an explicitly authorized artifact location. External probes may
write only to prepared authorized scratch, never the inspected candidate.
Role capabilities do not grant filesystem or delivery authorization.

| Role | Required input | Permitted writes | Production / tests | Required output | Role stop | Next role |
|---|---|---|---|---|---|---|
| Audit | Frozen target, question, scope | None | No / No | Finding, coverage, uncertainty | Unreproducible claim or contract conflict | Design or implementation |
| Design | Finding and competing evidence | Authorized design artifact only | No / No | Bounded invariant, options, readiness | Invariant undecidable or broader scope needed | Human or implementation |
| Implementation | Confirmed finding, contract, allowlist | Allowlisted feature worktree files | Scoped / Scoped | Candidate, RED/GREEN, verification evidence | Root-cause boundary fails | Verification then independent red team |
| Verification | Frozen candidate and command plan | Execution artifacts in prepared isolated verification workspace only | No / No | Command/result/scope/environment/limits | Failure or unsafe command | Writer or red team |
| Red team | Exact base and candidate diff, evidence | External safe probes only | No / No | PASS, FAIL, or INCONCLUSIVE with probes | Candidate changes or insufficient evidence | Design/writer or human |
| Docs audit | Claims plus frozen implementation revision | None | No / No | Claim-to-evidence table | Conflicting intended contract | Docs writer or design |
| Docs writer | Explicit docs correction scope, verified claims | Allowlisted docs in isolated feature worktree | No / No | Minimal correction, link/claim verification | Production change needed | Independent docs verifier |
| Performance | Question, prepared baseline; candidate for comparison | Measurement artifacts in prepared isolated execution workspace only | No / No | Measurements, variance, limits | Environment not comparable | Design/writer or human |
| Git governor | Frozen reviewed diff and explicit operation permissions | Task Git metadata; no content repairs | No / No | Actual operation evidence and state | Gate absent, ref moved, or scope differs | Human or requested postcheck |
| Human | Evidence, risk, unresolved decisions | Within repository/platform controls | Authorized / Authorized | Scope, contract, risk and delivery decisions | Unacceptable evidence/risk | Explicitly assigned role |

## External action matrix

N = no authority in this role. A = only that explicitly authorized action after
required gates. Human decisions remain subject to platform and repository rules.

| Role | Commit | Push | Open PR | Merge | Close issue | Change requirements |
|---|---|---|---|---|---|---|
| Audit | N | N | N | N | N | N |
| Design | N | N | N | N | N | Propose only |
| Implementation | N | N | N | N | N | N |
| Verification | N | N | N | N | N | N |
| Red team | N | N | N | N | N | N |
| Docs audit / writer | N | N | N | N | N | N |
| Performance | N | N | N | N | N | N |
| Git governor | A | A | A | A | A | N |
| Human | A | A | A | A | A | A |

A writer may explicitly transition to Git governor when already authorized;
that is not independent review. Independent verification/red-team must be a
different reviewer/context with access to raw artifacts, not the writer
renaming its self-review. If unavailable, report the independent gate outstanding.

Engine/analyzers produce deterministic evidence subject to tested contracts.
Semantic IR, when implemented, may represent validated/versioned evidence and
uncertainty, not manufacture truth. Jev/LLMs may explain, propose, prioritize, and
synthesize hypotheses or bounded plans; they cannot become parser or symbol
authority, overwrite facts, invent provenance, or decide final verification.
Select agents by role capabilities, not vendor/model names. Jev is product
architecture, not agent governance authority.
