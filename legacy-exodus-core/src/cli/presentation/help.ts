import type { Command } from "commander";

import type { TerminalCapabilities } from "./capabilities";
import { createSymbols, type Symbols } from "./symbols";
import { truncateAnsi } from "./tables";
import { createTheme, stripAnsi, type Theme } from "./theme";

export interface CommandDocGroup {
  readonly title: string;
  readonly commands: readonly {
    readonly name: string;
    readonly description: string;
    readonly isReadOnly?: boolean;
    readonly isMutating?: boolean;
  }[];
}

export interface OptionDoc {
  readonly flags: string;
  readonly description: string;
}

export interface ExampleDoc {
  readonly command: string;
  readonly note?: string;
}

export class HelpPresenter {
  public readonly theme: Theme;
  public readonly symbols: Symbols;

  public constructor(public readonly capabilities: TerminalCapabilities) {
    this.theme = createTheme(capabilities);
    this.symbols = createSymbols(capabilities);
  }

  public renderHeader(title: string, subtitle?: string): string {
    const brandPart = `${this.theme.brand(this.symbols.brand)} ${this.theme.heading("LegacyExodus")}`;
    const subPart = subtitle ? ` ${this.theme.muted(this.symbols.arrow)} ${this.theme.text(subtitle)}` : "";
    const titlePart = ` ${this.theme.muted(this.symbols.arrow)} ${this.theme.heading(title)}`;

    const prefix = subtitle ? `${brandPart}${subPart}${titlePart} ` : `${brandPart}${titlePart} `;
    const rawLen = stripAnsi(prefix).length;
    const targetWidth = this.capabilities.width > 0 ? this.capabilities.width : 80;
    if (rawLen >= targetWidth) {
      return truncateAnsi(prefix.trimEnd(), targetWidth);
    }
    const remaining = Math.max(0, targetWidth - rawLen);
    const rule = this.theme.border(this.symbols.horizontalRule.repeat(remaining));

    return `${prefix}${rule}`;
  }

  public renderDivider(): string {
    const len = this.capabilities.width > 0 ? this.capabilities.width : 80;
    return this.theme.border(this.symbols.horizontalRule.repeat(len));
  }

