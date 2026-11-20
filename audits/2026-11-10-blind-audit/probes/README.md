# Probes for the 2026-11-10 audit

Each folder is a complete program. Run one through the engine with:

    bun run legacy-exodus-core/src/cli/index.ts analyze <folder> --refresh

| Folder | Finding |
|---|---|
| `tn1` | XA-01: no flow into `readFileSync` or `execSync` behind `escape-html` |
| `ch1` | XA-02: internal base class with an exported subclass |
| `ch2` | XA-03: exported instance patched in another file |
| `ch3` | XA-04: computed read borrows a method |
| `rq1` | XA-05: call before its `require` binds |

XA-06 needs a generated file: `export const y = x + x + … + x;` with 6,000 terms after `const x = 1;`.
