import { describe, expect, it } from "bun:test";

import { detectTerminalCapabilities, type TerminalCapabilities } from "@cli/presentation/capabilities";
import { createTheme, stripAnsi } from "@cli/presentation/theme";

describe("CLI Theme Subsystem", () => {
  it("creates Classic theme with sky and emerald palettes", () => {
    const caps: TerminalCapabilities = {
      isTTY: true,
      isCI: false,
      noColor: false,
      isUnicodeSupported: true,
      width: 80,
      mode: "interactive",
      theme: "classic",
    };
    const theme = createTheme(caps);

    const brand = theme.brand("LegacyExodus");
    expect(brand).toContain("\x1b[");
    expect(stripAnsi(brand)).toBe("LegacyExodus");

    const success = theme.success("PASS");
    expect(success).toContain("\x1b[");
    expect(stripAnsi(success)).toBe("PASS");

    const highlight = theme.highlight("Key");
    expect(highlight).toContain("\x1b[");
    expect(stripAnsi(highlight)).toBe("Key");
  });

  it("creates Soft Aurora theme with lavender and teal palettes", () => {
    const caps: TerminalCapabilities = {
      isTTY: true,
      isCI: false,
      noColor: false,
      isUnicodeSupported: true,
      width: 80,
      mode: "interactive",
      theme: "aurora",
    };
    const theme = createTheme(caps);

    expect(caps.theme).toBe("aurora");
    const brand = theme.brand("Exodus");
    expect(brand).toContain("\x1b[");
    expect(stripAnsi(brand)).toBe("Exodus");

    const success = theme.success("COMPLETE");
    expect(success).toContain("\x1b[");
    expect(stripAnsi(success)).toBe("COMPLETE");

    const warn = theme.warning("NOTICE");
    expect(warn).toContain("\x1b[");
    expect(stripAnsi(warn)).toBe("NOTICE");
  });

  it("creates Mono Professional theme without TrueColor escapes for high contrast / CI", () => {
    const caps: TerminalCapabilities = {
      isTTY: true,
      isCI: false,
      noColor: false,
      isUnicodeSupported: true,
      width: 80,
      mode: "interactive",
      theme: "mono",
    };
    const theme = createTheme(caps);

    expect(caps.theme).toBe("mono");
    const brand = theme.brand("Exodus");
    expect(stripAnsi(brand)).toBe("Exodus");

    const text = theme.text("Plain content");
    expect(text).toBe("Plain content");

    const muted = theme.muted("Dim note");
    expect(stripAnsi(muted)).toBe("Dim note");
  });

  it("disables all ANSI formatting when noColor is detected", () => {
    const caps = detectTerminalCapabilities({ plain: true, theme: "aurora" });
    const theme = createTheme(caps);

    expect(theme.brand("Exodus")).toBe("Exodus");
    expect(theme.heading("Header")).toBe("Header");
    expect(theme.success("OK")).toBe("OK");
    expect(theme.error("FAIL")).toBe("FAIL");
    expect(theme.highlight("Text")).toBe("Text");
  });

  it("extracts theme from LEGACYEXODUS_THEME environment variable", () => {
    const orig = process.env.LEGACYEXODUS_THEME;
    try {
      process.env.LEGACYEXODUS_THEME = "aurora";
      const caps = detectTerminalCapabilities();
      expect(caps.theme).toBe("aurora");
    } finally {
      if (orig !== undefined) {
        process.env.LEGACYEXODUS_THEME = orig;
      } else {
        delete process.env.LEGACYEXODUS_THEME;
      }
    }
  });
});
