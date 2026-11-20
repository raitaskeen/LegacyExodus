#!/bin/bash
# usage: run.sh <probe-name> [entry]  -- runs engine (calls) and node on probe folder
S=/c/Users/TECHPL~1/AppData/Local/Temp/claude/205eb06ba3921292/59b15869-cc60-450c-8a88-67d2ad9a8051/scratchpad
P=$S/p/$1
ENTRY=${2:-main.js}
cd /c/Projects/LegacyExodus/.claude/worktrees/redteam-main-rules-75fb2c/legacy-exodus-core
echo "--- engine ($1)"
bun run benchmarks/.probe-run.ts "$P" calls 2>&1 | grep -v "^$" | sed 's/^calls  //' | grep -vE "\|(EXTERNAL\|(console\.log|globalThis\.console\.log)|EXTERNAL\|node:console)" 
echo "--- node"
(cd "$P" && node "$ENTRY" 2>&1 | head -20)
