import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveProjectId, SnapshotKeyStore } from "@discovery/index";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "lx-project-id-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function project(root: string, name: string, config?: string): Promise<string> {
  const path = join(root, name);
  await mkdir(join(path, ".legacy-exodus"), { recursive: true });
  if (config !== undefined) await writeFile(join(path, ".legacy-exodus", "config.json"), config);
  return path;
}

/** ADR-010 step 2: one repository keeps one project id across runs, and no path is in it. */
describe("resolveProjectId", () => {
  it("derives the same UUID for the same repository and a different one for another", async () => {
    await withRoot(async (root) => {
      const keys = new SnapshotKeyStore(join(root, "home"));
      const a = await project(root, "a");
      const b = await project(root, "b");
      const first = await resolveProjectId(a, keys);
      expect(first).toMatch(UUID);
      expect(await resolveProjectId(a, keys)).toBe(first);
      expect(await resolveProjectId(b, keys)).not.toBe(first);
      // The id is keyed: another machine's key gives another id for the same path.
      expect(await resolveProjectId(a, new SnapshotKeyStore(join(root, "other-home")))).not.toBe(first);
    });
  });

  it("uses the id that init recorded, and ignores a config value that is not a UUID", async () => {
    await withRoot(async (root) => {
      const keys = new SnapshotKeyStore(join(root, "home"));
      const recorded = "3F2504E0-4F89-41D3-9A0C-0305E82C3301";
      expect(await resolveProjectId(await project(root, "set", JSON.stringify({ projectId: recorded })), keys)).toBe(recorded.toLowerCase());
      const bad = await project(root, "bad", JSON.stringify({ projectId: "../../etc/passwd" }));
      const derived = await resolveProjectId(bad, keys);
      expect(derived).toMatch(UUID);
      expect(await resolveProjectId(bad, keys)).toBe(derived);
      expect(await resolveProjectId(await project(root, "broken", "{"), keys)).toMatch(UUID);
    });
  });

  it("does not follow a symbolic link for the config", async () => {
    await withRoot(async (root) => {
      const outside = join(root, "outside.json");
      await writeFile(outside, JSON.stringify({ projectId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" }));
      const linked = await project(root, "linked");
      try {
        await symlink(outside, join(linked, ".legacy-exodus", "config.json"), "file");
      } catch {
        return; // Symbolic links need extra rights on some Windows machines.
      }
      expect(await resolveProjectId(linked, new SnapshotKeyStore(join(root, "home")))).not.toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    });
  });

  it("falls back to a random id when the key lives inside the project", async () => {
    await withRoot(async (root) => {
      const path = await project(root, "p");
      const keys = new SnapshotKeyStore(join(path, "home"));
      const first = await resolveProjectId(path, keys);
      expect(first).toMatch(UUID);
      expect(await resolveProjectId(path, keys)).not.toBe(first);
      // No key was created inside the analyzed repository.
      expect(await keys.readKey()).toBeUndefined();
    });
  });
});
