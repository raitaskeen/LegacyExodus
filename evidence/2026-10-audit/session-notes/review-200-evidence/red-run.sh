#!/usr/bin/env bash
# Usage: red-run.sh <source-commit> <test-commit> <label>
# Exports legacy-exodus-core at <source-commit> into an isolated dir, overlays the
# regression test file from <test-commit>, and runs only that file.
set -u
SCR="/c/Users/GRACEC~1/AppData/Local/Temp/claude/C--Users-Grace-Computers-Projects-LegacyExodus--claude-worktrees-review-200-efbe81/e8b4dd69-62ea-43eb-bf08-44d2c6f7b717/scratchpad"
REPO="/c/Users/Grace Computers/Projects/LegacyExodus/.claude/worktrees/review-200-efbe81"
SRC_COMMIT="$1"; TEST_COMMIT="$2"; LABEL="$3"
D="$SCR/red/core"
rm -rf "$D" "$SCR/red/tmp-x"; mkdir -p "$SCR/red/tmp-x"
git -C "$REPO" archive "$SRC_COMMIT" legacy-exodus-core | tar -x -C "$SCR/red/tmp-x"
mv "$SCR/red/tmp-x/legacy-exodus-core" "$D"; rm -rf "$SCR/red/tmp-x"
mv "$SCR/red/node_modules" "$D/node_modules"
T=tests/unit/semantic/call-resolution-soundness.test.ts
git -C "$REPO" show "$TEST_COMMIT:legacy-exodus-core/$T" > "$D/$T"
echo "source=$(git -C "$REPO" rev-parse $SRC_COMMIT) test=$(git -C "$REPO" rev-parse $TEST_COMMIT)" > "$SCR/logs/red-$LABEL.log"
( cd "$D" && bun test "$T" ) >> "$SCR/logs/red-$LABEL.log" 2>&1
mv "$D/node_modules" "$SCR/red/node_modules"
grep -E '^\s*[0-9]+ (pass|fail)|Ran ' "$SCR/logs/red-$LABEL.log"
