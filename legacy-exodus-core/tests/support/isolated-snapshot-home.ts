import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Snapshot keys created while testing must never land in the developer's real
// home directory. Tests that need a specific key location set LEGACY_EXODUS_HOME
// in the engine environment explicitly.
if (process.env.LEGACY_EXODUS_HOME === undefined) {
  const isolatedHome = mkdtempSync(join(tmpdir(), "lx-test-home-"));
  process.env.LEGACY_EXODUS_HOME = isolatedHome;
  afterAll(() => rmSync(isolatedHome, { recursive: true, force: true }));
}
