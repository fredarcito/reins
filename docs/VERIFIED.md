# What is verified

> Recorded before the rename to **reins** (2026-11-04): commands, packages and paths below use the old names (`harness`, `@harness/*`, `.harness/`). They are kept as they were run.

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
| P9 | A `SessionStart` hook restores context after a compaction | **Pass** | Yes: notes must be re-delivered, see P9 |
| P10 | Other coding-agent clients consume the shared `AGENTS.md` rules and can use the reins CLI | **Unverified** | The shared workflow avoids provider APIs; client-level instruction loading still needs testing |
| P12 | Cursor runs reins' hooks and its agent can know its session | **Pass, with gaps** (Cursor 3.29.9, 1 run) | Yes: a Cursor adapter is mostly not needed, see P12 |
| P11 | Bash tool commands see `CLAUDE_CODE_SESSION_ID`, and it survives `--resume` / `--continue` | **Pass** (print mode) | No: per-session notebooks can rely on it, see P11 |

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

## P9. `SessionStart` hook after a compaction — pass

Test 1 (probe): a `SessionStart` hook (matcher `startup|resume|compact|clear`) that logs its input and, when `source` is `compact`, returns `additionalContext` with a keyword. Session with `claude -p --session-id`, then `claude -p "/compact" --resume`, then a question without tools.

Evidence:
- The hook ran with `source` `startup`, then `resume`, then `compact` (inside the `/compact` run), then `resume`. **The `session_id` is the same before and after the compaction.**
- After the compaction the model answered the keyword, which only the `compact` hook had delivered.