  public renderRootHelp(version: string): string {
    const header = this.renderHeader("Modernization Engine", `v${version}`);
    const tagline = `  ${this.theme.text("Knowledge-first codebase modernization and repository intelligence")}`;

    const usage = [
      this.theme.heading("USAGE"),
      `  $ ${this.theme.brand("legacy-exodus")} ${this.theme.muted("[command]")} ${this.theme.dim("[options]")}`,
    ].join("\n");

    const commandGroups: readonly CommandDocGroup[] = [
      {
        title: "Workspace & Runtime",
        commands: [
          { name: "status", description: "Report runtime health and composed dependencies", isReadOnly: true },
          { name: "init <path>", description: "Initialize a new LegacyExodus workspace configuration", isMutating: true },
        ],
      },
      {
        title: "Repository Analysis",
        commands: [
          { name: "analyze <path>", description: "Analyze repository structure, ASTs, symbols & graph", isReadOnly: true },
        ],
      },
      {
        title: "Quality & Verification",
        commands: [
          { name: "test [domain]", description: "Explore and run test suites by architectural domain", isReadOnly: true },
          { name: "verify", description: "Run complete multi-gate repository verification", isReadOnly: true },
        ],
      },
      {
        title: "Plugins & Extensions",
        commands: [
          { name: "plugins list", description: "Inspect loaded plugins and discovery extensions", isReadOnly: true },
        ],
      },
    ];

    const commandsSection = [
      this.theme.heading("COMMANDS"),
      ...commandGroups.map((group) => {
        const groupTitle = `  ${this.theme.muted(group.title)}`;
        const groupCmds = group.commands.map((cmd) => {
          const paddedName = cmd.name.padEnd(20, " ");
          const badge = cmd.isReadOnly
            ? ` ${this.theme.dim("[read-only]")}`
            : cmd.isMutating
              ? ` ${this.theme.dim("[mutates workspace]")}`
              : "";
          return `    ${this.theme.active(paddedName)}  ${this.theme.text(cmd.description)}${badge}`;
        }).join("\n");
        return `${groupTitle}\n${groupCmds}`;
      }),
    ].join("\n\n");

    const globalOptions: readonly OptionDoc[] = [
      { flags: "-V, --version", description: "Output the version number" },
      { flags: "-h, --help", description: "Display help for command" },
    ];

    const maxFlagLen = Math.max(...globalOptions.map((o) => o.flags.length));
    const optionsSection = [
      this.theme.heading("GLOBAL OPTIONS"),
      ...globalOptions.map((opt) => {
        const paddedFlag = opt.flags.padEnd(maxFlagLen, " ");
        return `  ${this.theme.active(paddedFlag)}  ${this.theme.text(opt.description)}`;
      }),
    ].join("\n");

    const themesSection = [
      this.theme.heading("THEMES"),
      `  ${this.theme.active("classic".padEnd(12, " "))}  ${this.theme.text("Default TrueColor sky/emerald palette for interactive terminals")}`,
      `  ${this.theme.active("aurora".padEnd(12, " "))}  ${this.theme.text("Soft lavender/teal palette with gentle contrast")}`,
      `  ${this.theme.active("mono".padEnd(12, " "))}  ${this.theme.text("Minimal monochrome output for CI pipelines and high contrast")}`,
    ].join("\n");

    const outputModesSection = [
      this.theme.heading("OUTPUT MODES"),
      `  ${this.theme.active("Interactive".padEnd(14, " "))}  ${this.theme.text("Rich terminal layout with status cards, tables, and ANSI themes")}`,
      `  ${this.theme.active("CI / Non-TTY".padEnd(14, " "))}  ${this.theme.text("Deterministic plain-text summaries without color codes")}`,
      `  ${this.theme.active("--json".padEnd(14, " "))}  ${this.theme.text("Pure machine-readable JSON emitted directly to stdout")}`,
    ].join("\n");

    const quickStartExamples: readonly ExampleDoc[] = [
      { command: "legacy-exodus status", note: "Verify runtime and storage readiness" },
      { command: "legacy-exodus analyze ./my-app", note: "Analyze repository and build discovery inventory" },
      { command: "legacy-exodus test --list", note: "List all 12 test domains and file counts" },
      { command: "legacy-exodus test parser", note: "Run focused AST parser tests" },
      { command: "legacy-exodus verify", note: "Run static typecheck, tests, benchmarks, diff hygiene" },
    ];

    const maxExampleCmdLen = Math.max(...quickStartExamples.map((e) => e.command.length));
    const examplesSection = [
      this.theme.heading("QUICK START"),
      ...quickStartExamples.map((ex) => {
        const paddedCmd = ex.command.padEnd(maxExampleCmdLen, " ");
        const noteText = ex.note ? `  ${this.theme.muted(`# ${ex.note}`)}` : "";
        return `  $ ${this.theme.brand(paddedCmd)}${noteText}`;
      }),
    ].join("\n");

    const divider = this.renderDivider();
    const footer = `  ${this.theme.muted("Run 'legacy-exodus <command> --help' for options and examples on a specific command.")}`;

    return this.boundLines([
      header,
      tagline,
      "",
      usage,
      "",
      commandsSection,
      "",
      optionsSection,
      "",
      themesSection,
      "",
      outputModesSection,
      "",
      examplesSection,
      "",
      divider,
      footer,
    ].join("\n"));
  }

