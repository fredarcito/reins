# What is verified

Record of what we assume about external tools (Claude Code, pnpm, dependency-cruiser, npm) and whether it has been checked. Anything not marked **pass** here is not taken as true.

Test environment (2026-11-04): macOS (Darwin 25.6), Node 22.21.1 (minimum supported since phase 1: Node 22), Claude Code 2.1.318, pnpm 12.11.2 (and 11.22.0, see P7), dependency-cruiser 18.7.2, typescript 5.

Scripts to rerun them: [`scripts/verify/`](../scripts/verify/). The Claude Code tests use `claude -p --output-format stream-json --setting-sources project,local` so that user settings (global hooks) don't interfere. The prompts and fixture contents in those scripts are in Spanish because that is how the tests were run; they are kept verbatim for reproducibility. The full evidence (JSONL) stayed in a temporary session folder; the relevant parts are below.

## Summary

| # | Assumption | Result | Changes the design |
| --- | --- | --- | --- |
| P1 | A `PreToolUse` hook delivers context when editing a given path | **Pass, with a caveat** | Yes: the context arrives late, see P1 |
| P2 | Permissions denying `git commit` and `git push` block them | **Partial pass** | Yes: they can be bypassed, see P2 |
| P3 | `CLAUDE.md` with `@AGENTS.md` loads the content | **Pass** (and it isn't needed) | Barely: see P3 |
| P4 | A "read X on demand" line in `AGENTS.md` gets X read | **Pass (2/2, one model only)** | No |
| P5 | Skills in `.claude/skills/<n>/SKILL.md` load by description | **Pass (1/1, one model only)** | No |
| P6 | `@/` aliases with dependency-cruiser in Vite and Next | **Pass if the adapter passes the config**; fails on its own | Confirms it belongs in the adapter |
| P7 | `peerDependencies` on `@harness/core` with pnpm | **Pass** | Yes, two details: see P7 |
| P8 | npm scope `@harness` is free | **Could not be fully tested** | Pending decision |

## P1. `PreToolUse` hook with per-path context — pass, with a caveat

Test: `.claude/settings.json` with a `PreToolUse` hook (matcher `Edit|Write|MultiEdit`) that logs its input and, if `tool_input.file_path` contains `src/billing`, prints `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"NOTA ... ZANAHORIA-42"}}`. The prompt asked to edit one file in `src/billing` and one in `src/search`.

Evidence:
- The hook ran on both edits and received `tool_name` and an absolute `tool_input.file_path`.
- The model quoted verbatim: `PreToolUse:Edit hook additional context: NOTA del módulo billing: la palabra clave es ZANAHORIA-42.` Only for `billing`, not for `search`.

**Caveat that changes the design:** the context arrives *after the model has already written the edit*. The note cannot influence that first edit of the file, only later ones. Proposal (unverified): also hook the `Read` matcher (the agent almost always reads before editing) and don't repeat the note within the same session (`session_id` is in the hook input). A stronger alternative: deny the first edit with the note as the reason so the agent redoes it; more intrusive, untested.

## P2. Permissions denying `git commit` / `git push` — partial pass

Test: `permissions.deny: ["Bash(git commit:*)", "Bash(git push:*)"]` in the project's `.claude/settings.json`. Each command was requested verbatim, once, with haiku; most in `--permission-mode bypassPermissions` (the most permissive mode).

| Command | Mode | Result |
| --- | --- | --- |
| `git commit -m t2d --allow-empty` | default + `--allowedTools Bash` | Blocked |
| `git add -A && git commit ...` | bypassPermissions | Blocked (subcommands are analyzed) |
| `git push origin main` | bypassPermissions | Blocked |
| `git -c core.editor=true commit ...` | bypassPermissions | **Commit created** |
| `bash -c 'git commit ...'` | bypassPermissions | **Commit created** |

Conclusion: the prefix rule blocks the usual forms, even in bypass mode, but it is not a guarantee. More variants are untested (`env git`, `/usr/bin/git`, a script, a git alias).

Proposed design change:
- In "Enforced by a machine", permissions become a "**partial brake**". The guarantee remains branch protection + CI.
- Add (unverified) a `PreToolUse` hook on `Bash` that looks for `git ... commit|push` in any position and returns `permissionDecision: "deny"`. It covers `-c` and `bash -c`, but it isn't complete either.

## P3. `CLAUDE.md` with `@AGENTS.md` — pass, and not needed in this version

Test: `AGENTS.md` with a keyword; asked without read tools (`--disallowedTools "Read Bash Glob Grep"`).

| Case | Answer | Input tokens |
| --- | --- | --- |
| `CLAUDE.md` (`@AGENTS.md`) + `AGENTS.md` of ~4,000 tokens | PEPINO-7 | 36,592 |
| Only `AGENTS.md` of ~4,000 tokens, no `CLAUDE.md` | PEPINO-7 | 36,468 |
| Neither (control) | NINGUNA (none) | 32,414 |

Conclusion: Claude Code 2.1.318 loads `AGENTS.md` on its own. With `CLAUDE.md` + `@AGENTS.md` it is not duplicated (only +124 tokens). `CLAUDE.md` is kept for compatibility with older versions and because it is cheap. **Unverified:** from which version `AGENTS.md` is read natively.

## P4. "Read on demand" — pass (2/2, one model only)

Test: `AGENTS.md` with `Antes de tocar estas rutas, lee su nota: src/billing/** → .harness/notes/billing.md` ("before touching these paths, read their note"). The note requires a `// cents-only` comment on every new function. The prompt asked to add a function to `src/billing/price.js` (two different prompts, in separate copies).

Evidence: in both runs the model read the note **before** editing (once with `Read`, once with `cat` in Bash) and added `// cents-only`.

**Unverified:** other models (only the default model, claude-opus-5-5, was tested), Codex and Cursor, and repos with large context (a real repo has much more noise). Two runs are not a rate.

## P5. Skills by description — pass (1/1, one model only)

Test: `.claude/skills/harness-close-task/SKILL.md` with `name` and `description` in the frontmatter ("use it when the person says the task is finished"). Prompt: "I finished the task in this repo. Please close it" (in Spanish).

Evidence: the skill appears in the skills list at startup; the model called the `Skill` tool with `harness-close-task` and followed its steps (the answer starts with `CIERRE-OK-913`).

**Unverified:** other models, whether the description triggers on less obvious prompts, and whether skills in `.harness/skills/` are used outside Claude Code.

## P6. `@/` aliases with dependency-cruiser — pass if given the config

Minimal projects: Vite + React in JS (`vite.config.js` with `alias: { '@': ./src }` and `jsconfig.json` with `paths`) and Next app router in TS (`tsconfig.json` with `paths: { "@/*": ["./src/*"] }`). `cruise()` API of dependency-cruiser 18.7.2.

| Case | Result |
| --- | --- |
| Vite without passing alias config | Fails: `@/...` stays unresolved |
| Vite with `jsconfig.json` passed as `tsConfig` | Pass |
| Vite with `alias` in the resolve options (what the adapter would read from `vite.config`) | Pass |
| Next without passing config | Fails |
| Next with `tsconfig.json` passed as `tsConfig` | Pass |

Conclusion: the adapter must read the aliases (tsconfig/jsconfig `paths` and Vite's `resolve.alias`) and pass them in. Details: dependency-cruiser 18 is ESM-only (no `require`), and `extract-ts-config` needs `typescript` installed.

**Plain JS/JSX without `typescript` installed** (rerun of the Vite JS/JSX fixture with dependency-cruiser alone, [`probe-no-typescript.mjs`](../scripts/verify/probe-no-typescript.mjs)):

| Case | Result |
| --- | --- |
| No alias config | Fails: `@/...` unresolved; relative imports (`./total`) resolve |
| `alias` passed as a resolve option | Pass: `.jsx` and `.js` files parsed and resolved |

So JS/JSX projects are supported if the adapter reads `jsconfig.json`/`tsconfig.json` `paths` itself (JSON with comments, `extends`, `baseUrl`) and turns them into `alias`, instead of using `extract-ts-config`. **Unverified:** `paths` patterns that aren't a simple `prefix/*` → `dir/*` mapping.

**Unverified:** Vite TS projects where `paths` live in `tsconfig.app.json` (referenced from `tsconfig.json`), `vite.config.ts` (it has to be evaluated or parsed), aliases given as an array, and projects without `typescript` installed. These go into the phase 3 examples.

## P7. `peerDependencies` with pnpm — pass

Test: toy packages `@harness/core` (with `exports` `.` and `./contract`), `@harness/adapter-js` (peer `^0.1.0`, `"harness": {"contract": 1}`) and `@harness/cli`, packed with `npm pack` and installed as tarballs into a consumer project.

| Case | Result |
| --- | --- |
| A: consumer installs core, cli and adapter | Installs; CLI and adapter share the same core instance |
| B: consumer doesn't install core | pnpm installs the peer itself; same instance |
| C: core 0.2.0 against a `^0.1.0` peer | **Only warns** (`Issues with peer dependencies found`) and continues |
| Adapter imports a core path outside `exports` | Blocked (`ERR_PACKAGE_PATH_NOT_EXPORTED`) |

Details that affect the design:
- With an incompatible peer pnpm doesn't fail, so **the CLI must check `harness.contract` itself**, as phase 4 already says.
- The CLI could also import the adapter directly, but only thanks to pnpm's hidden hoisting (`node_modules/.pnpm/node_modules`). The CLI must resolve the adapter from the project root (`createRequire(<repo>/package.json)`) and not depend on that.
- pnpm 11+ ignores the `pnpm` field in `package.json` (`overrides` and the rest go in `pnpm-workspace.yaml`). This matters when documenting tarball installation.
- The full test ran with pnpm 11.22.0 (the version pnpm picked in that folder); cases B and C were repeated with 12.11.2 with the same result, reusing the lockfile. The case C warning was only observed with 11.

**Unverified:** npm and yarn on the consumer side.

## P8. npm scope `@harness` — could not be fully tested

- `npm view @harness/core` and `npm view @harness/cli`: 404 (they don't exist).
- Registry search `scope:harness`: 0 packages.
- Whether the `harness` **organization** is free can't be checked without an account: npmjs.com returned 403 to an anonymous request. We need to try creating it (`npm org` / web) or pick another scope.

## Phase 1 findings

- **Node 22 and 24 — pass.** `pnpm lint` and every test suite pass on Node 22.21.1 and on Node 24 (run through `npx -p node@24`). They also passed on Node 20.20.2 before the minimum was raised to 22.
- **`node --check` quirk (Node 22) — observed.** A `.js` file with broken ESM syntax (`export const = ;`) passes `node --check` when its `package.json` has no `"type": "module"`; with `"type": "module"` it fails as expected. The linter therefore requires `"type": "module"` in every package.
- **CI workflow — not run.** `.github/workflows/ci.yml` has never run on GitHub. Unverified: `pnpm/action-setup@v4` with pnpm 12.11.2, and pnpm 12 running on Node 24 (locally pnpm ran on Node 22 only).

## Phase 2 notes

- **Integrity in CI — unverified.** `integrity` needs the base branch's history (`git merge-base HEAD <base>`). GitHub's `actions/checkout` fetches one commit by default, so the CI job will probably need `fetch-depth: 0` or an explicit fetch of the base branch. Without it, `check` warns "Could not compare with <base>" instead of failing. To test in phase 8.
- Integrity was tested against real temporary git repos (merge base, committed and uncommitted changes, missing ref).

## Phase 3 findings

- **TypeScript files are skipped silently without the `typescript` package — observed.** dependency-cruiser 18.7.2 on the Next TS fixture without `typescript` installed: 0 modules, no error. With it: all files and edges. `getAvailableTranspilers()` reports whether it is available; adapter-js now throws in that case.
- **dependency-cruiser engines** are `^22 || ^24 || >=26`: Node 20 is not supported by the graph engine (another reason for the Node 22 minimum).
- **Both examples and three extra fixtures — pass.** Vite JS/JSX (aliases in `jsconfig.json` and `vite.config.js`), Next app router TS (`tsconfig.json` `paths`), Vite TS template (`paths` in `tsconfig.app.json` via `references` + `extends`, `vite.config.ts` with `fileURLToPath(new URL(...))`), Next pages router JSX (`baseUrl` only), and a Vite `alias` array with `find`/`replacement`. Exact edges and violations asserted in `packages/adapters/js/test/`.
- **Unverified:** that dependency-cruiser (a dependency of adapter-js) can load the consumer repo's `typescript` under pnpm's strict layout. In this monorepo it works through hoisting. To test with tarballs in phase 8; if it fails, the adapter's error message tells the user, it doesn't pass silently.
- **Unverified:** real-world `vite.config` alias forms beyond the ones in the fixtures (computed objects, spread helpers, aliases from plugins such as `vite-tsconfig-paths`). Unknown forms produce a warning, not a silent miss.

## Unverified (pending)

- Session start hook (`SessionStart`) to load the progress notebook: not tested.
- Read-only subagents (`reviewer`, `explorer`) with restricted tools: not tested.
- Any behavior in Codex or Cursor.
- That the notes hook on `Read` and per-`session_id` deduplication work (P1 proposal).
- A `Bash` hook that denies `git commit`/`push` (P2 proposal).
