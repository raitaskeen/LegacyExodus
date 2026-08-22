# Golden — Hand-Verified Ground Truth

This directory contains manually verified analysis facts for benchmark repositories.

Each subdirectory corresponds to a repository and contains:

- `sample-sheet.json` — Randomly sampled findings with manual review verdicts
- `calls.json` — Verified call resolution facts (optional, post-review)
- `dependencies.json` — Verified dependency edge facts (optional, post-review)
- `taint.json` — Verified taint flow facts (optional, post-review)

## Review Methodology

1. Run `bun run benchmarks/scripts/sample.ts <repo-path>` to generate a sample sheet
2. For each sampled finding, inspect the source code manually
3. Fill in `manualVerdict` ("correct" | "incorrect" | "uncertain") and `manualNote`
4. Compute precision: `correct / (correct + incorrect)`

## Confidence Limitations

- Sample sizes are small (default 20 per category)
- Sampling is random but not statistically controlled
- Precision is estimated, not proven
- Results are specific to the analyzed revision
