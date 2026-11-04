#!/usr/bin/env bash
# Vendored tarballs (inside the consumer repo) must work for a fresh clone in another path, like CI.
# Usage: run `pnpm pack:all` first, then: scripts/verify/<this script> <empty-work-dir>
set -uo pipefail
R="$(cd "$(dirname "$0")/../.." && pwd)"
W="$1"; mkdir -p "$W" && cd "$W"
git init -q --bare origin.git
cp -R "$R/examples/vite-react" app && cd app
printf 'node_modules/\n' > .gitignore
echo '{ "name": "v", "private": true, "type": "module" }' > package.json
mkdir -p vendor/reins && cp "$R"/.tarballs/*.tgz vendor/reins/
npm install -D --silent ./vendor/reins/*.tgz >/dev/null 2>&1
grep -E '"reins"' package.json
npx reins check --update-baseline >/dev/null
git init -q -b main && git add -A && git -c user.email=a@b -c user.name=a commit -qm v
git remote add origin ../origin.git && git push -q origin main
mkdir -p "$W/deep/er/path" && cd "$W/deep/er/path"
git clone -q "$W/origin.git" ci && cd ci
npm ci --silent >/dev/null 2>&1; echo "npm ci exit=$?"
GITHUB_BASE_REF=main npx reins check | tail -2
echo "check exit=${PIPESTATUS[0]}"
