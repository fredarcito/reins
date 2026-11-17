# Build defaults

| Topic | Decision |
| --- | --- |
| Language | Everything written in this repo (code, comments, docs, templates, CLI messages) is in English. `docs/DESIGN.md` is the original Spanish draft and stays as is; template texts taken from it are translated |
| Runtime | Node ≥ 22 (raised from 20 on 2026-11-04 at the user's request: 22 is the current standard), ESM, JavaScript with JSDoc types, no build step |
| Package manager | pnpm with workspaces (`packages/*`, `packages/adapters/*`). No `packageManager` field: pinning a version made corepack download a different one; the installed pnpm (12.11.2) is used |
| Tests | `node:test` |
| CLI | `node:util` `parseArgs`, no framework |
| npm scope | `@agentreins/*` (decided 2026-11-04, see "Name"), kept in one place and changeable with `scripts/rename-scope.mjs` |
| Status | Each piece is **stable** (enforced and tested) or **experimental**, in `docs/STATUS.md` and the README |
| Git | The agent building this repo does not commit, push, open PRs or publish |
