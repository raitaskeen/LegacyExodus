import { describe, expect, it } from "bun:test";
import { Command } from "commander";

import { createCLI } from "@cli/app";
import type { TerminalCapabilities } from "@cli/presentation/capabilities";
import { HelpPresenter } from "@cli/presentation/help";
import { stripAnsi } from "@cli/presentation/theme";

describe("CLI Help & Command Discovery Subsystem", () => {
  const interactiveCaps: TerminalCapabilities = {
    isTTY: true,
    isCI: false,
    noColor: false,
    isUnicodeSupported: true,
    width: 80,
    mode: "interactive",
    theme: "classic",
  };

  const plainCaps: TerminalCapabilities = {
    isTTY: false,
    isCI: false,
    noColor: true,
    isUnicodeSupported: false,
    width: 80,
    mode: "plain",
    theme: "mono",
  };

  it("renders root help with structured command groups and product identity", () => {
    const presenter = new HelpPresenter(interactiveCaps);
    const output = presenter.renderRootHelp("0.1.0");

    expect(output).toContain("LegacyExodus");
    expect(output).toContain("Modernization Engine");
    expect(output).toContain("v0.1.0");
    expect(output).toContain("Workspace & Runtime");
    expect(output).toContain("Repository Analysis");
    expect(output).toContain("Quality & Verification");
    expect(output).toContain("Plugins & Extensions");

    // Check commands are documented
    expect(output).toContain("status");
    expect(output).toContain("init <path>");
    expect(output).toContain("analyze <path>");
    expect(output).toContain("test [domain]");
    expect(output).toContain("verify");
    expect(output).toContain("plugins list");

    // Check themes and output modes are documented
    expect(output).toContain("classic");
    expect(output).toContain("aurora");
    expect(output).toContain("mono");
    expect(output).toContain("Interactive");
    expect(output).toContain("CI / Non-TTY");
    expect(output).toContain("--json");

    // Check quick start examples are included
    expect(output).toContain("QUICK START");
    expect(output).toContain("legacy-exodus status");
    expect(output).toContain("legacy-exodus analyze ./my-app");
    expect(output).toContain("legacy-exodus test --list");
  });

  it("renders command-specific help for analyze with arguments and examples", () => {
    const presenter = new HelpPresenter(interactiveCaps);
    const cmd = new Command("analyze");
    const output = presenter.renderCommandHelp(cmd);

    expect(output).toContain("analyze");
    expect(output).toContain("USAGE");
    expect(output).toContain("ARGUMENTS");
    expect(output).toContain("<path>");
    expect(output).toContain("OPTIONS");
    expect(output).toContain("--json");
    expect(output).toContain("--theme");
    expect(output).toContain("EXAMPLES");
    expect(output).toContain("legacy-exodus analyze ./apps/web");
    expect(output).toContain("[read-only]");
  });

  it("renders command-specific help for test with all 12 domains documented", () => {
    const presenter = new HelpPresenter(interactiveCaps);
    const cmd = new Command("test");
    const output = presenter.renderCommandHelp(cmd);

    expect(output).toContain("test");
    expect(output).toContain("ARGUMENTS");
    expect(output).toContain("[domain]");
    expect(output).toContain("runtime");
    expect(output).toContain("parser");
    expect(output).toContain("symbols");
    expect(output).toContain("semantic");
    expect(output).toContain("flow");
    expect(output).toContain("storage");
    expect(output).toContain("governance");
    expect(output).toContain("plugins");
    expect(output).toContain("cli");
    expect(output).toContain("integration");
    expect(output).toContain("architecture");
    expect(output).toContain("OPTIONS");
    expect(output).toContain("--list");
    expect(output).toContain("-v, --verbose");
    expect(output).toContain("--bail");
    expect(output).toContain("EXAMPLES");
  });

  it("renders command-specific help for verify with all 4 verification gates", () => {
    const presenter = new HelpPresenter(interactiveCaps);
    const cmd = new Command("verify");
    const output = presenter.renderCommandHelp(cmd);

    expect(output).toContain("verify");
    expect(output).toContain("VERIFICATION GATES");
    expect(output).toContain("Static Typecheck");
    expect(output).toContain("Test Suite");
    expect(output).toContain("Benchmark Governance");
    expect(output).toContain("Working Tree Hygiene");
    expect(output).toContain("EXAMPLES");
  });

  it("renders command-specific help for status, init, and plugins", () => {
    const presenter = new HelpPresenter(interactiveCaps);

    const statusOut = presenter.renderCommandHelp(new Command("status"));
    expect(statusOut).toContain("status");
    expect(statusOut).toContain("[read-only]");

    const initOut = presenter.renderCommandHelp(new Command("init"));
    expect(initOut).toContain("init");
    expect(initOut).toContain("<path>");
    expect(initOut).toContain("[mutates workspace]");

    const pluginsParent = new Command("plugins");
    const pluginsList = new Command("list");
    pluginsParent.addCommand(pluginsList);

    const pluginsParentOut = presenter.renderCommandHelp(pluginsParent);
    expect(pluginsParentOut).toContain("plugins");
    expect(pluginsParentOut).toContain("list");

    const pluginsListOut = presenter.renderCommandHelp(pluginsList);
    expect(pluginsListOut).toContain("plugins list");
  });

  it("renders plain-text help when colors are disabled", () => {
    const presenter = new HelpPresenter(plainCaps);
    const output = presenter.renderRootHelp("0.1.0");

    expect(output).not.toContain("\x1b[");
    expect(stripAnsi(output)).toBe(output);
  });

  it("integrates seamlessly with commander app helpInformation()", () => {
    const app = createCLI();
    const rootHelp = app.helpInformation();

    expect(rootHelp).toContain("LegacyExodus");
    expect(rootHelp).toContain("Modernization Engine");
    expect(rootHelp).toContain("USAGE");
    expect(rootHelp).toContain("COMMANDS");
    expect(rootHelp).toContain("GLOBAL OPTIONS");
  });

  it("bounds horizontal rule and card layout to narrow viewports without overflow", () => {
    for (const width of [120, 80, 60, 40, 20, 19, 15, 10]) {
      const caps: TerminalCapabilities = {
        isTTY: true,
        isCI: false,
        noColor: false,
        isUnicodeSupported: true,
        width,
        mode: "interactive",
        theme: "classic",
      };

      const presenter = new HelpPresenter(caps);
      const rootHelp = presenter.renderRootHelp("0.1.0");
      const rootLines = rootHelp.split("\n");

      for (const line of rootLines) {
        expect(stripAnsi(line).length).toBeLessThanOrEqual(width);
      }

      const analyzeHelp = presenter.renderCommandHelp(new Command("analyze"));
      const analyzeLines = analyzeHelp.split("\n");

      for (const line of analyzeLines) {
        expect(stripAnsi(line).length).toBeLessThanOrEqual(width);
      }
    }
  });

  it("only documents true root options in GLOBAL OPTIONS", () => {
    const presenter = new HelpPresenter(interactiveCaps);
    const output = presenter.renderRootHelp("0.1.0");

    expect(output).toContain("GLOBAL OPTIONS");
    expect(output).toContain("-V, --version");
    expect(output).toContain("-h, --help");
  });
});
