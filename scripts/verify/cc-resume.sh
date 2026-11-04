#!/usr/bin/env bash
# Claude Code test (phase 10): the SessionStart hook installed by `harness sync` restores the task after a
# compaction. Tarballs installed in a copy of examples/vite-react, real `claude -p` sessions (haiku).
#   1. startup: the notebook and the module note of the changed files arrive as context
#   2. the notebook and the note change, then /compact: the new versions arrive (they can only come from the hook,
#      not from the compaction summary)
# Usage: scripts/verify/cc-resume.sh <empty-work-dir>     (needs network for dependency-cruiser and the Claude API)
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
W="$1"; mkdir -p "$W"; cd "$W"
pass(){ echo "PASS  $*"; }
fail(){ echo "FAIL  $*"; FAILED=1; }
FAILED=0
G=(-c user.email=dev@example.com -c user.name=dev)
CC=(--setting-sources project,local --model haiku --output-format json)
Q='Without using any tool, answer in one line: the NEXT STEP keyword from the progress notebook and the RULE keyword from the cart module note, or NONE for each one you cannot see in your context.'
answer(){ tail -n1 "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result))'; }

(cd "$REPO" && pnpm pack:all >/dev/null) || { echo "pack failed"; exit 1; }
cp -R "$REPO/examples/vite-react" app && rm -rf app/.harness && cd app
printf '{ "name": "cc-resume", "private": true, "type": "module" }\n' > package.json
printf 'node_modules/\n' > .gitignore
git init -q -b main && git add -A && git "${G[@]}" commit -qm app
npm install -D --silent "$REPO"/.tarballs/harness-*.tgz >/dev/null 2>&1 || { echo "npm install failed"; exit 1; }
npx --no-install harness install >/dev/null && npx --no-install harness init >/dev/null
npx --no-install harness notes new cart > ../notes-new.log; cat ../notes-new.log
grep -q "Used by" .harness/notes/cart.md && pass "notes new drafted the cart note from the graph" || fail "cart note draft"
note(){ printf -- '---\npaths: ["src/features/cart/**"]\n---\n## Purpose\nThe cart.\n## Decisions\n- 2026-11-04: RULE keyword %s.\n' "$1" > .harness/notes/cart.md; }
note ALFA-1
git add -A && git "${G[@]}" commit -qm harness
git switch -qc feat/coupons
echo 'export const coupon = 1;' >> src/features/cart/cartStore.js
nb(){ printf '# feat/coupons · status: open · updated: 2026-11-04\n**Goal:** coupons in the cart.\n**Next step:** NEXT STEP keyword %s.\n' "$1" > .harness/progress/feat-coupons.md; }
mkdir -p .harness/progress && nb TORTUGA-1
jq -r '.hooks.SessionStart[0].hooks[0].command' .claude/settings.json | grep -q 'harness resume --hook' && pass "sync installed the SessionStart hook" || fail "SessionStart hook missing"

SID=$(node -e 'console.log(crypto.randomUUID())')
claude -p "$Q" --session-id "$SID" "${CC[@]}" < /dev/null > ../s1.json 2>&1
A1=$(answer ../s1.json); echo "startup  -> $A1"
[[ "$A1" == *TORTUGA-1* && "$A1" == *ALFA-1* ]] && pass "startup: notebook and note arrive" || fail "startup: $A1"

nb TORTUGA-2; note ALFA-2
claude -p "/compact" --resume "$SID" "${CC[@]}" < /dev/null > ../s2.json 2>&1
claude -p "$Q Give the current values, not earlier ones." --resume "$SID" "${CC[@]}" < /dev/null > ../s3.json 2>&1
A3=$(answer ../s3.json); echo "compact  -> $A3"
[[ "$A3" == *TORTUGA-2* ]] && pass "after compaction: the updated notebook arrives" || fail "notebook after compaction: $A3"
[[ "$A3" == *ALFA-2* ]] && pass "after compaction: the updated note arrives again" || fail "note after compaction: $A3"
exit $FAILED
