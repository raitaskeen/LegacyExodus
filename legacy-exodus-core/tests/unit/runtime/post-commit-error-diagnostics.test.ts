import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

interface DiagnosticRecord {
  readonly error?: string;
  readonly err?: {
    readonly message?: string;
    readonly stack?: string;
    readonly type?: string;
  };
  readonly message: string;
}

const projectRoot = resolve(import.meta.dir, "../../..");

describe("post-commit event delivery diagnostics", () => {
  test("preserves Error diagnostics and stringifies non-Error failures", () => {
    const script = `
      import { createEngineContext } from "./src/runtime/composition/services.ts";

      const context = createEngineContext({ LOG_LEVEL: "error", NODE_ENV: "test" });
      let failure = new Error("error diagnostic sentinel");
      context.eventBus.subscribe("ProjectInitialized", () => { throw failure; });

      const command = (id, projectId) => ({
        id,
        type: "InitializeProject",
        createdAt: new Date("2026-09-12T00:00:00.000Z"),
        payload: { projectId, name: "Diagnostic Project" },
      });

      await context.orchestrator.execute(command(
        "00000000-0000-4000-8000-000000000201",
        "00000000-0000-4000-8000-000000000202",
      ));
      failure = "non-error diagnostic sentinel";
      await context.orchestrator.execute(command(
        "00000000-0000-4000-8000-000000000203",
        "00000000-0000-4000-8000-000000000204",
      ));
    `;

    const execution = Bun.spawnSync([process.execPath, "-e", script], {
      cwd: projectRoot,
      env: { ...process.env, FORCE_COLOR: "0" },
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(execution.exitCode).toBe(0);
    const diagnostics = execution.stderr
      .toString()
      .trim()
      .split(/\r?\n/u)
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as DiagnosticRecord);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.message).toBe("Post-commit event delivery failed");
    expect(diagnostics[0]?.err?.type).toBe("Error");
    expect(diagnostics[0]?.err?.message).toBe("error diagnostic sentinel");
    expect(diagnostics[0]?.err?.stack).toContain("Error: error diagnostic sentinel");
    expect(diagnostics[0]?.error).toBeUndefined();
    expect(diagnostics[1]?.err).toBeUndefined();
    expect(diagnostics[1]?.error).toBe("non-error diagnostic sentinel");
  });
});
