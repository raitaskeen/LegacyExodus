#!/usr/bin/env bash
# Usage: snap-step.sh <label> <core-dir>  -- runs `analyze --json` on the snapshot project with an isolated key home.
SCR="/c/Users/GRACEC~1/AppData/Local/Temp/claude/C--Users-Grace-Computers-Projects-LegacyExodus--claude-worktrees-review-200-efbe81/e8b4dd69-62ea-43eb-bf08-44d2c6f7b717/scratchpad"
LABEL="$1"; CORE="$2"
OUT="$SCR/logs/snap-$LABEL.json"
( cd "$CORE" && LEGACY_EXODUS_HOME="$SCR/lxhome" bun run src/cli/index.ts analyze "$SCR/snap-proj" --json --storage-driver memory ) > "$OUT" 2> "$SCR/logs/snap-$LABEL.err"
echo "== $LABEL exit=$? core=$CORE"
bun -e '
const fs = require("fs");
const raw = fs.readFileSync(process.argv[1], "utf8"); const start = raw.indexOf("{"); const report = JSON.parse(raw.slice(start));
const r = report.data ?? report.report ?? report;
console.log("  reused:", r.reused, " snapshotAnalysisRunId:", r.snapshotAnalysisRunId ?? "-");
const sem = JSON.parse(fs.readFileSync(process.argv[2] + "/.discovery/semantic.json", "utf8"));
const call = sem.calls.find((c) => c.calleeName === "this.handle");
console.log("  semantic.json this.handle:", call?.resolutionState);
const manifest = JSON.parse(fs.readFileSync(process.argv[2] + "/.discovery/manifest.json", "utf8"));
console.log("  manifest analysisRunId:", manifest.analysis?.analysisRunId ?? "-", " analyzer:", (manifest.analyzer?.fingerprint ?? manifest.analysis?.analyzerFingerprint ?? manifest.engine?.analyzerFingerprint ?? JSON.stringify(manifest).match(/lx-analyzer-v1:[0-9a-f]{12}/)?.[0] ?? "-"));
' "$OUT" "$SCR/snap-proj"
