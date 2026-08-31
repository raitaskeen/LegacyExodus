import { describe, expect, it } from "bun:test";

import { detectTerminalCapabilities } from "@cli/presentation/capabilities";
import { CliShell } from "@cli/presentation/shell";
import { stripAnsi } from "@cli/presentation/theme";

describe("CLI Shell & Agent Console Presentation", () => {
  it("renders structured header with horizontal rule", () => {
    const caps = detectTerminalCapabilities({ theme: "classic" });
    const shell = new CliShell(caps);

    const header = shell.renderHeader("Agent Console", "Repository Analysis");
    expect(header).toContain("LegacyExodus");
    expect(header).toContain("Agent Console");
    expect(header).toContain("Repository Analysis");
  });

  it("renders pipeline stage list across different stage statuses", () => {
    const unicodeCaps = {
      isTTY: true,
      isCI: false,
      noColor: false,
      isUnicodeSupported: true,
      width: 80,
      mode: "interactive" as const,
      theme: "aurora" as const,
    };
    const shell = new CliShell(unicodeCaps);

    const stageOutput = shell.renderStageList([
      { name: "Discovery", status: "done", detail: "128 files", durationMs: 45 },
      { name: "Parser", status: "running", detail: "in progress" },
      { name: "Symbols", status: "pending" },
      { name: "Security", status: "warn", detail: "1 notice" },
      { name: "Verification", status: "fail", detail: "failed check" },
      { name: "Artifacts", status: "skip" },
    ]);

    expect(stageOutput).toContain("Discovery");
    expect(stageOutput).toContain("128 files");
    expect(stageOutput).toContain("Parser");
    expect(stageOutput).toContain("Symbols");
    expect(stageOutput).toContain("Security");
    expect(stageOutput).toContain("Verification");
    expect(stageOutput).toContain("Artifacts");
    // Verify Unicode glyphs in interactive Unicode mode
    expect(stageOutput).toContain("○");
    expect(stageOutput).toContain("◐");
    expect(stageOutput).toContain("⊘");
  });

  it("renders ASCII-only stage glyphs when Unicode is not supported", () => {
    const asciiCaps = {
      isTTY: true,
      isCI: false,
      noColor: true,
      isUnicodeSupported: false,
      width: 80,
      mode: "plain" as const,
      theme: "mono" as const,
    };
    const shell = new CliShell(asciiCaps);

    const stageOutput = shell.renderStageList([
      { name: "Discovery", status: "done" },
      { name: "Parser", status: "running" },
      { name: "Symbols", status: "pending" },
      { name: "Security", status: "warn" },
      { name: "Verification", status: "fail" },
      { name: "Artifacts", status: "skip" },
    ]);

    // Ensure no Unicode glyphs leak into ASCII mode
    expect(stageOutput).not.toContain("○");
    expect(stageOutput).not.toContain("◐");
    expect(stageOutput).not.toContain("⊘");
    expect(stageOutput).not.toContain("✓");
    expect(stageOutput).not.toContain("✗");

    // Ensure ASCII fallbacks are rendered
    expect(stageOutput).toContain("o");
    expect(stageOutput).toContain(">");
    expect(stageOutput).toContain("-");
    expect(stageOutput).toContain("[+]");
    expect(stageOutput).toContain("[x]");
    expect(stageOutput).toContain("[!]");
  });

  it("renders card and footer consistently", () => {
    const caps = detectTerminalCapabilities({ theme: "mono" });
    const shell = new CliShell(caps);

    const card = shell.renderCard([
      { label: "Target Workspace", value: "/my/project" },
      { label: "Engine Status", value: "ONLINE", badge: "READY", badgeType: "success" },
    ]);

    expect(card).toContain("Target Workspace");
    expect(card).toContain("/my/project");
    expect(card).toContain("ONLINE");
    expect(card).toContain("READY");

    const footer = shell.renderFooter("Workspace ready for analysis.", true);
    expect(stripAnsi(footer)).toContain("Workspace ready for analysis.");
  });
});
