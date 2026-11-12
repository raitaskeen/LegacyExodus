# Behaviour Safety Net: critique of the Gemini blueprint, and a buildable plan

Date: 8 Nov 2026. Inputs: the Gemini blueprint you pasted; the 4 Nov LegacyExodus report (pipeline step 4,
"Safety net", and step 6, "differential testing"); the 4 Nov product-ideas answer; a quick web check of
competitors. Scores and estimates are my judgment unless a source is named.

## 0. Verdict in five lines

1. **Choosing this product is right.** It is already step 4 of the LegacyExodus pipeline and the
   parity harness that JS → TypeScript migration needs, so it isn't a detour. It pulls planned work forward.
2. **The blueprint is not buildable as written.** About half of it is research-grade (eBPF, WASI, Z3,
   custom schedulers), and several claims are false. Those would break the honesty rules that are the brand.
3. **One correction to my own 4 Nov answer:** I said JS/TS was "open territory". It is not.
   - Keploy already does eBPF record-and-replay API tests ([Keploy](https://keploy.io/compare/vcr)).
   - EarlyAI and Qodo generate JS/TS unit tests ([dev.to guide](https://dev.to/rahulxsingh/best-ai-test-generation-tools-in-2026-complete-guide-4o2p)).
   - The edge has to come from LegacyExodus's proven facts, not from "we generate tests".
4. **Build it in TypeScript/Bun next to the engine, not in Rust.** Rust later, only for measured hot spots.
5. **It runs customer code. The engine never does.** That needs its own security design (section 4).

## 1. Claim-by-claim critique

| Blueprint claim | Problem | Replace with |
|---|---|---|
| "Impenetrable", "mathematically securing the business logic", "100% deterministic accuracy" | Characterization tests record what code **does**, bugs included. They prove *unchanged*, not *correct*. Determinism (same output twice) is not accuracy. These words break kernel rule 2 and the README's own honesty | "Records today's behaviour so any change that alters it is caught. Unknowns are listed, not guessed." |
| "Compiled AI Paradigm" | Buzzword with no definition. There is no AI in the design anyway | Drop it. "Deterministic, evidence-backed" is the real differentiator |
| "Operates on static AST… synthesises tests entirely offline" | Contradiction: recording outputs **requires running the code** (the blueprint itself adds a sandbox and eBPF capture) | Static analysis **chooses** what to test and what to isolate; execution **records** the answers |
| Rust core "transitioning from the TS prototype" | The engine is 23k lines of tested TS, and ADR-009 just made it scale. A rewrite now costs months and yields no revenue. My 4 Nov estimate: S7 workers give 5–10× before Rust matters | Stay on TS/Bun. Later swap measured hot spots (for example the `oxc` parser), each with fact-diff 0/0 |
| The 80/20 split | Invented, not measured. The real ratio varies per repository | **Measure it.** LegacyExodus can already classify functions by their proven calls and taint sinks (pure, I/O, unknown). Report the real ratio on Express, Fastify and Ghost |
| CRUD "safely intercepted and seeded in the V8 sandbox" | Mocking an ORM tests the mock, not the SQL. Real DB behaviour (constraints, transactions, collation) disappears | Run a real database in a container, seeded from a snapshot, or record and replay at the driver level. Label tests by which one they use |
| eBPF "Golden Tape" (`sys_sendto`/`sys_recvfrom`) | (a) It captures **TLS ciphertext**: most traffic is HTTPS, so the bytes are useless without hooking OpenSSL inside the Node binary. (b) Linux only, root or CAP_BPF, kernel-version specific. You develop on Windows, and many customers won't grant root on staging. (c) Keploy already ships this, so it isn't a moat | Hook in-process at the Node level (`--import` preload patching `http`/`undici`/`net`, or the MockAgent/nock approach). That works on every OS, sees plaintext and needs no privileges. eBPF stays an optional adapter later |
| WASI/Wasmtime sandbox for a Node app | Node apps can't run on WASI: libuv, native addons, `fs`/`net`. Running JS in Wasm means a different engine (QuickJS/StarlingMonkey) with different semantics, so the recorded behaviour is **not** production behaviour. Custom `rusty_v8` means building your own Node | Run real Node (the version the customer uses) in a container. Add determinism shims: fake timers for `Date` and timers, seeded `Math.random`/`crypto.randomUUID` in test mode, replayed network, a fixed `TZ` and locale |
| Z3 "proves inputs… even for cryptographic hashes or random strings" | **False.** Finding an input that gives a chosen hash is exactly what hash functions are designed to prevent. Symbolic execution of real JS (ExpoSE, Jalangi) is research-grade and breaks on dynamic features | v1: inputs from literals and branch conditions in the LegacyExodus CFG, plus property-based generation (fast-check). Later: coverage-guided search. Z3 only for simple numeric or string guards, if ever |
| "Custom Rust thread scheduler… neutralises race conditions in microservices" | JS is single-threaded per process. Races come from I/O ordering, and **another service can't be scheduled from your process**. Distributed races are out of reach for any test generator | In-process: replay recorded I/O in a fixed order, which already makes tests deterministic. Distributed: mark it UNRESOLVED and say so |
| "Outputs test suites in milliseconds" | Irrelevant and untrue at repository scale. Running the code dominates | Promise reproducibility, not speed |
| Interactive `exodus resolve` that pauses execution | It blocks CI and can't run unattended | Non-interactive by default. Write `safety-net/unresolved.json` plus stub files with typed placeholders. The CLI triage is a separate command that edits those files |
| Red/green CFG dashboard | Nice for demos, not needed to sell v1 | Later. v1 deliverable: test files plus an HTML report |
| Instrumentation phase "injects hidden probes into the AST" | Rewriting customer code before recording changes the behaviour you're recording, and "hidden" erodes trust | Instrument nothing in source. Preload hooks only at process boundaries, all listed in the report |

**What the blueprint gets right:**
- An explicit UNRESOLVED class instead of guessing.
- Native test output (Jest/Vitest/Mocha).
- Typed stub skeletons for unresolved boundaries.
- Seeding all non-determinism.
- Record-and-replay for external I/O.

Keep all of those.

## 2. What is missing from the blueprint

- **The oracle problem.** A recorded output is only as good as what gets asserted. Snapshot everything and the
  tests break on every harmless change, so teams delete them. You need normalisation rules (ids, timestamps,
  ordering) and assertions on stable fields.
- **A quality metric. Coverage is not one.** Use **mutation score** (for example Stryker for JS): plant small
  bugs and count how many the generated tests catch. That number is what to sell.
- **Flakiness gate.** Every generated test runs N times (say 5) and across 2 timezones and locales before it is
  emitted. Any variance makes it UNRESOLVED, never a flaky test.
- **Readability and minimisation.** Engineers must be able to read and keep the tests: one behaviour per test,
  named after the function and branch, duplicates removed.
- **Secrets and PII.** Recorded traffic contains tokens and customer data. Redact before writing, never send it
  anywhere, and publish the redaction rules.
- **The LegacyExodus edge, which the blueprint barely uses.** Proven calls tell you exactly which
  boundaries to stub. The CFG tells you which branches the tests haven't reached. Express routes (BA-08)
  give the API test list. Taint flows give the security-relevant tests. Stable ids (ADR-008) let tests map
  back to facts across edits. No competitor has these.

## 3. A buildable v1 (JS/TS)

Commands (names are placeholders): `legacy-exodus safety-net plan | record | generate | verify`.

1. **Plan (static, no execution).** Read `.discovery`. Classify each function and route:
   - PURE: no I/O calls, proven.
   - BOUNDARY: proven calls to `fs`, `http`, a DB client.
   - UNKNOWN: unresolved calls or dynamic features.

   Measure existing test coverage (V8 coverage). Output a plan with the **measured** split.
2. **Generate for PURE functions first.** Inputs come from CFG literals and branch conditions plus fast-check.
   Each function runs in a child Node process (the customer's Node version) with determinism shims. Output
   is recorded, then emitted as Vitest/Jest files.
3. **Express routes next.** An in-process HTTP and DB-driver recorder runs against the customer's own test
   run or a staging session, with redaction. Replay through an interceptor.
4. **Verify gate.**
   - Every test passes 5× in a row.
   - Every test passes under 2 timezones.
   - Mutation score is reported.
   - Anything that fails these goes to `unresolved.json` with the reason.
5. **Report.** HTML with the measured split, coverage before and after, mutation score and the UNRESOLVED list.

**Not in v1:** eBPF, WASI, Z3, the dashboard, Rust, distributed systems, other languages.

**Time:** my 4 Nov estimate was 35–45 active days for a sellable JS/TS version. Narrowed to the v1 above
(pure functions plus Express routes), I'd put **20–30 active days** before packaging. That is my estimate,
not a measurement.

**Pricing pitch:** bundle it with the Assessment ("we map your system *and* lock its behaviour before you
change it"). That is stronger than competing as a generic test generator against free AI tools.

## 4. Architecture rules so LegacyExodus isn't harmed

- **Separate package** (for example `legacy-exodus-safetynet/` in this repo, or its own repo). **It never
  edits `legacy-exodus-core/src`.** It reads `.discovery` through a versioned contract. If it needs a new
  fact, that is a separate engine PR with fact-diff, as today.
- **Execution boundary.** The engine's kernel says never execute analyzed repositories. The safety net must, so it gets its own ADR:
  - container or VM isolation;
  - no network except the replay;
  - customer approval required to run;
  - the engine itself stays non-executing.
- **Same quality bar:**
  - deterministic output;
  - unknowns explicit;
  - conformance cases;
  - a CI job that runs the generator twice and diffs the results.
- **Roadmap impact.** It moves pipeline step 4 ahead of the IR phase. The engine work (IR, S7) pauses while
  you build this, which costs time, not correctness. Record it as an owner decision in the queue and ROADMAP.
