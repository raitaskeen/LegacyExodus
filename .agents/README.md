# Development Agent Control Plane

`.agents/` contains focused operating skills for agents that work on the LegacyExodus repository. It does not configure or participate in the LegacyExodus runtime, analyze user repositories, or define product architecture.

The authoritative entry point is [`AGENTS.md`](../AGENTS.md). Select only the skill needed for the current task:

- `legacyexodus-forensic-remediation`: one confirmed implementation defect, failure-first through verified remediation.
- `legacyexodus-code-audit`: read-only code and architecture inspection.
- `legacyexodus-docs-audit`: read-only documentation-to-core truth comparison and review reconciliation.
- `legacyexodus-git-governance`: branch, commit, synchronization, and publication rules.
- `legacyexodus-test-verification`: canonical verification layers and evidence format.
- `legacyexodus-performance-audit`: read-only performance and memory measurement.
- `legacyexodus-red-team-review`: read-only adversarial challenge of a candidate change.

Use the smallest evidence surface that can answer the task. Do not re-audit unrelated subsystems, reopen closed findings without new executable evidence, or treat roadmap prose as implementation truth.

For every core change, report whether documentation impact is `REQUIRED` or `NONE` and why. Documentation follows current source, tests, and verified runtime behavior; it never drives production changes.