  public renderCommandHelp(cmd: Command): string {
    const rawName = (cmd.name() ?? "").split(" ")[0]?.trim() ?? "";
    const parentName = cmd.parent?.name();
    const isParentRoot = !parentName || parentName === "legacy-exodus";
    const fullCmdName = isParentRoot ? rawName : `${parentName} ${rawName}`;

    let result = "";
    // Detailed command metadata mapping
    switch (fullCmdName) {
      case "status":
        result = this.renderStatusHelp();
        break;
      case "init":
        result = this.renderInitHelp();
        break;
      case "analyze":
        result = this.renderAnalyzeHelp();
        break;
      case "test":
        result = this.renderTestHelp();
        break;
      case "verify":
        result = this.renderVerifyHelp();
        break;
      case "plugins":
        result = this.renderPluginsParentHelp();
        break;
      case "plugins list":
        result = this.renderPluginsListHelp();
        break;
      default:
        result = this.renderGenericCommandHelp(cmd);
        break;
    }

    return this.boundLines(result);
  }

  private renderStatusHelp(): string {
    const header = this.renderHeader("status", "Command");
    const desc = `  ${this.theme.text("Report runtime health, storage & dependencies")} ${this.theme.dim("[read-only]")}`;

    const usage = [
      this.theme.heading("USAGE"),
      `  $ ${this.theme.brand("legacy-exodus status")} ${this.theme.dim("[options]")}`,
    ].join("\n");

    const options = [
      this.theme.heading("OPTIONS"),
      `  ${this.theme.active("--json".padEnd(16, " "))}  ${this.theme.text("Emit machine-readable JSON status report to stdout")}`,
      `  ${this.theme.active("--theme <name>".padEnd(16, " "))}  ${this.theme.text("Visual theme: classic (default), aurora, mono")}`,
      `  ${this.theme.active("-h, --help".padEnd(16, " "))}  ${this.theme.text("Display this help message")}`,
    ].join("\n");

    const examples = [
      this.theme.heading("EXAMPLES"),
      `  $ ${this.theme.brand("legacy-exodus status")}                       ${this.theme.muted("# Interactive runtime status card")}`,
      `  $ ${this.theme.brand("legacy-exodus status --theme aurora")}        ${this.theme.muted("# Render with soft aurora theme")}`,
      `  $ ${this.theme.brand("legacy-exodus status --json")}                ${this.theme.muted("# JSON output for health probes")}`,
    ].join("\n");

    return [header, desc, "", usage, "", options, "", examples].join("\n");
  }

  private renderInitHelp(): string {
    const header = this.renderHeader("init", "Command");
    const desc = `  ${this.theme.text("Initialize a new workspace configuration")} ${this.theme.dim("[mutates workspace]")}`;

    const usage = [
      this.theme.heading("USAGE"),
      `  $ ${this.theme.brand("legacy-exodus init")} ${this.theme.active("<path>")} ${this.theme.dim("[options]")}`,
    ].join("\n");

    const args = [
      this.theme.heading("ARGUMENTS"),
      `  ${this.theme.active("<path>".padEnd(16, " "))}  ${this.theme.text("Target directory to initialize with workspace metadata")}`,
    ].join("\n");

    const options = [
      this.theme.heading("OPTIONS"),
      `  ${this.theme.active("--json".padEnd(16, " "))}  ${this.theme.text("Emit machine-readable JSON result to stdout")}`,
      `  ${this.theme.active("--theme <name>".padEnd(16, " "))}  ${this.theme.text("Visual theme: classic (default), aurora, mono")}`,
      `  ${this.theme.active("-h, --help".padEnd(16, " "))}  ${this.theme.text("Display this help message")}`,
    ].join("\n");

    const examples = [
      this.theme.heading("EXAMPLES"),
      `  $ ${this.theme.brand("legacy-exodus init ./my-project")}            ${this.theme.muted("# Initialize a new project directory")}`,
      `  $ ${this.theme.brand("legacy-exodus init .")}                       ${this.theme.muted("# Initialize current directory")}`,
      `  $ ${this.theme.brand("legacy-exodus init ./app --json")}            ${this.theme.muted("# Machine-readable initialization")}`,
    ].join("\n");

    return [header, desc, "", usage, "", args, "", options, "", examples].join("\n");
  }

