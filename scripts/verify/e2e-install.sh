#!/usr/bin/env bash
# End-to-end install test (phase 8): tarballs + real Husky in a copy of examples/vite-react.
#   1. reins install + reins init on a fresh repo
#   2. the pre-commit hook lets a clean commit through and blocks a commit with a new violation
#   3. CI simulation: someone without hooks pushes a violation; a fresh clone running the workflow steps fails
# Usage: scripts/verify/e2e-install.sh <empty-work-dir>     (needs network for husky and dependency-cruiser)
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
W="$1"; mkdir -p "$W"; cd "$W"
pass(){ echo "PASS  $*"; }
fail(){ echo "FAIL  $*"; FAILED=1; }
FAILED=0
G=(-c user.email=dev@example.com -c user.name=dev)

(cd "$REPO" && pnpm pack:all >/dev/null) || { echo "pack failed"; exit 1; }
T="$REPO/.tarballs"

# --- 1. fresh repo, install, init -------------------------------------------------------------
git init -q --bare origin.git
cp -R "$REPO/examples/vite-react" app && rm -rf app/.reins && cd app
cat > package.json <<'EOF'
{ "name": "e2e-app", "private": true, "type": "module", "scripts": { "dev": "vite" } }
EOF
printf 'node_modules/\n' > .gitignore
git init -q -b main && git add -A && git "${G[@]}" commit -qm "app" && git remote add origin ../origin.git
npm install -D --silent "$T"/*.tgz husky@9 >/dev/null 2>&1 || { echo "npm install failed"; exit 1; }
npx husky init >/dev/null && : > .husky/pre-commit       # husky init writes "npm test"; start empty
npx reins install > ../install.log; cat ../install.log
grep -q "created .husky/pre-commit\|appended to .husky/pre-commit" ../install.log && pass "install wired the Husky hook" || fail "Husky hook not wired"
[ -f .github/workflows/reins.yml ] && pass "workflow written" || fail "workflow missing"
npx reins init > /dev/null && pass "init drafted the plan" || fail "init failed"
npx reins check > /dev/null && pass "check is green after init" || fail "check not green after init"

# --- 2. hook ------------------------------------------------------------------------------------
git add -A
if git "${G[@]}" commit -qm "adopt reins" > ../commit1.log 2>&1; then pass "clean commit goes through the hook"; else fail "clean commit blocked"; cat ../commit1.log; fi
git push -q origin main
printf "import { CartSummary } from '@/features/cart';\nexport const m = CartSummary;\n" > src/lib/money.js
git add src/lib/money.js
if git "${G[@]}" commit -qm "violation" > ../commit2.log 2>&1; then fail "commit with a violation went through"; else
  grep -q "layer-direction  src/lib/money.js" ../commit2.log && pass "hook blocked the commit with rule, why and fix" || { fail "hook failed for another reason"; cat ../commit2.log; }
fi
git reset -q HEAD src/lib/money.js && rm src/lib/money.js
cd ..

# --- 3. CI ----------------------------------------------------------------------------------------
# A developer (or an agent) without the hooks installed: fresh clone, no npm install, so no Husky.
git clone -q origin.git nohooks && cd nohooks && git checkout -q -b feat/money
printf "import { CartSummary } from '@/features/cart';\nexport const m = CartSummary;\n" > src/lib/money.js
git add -A && git "${G[@]}" commit -qm "violation without hooks" && pass "without hooks the violation can be committed (expected)"
git push -q origin feat/money; cd ..

ci(){ # branch -> runs the workflow steps in a fresh full clone, prints exit code
  rm -rf ci && git clone -q origin.git ci && cd ci && git checkout -q "$1"
  npm ci --silent >/dev/null 2>&1 || { echo "npm ci failed"; cd ..; return 99; }
  GITHUB_BASE_REF=main npx reins check > ../ci-"${1//\//-}".log 2>&1; local code=$?; cd ..; return $code
}
ci main; [ $? -eq 0 ] && pass "CI on main: green" || { fail "CI on main not green"; cat ci-main.log; }
ci feat/money; code=$?
if [ $code -eq 1 ] && grep -q "layer-direction  src/lib/money.js" ci-feat-money.log; then pass "CI on the PR branch: fails with the new violation"; else fail "CI on the PR branch: exit $code"; cat ci-feat-money.log; fi

echo; [ $FAILED -eq 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit $FAILED
