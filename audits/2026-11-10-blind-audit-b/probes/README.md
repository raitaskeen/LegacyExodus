# Probes for audit B (10 Nov 2026)

Each folder is a tiny program. Node is the ground truth: run `node <dir>/a.js` or `node <dir>/main.js` (for
`tv-runtime`, `node prove-tv-runtime.js`). The engine's facts:

```
cp audits/2026-11-10-blind-audit-b/probes/run-probe.ts legacy-exodus-core/benchmarks/.probe-run.ts
cd legacy-exodus-core
bun run benchmarks/.probe-run.ts ../audits/2026-11-10-blind-audit-b/probes/<dir> [category ...|ALL]
```

Default category: `calls`. Taint: `taint`; summaries: `dfg-summaries`.

| Finding | Probes |
|---|---|
| XB-01 | `tv-runtime` (+ `prove-tv-runtime.js`), `tv-sarrow`, `tv-fnexp`; controls `tv-local`, `tv-objm` |
| XB-02 | `pk-hash`, `pk-self` |
| XB-03 | `ex-alias`, `ex-poly`, `ex-pkgalias`, `ex-define` |
| XB-04 | `c1-block`, `c1-destr` |
| XB-05 | `c2-objproto` |
| XB-06 | `c1-async` |
| XB-07 | `c2-assign` (class control: `ch-assign`) |
| XB-08 | `dm-esm` |
| Holding | `ch-*`, `rq-*`, `dm-exports`, `dm-missing`, `mx-*`, `gl-shadow`, `b1c-destr` |
