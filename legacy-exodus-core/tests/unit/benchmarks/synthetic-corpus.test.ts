import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureSyntheticCorpus } from "../../../benchmarks/synthetic";

function contents(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
    .map((path) => `${path.slice(root.length)}\n${readFileSync(path, "utf8")}`);
}

describe("ADR-009 step 5: synthetic scale corpus", () => {
  test("the same bytes for the same size, with imports across directories and request-to-query routes", async () => {
    const first = mkdtempSync(join(tmpdir(), "lx-synthetic-"));
    const second = mkdtempSync(join(tmpdir(), "lx-synthetic-"));
    try {
      const a = await ensureSyntheticCorpus(first, 120);
      const b = await ensureSyntheticCorpus(second, 120);
      expect(contents(a)).toEqual(contents(b));
      // readdir order is the file system's; the claim is which directories exist.
      expect(readdirSync(join(a, "src")).sort()).toEqual(["d0000", "d0001"]);
      const crossing = readFileSync(join(a, "src/d0001/m100.js"), "utf8");
      expect(crossing).toContain(`from "../d0000/m99.js"`);
      expect(crossing).toContain("req.query.name");
      expect(await ensureSyntheticCorpus(first, 120)).toBe(a);
    } finally {
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
    }
  });
});
