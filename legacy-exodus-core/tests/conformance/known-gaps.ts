/**
 * Expectations the engine does not meet yet, each owned by a finding of the 2026-10-28 blind
 * audit (audits/2026-10-28-blind-audit/FINDINGS.md). The conformance test fails if an
 * expectation outside this ledger breaks, and also if one inside it starts to hold, so the
 * ledger always describes the engine exactly. A fix removes its entries in the same PR.
 */
const gaps: Readonly<Record<string, readonly string[]>> = {
  "BA-02 TypeScript declarations": [
    "ts:enum-export",
    "ts:namespace-export",
    "ts:interface-export",
    "ts:type-alias-export",
    "ts:namespace-member-is-not-module-export",
    "ts:enum-import-edge",
  ],
  "BA-03 TypeScript module resolution": ["resolve:ts-esm-js-extension", "resolve:jsonc-tsconfig-alias"],
  "BA-04 direct source arguments": ["taint-direct-send:flow", "taint-direct-json-object:flow"],
  "BA-05 F-004 structured joins": [
    "taint-f004-L1:flow", "taint-f004-L2:flow", "taint-f004-L3:flow", "taint-f004-L4:flow",
    "taint-f004-L5:flow", "taint-f004-L6:flow", "taint-f004-L7:flow", "taint-f004-L8:flow",
    "taint-f004-L9:flow", "taint-f004-L10:flow", "taint-f004-L11:flow",
    "taint-f004-S1:flow", "taint-f004-S2:flow", "taint-f004-S3:flow", "taint-f004-S4:flow",
    "taint-f004-T1:flow", "taint-f004-T2:flow", "taint-f004-T3:flow", "taint-f004-T4:flow",
    "taint-f004-E1:flow", "taint-f004-E2:flow", "taint-f004-E3:flow", "taint-f004-E4:flow",
  ],
  "BA-06 condition is not data": ["taint-condition-not-data:no-flow"],
  "BA-07 taint policy aliasing": ["taint-destructured-body:flow"],
  "BA-08 Express route model": [
    "express:middleware-is-per-router",
    "express:settings-read-is-not-route",
    "express:handler-is-last-argument",
    "express:mount-path-applied",
  ],
  "BA-09 namespace imports": ["namespace:used-export-not-unused", "namespace:no-arbitrary-export-edge"],
  "BA-10 dynamic import": ["dynamic:literal-import-edge", "dynamic:target-not-unused"],
  "BA-12 compiled CommonJS": ["cjs:compiled-member-call-resolves", "cjs:indirect-call-recorded"],
  "BA-13 class expressions": ["class:expression-method-container"],
  "BA-14 CFG adjacents": ["cfg:loop-body-that-always-returns-has-no-loop", "cfg:statement-ids-unique-per-graph"],
  "BA-15 discovery policy": [
    "discovery:no-express-from-directory-name",
    "discovery:no-react-from-directory-name",
    "discovery:build-output-not-analyzed",
  ],
  "BA-26 relative manifest path": ["projection:manifest-path-not-absolute"],
};

/** Expectation id -> owning finding. */
export const knownGaps: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(gaps).flatMap(([finding, ids]) => ids.map((id) => [id, finding])),
);
