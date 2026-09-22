# LegacyExodus agent operating system

This controls repository engineering agents, not the product runtime or Jev.
Start here; select one role. Do not load the entire directory.

## Progressive context

- **Level 0, every task:** [kernel](core/KERNEL.md) and this router. The kernel
  owns constitution, evidence/trust rules, authorization and common stops.
- **Level 1, selected task:** [lifecycle](protocols/LIFECYCLE.md),
  [roles](protocols/ROLES.md), relevant [report](templates/REPORTS.md);
  [engine](context/ENGINE.md) only for implementation/semantic claims.
- **Level 2:** selected skill below and only its conditional reads. Git preparation
  and verification are explicit role transitions for writers, not reasons to
  load every skill at intake.

Read dependencies flow from bootstrap -> router -> skills -> shared contracts.
Shared contracts do not link back to skills; procedure names refer to this routing
table. No recursively loaded policy loops. Historical governance documents do not
reintroduce a competing execution sequence; kernel defines the precedence boundary.

## Task router

All routes inherit kernel stops and lifecycle baseline checks.

| Task / skill | Mandatory additional context | Write / isolation | Reviewer -> next handoff |
|---|---|---|---|
| [Code audit](skills/legacyexodus-code-audit/SKILL.md) | Engine, scoped source/contracts/tests | None; prepared execution copy if needed | Evidence challenge -> design or writer |
| [Docs audit](skills/legacyexodus-docs-audit/SKILL.md) | Engine truth rules, claims and frozen source | Audit none; separately authorized docs writer uses isolated feature worktree | Independent docs verifier -> human/Git |
| [Remediation](skills/legacyexodus-forensic-remediation/SKILL.md) | Engine, finding/contract, Git preparation and verification | Allowlisted source/tests; isolated feature worktree | Independent verification and red team -> human/Git |
| [Git governance](skills/legacyexodus-git-governance/SKILL.md) | Live refs, scope, permissions and review evidence | Task metadata and authorized delivery | Human gates -> requested postcheck/stop |
| [Performance audit](skills/legacyexodus-performance-audit/SKILL.md) | Engine, corpus/scripts/environment | Candidate read-only; prepared measurement copies | Evidence review -> design/writer |
| [Red team](skills/legacyexodus-red-team-review/SKILL.md) | Exact diff, contract, RED and gate evidence | Candidate read-only; authorized external probes | PASS -> human; FAIL -> writer/design |
| [Verification](skills/legacyexodus-test-verification/SKILL.md) | Frozen candidate, scripts and CI | Candidate read-only; isolated execution artifacts | Independent red team or writer |
| [Design](skills/legacyexodus-architecture-design/SKILL.md) | Engine, disputed evidence and invariant | Authorized design artifact only; isolated feature worktree if writing | Human decision -> scoped implementation |

For governance writing use the lifecycle GOVERNANCE route with explicit file
allowlist, Git preparation, skill design, consistency checks and scenario review.
Do not force this through the engine bug-remediation skill.

Every skill supplies use/exclusion, context manifest, inputs/authority, procedure,
stops, output and next role. Read only related source and evidence; unrelated
skills/roadmaps/host directories are not default context.
Persist volatile task facts only in dated evidence/handoff reports, not policy.
The system is model-neutral and does not itself delegate agents or grant tools.
