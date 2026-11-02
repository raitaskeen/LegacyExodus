import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

import { createDiscoveryProjection, deferredArtifact } from "@contracts/discovery-projection";
import { FileDiscoveryProjectionAdapter } from "@storage/index";

describe("BA-17 deferred discovery artifacts", () => {
  const semantic = () => ({ calls: [{ id: "c", location: { line: 1, column: 0 } }], references: [] });

  it("is not produced while the projection is validated, and is produced frozen when read", () => {
    let loads = 0;
    const projection = createDiscoveryProjection({
      projectPath: "/repo",
      artifacts: [{ name: "files.json", payload: [] }, deferredArtifact("semantic.json", () => { loads++; return semantic(); })],
    });
    expect(loads).toBe(0);
    const payload = projection.artifacts.find((artifact) => artifact.name === "semantic.json")?.payload as ReturnType<typeof semantic>;
    expect(loads).toBe(1);
    expect(payload).toEqual(semantic());
    expect(Object.isFrozen(payload.calls[0]!.location)).toBe(true);
  });

  it("writes the same bytes as an eager artifact", async () => {
    const write = async (deferred: boolean): Promise<string> => {
      const projectPath = await mkdtemp(join(tmpdir(), "legacy-exodus-deferred-"));
      try {
        await new FileDiscoveryProjectionAdapter().write(createDiscoveryProjection({
          projectPath,
          artifacts: [{ name: "files.json", payload: [] }, deferred ? deferredArtifact("semantic.json", semantic) : { name: "semantic.json", payload: semantic() }],
        }));
        return await readFile(join(projectPath, ".discovery", "semantic.json"), "utf8");
      } finally {
        await rm(projectPath, { recursive: true, force: true });
      }
    };
    expect(await write(true)).toBe(await write(false));
  });

  it("still rejects an unknown artifact name without producing any payload", () => {
    expect(() => createDiscoveryProjection({ projectPath: "/repo", artifacts: [{ name: "evil.json" as never, payload: 1 }] })).toThrow();
  });
});
