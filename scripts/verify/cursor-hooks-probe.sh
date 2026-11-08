#!/usr/bin/env bash
# Cursor hooks probe (docs/proposals/agent-adapters.md, step 1). Manual: Cursor has no headless agent here.
# Builds a project whose Cursor hooks (.cursor/hooks.json) and Claude Code format hooks (.claude/settings.json) log
# their input to probe.log and answer with keywords. Then, in Cursor: open the folder, start an Agent chat and paste
# the prompt printed below; the agent's answer says which keywords reached the model, probe.log says what each hook got.
# Usage: scripts/verify/cursor-hooks-probe.sh <empty-dir>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
P="$1"; mkdir -p "$P/.cursor/hooks" "$P/.claude" "$P/src"; cd "$P"
cp "$HERE/cursor-hooks-probe/probe.mjs" .cursor/hooks/probe.mjs
node -e '
const ev=["sessionStart","preToolUse","postToolUse","beforeReadFile","afterFileEdit","beforeShellExecution","preCompact","stop"];
const h={}; for (const e of ev) h[e]=[{command:`node .cursor/hooks/probe.mjs ${e}`}];
require("fs").writeFileSync(".cursor/hooks.json", JSON.stringify({version:1,hooks:h},null,2));
const c=(e,m)=>({...(m?{matcher:m}:{}),hooks:[{type:"command",command:`node "$CLAUDE_PROJECT_DIR"/.cursor/hooks/probe.mjs claude-${e}`}]});
require("fs").writeFileSync(".claude/settings.json", JSON.stringify({hooks:{SessionStart:[c("SessionStart","startup|compact|clear")],PreToolUse:[c("PreToolUse","Read|Edit|Write|MultiEdit")]}},null,2));'
printf 'export const a = 1;\n' > src/a.js; printf 'export const b = 2;\n' > src/b.js; git init -q
cat <<'PROMPT'
Open this folder in Cursor, start a new Agent chat and paste:

Read src/a.js. Then add the comment "// probe" at the top of src/b.js. Then run this in the terminal: printenv | grep -i -E 'session|conversation|reins|cursor|claude'. Finally, list every keyword in your context that looks like WORD-NUMBER (for example TORTUGA-7) and say where each one came from. Do not search the files for them; only report what you already see in your context.
PROMPT
