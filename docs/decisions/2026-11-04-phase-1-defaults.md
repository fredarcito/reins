# Phase 1 defaults

| Topic | Decision |
| --- | --- |
| npm scope at runtime | Not hardcoded. The CLI derives it from its own `package.json` name (`SCOPE`). The scope only appears literally in package names, dependency keys and import specifiers, which `scripts/rename-scope.mjs` rewrites (it skips `docs/DESIGN.md`, `docs/VERIFIED.md` and `scripts/verify/`, which are historical records) |
| Versions | `0.0.0` until phase 9 (`0.1.0`, unpublished). No `license` field until the license is decided |
| Internal deps | `workspace:^` for core in the cli (dependency) and in adapters (peer + dev). `pnpm pack` turns it into a real range |
| `exports` | Every package exposes `./package.json` as well, so the CLI can read an adapter's `reins.contract` |
| Tests | `node --test "test/**/*.test.js"` in each package (an explicit glob: with no arguments node also runs the fixtures under `test/`). Root runs `pnpm -r test` plus `scripts/*.test.mjs` |
| Linter | Own script without dependencies (`scripts/lint.mjs`): syntax, import boundaries (interim self-check until phase 9), AGENTS.md rules, package metadata. No ESLint/Prettier: not worth a dependency yet |
| CI | GitHub Actions, Node 22 (minimum) and 24, pnpm 12.11.2 pinned in the workflow (matches the local version and the lockfile) |