  private renderAnalyzeHelp(): string {
    const header = this.renderHeader("analyze", "Command");
    const desc = `  ${this.theme.text("Analyze repository structure, ASTs, symbols & graph")} ${this.theme.dim("[read-only]")}`;

    const usage = [
      this.theme.heading("USAGE"),
      `  $ ${this.theme.brand("legacy-exodus analyze")} ${this.theme.active("<path>")} ${this.theme.dim("[options]")}`,
    ].join("\n");

    const args = [
      this.theme.heading("ARGUMENTS"),
      `  ${this.theme.active("<path>".padEnd(16, " "))}  ${this.theme.text("Path to the repository or directory to analyze")}`,
    ].join("\n");

    const options = [
      this.theme.heading("OPTIONS"),
      `  ${this.theme.active("--refresh".padEnd(28, " "))}  ${this.theme.text("Force fresh discovery and bypass existing snapshot reuse")}`,
      `  ${this.theme.active("--storage-driver <driver>".padEnd(28, " "))}  ${this.theme.text("Storage driver to use (memory, sqlite)")}`,
      `  ${this.theme.active("--storage-path <path>".padEnd(28, " "))}  ${this.theme.text("Database file path for SQLite storage (infers sqlite driver)")}`,
      `  ${this.theme.active("--json".padEnd(28, " "))}  ${this.theme.text("Emit complete machine-readable discovery inventory in JSON")}`,
      `  ${this.theme.active("--theme <name>".padEnd(28, " "))}  ${this.theme.text("Visual theme: classic (default), aurora, mono")}`,
      `  ${this.theme.active("-h, --help".padEnd(28, " "))}  ${this.theme.text("Display this help message")}`,
    ].join("\n");

    const examples = [
      this.theme.heading("EXAMPLES"),
      `  $ ${this.theme.brand("legacy-exodus analyze ./apps/web")}           ${this.theme.muted("# Analyze web application")}`,
      `  $ ${this.theme.brand("legacy-exodus analyze . --theme aurora")}     ${this.theme.muted("# Analyze current workspace with aurora theme")}`,
      `  $ ${this.theme.brand("legacy-exodus analyze ./repo --json")}        ${this.theme.muted("# Stream JSON discovery inventory to stdout")}`,
      `  $ ${this.theme.brand("legacy-exodus analyze . --refresh")}          ${this.theme.muted("# Force fresh discovery bypassing cached snapshot")}`,
      `  $ ${this.theme.brand("legacy-exodus analyze . --storage-path ./exodus.db")}  ${this.theme.muted("# Persist discovery to SQLite database")}`,
    ].join("\n");

    return [header, desc, "", usage, "", args, "", options, "", examples].join("\n");
  }

