import type { TerminalCapabilities } from "./capabilities";
import { createSymbols, type Symbols } from "./symbols";
import { createTheme, type Theme } from "./theme";

export interface ProgressPhase {
  readonly id: string;
  readonly name: string;
  readonly status: "pending" | "running" | "completed" | "failed";
  readonly details?: string;
  readonly durationMs?: number;
}

export class ProgressTracker {
  public readonly theme: Theme;
  public readonly symbols: Symbols;
  private readonly phases: Map<string, ProgressPhase> = new Map();
  private spinnerIdx = 0;
  private timer: Timer | null = null;

  public constructor(
    public readonly capabilities: TerminalCapabilities,
    private readonly stream: NodeJS.WriteStream = process.stdout,
  ) {
    this.theme = createTheme(capabilities);
    this.symbols = createSymbols(capabilities);
  }

  public registerPhases(phases: readonly { id: string; name: string }[]): void {
    for (const p of phases) {
      this.phases.set(p.id, { id: p.id, name: p.name, status: "pending" });
    }
  }

  public startPhase(phaseId: string, details?: string): void {
    const p = this.phases.get(phaseId);
    if (!p) return;

    this.phases.set(phaseId, { ...p, status: "running", details });
    if (this.capabilities.mode === "ci" || this.capabilities.mode === "plain") {
      const msg = details ? ` (${details})` : "";
      this.stream.write(`[INFO] Starting ${p.name}${msg}...\n`);
    } else {
      this.renderInteractive();
    }
  }

  public completePhase(phaseId: string, details?: string, durationMs?: number): void {
    const p = this.phases.get(phaseId);
    if (!p) return;

    this.phases.set(phaseId, { ...p, status: "completed", details, durationMs });
    if (this.capabilities.mode === "ci" || this.capabilities.mode === "plain") {
      const dur = durationMs ? ` in ${durationMs.toFixed(0)}ms` : "";
      const msg = details ? ` [${details}]` : "";
      this.stream.write(`[PASS] ${p.name}${msg}${dur}\n`);
    } else {
      this.renderInteractive();
    }
  }

  public failPhase(phaseId: string, errorMsg?: string): void {
    const p = this.phases.get(phaseId);
    if (!p) return;

    this.phases.set(phaseId, { ...p, status: "failed", details: errorMsg });
    if (this.capabilities.mode === "ci" || this.capabilities.mode === "plain") {
      this.stream.write(`[FAIL] ${p.name}: ${errorMsg || "Failed"}\n`);
    } else {
      this.renderInteractive();
    }
  }

  public startAnimation(): void {
    if (this.capabilities.mode !== "interactive") return;
    if (this.timer !== null) return;

    this.timer = setInterval(() => {
      this.spinnerIdx = (this.spinnerIdx + 1) % this.symbols.spinnerFrames.length;
      this.renderInteractive();
    }, 80);
  }

  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private renderInteractive(): void {
    if (this.capabilities.mode !== "interactive") return;

    const frame = this.symbols.spinnerFrames[this.spinnerIdx] ?? "⠋";
    const lines: string[] = [];

    for (const phase of this.phases.values()) {
      let icon = this.theme.muted("○");
      let nameText = this.theme.muted(phase.name);
      let detailsText = "";

      if (phase.status === "completed") {
        icon = this.theme.success(this.symbols.success);
        nameText = this.theme.text(phase.name);
        const dur = phase.durationMs ? ` (${phase.durationMs.toFixed(0)}ms)` : "";
        detailsText = this.theme.muted(`${phase.details ? ` [${phase.details}]` : ""}${dur}`);
      } else if (phase.status === "running") {
        icon = this.theme.active(frame);
        nameText = this.theme.active(phase.name);
        detailsText = this.theme.muted(phase.details ? ` [${phase.details}]` : "");
      } else if (phase.status === "failed") {
        icon = this.theme.error(this.symbols.failure);
        nameText = this.theme.error(phase.name);
        detailsText = this.theme.error(phase.details ? ` (${phase.details})` : "");
      }

      lines.push(`  ${icon} ${nameText}${detailsText ? ` ${detailsText}` : ""}`);
    }

    // In a live terminal, we write progress line updates cleanly
  }
}
