#!/usr/bin/env bash
# Claude Code test (multi-session notebooks, section 2 of docs/proposals/multi-session-progress.md):
# the terminal CLI sets CLAUDE_CODE_SESSION_ID in the environment of Bash tool commands, and --resume /
# --continue keep the same id (--fork-session gets a new one). Real `claude -p` sessions (haiku).
# Usage: scripts/verify/cc-session-id.sh <empty-work-dir>     (needs the Claude API)
set -uo pipefail
W="$1"; mkdir -p "$W"; cd "$W"
pass(){ echo "PASS  $*"; }
fail(){ echo "FAIL  $*"; FAILED=1; }
FAILED=0
P='Run this exact bash command and reply with only its output: printenv CLAUDE_CODE_SESSION_ID'
# Unset the variables a parent Claude Code session would leak into this one.
run(){ env -u CLAUDE_CODE_SESSION_ID -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT \
  claude -p "$P" --allowedTools "Bash(printenv:*)" --model haiku --setting-sources project,local --output-format json "$@" < /dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.session_id+" "+String(j.result).trim())})'; }
check(){ read -r id env <<<"$2"; echo "$1 -> session_id=$id env=$env"; }

R1=$(run); check fresh "$R1"; read -r ID ENV <<<"$R1"
[[ -n "$ID" && "$ENV" == "$ID" ]] && pass "fresh: the env var equals the session id" || fail "fresh: $R1"
R2=$(run --resume "$ID"); check resume "$R2"
[[ "$R2" == "$ID $ID" ]] && pass "--resume keeps the id" || fail "--resume: $R2"
R3=$(run --continue); check continue "$R3"
[[ "$R3" == "$ID $ID" ]] && pass "--continue keeps the id" || fail "--continue: $R3"
R4=$(run --resume "$ID" --fork-session); check fork "$R4"; read -r FID FENV <<<"$R4"
[[ "$FID" != "$ID" && "$FENV" == "$FID" ]] && pass "--fork-session gets a new id, and the env var follows it" || fail "--fork-session: $R4"
exit $FAILED