  private renderTestHelp(): string {
    const header = this.renderHeader("test", "Command");
    const desc = `  ${this.theme.text("Explore and run test suites filtered by architectural domain")} ${this.theme.dim("[read-only]")}`;

    const usage = [
      this.theme.heading("USAGE"),
      `  $ ${this.theme.brand("legacy-exodus test")} ${this.theme.muted("[domain]")} ${this.theme.dim("[options]")}`,
    ].join("\n");

    const args = [
      this.theme.heading("ARGUMENTS"),
      `  ${this.theme.active("[domain]".padEnd(16, " "))}  ${this.theme.text("Target domain (default: 'all'). Available domains:")}`,
      `                    ${this.theme.muted("runtime, discovery, parser, symbols, semantic,")}`,
      `                    ${this.theme.muted("flow, storage, governance, plugins, cli,")}`,
      `                    ${this.theme.muted("integration, architecture, all")}`,
    ].join("\n");

    const options = [
      this.theme.heading("OPTIONS"),
      `  ${this.theme.active("--list".padEnd(16, " "))}  ${this.theme.text("List all 12 available test domains and dynamic file counts")}`,
      `  ${this.theme.active("-v, --verbose".padEnd(16, " "))}  ${this.theme.text("Emit detailed test execution output")}`,
      `  ${this.theme.active("--bail".padEnd(16, " "))}  ${this.theme.text("Stop execution immediately on first test failure")}`,
      `  ${this.theme.active("--json".padEnd(16, " "))}  ${this.theme.text("Emit machine-readable test results in JSON")}`,
      `  ${this.theme.active("--theme <name>".padEnd(16, " "))}  ${this.theme.text("Visual theme: classic (default), aurora, mono")}`,
      `  ${this.theme.active("-h, --help".padEnd(16, " "))}  ${this.theme.text("Display this help message")}`,
    ].join("\n");

    const examples = [
      this.theme.heading("EXAMPLES"),
      `  $ ${this.theme.brand("legacy-exodus test --list")}                  ${this.theme.muted("# View domain taxonomy and test file counts")}`,
      `  $ ${this.theme.brand("legacy-exodus test parser")}                  ${this.theme.muted("# Run JavaScript/TypeScript parser tests")}`,
      `  $ ${this.theme.brand("legacy-exodus test parser --verbose")}        ${this.theme.muted("# Run parser tests with detailed execution log")}`,
      `  $ ${this.theme.brand("legacy-exodus test symbols")}                 ${this.theme.muted("# Run symbol extraction & export tests")}`,
      `  $ ${this.theme.brand("legacy-exodus test semantic")}                ${this.theme.muted("# Run call-graph & receiver resolution tests")}`,
      `  $ ${this.theme.brand("legacy-exodus test flow")}                    ${this.theme.muted("# Run CFG & DFG flow analysis tests")}`,
      `  $ ${this.theme.brand("legacy-exodus test all --bail")}              ${this.theme.muted("# Run all test suites, aborting on error")}`,
      `  $ ${this.theme.brand("legacy-exodus test parser --json")}           ${this.theme.muted("# Emit parsed JSON test results")}`,
    ].join("\n");

    return [header, desc, "", usage, "", args, "", options, "", examples].join("\n");
  }

  private renderVerifyHelp(): string {
    const header = this.renderHeader("verify", "Command");
    const desc = `  ${this.theme.text("Run complete 4-gate repository verification")} ${this.theme.dim("[read-only]")}`;

    const usage = [
      this.theme.heading("USAGE"),
      `  $ ${this.theme.brand("legacy-exodus verify")} ${this.theme.dim("[options]")}`,
    ].join("\n");

    const gates = [
      this.theme.heading("VERIFICATION GATES"),
      `  ${this.theme.active("1. Static Typecheck".padEnd(28, " "))}  ${this.theme.text("Zero TypeScript compiler errors (tsc --noEmit)")}`,
      `  ${this.theme.active("2. Test Suite".padEnd(28, " "))}  ${this.theme.text("All unit, integration, and architecture test suites")}`,
      `  ${this.theme.active("3. Benchmark Governance".padEnd(28, " "))}  ${this.theme.text("10-point benchmark system self-audit")}`,
      `  ${this.theme.active("4. Working Tree Hygiene".padEnd(28, " "))}  ${this.theme.text("Git diff whitespace and file hygiene check")}`,
    ].join("\n");

    const options = [
      this.theme.heading("OPTIONS"),
      `  ${this.theme.active("--theme <name>".padEnd(16, " "))}  ${this.theme.text("Visual theme: classic (default), aurora, mono")}`,
      `  ${this.theme.active("-h, --help".padEnd(16, " "))}  ${this.theme.text("Display this help message")}`,
    ].join("\n");

    const examples = [
      this.theme.heading("EXAMPLES"),
      `  $ ${this.theme.brand("legacy-exodus verify")}                       ${this.theme.muted("# Execute all 4 verification gates")}`,
      `  $ ${this.theme.brand("legacy-exodus verify --theme aurora")}        ${this.theme.muted("# Verification dashboard in aurora palette")}`,
      `  $ ${this.theme.brand("legacy-exodus verify --theme mono")}          ${this.theme.muted("# Monochrome verification for CI logs")}`,
    ].join("\n");

    return [header, desc, "", usage, "", gates, "", options, "", examples].join("\n");
  }

