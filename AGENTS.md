# harness

Monorepo of the harness for coding agents. Design (Spanish, source of truth): `docs/DESIGN.md`.
Commands: `pnpm install` · `pnpm lint` · `pnpm test`

## Always
- Never commit, push, open a PR or `npm publish`. Leave changes uncommitted. Never use `--no-verify`.
- Everything written into the repo is in English (code, comments, docs, templates, CLI messages).
- Node >= 22, ESM, JavaScript with JSDoc types, no build step. Tests use `node:test`, next to the code.
- Dependency direction: `cli` -> `adapters` -> `core`. `core` never imports `cli` or adapters; adapters only import `@harness/core/contract`.
- `core` knows no framework: anything specific to JS, Vite or Next lives in `packages/adapters/js`.
- Don't run tests per subtask: run `pnpm lint && pnpm test` once at the end and say what was verified and what wasn't.
- No per-folder `AGENTS.md`/`CLAUDE.md`. This file stays at 30 lines or fewer.
- Stop only for an ambiguous decision with consequences, growing scope, an irreversible action or repeated failures.

## On demand
- New dependency -> justify it in `docs/DECISIONS.md`.
- Assumption about Claude Code, hooks, permissions or skills you haven't tested -> record it in `docs/VERIFIED.md` as unverified.
- Stable vs experimental status of each piece -> `docs/STATUS.md`.
- `README.md` is the team's documentation: update it (with diagrams) whenever a phase changes what exists.
- Renaming the npm scope -> `pnpm rename-scope <@scope>`; never edit package names by hand.
