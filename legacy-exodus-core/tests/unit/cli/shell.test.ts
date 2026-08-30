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
    const caps = detectTerminalCapabilities({ theme: "aurora" });
    const shell = new CliShell(caps);

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
