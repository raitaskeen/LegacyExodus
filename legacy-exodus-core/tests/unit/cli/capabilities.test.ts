import { describe, expect, it } from "bun:test";
import { detectTerminalCapabilities } from "@cli/presentation/capabilities";

describe("CLI Capabilities Determinism & Environment Isolation", () => {
  it("forces json mode when json option is passed", () => {
    const caps = detectTerminalCapabilities({ json: true });
    expect(caps.mode).toBe("json");
  });

  it("forces plain mode when explicit plain option is passed", () => {
    const caps = detectTerminalCapabilities({ plain: true });
    expect(caps.mode).toBe("plain");
  });

  it("forces plain mode when stream is non-TTY", () => {
    const mockStream = { isTTY: false, columns: 80 } as any;
    const caps = detectTerminalCapabilities({ stream: mockStream });
    expect(caps.isTTY).toBe(false);
    expect(caps.mode).toBe("plain");
  });

  it("selects interactive mode when stream is TTY and no CI/NO_COLOR set", () => {
    const originalCI = process.env.CI;
    const originalNoColor = process.env.NO_COLOR;
    delete process.env.CI;
    delete process.env.NO_COLOR;

    try {
      const mockStream = { isTTY: true, columns: 100 } as any;
      const caps = detectTerminalCapabilities({ stream: mockStream });
      expect(caps.isTTY).toBe(true);
      expect(caps.mode).toBe("interactive");
      expect(caps.width).toBe(100);
    } finally {
      if (originalCI !== undefined) process.env.CI = originalCI;
      if (originalNoColor !== undefined) process.env.NO_COLOR = originalNoColor;
    }
  });

  it("selects CI mode when CI environment variable is active", () => {
    const originalCI = process.env.CI;
    process.env.CI = "true";

    try {
      const mockStream = { isTTY: true, columns: 80 } as any;
      const caps = detectTerminalCapabilities({ stream: mockStream });
      expect(caps.isCI).toBe(true);
      expect(caps.mode).toBe("ci");
    } finally {
      if (originalCI !== undefined) process.env.CI = originalCI;
      else delete process.env.CI;
    }
  });

  it("extracts theme from --theme <name> and --theme=<name> CLI arguments", () => {
    const originalArgv = [...process.argv];

    try {
      process.argv = ["bun", "src/cli/index.ts", "--theme", "aurora"];
      expect(detectTerminalCapabilities().theme).toBe("aurora");

      process.argv = ["bun", "src/cli/index.ts", "--theme=mono"];
      expect(detectTerminalCapabilities().theme).toBe("mono");

      process.argv = ["bun", "src/cli/index.ts", "--theme=invalid"];
      expect(detectTerminalCapabilities().theme).toBe("classic");
    } finally {
      process.argv = originalArgv;
    }
  });

  it("respects LEGACYEXODUS_THEME environment variable with classic default", () => {
    const originalTheme = process.env.LEGACYEXODUS_THEME;
    const originalArgv = [...process.argv];

    try {
      process.argv = ["bun", "src/cli/index.ts"];
      process.env.LEGACYEXODUS_THEME = "mono";
      expect(detectTerminalCapabilities().theme).toBe("mono");

      delete process.env.LEGACYEXODUS_THEME;
      expect(detectTerminalCapabilities().theme).toBe("classic");
    } finally {
      if (originalTheme !== undefined) process.env.LEGACYEXODUS_THEME = originalTheme;
      else delete process.env.LEGACYEXODUS_THEME;
      process.argv = originalArgv;
    }
  });
});
