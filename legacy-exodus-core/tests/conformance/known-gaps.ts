/**
 * Expectations the engine does not meet yet, each owned by a finding of the 2026-10-28 blind
 * audit (audits/2026-10-28-blind-audit/FINDINGS.md). The conformance test fails if an
 * expectation outside this ledger breaks, and also if one inside it starts to hold, so the
 * ledger always describes the engine exactly. A fix removes its entries in the same PR.
 */
const gaps: Readonly<Record<string, readonly string[]>> = {
  "BA-08 Express route model": [
    "express:middleware-is-per-router",
    "express:settings-read-is-not-route",
    "express:handler-is-last-argument",
    "express:mount-path-applied",
  ],
  "BA-26 relative manifest path": ["projection:manifest-path-not-absolute"],
};

/** Expectation id -> owning finding. */
export const knownGaps: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(gaps).flatMap(([finding, ids]) => ids.map((id) => [id, finding])),
);
