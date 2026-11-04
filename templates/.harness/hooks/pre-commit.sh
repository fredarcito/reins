#!/bin/sh
# harness: check the architecture of the staged files. Called by .husky/pre-commit or lefthook.
# Bypassable with --no-verify; CI is the real guarantee.
files=$(git diff --cached --name-only --diff-filter=ACMR | tr '\n' ',' | sed 's/,$//')
[ -z "$files" ] && exit 0
exec npx --no-install harness check --files "$files"