Consequence: the notes hook delivered each note once per `session_id`, so after a compaction it stayed silent while the notes were gone. Fixed in phase 10 (`resume --hook` resets the session's record on `compact` and `clear`).

Test 2 (end to end, [`scripts/verify/cc-resume.sh`](../scripts/verify/cc-resume.sh)): tarballs installed in a copy of `examples/vite-react`, `harness install`, `init`, `notes new cart`, a branch with a notebook and a change in `cart`. Haiku, 1 run each:
- At startup, without tools, the model quoted the notebook's next step and the cart note's keyword.
- Then the notebook and the note were changed on disk and the session was compacted. After it, the model quoted the **new** values, which could only come from the hook, not from the compaction summary. 5/5 checks pass.

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

## Phase 4 findings

- **Install from tarballs, then `init` + `check` — pass with npm and pnpm.** `pnpm pack` of the three packages, installed in copies of the examples outside the monorepo:
  - pnpm 12.11.2, Next TS example: needs `overrides` for `@harness/core` in `pnpm-workspace.yaml` (otherwise pnpm looks it up in the registry). `init` found the 4 violations, `check` passed.
  - npm 11.12.1, Vite JS example without `typescript`: works without overrides (the directly installed core satisfies the CLI's range; an override there fails with `EOVERRIDE`). `init`, `check` and `check --files` with a new violation (exit 1) as expected.
- **dependency-cruiser finds the repo's `typescript` under pnpm — pass** (the phase 3 open question): with the tarball install above, TS files were analyzed (4 violations found). The adapter's guard would have stopped otherwise.
- **Symlinked working folders — bug found and fixed.** `git rev-parse --show-toplevel` returns the real path; macOS temp folders are symlinks (`/var` → `/private/var`), so `--files` produced wrong paths. The CLI now resolves real paths.
- **Unverified:** yarn (classic and berry/PnP), `init`/`check` duration on large repos (the examples take well under a second; the whole graph is computed even with `--files`), Windows paths.

## Phase 5 notes

- **The validation gate was skipped** (the author said "continue" without results from a real repo). Phases 5+ are experimental, and `init`/`check` remain unverified on a real repo.
- **Unverified:** that CI providers set `CI` (GitHub Actions does, from memory; not tested). If not, `doctor` would run in CI but still exit 0 without `--strict`.
- **Unverified:** that agents actually write `triage.log` lines and keep the notebook format. Without those files, most doctor rules have nothing to compare (design risk).

## Phase 6 findings

- **Notes hook on `Read` — pass (2/2, default model claude-opus-5-5).** Follow-up of P1. Consumer repo installed from tarballs (npm), `harness sync` installed the hook (`PreToolUse`, matcher `Read|Edit|Write|MultiEdit`, command `"$CLAUDE_PROJECT_DIR"/node_modules/.bin/harness notes --hook`). `AGENTS.md`/`CLAUDE.md` removed so the note could only arrive through the hook. Prompt: add a function to `src/features/cart/cartStore.js`; the note requires `// cents-only`. Both runs: `Read` → note delivered (the per-session "seen" record was written at that point) → the **first** `Edit` already contained `// cents-only`. In phase 0, with the hook only on `Edit`, the note arrived after the edit was written.
- **Once per session — pass** in unit tests (same note not repeated in a session; a new session gets it again). Not observed across many tool calls in a real session.
- **Symlinked project folders**: the hook resolves real paths on both sides (same class of bug as in phase 4).
- **Templates inside the CLI tarball — pass**: `prepack` copies `templates/` into `@harness/cli` (19 files), `postpack` removes the copy.
- **Unverified:** skills and agents generated by `sync` loading in Claude Code under the `harness-` names (P5 tested a hand-written skill), subagent `tools:` restrictions, the hook's latency on large repos (`harness notes --hook` runs on every Read/Edit/Write), behavior on Windows (the hook command uses a POSIX path).

## Phase 7 notes

- Nothing external was tested in this phase: `audit`, `progress` and `review` only touch local files and git.
- **Unverified:** that agents use `harness progress` instead of rewriting the notebook, and `harness audit` instead of editing the backlog by hand (both are instructions in the policies and skills); how useful the `review` prompt is in practice; review prompts for very large diffs (truncated at 200 KB by default).

## Phase 8 findings

- **Clean install with a real hook manager and CI simulation — pass (9/9 checks).** [`scripts/verify/e2e-install.sh`](../scripts/verify/e2e-install.sh): copy of `examples/vite-react`, tarballs + Husky 9.1.7 via npm, `harness install` + `harness init`; a clean commit passes the hook; a commit with a new violation is **blocked by the hook** with rule, why and fix; a clone without hooks can commit and push the violation; a fresh clone running the workflow steps (`npm ci`, `GITHUB_BASE_REF=main npx --no-install harness check`) is green on `main` and **fails on the PR branch**.
- **Tarballs outside the repo break CI — observed.** npm records `file:../../…/harness/.tarballs/…` in `package.json` and the lockfile. Fix: commit the tarballs under `vendor/harness/`; verified with npm (`npm ci`) and pnpm (`pnpm install --frozen-lockfile`, with the core override) from a clone in a different folder ([`vendor-test.sh`](../scripts/verify/vendor-test.sh), [`vendor-test-pnpm.sh`](../scripts/verify/vendor-test-pnpm.sh)).
- **Unverified:** the workflow on real GitHub Actions (`pnpm/action-setup@v4`, `cache:`, `fetch-depth: 0`, `GITHUB_BASE_REF` on PRs), lefthook actually running the command (only the config edit is tested), yarn and bun, internal registries (GitHub Packages, Verdaccio), branch protection settings.

## Phase 9 findings

- **Monorepo workspaces lost their edges — bug found and fixed.** Running the harness on itself showed 0 imports between packages: dependency-cruiser couldn't resolve packages that only declare `exports` (like `@harness/core`), so those imports vanished and `check` would have passed without seeing them. Fixed with `exportsFields`/`conditionNames` in the adapter; symlinked workspaces now resolve to their real path inside the repo. Regression test with a temporary npm/pnpm-style workspace.
- **Real root path in the adapter — fixed.** Same symlink class as phases 4 and 6: with the repo opened through a symlink, resolved paths fell outside the root.
- **Doctor counted harness files as task files — fixed.** In the walkthrough, a one-file change looked like four files (`AGENTS.md`, `.harness/.generated.json` and a note changed too). `.harness/`, `.claude/`, `AGENTS.md` and `CLAUDE.md` no longer count; touching `architecture.yml` still means `large`.
- **Self-check — pass.** `pnpm self-check`: dependency-cruiser alone with plain forbidden rules (0 errors, 12 `cli → core` imports seen) and `harness check` from source on `.harness/architecture.yml` (`cli` > `adapters` > `core`). Both caught an injected `core → cli` import and an adapter importing a core internal.
- **End-to-end scripts at 0.1.0 — pass** (`e2e-install.sh` 9/9, `vendor-test.sh`, `vendor-test-pnpm.sh`). Tarballs carry `LICENSE`.

## Phase 10 findings

- **Notes lost after a compaction — bug found and fixed** (P9): same `session_id`, so the notes hook thought they were already in context.
- **`SessionStart` with `startup`, `compact` and `clear` — pass** with Claude Code 2.1.318, haiku, 1 run (`cc-resume.sh`). `clear` was not tested on its own.
- **`notes new` — pass** on both examples (with and without a graph).

## After the rename: `reins-fill-notes` skill — pass (1/1, haiku)

On a copy of `examples/vite-react` installed from npm (`@agentreins/cli` 0.1.0, notes drafted by `reins init`), plus the new skill synced into `.claude/skills/reins-fill-notes/`: `claude -p "/reins-fill-notes"` (haiku, `acceptEdits`). Result: both notes filled, no `TODO` left, Map lines from the graph kept, decisions not invented (one git commit, so they became `- ? question` lines), real traps found (integer cents, the `format.js`/`currency.js` cycle, `Home.jsx` bypassing the catalog public API). It could not run `npx reins doctor` (Bash not allowed in that run) and said so. Follow-up: the draft comment stayed; the skill now says to delete it.

## Skills `reins-review-architecture` and `reins-new-agent` — pass (1/1 each, haiku)

Copy of `examples/vite-react` with a `src/generated/` file, installed from this version's tarballs, `reins install` + `init` + `check --update-baseline`.

- `claude -p "/reins-review-architecture"` (Read/Grep/Glob and `npx reins` only): `architecture.yml` unchanged (same hash). It ran `check --coverage` and `--verbose`, confirmed each baseline item in the code (wrong-layer import in `Button.jsx`, `Home.jsx` bypassing the catalog public API, the `format`/`currency` cycle), proposed `ignore: ["src/generated/**"]` with evidence, kept every existing violation as baseline debt, and ended with questions. Gap found: it couldn't confirm `ignore:` was a valid key; the skill now lists the keys and links the reference.
- `claude -p "/reins-new-agent …a read-only a11y checker…"` (`acceptEdits`): wrote `.reins/agents/a11y-checker.md` in the house format (read-only, Role/When/How/Returns, under 40 lines), ran `reins sync` (`.claude/agents/reins-a11y-checker.md`, `sync --check` clean) and proposed, without applying, a line for the multi-agent policy.

## P11. Session id in Bash tool commands — pass

Needed by the multi-session notebooks ([proposal](proposals/multi-session-progress.md), section 2): `npx reins progress …` run by the agent must know its session.

- **VS Code extension (2026-11-08) — pass.** `CLAUDE_CODE_SESSION_ID` is set in the environment of Bash tool commands and matches the session.
- **Terminal CLI, print mode (2026-11-08) — pass**, Claude Code 2.1.318, haiku, [`cc-session-id.sh`](../scripts/verify/cc-session-id.sh). `claude -p` with the parent session's variables unset; the agent runs `printenv CLAUDE_CODE_SESSION_ID`:
  - fresh session: the variable equals the `session_id` of the JSON result;
  - `--resume <id>` and `--continue`: same id, in the result and in the variable;
  - `--resume <id> --fork-session`: a new id, and the variable follows it.
- Side finding: Bash permission rules reject `echo $CLAUDE_CODE_SESSION_ID` ("a variable in this command can't be checked before it runs"); `printenv` passes. reins reads the variable from `process.env`, so this does not affect it.
- **Unverified:** the interactive terminal UI (no TTY in the test; same binary, so expected to match) and `/resume` picked from inside a running session.

## P12. Cursor hooks — pass, with gaps

Cursor 3.29.9 (IDE, Agent mode, model grok-4.7), 2026-11-08, one run of [`cursor-hooks-probe.sh`](../scripts/verify/cursor-hooks-probe.sh): Cursor's own hooks and Claude Code format hooks in `.claude/settings.json` (the ones `reins sync` generates) log their input and answer with keywords; the agent then listed the keywords it could see.

- **Cursor runs Claude Code format hooks from `.claude/settings.json`**, with no setting changed: `SessionStart` and `PreToolUse` (matcher `Read|Edit|Write|MultiEdit` matched Cursor's `Read` and `Write`). Their `hookSpecificOutput.additionalContext` reached the model: at session start, and on the Read calls and the edit.
- Cursor's own hooks: `sessionStart` and `postToolUse` `additional_context` reached the model. `preToolUse` `agent_message` with `permission: allow` did not.
- Payload of a Claude-format hook in Cursor: `session_id` (equal to `conversation_id`), `tool_name` (`Read`, `Write`, `Shell`; edits are `Write`), `tool_input.file_path`, but `hook_event_name` is Cursor's (`preToolUse`, `sessionStart`) and `SessionStart` has **no `source`**.
- Environment: hooks get `CLAUDE_PROJECT_DIR` (alias) and `CURSOR_PROJECT_DIR`. The agent's shell gets **`CURSOR_CONVERSATION_ID`**, equal to the hooks' `session_id`; not `CLAUDE_CODE_SESSION_ID`. `env` returned by `sessionStart` reached later hooks, not the agent's shell. The shell runs sandboxed (`CURSOR_SANDBOX=seatbelt`).
- **Gaps for reins:** (1) `reins progress` run by the Cursor agent sees no session id it knows (it reads `CLAUDE_CODE_SESSION_ID` / `REINS_SESSION`); (2) reins echoes `hook_event_name` into `hookEventName`, which in Cursor would be `preToolUse`: whether Cursor accepts that was not tested (the probe answered with the Claude names); (3) no `source`, and `preCompact` cannot add context, so after a compaction in Cursor nothing re-delivers the notebook and notes.
- **reins' real hooks in this repo opened in Cursor** (after fixes 1 and 2, same day, one run; Cursor's hook log in `~/Library/Application Support/Cursor/logs/*/cursor.hooks.*.log`):
  - **Pass:** `reins notes --hook` ran on the Read calls (~150 ms) and Cursor accepted its answer as valid, turning `additionalContext` into `additional_context`. The agent reported the `core` note and the impact warning for `packages/core/src/index.js` (large vs. the declared medium), and none for `notebooks.js` (medium, within the declared level).
  - **Pass:** `reins progress new` / `show` from the agent's shell claimed the task with Cursor's conversation id (`session:` in the header), through `CURSOR_CONVERSATION_ID`.
  - **Fail:** no `sessionStart` step was requested in that window at all, so `reins resume --hook` never ran: no task context at the start and no background impact map (an older map was used). In the probe project, which also had a `.cursor/hooks.json` with `sessionStart`, the Claude-format `SessionStart` did run. Unknown whether Cursor only fires it when a native `sessionStart` hook exists.
  - **Unclear:** the `cli` note for `notebooks.js` was produced and accepted (log), but the agent said it got no note for that file. The two Reads ran in parallel and the note is ~6 KB; lost context, a size limit or a wrong self-report are all possible.
  - **Follow-up, session start — pass with a native trigger** (2 more runs): with a `.cursor/hooks.json` holding only a no-op `sessionStart`, a **new** conversation fired `sessionStart` and Cursor ran all four sources: the native one, the Claude **project** `SessionStart` (`reins resume --hook`), the Claude user one and plugin hooks. The agent got the resume context (task files, `cli` note), no repeat of the `cli` note on reading `notebooks.js` (already delivered), and the impact warning plus the `core` note on `index.js`; the impact map was rebuilt in the background. Without that native file no `sessionStart` was requested (1 run). A run in the **same** conversation got neither `sessionStart` nor repeated notes, as designed. Likely rule, from these runs: Cursor only requests `sessionStart` when some native config defines it. `reins sync` now writes that no-op trigger.
  - Side finding: Cursor also runs the person's Claude Code **user** hooks and plugins (`~/.claude/settings.json`, plugin hooks).
- **Not tested:** compaction; Cursor CLI agent; cloud agents (no `sessionStart` there).

## P13. Mermaid in GitHub Markdown for the PR map — pass (dark theme)

Needed by the PR map comment ([proposal](proposals/pr-map.md)). 2026-11-08, a secret gist (`.md` file) viewed by the person in GitHub's dark theme, several iterations of [`pr-map-examples/`](proposals/pr-map-examples/).

- **Renders:** `flowchart LR`, the `%%{init: …}%%` line (theme `base`, `curve: basis`, spacing, fonts, `edgeLabelBackground`), Markdown string labels with bold and a second line, `classDef` fills/strokes/dash, `linkStyle` by index, `-.->` dashed edges, `#nbsp;` padding in an edge label, `> [!CAUTION]` / `> [!WARNING]` alerts, emoji squares in `<sub>`.
- `diff` blocks color by first character: `+` green, `-` red, `!` orange, space none.
- **Layout finding:** subgraphs per layer with unchanged edges produced a tall, crossing layout (rejected); a flat `LR` graph with only the changed edges read well.
- **Reading finding:** the person read most bare `A → B` arrows backwards (as "B imports from A"). The diff block now uses verbs ("now uses").
- **Not verified:** light theme; a real PR comment (gists and comments use the same renderer, assumed); the 65,536-character comment limit; how Mermaid lays out 20+ edges (the `large.md` example was not rendered yet).

## P14. Base graph through a git worktree — pass with a mirrored `node_modules`

Phase 0b of the PR map ([proposal](proposals/pr-map.md), section 5). 2026-11-08, this monorepo (pnpm, three packages importing each other), HEAD `ad71e46`, spike script plus the automated tests below.

- **Failed first.** A worktree at HEAD analyzed with the head `architecture.yml` gave 225 head edges and 200 base edges: **25 new edges, 0 removed**, all to `@agentreins/core`. Same result with the worktree inside the repo and outside it. pnpm resolves `core` through `packages/<pkg>/node_modules/@agentreins/core` symlinks; the worktree has none and the root `node_modules` only has `adapter-js` and `cli`. No warning, and no base edge pointed outside the worktree, so the plan's "drop base edges outside the worktree" would not have caught it.
- **Passes with `prepareCheckout`** (adapter-js, section 5 of the proposal): 225 base edges = 225 head edges, zero new, zero removed, in repeated runs. A relative workspace link is recreated with its relative target; every other entry is an absolute link to the main install.
- **Automated:** `packages/cli/test/pr-map.test.js` builds a temp git repo with a clean commit and two workspace packages linked as pnpm does (a relative symlink in `packages/a/node_modules`), checks that the cross-package edge exists at head, and that base = HEAD prints the short form with no dependencies; it fails when `prepareCheckout` is removed (checked by hand). `packages/adapters/js/test/checkout.test.js` covers the relative workspace link, an absolute one, `@scope` folders, a store link, a link outside the repo, `.bin`, a package missing at the base commit, and the Yarn PnP warning.
- **Timing, this repo only** (294 files, warm disk, one machine): worktree add ~100 ms, mirror ~7 ms, base analysis ~130 ms, worktree remove ~55 ms; the head graph took 520–860 ms because it is the first analysis of the process. **CI timing is unverified**: it depends on the repo size, a cold runner and a fresh process; measure it on the first real PR run.
- **Not tested:** a Next fixture or a real repvue-next PR; npm, yarn classic and bun layouts (only pnpm-style and the real-folder case are covered by tests); Yarn PnP beyond the warning; a base commit whose dependencies differ from the head install (the mirror points at the head install by design).

**PR map on GitHub Actions — pass on the first real PR** (2026-11-09, `fredarcito/reins` PR #1, branch from the same repo, two pushes, dark theme, seen by the person):
- The step ran on `pull_request`, with `fetch-depth: 0`, `origin/main` as base and `git worktree add` on the runner, and `github-actions` posted the comment (short form, "No structural changes", `Compared with origin/main at ad71e46`). The workflow-level `permissions:` did not break the `check` step (3 checks green).
- Second push: the same comment was **edited in place** ("edited", still one comment), so the marker search (`gh api … --paginate --jq … | sed -n 1p`), the PATCH and the file in `$RUNNER_TEMP` work.
- Test files outside every layer showed as `6 files outside layers`, not as folders outside `architecture.yml`.
- **Layout finding:** a map with no edges in `flowchart LR` stacked the boxes in one tall column; with `flowchart TB` (second push) they sit in one row.

**PR map: still unverified on GitHub:**
- PRs from forks: read-only token, the step fails and `continue-on-error` keeps the job green.
- The label condition `!contains(github.event.pull_request.labels.*.name, 'reins:no-map')`, and the step creating the label with `issues: write`.
- `concurrency` racing two quick pushes, and `!cancelled()` on a cancelled run.
- CI timing of the base graph on a cold runner (not read from the run yet).
- Light theme, a structural-change comment (new edges, violations, mutual) in a real PR, and the 65,536-character limit (the renderer caps at 60,000 and is tested with a synthetic 300-domain PR).
- The map-skipped limit (20 structural edges) is an assumption until phase 0c.

## Still unverified

Everything below is assumed, not tested. Each is a candidate for the pilot or for a script in `scripts/verify/`.

**On real projects**
- `init` and `check` on a real team repo (the validation gate after phase 4 was skipped): layer inference, false positives, duration on large repos (the whole graph is computed even with `--files`).
- `vite.config` alias forms beyond the tested ones (computed objects, helpers, plugins).

**CI and package managers**
- The generated workflow on real GitHub Actions (`pnpm/action-setup@v4`, `cache:`, `fetch-depth: 0`, `GITHUB_BASE_REF` on PRs), and this repo's own `ci.yml`.
- yarn (classic, berry/PnP) and bun; internal registries (GitHub Packages, Verdaccio).
- lefthook actually running the command (only the config edit is tested).
- Windows paths (the notes hook command is POSIX).
- CI providers setting `CI` (the doctor skips itself when it is set).

**Claude Code and other agents**
- Other models than the default one for "read on demand", skills and notes (2/2 and 1/1 runs, one model).
- Skills and agents generated by `sync` loading under the `harness-` names; subagent `tools:` restrictions.
- The notes hook latency on large repos (it runs on every Read/Edit/Write).
- That agents run `npx reins notes <path…>` when they read or edit code through the shell or other tools (code-graph MCP servers…), where the notes hook does not fire. The `AGENTS.md` notes block says so on its first line; untested. Proposed, not built: also hooking `Bash` and parsing file paths out of the command (fragile: pipes, globs, `sed -i`, `find -exec`; and MCP tools would still be uncovered).
- Permissions denying `git commit`/`git push` are bypassable (`git -c … commit`, `bash -c`); a `Bash` hook that blocks them is proposed, not built (deferred by decision).
- `SessionStart` with `source: clear`, other models than haiku for the resume context, and very large notebooks or many notes (the hook output is capped at 30 files and 6 full notes, never measured in tokens).
- That agents fill the TODO lines of a drafted note and keep notes current when closing (instructions plus doctor warnings, not enforced).
- Any behavior in Codex or Cursor, including their hooks (events, added context, deny, session id): see [`proposals/agent-adapters.md`](proposals/agent-adapters.md), whose step 1 verifies them. Not testable on the 2026-11-08 machine (no Codex; Cursor 0.47.8, older than its hooks).
- That an agent actually stops and re-triages when the notes hook delivers the impact warning (tested only as hook output), and that the detached `reins impact --map` started by the `SessionStart` hook keeps running after the hook returns inside a real Claude Code session (checked by hand from a shell).
- That agents write `triage.log` lines, keep the notebook format and use `harness progress` / `harness audit` instead of rewriting files (instructions, not enforced).
- That agents skip triage (no level, announcement or `triage.log` line) for information-only messages, and still triage questions that need repository work (policy text, not enforced).