  private renderPluginsParentHelp(): string {
    const header = this.renderHeader("plugins", "Command Group");
    const desc = `  ${this.theme.text("Inspect registered LegacyExodus plugins and extensions")} ${this.theme.dim("[read-only]")}`;

    const usage = [
      this.theme.heading("USAGE"),
      `  $ ${this.theme.brand("legacy-exodus plugins <command>")} ${this.theme.dim("[options]")}`,
    ].join("\n");

    const commands = [
      this.theme.heading("COMMANDS"),
      `  ${this.theme.active("list".padEnd(16, " "))}  ${this.theme.text("List all registered plugins in an auto-aligning table")}`,
    ].join("\n");

    const options = [
      this.theme.heading("OPTIONS"),
      `  ${this.theme.active("-h, --help".padEnd(16, " "))}  ${this.theme.text("Display this help message")}`,
    ].join("\n");

    const examples = [
      this.theme.heading("EXAMPLES"),
      `  $ ${this.theme.brand("legacy-exodus plugins list")}                 ${this.theme.muted("# Formatted table of loaded plugins")}`,
      `  $ ${this.theme.brand("legacy-exodus plugins list --json")}          ${this.theme.muted("# JSON array of plugin metadata")}`,
    ].join("\n");

    return [header, desc, "", usage, "", commands, "", options, "", examples].join("\n");
  }

  private renderPluginsListHelp(): string {
    const header = this.renderHeader("plugins list", "Command");
    const desc = `  ${this.theme.text("List registered plugins and discovery extensions")} ${this.theme.dim("[read-only]")}`;

    const usage = [
      this.theme.heading("USAGE"),
      `  $ ${this.theme.brand("legacy-exodus plugins list")} ${this.theme.dim("[options]")}`,
    ].join("\n");

    const options = [
      this.theme.heading("OPTIONS"),
      `  ${this.theme.active("--json".padEnd(16, " "))}  ${this.theme.text("Emit machine-readable JSON plugin list to stdout")}`,
      `  ${this.theme.active("--theme <name>".padEnd(16, " "))}  ${this.theme.text("Visual theme: classic (default), aurora, mono")}`,
      `  ${this.theme.active("-h, --help".padEnd(16, " "))}  ${this.theme.text("Display this help message")}`,
    ].join("\n");

    const examples = [
      this.theme.heading("EXAMPLES"),
      `  $ ${this.theme.brand("legacy-exodus plugins list")}                 ${this.theme.muted("# Tabular display of installed plugins")}`,
      `  $ ${this.theme.brand("legacy-exodus plugins list --json")}          ${this.theme.muted("# JSON output of plugin descriptors")}`,
    ].join("\n");

    return [header, desc, "", usage, "", options, "", examples].join("\n");
  }

  private renderGenericCommandHelp(cmd: Command): string {
    const header = this.renderHeader(cmd.name(), "Command");
    const desc = cmd.description() ? `  ${this.theme.text(cmd.description())}` : "";

    const usage = [
      this.theme.heading("USAGE"),
      `  $ ${this.theme.brand(`legacy-exodus ${cmd.name()}`)} ${this.theme.dim("[options]")}`,
    ].join("\n");

    const opts = cmd.options.map((opt) => {
      const paddedFlag = opt.flags.padEnd(20, " ");
      return `  ${this.theme.active(paddedFlag)}  ${this.theme.text(opt.description)}`;
    });

    const options = opts.length > 0 ? [this.theme.heading("OPTIONS"), ...opts].join("\n") : "";

    return [header, desc, "", usage, "", options].filter(Boolean).join("\n");
  }

  private boundLines(content: string): string {
    const maxWidth = this.capabilities.width;
    if (maxWidth <= 0) return content;
    return content
      .split("\n")
      .map((line) => truncateAnsi(line, maxWidth))
      .join("\n");
  }
}
