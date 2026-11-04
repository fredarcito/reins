# Decisions

Source of truth for the design: [`DESIGN.md`](DESIGN.md). This file summarizes what is already decided, the build defaults, and what remains open. Every new dependency is justified in the "Dependencies" section.

## Decided in the design (summary)

- **Three layers:** deterministic core (`architecture.yml`, `baseline.json`, `check`, git hook, CI), portable markdown content, and thin generated tool adapters (`.claude/`, Husky).
- **Only the core is enforced.** Anything that depends on the agent reading or writing files is an instruction and is marked experimental.
- **The core knows no framework.** It only sees edges `{ from, to, kind }`. Everything specific lives in adapters with a versioned contract (`contract: 1`: `detect`, `graph`).
- **Dependency direction:** `cli` → `adapters` → `core`. `core` doesn't import from `cli` or `adapters`. Adapters only see `@harness/core/contract` (enforced with `exports`).
- **Adapters are installed separately**, with `@harness/core` as a `peerDependency` and `"harness": { "contract": 1 }`. The CLI says which one is missing; it installs nothing.
- **`check`:** rules `layer-direction`, `domain-boundary`, `no-cycles`; baseline (only new violations fail); integrity of `architecture.yml`, `baseline.json` and generated files. Runs in pre-commit (touched files) and CI (everything). CI plus branch protection is the real guarantee.
- **`doctor` separate from `check`:** local, informational (exit code 0 unless `--strict`), never in CI or the hook, no baseline or adapter.
- **The agent never commits, pushes or opens PRs, and never uses `--no-verify`.**
- **`AGENTS.md` of at most 30 lines**, no per-folder `AGENTS.md`/`CLAUDE.md`. `CLAUDE.md` only contains `@AGENTS.md`.
- **`sync` only touches what it generated** (manifest) and never deletes third-party skills, agents or settings. Own names use the `harness-` prefix.
- **`backlog/` and `progress/` are local** (outside git).
- **Discarded:** delegator agent, one agent per subtask as the norm, general orchestrator, memory database.

## Build defaults

| Topic | Decision |
| --- | --- |
| Language | Everything written in this repo (code, comments, docs, templates, CLI messages) is in English. `docs/DESIGN.md` is the original Spanish draft and stays as is; template texts taken from it are translated |
| Runtime | Node ≥ 22 (raised from 20 on 2026-11-04 at the user's request: 22 is the current standard), ESM, JavaScript with JSDoc types, no build step |
| Package manager | pnpm with workspaces (`packages/*`, `packages/adapters/*`). No `packageManager` field: pinning a version made corepack download a different one; the installed pnpm (12.11.2) is used |
| Tests | `node:test` |
| CLI | `node:util` `parseArgs`, no framework |
| npm scope | `@harness/*` as a placeholder, kept in one place and changeable with `scripts/rename-scope.mjs` (final name pending) |
| Status | Each piece is **stable** (enforced and tested) or **experimental**, in `docs/STATUS.md` and the README |
| Git | The agent building this repo does not commit, push, open PRs or publish |

## Phase 1 defaults

| Topic | Decision |
| --- | --- |
| npm scope at runtime | Not hardcoded. The CLI derives it from its own `package.json` name (`SCOPE`). The scope only appears literally in package names, dependency keys and import specifiers, which `scripts/rename-scope.mjs` rewrites (it skips `docs/DESIGN.md`, `docs/VERIFIED.md` and `scripts/verify/`, which are historical records) |
| Versions | `0.0.0` until phase 9 (`0.1.0`, unpublished). No `license` field until the license is decided |
| Internal deps | `workspace:^` for core in the cli (dependency) and in adapters (peer + dev). `pnpm pack` turns it into a real range |
| `exports` | Every package exposes `./package.json` as well, so the CLI can read an adapter's `harness.contract` |
| Tests | `node --test` with no arguments in each package. Root runs `pnpm -r test` plus `scripts/*.test.mjs` |
| Linter | Own script without dependencies (`scripts/lint.mjs`): syntax, import boundaries (interim self-check until phase 9), AGENTS.md rules, package metadata. No ESLint/Prettier: not worth a dependency yet |
| CI | GitHub Actions, Node 22 (minimum) and 24, pnpm 12.11.2 pinned in the workflow (matches the local version and the lockfile) |

## Dependencies

| Package | Where | Why |
| --- | --- | --- |
| `yaml` | `core` | Read `architecture.yml` and `doctor.yml`. Node has no YAML parser |
| `dependency-cruiser` | `adapters/js` only | Compute the import graph (with aliases). Decided in the design over writing our own parser |

## Design adjustments proposed after phase 0

They come from [`VERIFIED.md`](VERIFIED.md). Pending your OK.

1. **Notes via hook (P1) — accepted 2026-11-04:** `PreToolUse` context arrives after the model wrote the edit. Decision: the hook matches `Read|Edit|Write|MultiEdit` and delivers each note at most once per session (keyed by `session_id`). The `AGENTS.md` index line stays as the tool-agnostic path. Still unverified (P1 in VERIFIED.md); the "deny first edit" variant is not built.
2. **Git permissions (P2) — deferred 2026-11-04, design kept as is:** `Bash(git commit:*)` is bypassed with `git -c x=y commit` or `bash -c '...'`. For now we build what the design says (deny rules for `git commit` and `git push` only); no extra `Bash` hook. The known bypass stays documented in VERIFIED.md and STATUS.md, and branch protection + CI remain the real guarantee.
3. **`CLAUDE.md` (P3):** Claude Code 2.1.318 already reads `AGENTS.md` on its own. `CLAUDE.md` with `@AGENTS.md` is kept for compatibility (costs ~124 tokens, no duplication).
4. **Adapter resolution (P7):** the CLI resolves the adapter from the project root, not from its own location, and checks `harness.contract` itself, because pnpm only warns on an incompatible peer.
5. **Aliases (P6):** dependency-cruiser doesn't resolve `@/` without help. The adapter reads `paths` from tsconfig/jsconfig and Vite's `resolve.alias`. The phase 3 examples will include `tsconfig.app.json` with references and `vite.config.ts`.
6. **Plain JS/JSX projects are a requirement** (your request, 2026-11-04): `adapter-js` must work on `.js`/`.jsx`/`.mjs`/`.cjs` projects with no TypeScript at all, as well as `.ts`/`.tsx`. Consequences: `typescript` is not a dependency of the adapter; it parses `jsconfig.json`/`tsconfig.json` `paths` itself and passes them as `alias` (verified to work without `typescript`, P6); the examples include at least one pure JS/JSX project (`examples/vite-react` will be JS/JSX with `jsconfig.json`, `examples/next-app` TS).

## Open

- **Repo name and final npm scope — deferred 2026-11-04.** Only the author and the team will try it for now, installing from tarballs; nothing is published. `@harness/*` stays as the placeholder, kept in one place so `scripts/rename-scope.mjs` can change it later. (`@harness/*` has no published packages, but we couldn't confirm the organization is free.)
- **License.** No `LICENSE` until decided.
- From the design, undecided: whether the team's repos share a base `architecture.yml`; what to do with monorepos; who updates the baseline and with what review.
