/**
 * Expectations the engine does not meet yet, each owned by a finding: the 2026-10-28 blind audit
 * (audits/2026-10-28-blind-audit/FINDINGS.md) or the 2026-11-08 fresh audit
 * (audits/2026-11-08-fresh-audit/AUDIT-REPORT.md). The conformance test fails if an expectation outside
 * this ledger breaks, and also if one inside it starts to hold, so the ledger always describes the engine
 * exactly. A fix removes its entries in the same PR.
 */
const gaps: Readonly<Record<string, readonly string[]>> = {
  // A value stored in a returned object literal's field (`wrap(x).inner`).
  "NA-03c": ["taint-audit-returned-object-field:flow"],
  // A value passed to a callback by a higher-order builtin (`[x].forEach((v) => sink(v))`).
  "NA-03d": ["taint-audit-callback:flow"],
  // SQL built from input and run through a client instance (`mysql.createConnection().query`).
  "NA-03e": ["taint-sql:client-query"],
};

/** Expectation id -> owning finding. */
export const knownGaps: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(gaps).flatMap(([finding, ids]) => ids.map((id) => [id, finding])),
);
