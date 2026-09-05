import { describe, expect, it } from "bun:test";
import { runCommand } from "@cli/commands/verify";

describe("Subprocess Timeout Termination Lifecycle (CodeRabbit #2)", () => {
  it("enforces timeout, kills non-responsive child, and resolves with exit code 1", async () => {
    const started = performance.now();

    // A process that traps SIGTERM and refuses to exit until killed with SIGKILL
    const script = `
      process.on('SIGTERM', () => {
        // Deliberately ignore SIGTERM
      });
      setInterval(() => {}, 1000);
    `;

    const result = await runCommand(
      "bun",
      ["-e", script],
      { timeoutMs: 150 },
    );

    const duration = performance.now() - started;

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("timed out after 150ms");
    // Ensure timeout escalation doesn't hang indefinitely
    expect(duration).toBeLessThan(3000);
  });
});
