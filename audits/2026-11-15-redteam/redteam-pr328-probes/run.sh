#!/bin/sh
# usage: run.sh <probe-dir-name> [entry=main.js] [grep-filter]
S="${S:?set S to the folder holding probes/ and main-wt/}"
P="$S/probes/$1"; E="${2:-main.js}"; F="${3:-.}"
PR="C:/Projects/LegacyExodus/.claude/worktrees/redteam-c1c-35f2d2/legacy-exodus-core"
MAIN="$S/main-wt/legacy-exodus-core"
echo "== node $1/$E"; (cd "$P" && node "$E" 2>&1 | head -8)
echo "== PR";   (cd "$PR" && bun run benchmarks/.probe-run.ts "$P" calls 2>&1 | grep -E "$F")
echo "== main"; (cd "$MAIN" && bun run benchmarks/.probe-run.ts "$P" calls 2>&1 | grep -E "$F")
