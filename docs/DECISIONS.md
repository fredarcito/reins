# Decisions

Source of truth for the design: [`DESIGN.md`](DESIGN.md). This file summarizes what is already decided, the build defaults, and what remains open. Every new dependency is justified in the "Dependencies" section.

## Decided in the design (summary)

- **Three layers:** deterministic core (`architecture.yml`, `baseline.json`, `check`, git hook, CI), portable markdown content, and thin generated tool adapters (`.claude/`, Husky).
- **Only the core is enforced.** Anything that depends on the agent reading or writing files is an instruction and is marked experimental.
- **The core knows no framework.** It only sees edges `{ from, to, kind }`. Everything specific lives in adapters with a versioned contract (`contract: 1`: `detect`, `graph`).
- **Dependency direction:** `cli` → `adapters` → `core`. `core` doesn't import from `cli` or `adapters`. Adapters only see `@agentreins/core/contract` (enforced with `exports`).
- **Adapters are installed separately**, with `@agentreins/core` as a `peerDependency` and `"reins": { "contract": 1 }`. The CLI says which one is missing; it installs nothing.
- **`check`:** rules `layer-direction`, `domain-boundary`, `no-cycles`; baseline (only new violations fail); integrity of `architecture.yml`, `baseline.json` and generated files. Runs in pre-commit (touched files) and CI (everything). CI plus branch protection is the real guarantee.
- **`doctor` separate from `check`:** local, informational (exit code 0 unless `--strict`), never in CI or the hook, no baseline or adapter.
- **The agent never commits, pushes or opens PRs, and never uses `--no-verify`.**
- **`AGENTS.md` of at most 45 lines** (30 until 2026-11-07; raised so the managed reins rules block fits next to a repo's own rules), no per-folder `AGENTS.md`/`CLAUDE.md`. `CLAUDE.md` only contains `@AGENTS.md`.
- **Provider-neutral baseline:** shared rules and workflows are plain Markdown in `AGENTS.md` and the reins CLI; `.claude/` and `CLAUDE.md` are an optional adapter (`--skip-claude`, re-enabled with `--claude`). The choice is persisted in the generated manifest for consistent CI checks.
- **`sync` only touches what it generated** (manifest) and never deletes third-party skills, agents or settings. Own names use the `reins-` prefix. One exception for repos installed with <= 0.7.4: unmodified copies of shipped defaults in `.reins/` are removed (frozen hash list), so `.reins/core/` applies instead of a stale copy.
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
| npm scope | `@agentreins/*` (decided 2026-11-04, see "Name"), kept in one place and changeable with `scripts/rename-scope.mjs` |
| Status | Each piece is **stable** (enforced and tested) or **experimental**, in `docs/STATUS.md` and the README |
| Git | The agent building this repo does not commit, push, open PRs or publish |

## Phase 1 defaults

| Topic | Decision |
| --- | --- |
| npm scope at runtime | Not hardcoded. The CLI derives it from its own `package.json` name (`SCOPE`). The scope only appears literally in package names, dependency keys and import specifiers, which `scripts/rename-scope.mjs` rewrites (it skips `docs/DESIGN.md`, `docs/VERIFIED.md` and `scripts/verify/`, which are historical records) |
| Versions | `0.0.0` until phase 9 (`0.1.0`, unpublished). No `license` field until the license is decided |
| Internal deps | `workspace:^` for core in the cli (dependency) and in adapters (peer + dev). `pnpm pack` turns it into a real range |
| `exports` | Every package exposes `./package.json` as well, so the CLI can read an adapter's `reins.contract` |
| Tests | `node --test "test/**/*.test.js"` in each package (an explicit glob: with no arguments node also runs the fixtures under `test/`). Root runs `pnpm -r test` plus `scripts/*.test.mjs` |
| Linter | Own script without dependencies (`scripts/lint.mjs`): syntax, import boundaries (interim self-check until phase 9), AGENTS.md rules, package metadata. No ESLint/Prettier: not worth a dependency yet |
| CI | GitHub Actions, Node 22 (minimum) and 24, pnpm 12.11.2 pinned in the workflow (matches the local version and the lockfile) |

## Phase 2 defaults (core `check`)

Semantics are documented for users in [`architecture-yml.md`](architecture-yml.md); this is why they are that way.

| Topic | Decision | Why |
| --- | --- | --- |
| Globs | Own matcher (`*`, `**`, `?`, `{a,b}`), no dependency | `path.matchesGlob` is still experimental in Node 22; a glob library isn't worth a dependency for this |
| Overlapping globs | First matching layer/domain wins | Simple and predictable; documented |
| Files outside every layer | Ignored by `layer-direction` | Config files, scripts and tests shouldn't need a layer |
| Files with no domain | Still can't import a domain's internals | Pages importing `billing/total.js` is exactly the leak the rule targets |
| Defaults | No `rules:` section → three rules `error`, `integrity` `warn`. With `rules:` → unlisted rules off, except `integrity` (`warn` unless `off`) | Explicit list = explicit intent; integrity should not disappear by omission |
| Unknown keys | Error | A typo must not pass silently |
| Edge kinds | Recommended `static`, `dynamic`, `type`; rules can skip kinds with `ignore_kinds`; an edge is skipped only if all its kinds are ignored | TS type-only imports often shouldn't count for layers or cycles; it's the team's call per rule |
| Baseline key | `rule\|from\|to`; for cycles `no-cycles\|<sorted files>` | Stable across runs; a growing cycle counts as new |
| Baseline file | Sorted, no timestamps, `{ version, violations }` | Clean diffs in PRs |
| Integrity | Compares with the merge base of a base ref (git), working tree included. Reports a changed `architecture.yml` and a baseline that **grows**; ignores first adoption and shrinking. `warn` by default | The design says "without it being noticed": the job is visibility. Blocking is opt-in (`severity: error`) |
| Integrity findings | Never go into the baseline | They are about the PR, not about the code |
| `--files` (hook) | Reports violations that involve a touched file; cycles still use the full graph; "fixed" entries not computed | Fast feedback on what you changed without false "fixed" reports |
| Generated-files integrity (`sync --check`) | Not in phase 2 | `sync` arrives in phase 6 |
| Messages | Default `message`/`fix` per rule, overridable with placeholders | Design: errors useful for an agent |

## Phase 3 defaults (adapter-js)

| Topic | Decision | Why |
| --- | --- | --- |
| TypeScript | Optional peer dependency of adapter-js (dev dependency for its tests). If the repo has `.ts`/`.tsx` files and dependency-cruiser can't load `typescript`, `graph()` **throws** with the install command | Verified: without it dependency-cruiser skips TS files silently (zero edges, check green). JS/JSX projects install nothing extra |
| Aliases | Parsed by the adapter, never by executing config files: tsconfig/jsconfig `paths` + `baseUrl` (following relative `extends` and `references`), and `resolve.alias` in `vite.config.*` read as text (object and array forms, `path.resolve`, `fileURLToPath(new URL(...))`, `'/src'`). Anything it can't read becomes a warning that says to declare it in `paths` | Executing `vite.config` needs Vite installed and runs user code; JS projects must not need TypeScript |
| Unsupported `paths` | Only `prefix/*` and exact keys; other patterns produce a warning | Covers `@/*`, `~/*`, `@components/*`; rare patterns are reported, not guessed |
| Unresolved imports | Relative or alias-looking imports that don't resolve are listed in `warnings`. Bare package imports are not | An unresolved alias silently removes edges; the user must see it |
| Scanned files | Whole repo except `node_modules`, `.git`, `.next`, `.reins`, `dist`, `build`, `out`, `coverage`, `.turbo`, `.vercel`, `.cache`, `storybook-static` | Layers decide what matters; files outside every layer are ignored by the rules |
| Edge kinds | `type` (type-only, with `tsPreCompilationDeps`), `dynamic` (`import()`), `static` (everything else) | Lets `ignore_kinds: [type]` work |
| Presets | YAML: `layers` (starting point for `init`), `domains_from` (folders whose children become domains), `route_domains_from` (route folders, used only when `domains_from` finds none), `entries` (globs) | Presets are data, not code |
| Entries | Next special files (`page`, `layout`, `route`, `template`, `loading`, `error`, `not-found`, metadata files, `middleware`…), every file under `pages/`, `src/main.*`, config files, tests and stories | Design: Next special files are entries, not orphans |
| `next-server-client` | Optional (off unless listed). A `'use client'` file (directive as first statement) must not reach, through runtime imports, a module that imports `server-only` or `next/headers`. Reports the nearest one per path, with the chain | Everything a client component imports ships to the browser. `'use server'` files are allowed: client components may import server actions |
| Contract growth | `graph()` may return `{ edges, files, entries, warnings }`; adapters may declare `rules` and implement `evaluate(repoPath, config, graph)`. Still contract 1 (all optional) | `init` needs files/entries; adapter rules need file contents |
| Contract surface | `matchesAny` re-exported from `@agentreins/core/contract` | Adapters can only import the contract; avoids a second glob implementation |
| Test runner | Each package runs `node --test "test/**/*.test.js"` | Without arguments node also runs fixture files under `test/` |

## Phase 4 defaults (CLI `check` and `init`)

| Topic | Decision | Why |
| --- | --- | --- |
| Files in a consumer repo | `.reins/architecture.yml`, `.reins/baseline.json`, `.reins/init-report.md` | Design layout. The report is for review only; phase 8 will add it to `.gitignore` |
| Adapter resolution | From the repo root (then optional extra folders, used by tests): `@agentreins/adapter-<x>`, then `reins-adapter-<x>`. Reads `reins.contract` from the package's `package.json` (falls back to walking up from the entry file), refuses a mismatch, validates the module | Verified in phase 0 that pnpm only warns on peer mismatches |
| Missing adapter | `init` guesses `js` when there is a `package.json` and prints the install command for the repo's package manager (pnpm/yarn/bun/npm by lockfile). Never installs | Design |
| Contract growth | Optional `presets`, `suggestPreset(repoPath)`, `loadPreset(name)` on adapters; presets may list `default_rules`. Still contract 1 | `init` needs the preset; the core can't know frameworks |
| Exit codes | `0` no new errors, `1` new errors, `2` could not run | Hooks and CI only need "did it fail"; `2` separates broken setup from violations |
| Output | The report always goes to stdout (pass or fail); usage and setup errors to stderr. `--json` adds `warnings` | Hooks and agents read one stream |
| Missing baseline | Treated as empty, with a warning | A repo without baseline still gets a useful result |
| Base ref for integrity | `--base`, then the branch start (reflog), `$REINS_BASE`, `origin/$GITHUB_BASE_REF`, `base:` in `architecture.yml`, `origin/HEAD`, `origin/main`, `origin/master`, `main`, `master`; first that exists. None → integrity skipped with a warning. Since 2026-11-11, see "Comparison base" below | Works locally and in CI without configuration |
| `--files` | Comma-separated or repeated; relative to the current folder; real paths (symlinks resolved) | Hooks pass staged files; macOS temp folders are symlinks (bug found by the tests) |
| `--update-baseline` | Rewrites the whole baseline; refused together with `--files`; prints `+frozen / -fixed` | Integrity flags a growing baseline in the PR anyway |
| `init` layers | Preset layers whose globs match files, ordered by the dominant direction of runtime imports (type-only ignored); ties and loops keep the preset order and are reported | Design: "infer layers by dominant direction" |
| `init` domains | One per folder matching the preset's `domains_from` (e.g. `src/features/*`); public API = its `index.*`, or a placeholder flagged in the report. With no such folder, one per folder matching `route_domains_from` (`app/*`, `src/routes/*`…): Next `[param]` folders are looked through, catch-alls and `_private` skipped, `(group)` named without parentheses; public API = its `index.*`, else the files imported from outside plus its entries (`page.tsx`) | Design: "subfolders of features/"; repos organized by routes had no domains and so no module notes (2026-11-04) |
| `init` rules | Three core rules `error`; `ignore_kinds: [type]` when the repo has TypeScript; `integrity` `warn`; preset `default_rules` (`next-server-client`) as `warn` | Type-only imports rarely matter; a new adapter rule shouldn't block on day one |
| `init` safety | Asks before overwriting `architecture.yml`/`baseline.json`; without a terminal it refuses and suggests `--force` or `--dry-run`. The draft is validated by running the real analysis on it before writing | Design: never overwrite without confirmation |
| Orphans | Source files not imported, not entries, not tests/stories, not `*.config.*`, not `.d.ts` | Report only; no rule |
| Trying it before phase 8 | `pnpm pack:all` + [`docs/try-it.md`](try-it.md) | The validation gate needs it now |

## Phase 5 defaults (`doctor`, experimental)

Built after the validation gate without feedback from a real repo ("continue"), so it is **experimental**.

| Topic | Decision | Why |
| --- | --- | --- |
| Level names | `small`, `medium`, `large` (English), in `triage.log` and `doctor.yml` | Everything in the repo is English; the design's Spanish names are not accepted |
| `triage.log` | `.reins/progress/triage.log`, one line per task `YYYY-MM-DD \| branch \| level \| reason`; `#` comments allowed; the **latest** line of the branch counts (escalating = appending a line) | Design format; append-only keeps history |
| Diff | Files changed since the merge base with the base branch (same base-ref search as `check`; since 2026-11-08 the task's triage commit, since 2026-11-11 the branch start first), plus staged, unstaged and untracked files; `.reins/progress/` and `.reins/backlog/` excluded | "The task" is everything on the branch, committed or not |
| Suggested level | `small`: ≤ `max_files` files and ≤ `max_domains` domain; `medium`: more files, ≤ `medium.max_domains` domain; `large`: more domains, a public API file, or `architecture.yml`. Files outside every domain count as files but not as domains | Same thresholds as the planned `reins scope` (design); one function shared by both |
| `triage-mismatch` | Only when the diff needs **more** than declared. Declaring more than needed is not flagged | Design: "the diff exceeds the thresholds of the declared level"; "when in doubt pick the lower level" |
| Malformed `triage.log` lines | Reported under `triage-missing` | No separate rule in the design; the fix is the same (write a valid line) |
| Notebook | `.reins/progress/<branch>.md`, branch characters other than letters, digits, `.`, `_`, `-` become `-` (`feat/x` → `feat-x.md`). Header `# <branch> · status: open\|closed · updated: YYYY-MM-DD` (`\|` also accepted as separator). Items `- [ ]`, `- [~]`, `- [x]`, `- [-] text — reason` (`--` or `reason:` also accepted) | English version of the design's template; one parser shared with `reins progress` (phase 7) |
| `progress-closed` | Looks at items under a "Done criteria" section; if there is none, at every item | Subtasks may stay open when the task is closed; criteria may not |
| Exit code and CI | Always 0 unless `--strict`. When the `CI` environment variable is set, it prints a note and exits 0 without checking | Design: never in CI. The hook is not detected; the templates simply won't call it |
| Report format | Same as `check` (rule, why, fix; text or JSON) without the baseline parts | Design: same error format |
| `doctor.yml` | Optional; unknown keys and negative/non-integer values are errors | Same strictness as `architecture.yml` |

## Phase 6 defaults (templates, `sync`, `notes`, `scope`; experimental)

| Topic | Decision | Why |
| --- | --- | --- |
| Template texts | English translations of the design's texts; `[quick]`/`/quick` and `[deep]`/`/plan` overrides; backlog file `optimizations.md` | Everything in English |
| Where templates live | `templates/` at the repo root, laid out like a consumer repo; copied into `reins` at pack time (`prepack`/`postpack`) and read from there, or from the monorepo in development | The design puts `templates/` at the root; the CLI needs them at runtime |
| Who copies the `.reins/` sources | `reins install` (phase 8). `sync` only creates `AGENTS.md` and `CLAUDE.md` when missing, and generates `.claude/` from whatever is in `.reins/` | Keeps `sync` a pure generator |
| Generated names | Skills `.claude/skills/reins-<name>/`, agents `.claude/agents/reins-<name>.md`, with a "generated, edit the source" comment | Design: prefixed names avoid clashes with third-party skills |
| Agent sources | Frontmatter `name`, `description`, `permissions` (for people), `tools` (passed to Claude Code); body = role, when, how, returns | Design: the four parts of an agent |
| Notes index | A block between `<!-- reins:notes:start -->` and `<!-- reins:notes:end -->` in `AGENTS.md`, one line per note. An `AGENTS.md` without markers is left alone, with a warning | `AGENTS.md` belongs to the repo; reins owns only the block |
| `CLAUDE.md` | Created with `@AGENTS.md` only when missing; never touched afterwards | Belongs to the repo |
| Settings | Adds `deny: Bash(git commit:*), Bash(git push:*)` and the notes hook; removes only entries it added before and no longer wants; never reorders other entries | Design: never touch third-party settings |
| Manifest | `.reins/.generated.json` (committed): hash of each generated file, hash of the notes block, settings entries owned | Needed for `sync --check` in CI and to know what is ours |
| Ownership rules | A file at a generated path that reins didn't create is never overwritten (warning). A generated file edited by hand is overwritten by `sync` (with a message) and reported by `--check`. A generated file whose source is gone is deleted, unless edited by hand (then kept and released) | Generated files are regenerated from `.reins/`; manual edits must not vanish silently |
| `sync --check` in `check` | When the manifest exists, divergences become `integrity` findings (warn by default) | Design: integrity includes generated files |
| Notes hook | `"$CLAUDE_PROJECT_DIR"/node_modules/.bin/reins notes --hook` on `PreToolUse` for `Read\|Edit\|Write\|MultiEdit`; once per note per session (state in `.reins/progress/.notes-seen.json`, last 50 sessions); any error = no output, exit 0 | Accepted after phase 0; the local binary avoids `npx` startup on every tool call |
| `scope` | Folders are expanded to their files; thresholds from `doctor.yml`; same `suggestLevel` as the doctor | One definition of the levels |
| Pre-commit hook | `.reins/hooks/pre-commit.sh` runs `npx reins check --files <staged ACMR files>` | Design: the hook checks touched files only |

## Phase 7 defaults (`audit`, `progress`, `review`; experimental)

| Topic | Decision | Why |
| --- | --- | --- |
| Backlog file | `.reins/backlog/optimizations.md` (local), plain markdown, one finding per line: `- [open\|done\|wontfix] [recheck]? A<n> · date · \`path\` · finding — status date: reason` | Readable by people and agents, editable line by line, survives hand edits around it |
| Backlog ids | `A1`, `A2`… (max + 1) | Short, stable references for `audit set` |
| Duplicates | `audit add` refuses the same path + text (case-insensitive) as any existing finding, including `wontfix` | The design's point: don't propose the same thing again |
| Status changes | `done` and `wontfix` need a reason; reopening doesn't; any status change clears `recheck`. `wontfix` prints a hint to move durable reasons to the module note | Design |
| Recheck | `audit recheck <id…>` or `audit recheck open` flags findings; `list --recheck` shows them | "mark for re-verification" |
| Invalid backlog | Reported by `list`; every edit refuses to work on an invalid file | Never build on a broken file |
| `progress` actions | `new [--hot]`, `show`, `add [--criteria]`, `start`, `done`, `drop <reason>`, `next`. No `close`: only the person closes | Design lists done/add/next; start/drop cover the other two markers; new uses the templates |
| Item numbers | 1-based, file order, across all sections; `show` prints them | One numbering for every command |
| `start` | Puts any other `[~]` back to `[ ]` and says so | Only one in progress; the agent switching tasks shouldn't fail |
| Validity | Every edit: parse → refuse if invalid → apply → bump `updated:` → re-validate before writing. A refused edit writes nothing | Criterion: "progress never leaves the notebook badly formatted"; tested with 500 random edit sequences |
| `review` | Prints a prompt: instructions, changed files, `.reins/review/checklist.md` (template as fallback), notes of touched paths, and the diff against the merge base, including uncommitted and untracked files (local `.reins/progress|backlog` excluded). Diff truncated at 200 KB (`--max-bytes`) with a notice | Design: no API calls; any agent can use the prompt |
| Executors | `EXECUTORS` map in `commands/review.js`; only `print` exists; `--executor` selects one | Extension point for a future runner, without building it |

## Phase 8 defaults (`install`, distribution; experimental)

| Topic | Decision | Why |
| --- | --- | --- |
| `install` vs. documented steps | A command, additive and idempotent: copies missing `.reins/` sources, appends missing `.gitignore` lines, adds a `reins:check` script, wires the hook, writes the CI workflow, runs `sync`. Never overwrites existing files (the workflow only with `--force`), never installs packages; `--dry-run`, `--skip-hook`, `--skip-ci` | Fewer manual steps means fewer half-installed repos |
| Hook manager | Uses what the repo has: lefthook (config file or dependency) first, then Husky (`.husky/` or dependency). Neither → explains how to add one; no hook is written | Task: "Husky or lefthook, whichever the repo already uses". Installing one would be installing packages |
| Husky hook | Appends `sh .reins/hooks/pre-commit.sh` to `.husky/pre-commit` (no shebang: Husky 9 runs hook files with `sh`) | Husky 9 format |
| lefthook | Adds `pre-commit.commands.reins.run` with the `yaml` Document API, keeping comments and other commands | Editing YAML as text is fragile |
| CI workflow | `.github/workflows/reins.yml`: PRs and pushes to the default branch; `fetch-depth: 0` (integrity needs the base); Node 22; setup and install per package manager (npm `npm ci`, pnpm `pnpm/action-setup@v4` with the major version from `packageManager` or the local pnpm, yarn, bun); then only `npx reins check` | Design: CI runs only `check` |
| `.gitignore` | `.reins/backlog/`, `.reins/progress/`, `.reins/init-report.md` | Local state; the init report is for review only |
| Distribution without publishing | Tarballs committed in each repo under `vendor/reins/` and installed with relative `file:` paths | Verified: installing from a path outside the repo writes that path into the lockfile, and CI can't reach it |
| Branch protection | Printed as a next step and documented; not automated | Needs repo admin rights; outward-facing |

## Phase 9 defaults (docs, self-check, 0.1.0)

| Topic | Decision | Why |
| --- | --- | --- |
| License | MIT, copyright fredarcito (author's decision). `license: "MIT"` in every package; `pnpm pack:all` copies `LICENSE` into each package (gitignored copies) | "Usable without problems"; the most common permissive license in the JS ecosystem |
| Version | `0.1.0` in the three packages and the root, not published. `CHANGELOG.md` | First pilot version |
| Self-check | `.reins/architecture.yml` for this repo (`cli` > `adapters` > `core`, `core` as a domain whose public API is `index.js` + `contract/`), checked two ways by `pnpm self-check` (in CI): dependency-cruiser alone with forbidden rules, and `reins check` from source, plus a guard that both see `cli → core` imports | Chicken and egg: a broken reins can't vouch for itself; the guard catches the "zero edges, still green" failure found in this phase |
| `ignore:` in `architecture.yml` | Optional globs removed from the analysis (core drops edges, the adapter drops files and warnings) | This repo's examples and fixtures; real repos have generated code and stories too |
| Workspace resolution | The adapter passes `exportsFields: ['exports']` and `conditionNames` to dependency-cruiser and works from the real root path | Bug found in this phase: imports of `exports`-only workspace packages disappeared |
| Doctor counts | Triage counts only code files: `.reins/`, `.claude/`, `AGENTS.md`, `CLAUDE.md` don't count; `architecture.yml` is still detected | Bug found in the walkthrough: a one-file change looked like four |
| Diagrams lint | `pnpm lint` rejects mermaid labels with HTML entities, quotes, `<`, `>` or `|`, and reserved node ids | GitHub failed to render one diagram |
| Pilot | [`team-adoption.md`](team-adoption.md) + [`PILOT.md`](PILOT.md) template; thresholds decided before starting | Design: metrics and keep/simplify/drop criteria defined in advance |
| `npx --no-install harness` (until the rename to reins) | Every doc, template, skill, policy, hook and CI step ran the CLI with `--no-install` | An unrelated public npm package is called `harness` (0.0.6): a bare `npx harness` in a repo without the CLI installed would offer to download and run it. Dropped with the rename: see "Name" below |

## Phase 10 defaults (context between sessions; experimental)

Goal (author, 2026-11-04): an agent that comes back to a module a week later knows what it does, its decisions and why, without reading all its code; and a long conversation that gets compacted keeps what matters of the task.

| Topic | Decision | Why |
| --- | --- | --- |
| Note format | Template with five sections: Purpose, Map, How it works, Decisions (date, decision, why), Traps. Still free markdown: nothing is parsed except the `paths` frontmatter | A list of dated decisions doesn't tell a newcomer what the module is; the sections are what you'd otherwise rediscover from the code |
| `reins notes new <domain\|folder>` | Drafts the note from the import graph (public API, most imported files, who uses the module, what it depends on, grouped by domain or by first two folders). What only people know is left as `TODO` lines. Without a graph (no `architecture.yml`, no adapter) it still drafts, without the Map facts. Never overwrites without `--force` | The graph knows the structure for free; the agent only writes what the code can't say |
| Keeping notes current | `done` updates the notes of the touched modules as part of closing (no longer "when the person confirms"). New doctor rules, warn only: `note-missing` (a touched domain has no note) and `note-outdated` (a module's files changed but its note didn't) only for medium/large diffs (the objective level of the diff, not the declared one); `note-draft` (TODO lines left) and `note-size` (> `notes.max_lines`, default 60) for the notes of what the branch touched | A note nobody writes is worth nothing; small fixes must not pay this |
| `reins resume` | Prints the branch notebook, the files changed on the branch (up to 30) and the notes of those files (up to 6 in full, the rest by path). `--json` for agents | One command to pick a task up, for any agent |
| `SessionStart` hook | `sync` adds `reins resume --hook` with matcher `startup\|compact\|clear`. Not `resume`: a resumed session still has its transcript. Prints nothing when there is no notebook and no change | Verified in Claude Code 2.1.318 (P9): fires with `source: "compact"` and its context reaches the model |
| Fewer steps to adopt | `reins init` also drafts a note per inferred domain that no note covers (never touches existing notes; `--dry-run` lists them) and, if `install` already ran, updates the `AGENTS.md` index. `reins install` appends a `## Module notes` section with the index markers to an `AGENTS.md` the repo already had. `notes new --name` sets the file name | Trying it on this repo took nine steps; the markers had to be pasted by hand and each note created one by one. Most teams that use agents already have an `AGENTS.md` |
| Notes after a compaction | The session keeps its `session_id` after a compaction, so the "once per session" record made the notes hook stay silent while the notes were gone from the context. On `compact` and `clear`, `resume --hook` forgets the session's record and re-delivers the notes of the changed files; later reads deliver the others again | Bug found while designing this phase (P9) |

## Dependencies

| Package | Where | Why |
| --- | --- | --- |
| `yaml` | `core` | Read `architecture.yml` and `doctor.yml`. Node has no YAML parser |
| `dependency-cruiser` | `adapters/js` only | Compute the import graph (with aliases). Decided in the design over writing our own parser. Requires Node `^22 \|\| ^24 \|\| >=26` |
| `yaml` | `adapters/js` | Removed 2026-11-10: presets are JS modules now (see "Presets are JS modules"). Was: read the presets (`presets/*.yml`) |
| `yaml` | `cli` | Edit `lefthook.yml` without losing comments (`reins install`) |
| `typescript` | `adapters/js`: optional peer + dev | Only needed for TS repos; dependency-cruiser uses it to parse `.ts`/`.tsx`. Dev dependency so the TS example can be tested |

## Design adjustments proposed after phase 0

They come from [`VERIFIED.md`](VERIFIED.md). Pending your OK.

1. **Notes via hook (P1) — accepted 2026-11-04:** `PreToolUse` context arrives after the model wrote the edit. Decision: the hook matches `Read|Edit|Write|MultiEdit` and delivers each note at most once per session (keyed by `session_id`). The `AGENTS.md` index line stays as the tool-agnostic path. Still unverified (P1 in VERIFIED.md); the "deny first edit" variant is not built.
2. **Git permissions (P2) — deferred 2026-11-04, design kept as is:** `Bash(git commit:*)` is bypassed with `git -c x=y commit` or `bash -c '...'`. For now we build what the design says (deny rules for `git commit` and `git push` only); no extra `Bash` hook. The known bypass stays documented in VERIFIED.md and STATUS.md, and branch protection + CI remain the real guarantee.
3. **`CLAUDE.md` (P3):** Claude Code 2.1.318 already reads `AGENTS.md` on its own. `CLAUDE.md` with `@AGENTS.md` is kept for compatibility (costs ~124 tokens, no duplication).
4. **Adapter resolution (P7):** the CLI resolves the adapter from the project root, not from its own location, and checks `reins.contract` itself, because pnpm only warns on an incompatible peer.
5. **Aliases (P6):** dependency-cruiser doesn't resolve `@/` without help. The adapter reads `paths` from tsconfig/jsconfig and Vite's `resolve.alias`. The phase 3 examples will include `tsconfig.app.json` with references and `vite.config.ts`.
6. **Plain JS/JSX projects are a requirement** (your request, 2026-11-04): `adapter-js` must work on `.js`/`.jsx`/`.mjs`/`.cjs` projects with no TypeScript at all, as well as `.ts`/`.tsx`. Consequences: `typescript` is not a dependency of the adapter; it parses `jsconfig.json`/`tsconfig.json` `paths` itself and passes them as `alias` (verified to work without `typescript`, P6); the examples include at least one pure JS/JSX project (`examples/vite-react` will be JS/JSX with `jsconfig.json`, `examples/next-app` TS).

## After 0.1.0: skills for the steps people skip

| Topic | Decision | Why |
| --- | --- | --- |
| `reins-notes` | A skill, not a CLI feature: the CLI never calls a model | Filling notes needs to understand code; "ask your agent" was easy to miss |
| `reins-arch` | Proposes, never applies without approval; existing violations stay baseline debt by default; `allow:` only with the person's reason; never bends the plan to pass | The plan is what `check` enforces: an agent "fixing" it to go green would turn the check into decoration |
| `check --coverage` | Read-only facts for that review, also after `init` (files per layer and domain, folders outside every layer, imports between layers, exceptions, baseline) | The init report only exists right after `init` |
| `reins-agent` | Agents are written in `.reins/agents/` and generated by `sync`; read-only and fewest tools by default | Same path as the built-in agents, so they stay tool-agnostic and never hand-edited in `.claude/` |
| `progress new` | Uses `.reins/templates/` first | Team templates were ignored by the command |
| Keeping notes current | At task close, through `/reins-done` (and `doctor`'s `note-outdated`/`note-missing`). No Claude Code `Stop` hook (decided 2026-11-04) | `Stop` fires after every reply, including answers and intermediate steps, so it would ask for note updates at the wrong moments. Revisit only if the pilot shows tasks closed without `/reins-done` and notes going stale. The hook's blocking behavior is unverified |
| This repo: `tooling` layer | `scripts/**` is a layer above `cli` (approved 2026-11-04 after `/reins-arch`) | `reins check --coverage` showed `scripts/` outside every layer, so nothing stopped a published package from importing repo-only tooling |

## Name: reins (2026-11-04)

| Topic | Decision | Why |
| --- | --- | --- |
| Name | **reins** (the straps you steer a horse with): the agent pulls, you steer. Chosen by the author among names free on npm on 2026-11-04 (`reins` returned 404 on the registry) | Keeps the harness metaphor and the design's principle: the agent never commits, the person decides. (In old English and in French it also means kidneys; accepted) |
| Packages | `@agentreins/cli` (command `reins`), `@agentreins/core`, `@agentreins/adapter-js`; third-party adapters `reins-adapter-<x>`. The organization `reins` was taken on npm; `agentreins` (created by the author, free plan) says what the tool is for: reins for agents. `pnpm lint` requires the CLI to have exactly one bin, `reins` | First plan: publish the CLI unscoped as `reins`, so the `npx reins` fallback would be ours. npm refused it on 2026-11-04 (403: "too similar to existing package redis"); that typosquatting rule applies to everyone, so nobody can publish `reins`, and a bare `npx reins` without the CLI installed fails instead of running someone else's code. That is why `--no-install` is still not needed. Running without installing: `npx @agentreins/cli <command>` |
| Everything else | Folder `.reins/`, markers `<!-- reins:notes:… -->`, generated skills and agents `reins-*`, script `reins:check`, workflow `.github/workflows/reins.yml` with job `reins` (the branch protection check name) | Nobody had adopted it yet: one name everywhere was cheapest now |
| Repository | Renamed on GitHub from `fredarcito/harness` to `fredarcito/reins` (2026-11-04); GitHub redirects the old URL. The local folder can keep any name | One name everywhere |
| History | `docs/DESIGN.md` and `docs/VERIFIED.md` keep the old name `harness` (they record the design and the tests as they were) | Rewriting evidence would make it lie |

## Notes for the parts of a module (2026-11-05)

| Topic | Decision | Why |
| --- | --- | --- |
| Parts get notes, not domains | `init` drafts one note per part of a route domain (e.g. `companies/[slug]/salaries`): looks through `(group)`, `[param]` and single-folder chains, needs 2+ source files, at most 12 per domain. Parts never become domains | One note for a module with eight tabs is long and generic; a domain per tab would add boundaries that aren't real. Notes add context, not rules |
| Layout | `.reins/notes/<module>.md` plus `.reins/notes/<module>/<part>.md`, one level deep; the module's note stays outside its folder | The relation is explicit (no guessing from globs), 50+ flat files are hard to browse, and a module that later gains parts doesn't move its note. Mirroring the source tree was rejected: it breaks whenever code moves |
| Order and index | `notesFor` returns the most general note first; `sync` puts a module's parts on its line in `AGENTS.md` | The shared context is read before the specifics; `AGENTS.md` is paid on every session |
| `note-layout` (warn) | Flags notes deeper than one folder, parts without their module note, and parts whose paths are outside the module's folders | Cheap checks that keep the layout meaningful |
| Feature domains | Only route domains get parts drafted | Inside `features/x` the subfolders are usually `components/`, `hooks/`: a note per folder would be noise |

## Route domains: groups, lone pages, owned folders (2026-11-05)

| Topic | Decision | Why |
| --- | --- | --- |
| Route groups | `(x)` folders are looked through like `[param]` | In Next a group only shares a layout; `(main)` as a domain mixed unrelated routes. A group holding one feature (`(companies)/companies`) still gives that feature |
| Same route in several groups | Folders whose path without groups is the same are one domain (and one part) with several folders | Groups are not part of the URL: `(companies)/companies` and `(main)/companies` are both `/companies`. Found on a real repo, where they came out as `companies`, `companies-2`, `companies-3` |
| Lone pages | A route folder needs 2+ source files to be a domain; the rest are listed in the report | Looking through groups would otherwise turn every legal page into a domain with an empty note |
| Logic outside the route | Revised 2026-11-05 after a real repo (see below). Was: a folder joins a domain only when 100% of its imports come from it, descending otherwise | Decided by the import graph so it works for any convention (`components/pages/x`, `components/x`, `views/x`). Matching folder names was rejected: it breaks on `CompanyProfile/` vs `companies` and covers one convention only |
| Partial majorities | Revised 2026-11-05: see "Owned folders, second version" | |
| Closed domains | Reported, not warned | A route domain whose public API is only `page.js` is not "unchecked": `domain-boundary` flags any outside import of its files |
| Feature domains | Unchanged | `features/x` already holds its own components |
| Barrels | The JS adapter reads `index.*` files that only re-export, and the named imports of their importers, and returns `uses` (importer → file behind the barrel). `init` uses them instead of the edges into and out of barrels; rules keep the real edges. Anything it can't resolve (default or namespace import, dynamic import) counts as using everything behind the barrel | With a `components/index.js` barrel every page imports the same file, so no folder could ever look owned. Text, not a parser, because it is JS-specific (adapter) and the conservative fallback keeps mistakes on the safe side |
| Loose files | A file outside every owned folder that only one domain uses (directly or through other such files) joins the domain's note paths, never its `architecture.yml` paths | Notes are context and cannot block anyone; a rule built on "used once today" would break the day a second route uses the file |

## Owned folders, second version (2026-11-05)

Running 0.5.1 on a real Next.js app (1204 files) showed the first version split features into pieces and assigned shared code.

| Topic | Decision | Why |
| --- | --- | --- |
| Never split a feature | Inside a folder organized by feature, a subfolder joins the domain that makes at least 2/3 of the imports into it, whole. The other imports become violations, frozen in the baseline and counted in the report | Requiring 100% made one import from another domain push the algorithm down a level, ending with `OverviewPage/content/**`, `OverviewPage/faq/**` and 100+ single files; a new file in `OverviewPage/` had no domain. Freezing a few imports is better than a plan nobody can read |
| "Organized by feature" | A folder's children are split among domains only when most of its used children are mostly used by one domain (`components/pages/`). Otherwise it is shared code and nothing in it is assigned (`components/shared/`) | A graph signal, not a name list: `components/shared/CircularProgress` used by one page today is still shared by intent, and its siblings say so |
| Layer roots | Directly under a layer root, a folder still needs every import from one domain | A layer root mixes everything (`components/` holding `Button`, `pages/`, `JobBoard/`), so it says nothing about intent |
| Lowest layer | Never assigned, folders or loose files | It is shared by design (`utils/vote.js`, `constants/dates.js` were assigned before) |
| AGENTS.md index | At most two paths per note, then `(+N more)` | The index is read on every session; one note listed ~150 paths |
| Preset shared layer | Adds `constants`, `store`, `api`, `context` (and `src/config`); not `providers` | Common low-level folders were left out of every layer (93 of 1204 files unchecked). Providers often import components, so a fixed layer would be wrong; the report proposes one from its imports instead |
| Unclassified folders | The report proposes the lowest layer each one fits without violations, from who imports it and what it imports | Turns a list of unchecked folders into a decision a person can take in seconds |

## GitHub Pages site (2026-11-05)

| Topic | Decision | Why |
| --- | --- | --- |
| Landing page | `site/index.html`, one static file: vanilla HTML/CSS/JS, no framework, no build step | The page markets a no-lock-in, no-build-step tool; building it with a framework would contradict the message. Nothing new to maintain or update |
| Deployment | `.github/workflows/pages.yml`: official Pages actions (`configure-pages` / `upload-pages-artifact` / `deploy-pages`), on pushes to main touching `site/`, plus a manual trigger. Requires enabling Pages once (Settings → Pages → Source: "GitHub Actions") | The official flow needs no branch and no deploy key; a `gh-pages` branch and a `docs/` root were rejected — the first duplicates the source, the second would mix the landing page with the team's `docs/` and expose the markdown raw |
| Accuracy | Terminal output and rule texts on the page are quoted from the README and the core rule templates (`packages/core/src/check/rules/`), not invented | The page claims "same check locally and in CI"; showing fake output would undermine it |

## `reins impact`: the reverse of scope (2026-11-06)

Proposed from a real working session: `scope` goes path → domain, but nothing went the other way (file → consuming domains), so every agent paid recursive greps and a mental join with `architecture.yml` before touching a shared file.

| Topic | Decision | Why |
| --- | --- | --- |
| Contract | None added: the `Edge { from, to, kind }` contract and the adapter graphs are enough; `impact` is a pure core function (`impactOf`) over edges + domains | The proposal asked for an "edge provider contract" that already existed. A new adapter gets `impact` for free with the `graph()` it already needs for `check` |
| Extraction | The adapter's own graph (dependency-cruiser in `adapter-js`); knip rejected as a second extractor | No new dependency to justify; aliases and barrels are already solved there |
| Consumers | Files **outside** the target that import it; internal imports are not consumers; folder targets include everything inside | The blast radius of a change is who breaks outside, not who is already inside |
| Import kinds | All kinds count, including `type` (unlike rules with `ignore_kinds`) | A type-only import still breaks when the type changes: impact is about breakage, rules about architecture legality |
| Crossings | An import that reaches a domain's internals instead of its public API, before `allow`/`ignore_kinds` exceptions | Shows the leak even when `check` doesn't report it; the same shape `domain-boundary` would flag |
| Existing violations | Reuses `runCheck` with the `--files` filter (target + importers, adapter rules included), baseline status shown | One code path for what a violation is; impact never invents its own rule semantics |
| Level | `scopeSignals` + `suggestLevel` over the target plus its importers | Same thresholds as `scope` and `triage-mismatch`; the level of a breaking change, announced before the work |
| Barrels | Importers that reach the target through a barrel count as consumers (kind `barrel`), from the adapter's existing `uses`; crossings stay on real edges | Without it, a util re-exported by `utils/index.ts` shows the barrel as its only consumer and the level comes out too low — confidently wrong. Going through a domain's public API barrel is the legal path, so it is never a crossing |
| Symbols | File or folder, not `<file-or-export>`; `names[]` on edges rejected | Symbol questions stay a one-liner grep inside the domains impact lists; altitude stays at domains |
| Making agents use it | The generated `AGENTS.md` carries an unconditional trigger (restructuring a domain/folder, or editing a file others may import; unsure → run it; every level) plus a short command index ending in `reins --help`; the triage policy, the explorer and the audit skill repeat it where they act | First real use (2026-11-07): on "restructure cloud-index, full optimization" the agent ran `scope` on two files and skipped `impact` because it "didn't propose changing a shared contract" — before having a plan. The instruction lived only in `triage.md`, which agents skip because `AGENTS.md` already summarizes it; it was conditional on judging a file "shared", and small said "don't explore". A hook that delivers impact on Edit (like notes) is the stronger fix: built on 2026-11-08, see "Impact through the notes hook" |
| Cache | None: the graph is recomputed per run, exactly like `check` | Freshness is the property that makes the answer trustworthy; cache only if extraction cost becomes a measured problem |

## Tasks anchored to their start commit (2026-11-08, backlog A2)

`triage.log` only grew, and doctor compared the whole branch diff with the highest level ever declared on the branch. On long-lived branches (main, staging, epics) one old `large` line hid every `triage-mismatch` and any old line hid `triage-missing`; and the local base was `origin/main`, so on feature → staging flows the diff included other people's staging work.

| Topic | Decision | Why |
| --- | --- | --- |
| Writing the line | The agent runs `reins triage <level> <reason> [--task <name>]`; reins adds the date, the branch and `commit:<HEAD>` (12 chars), and `task:` when given. The fields go at the end, so old lines and old reins versions still parse | The agent can't be trusted to copy a sha by hand; one command keeps the format valid |
| What doctor compares | The diff since the commit on the branch's latest line (plus uncommitted changes), against the highest level among lines with that same commit | Agents don't commit, so tasks started at the same commit share the uncommitted diff and can't be told apart; tasks after a commit get a clean diff |
| Fallback | Latest line without a commit, or a commit that is no longer an ancestor of HEAD (rebased): the branch diff against the base and the highest level of the branch, as before | Keeps hand-written lines and older installs working |
| Cleanup | `resume` (hook and command) drops lines whose branch is gone (no local branch, no remote-tracking ref; the current branch always counts) and lines whose task has landed: commits exist since its commit and all of them are in the base. doctor applies the same filter without writing | The backlog's wording, "start commit already in the base", would drop every task that starts on `main` or right after branching, where the start commit is always in the base. Landing means the task's own commits reached the base; merging `main` into a feature does not count, since the feature's own commits are not in the base |
| Shared helper | `liveBranches` in `cli/src/project.js` (local + remote-tracking refs), reused by the notebook cleanup of the multi-session proposal | One definition of "the branch exists" |
| Not changed | `check` and `review` keep their base (`--base`, `REINS_BASE`, CI PR target, `origin/HEAD`) | They judge what enters git, not a task. Since 2026-11-11 they use the branch start too, never the triage line |
| Rejected (reversed 2026-11-11) | Detecting the parent branch from the reflog | Reflogs are local, expire and say nothing about the flow the team uses. A team that cuts tasks from `staging` showed the cost of not doing it; see "Comparison base" below |
| Known limit | On `main`, if the person commits and pushes in the middle of a task, the task's line is dropped and doctor asks for a new line (`triage-missing`) | Committing is the person's signal that the work is done; one extra `reins triage` line is cheap |

## One notebook per task (2026-11-08, phase 1)

Design and the cases it covers: [`proposals/multi-session-progress.md`](proposals/multi-session-progress.md). A branch had one notebook, so tasks one after another, parallel sessions on one feature and a fresh session per task all collided on it.

| Topic | Decision | Why |
| --- | --- | --- |
| Unit | One notebook per **task**, `.reins/progress/<branch>/<task>/notebook.md`; the task folder holds its cold files and agent reports | A task outlives a session (a new session continues it) and several tasks share a branch. A task is one folder: reading, closing or deleting it touches one place |
| Rejected | A. one notebook per session (a new session can't continue a task); C. one per branch, closed ones skipped (breaks parallel sessions and a new session with the previous task open); D. one file per branch with a block per session (unsafe concurrent writes without a lock) | See the proposal, section 4 |
| Session | `session:` in the header holds the last session that claimed the task: from the hook payload, `CLAUDE_CODE_SESSION_ID` (verified, P11) or `REINS_SESSION`. No ownership check | Every `reins progress` command claims what it acts on, so compaction and `/clear` find the task again |
| Reading | `progress show` does not claim (2026-11-10); only commands that edit do | An agent ran `show --task` to see what another session had done and silently became the task's owner, so that session lost it. Looking is not continuing |
| Choosing | Explicit `--task`/`REINS_TASK`; else the open task this session claimed; else none, and `resume` lists the open tasks. Never taken silently | At session start reins can't tell "continue yesterday's task" from "next task"; the person's first message can |
| Compatibility | No migration. Without a session id and one open notebook, it is used, as before. The older `<branch>.md` keeps working as a task without a name until it is closed; its cold files are the plain files of `<branch>/` | Agents without session ids (Codex, Cursor) and notebooks in progress keep working |
| Read view | `resume` shows the own notebook in full, other open tasks in 1–2 lines (5 at most), closed ones in one line only while others are open | About 100 tokens per session with three parallel sessions; nothing extra with one |
| Cleanup | `resume`, fixed 7-day margin: closed → deleted 7 days after closing or with its branch; open → only when its branch is gone and it has not changed for 7 days. Open removals add one line; the rest is silent. Uses the A2 `liveBranches` helper | Nothing piles up, and open work on a live branch is never lost |
| Overlaps | Policy only: the agent asks the person and writes one line in its own notebook | The person already talks to every session |
| Deferred to phase 2 | Feature notebook, `**Needs:**` requests between tasks, "new from other sessions" after each edit, cleanup log and configurable margin | Built only if real use asks for them |

## Impact through the notes hook (2026-11-08)

Agents still skipped `reins impact`, this repo's own agent included (2026-11-08: core's public API changed under a declared `medium`; doctor caught it only at the end). The rule is read at session start but applies right before an edit, where nothing recalls it — the same failure notes had before their hook.

| Topic | Decision | Why |
| --- | --- | --- |
| Where | The existing `PreToolUse` notes hook (Read, Edit, Write) adds the impact warning | The agent reads before editing, so it arrives in time (P1). No new hook to install |
| When it speaks | Only when the file has importers **and** the declared level of the current task (same window as doctor) is lower than impact's minimum, or no level is declared. Once per file and session; while untriaged, once per minimum level | An actionable "stop and re-triage" at the right moment, not one more line per file read |
| Cost | `reins impact --map` (importers count and level of every imported file, one pass over the graph, same `scopeSignals`/`suggestLevel` as `impact`) runs detached from the `SessionStart` hook into `.reins/progress/.impact-map.json`; the notes hook only reads it. ~0.7 s on this repo, off the critical path | Building the graph per edit costs seconds on large repos. Not on compaction; only when `CLAUDE_PROJECT_DIR` is set (Claude Code) |
| Staleness | The map is from session start; imports added during the session are not in it | Shared files rarely change shape mid-session; the next session rebuilds it |
| Not built | Denying the first edit of a shared file | Intrusive and untested (P1 only verified delivering context); only if warnings turn out not to be enough |
| Other agents | Unchanged: the `AGENTS.md` rule and doctor's `triage-mismatch` afterwards | No provider-neutral way to intercept an edit |

## Architecture map comment on PRs (2026-11-08)

Plan and rejected alternatives: [`proposals/pr-map.md`](proposals/pr-map.md). No new dependency.

| Topic | Decision | Why |
| --- | --- | --- |
| Base graph | A `git worktree` at the merge base, analyzed with the head `architecture.yml`; the adapter's optional `prepareCheckout` makes it resolvable | The adapter reads files from disk, so the base needs a checkout. Phase 0b showed a bare worktree reports every cross-package import as new (25 false edges here) |
| `prepareCheckout` | Mirror each `node_modules` entry by entry: workspace links (target inside the repo, not under `node_modules`) are recreated relative, the rest are absolute links to the main install. Optional contract field in adapter-js, core unaware of `node_modules`; Yarn PnP only warns | Linking whole folders resolves pnpm's relative workspace links against the head, so the base would be the head. Installing in the worktree costs network and minutes in CI |
| Contract | `prepareCheckout` added as an optional field; contract stays at version 1 | Same rule as `files`, `uses`, `presets`: additions do not break existing adapters |
| Only analyzed files are nodes | Changed files outside `graph.files` (docs, JSON, other languages) are not nodes; the file count is GitHub's total with one short note: `34 files (21 not on the map: they don't change the architecture)`. The first real PR showed `13 files` next to GitHub's 34, which a reviewer could not reconcile; listing extensions and folders was tried and rejected as noise. The context line names touched and affected domains only when there is no map; with a map they are its boxes. A file outside every layer and domain is not a node either (`N files outside layers`); "no domain" means inside a layer that has domains | Otherwise every docs or config folder shows up as "outside architecture.yml" (seen on this repo's first run; its tests sit outside every layer on purpose) |
| New violations | Violations in head's `check` that are not in the merge base's (same config, no baseline, no integrity) | A debt already there is not the PR's, and a baseline entry added in the PR must still show |
| Base graph adapter | The base graph is built by the head adapter and config (`analyze` with `loaded`), not by an adapter resolved inside the worktree | The worktree is inside the repo, so resolution can walk up to the head's copy, or find the base's through the mirrored links; either way a PR that changes the adapter would look like a change in the code (test with a workspace adapter) |
| Base side placement | Deleted files and the old path of a rename are placed with the base `architecture.yml`; no file at the base means every head domain is new | With the head config, the files of a removed domain landed in "not in architecture.yml" |
| Existing pair, new violation | A new violation on a node pair that already had an edge draws it red and adds a `-` row | The map must show every new violation, not only those on new edges |
| No code changes | A PR whose changed files include no analyzed code file says "No code changes", with no map | "No structural changes" over an empty map reads as an analysis result when nothing was analyzed |
| Comment limits | Details lists up to 150 rows (the diff's "more in Details" is then true); the short form draws at most 8 boxes; truncation is on a line boundary with fences closed | A cut in the middle of a fence breaks the whole comment |
| CI safety | Concurrency group per PR, `!cancelled()`, the comment in `$RUNNER_TEMP`, event values through `env:`, first marker id only | Races created two comments; a branch name in the script is an injection; `always()` also ran cancelled jobs |
| Several languages (2026-11-10) | One map with a frame per adapter, not one map per language; a domain is one node per frame, named `billing (rails)` in the text; frames are named after the adapter | Two separate maps lose the arrow that matters most in a full-stack PR, the one from a controller to the page it renders. reins cannot know which adapter is "back end", so it shows the adapter's name. Asked by the person after seeing a Rails + Inertia map where nothing told Ruby from React |
| Words before picture | The `diff` block with verbs ("now uses") is the main view; Mermaid supports it | A tester read bare arrows backwards (P13) |
| Prefix = severity | `-` forbidden, `!` mutual, `+` new allowed, space removed, not git semantics | GitHub colors a `diff` block by its first character; it is the only color available there |
| Violet for new | New domains and dependencies are violet, never green; red only for a broken rule; orange for mutual | Green reads as "approved" |
| Always comment | Every PR gets the comment, in the short form when nothing structural changed; skipped only with the label `reins:no-map` or by deleting the step | Silence is ambiguous: did the job fail? |
| Mutual in v1 | A new edge whose reverse exists is reported as mutual (a warning box), not blocked | Day-to-day PRs create them; no rule blocks them, so a person should decide |
| Never fails the job | `continue-on-error`, comment found by marker (never `--edit-last`), `check` stays the gate | Fork PRs have a read-only token; another bot's comment is never edited |
| Size | Diff capped at 40 lines, Details at 30 rows, map skipped over 20 structural edges (assumption until phase 0c) or if the comment would pass 60,000 characters | GitHub rejects comments over 65,536 |

## `progress close` enforces the done steps (2026-11-09)

An agent told "close it" ran `reins progress close` straight away and skipped the done skill: the module notes were not updated, and reins deletes the notebook a week after closing, so what was learned would have been lost. The skill was only advice.

| Decision | Why |
| --- | --- |
| `close` refuses while an item of the notebook is neither done `[x]` nor dropped `[-]` | Pending work in a closed notebook is lost a week later. Dropping takes a reason, so nothing is skipped silently |
| `close` refuses while the doctor flags a module note of the task's files (`note-missing`, `note-outdated`, `note-draft`, `note-dead-paths`, `note-dead-refs`) | Step 3 of the done skill is the one that gets skipped, and the doctor already knows which notes the task touched |
| `--notes-ok "<why>"` closes anyway and writes the reason into the notebook | Some flagged notes need nothing (a version bump touches `package.json`); the reason makes the skip visible instead of a bare `--force` |
| Not gated: tests, `reins check`, the reply to the person | reins can't tell whether the agent ran them; the skill still asks for them |

## Several adapters in one repo (2026-11-09)

A team with a Tauri app (React in `src/`, Rust in `src-tauri/`) asked to cover both halves. `architecture.yml` named a single adapter.

| Decision | Why |
| --- | --- |
| `adapters:` is always a list, even with one adapter: `init` writes `adapters: [js]` | Adding a language is adding a name to a list that is already there, so neither the person nor the agent has to know a second form |
| `sync` (so `reins update`) rewrites `adapter: js` as `adapters: [js]`, and `check` refuses the old key with that fix | One valid form instead of two to maintain. Upgrades that skip `sync` (Dependabot, `npm update`) get the exact fix, not a generic "unknown key". This is the first edit reins makes to `architecture.yml`: only the line, shown in the diff, and the README promise now says so. The first PR map after the migration warns once that the base plan could not be read |
| One plan, one baseline, one merged graph | Layers and domains are paths, so they need no language. Two plans would split the baseline and make `impact` and `scope` merge results |
| No `root:` per adapter: each adapter gets the repo root and finds its own files | Avoids rewriting paths between adapters. A `{ name, root }` form can come if two adapters ever claim the same files |
| Each adapter's `evaluate` sees only its own graph; duplicate rule ids are refused | An adapter rule only understands its language; one id in `rules:` must mean one thing |
| `preset` goes only to the adapter that lists it; a preset no adapter lists is an error | `adapter-js` throws on an unknown preset, so a Rust preset would break the JS graph. Without the error, a typo would be dropped silently and the graph built without the preset's entry points |
| `init` still drafts for one adapter, and refuses a plan that lists several | Only `js` can be detected today; detecting several waits for a second real adapter |
| The adapter contract did not change (still version 1) | Everything happens in the CLI |

## Thin routes in `init`, notes of new domains (2026-11-09)

First real run on a Vite repo whose routes are one `index.jsx` each and whose code lives in `components/pages/<x>` (repvue-employer): 3 domains out of 26 route folders, and `/reins-arch` then added 13 domains with no notes and no warning.

| Topic | Decision | Why |
| --- | --- | --- |
| One-file routes | Every route folder competes in `inferOwnedFolders`; only afterwards are one-file routes that own nothing left out | Dropping them first threw away the modules whose route is thin (3 → 14 domains on that repo) |
| Routes sharing a feature folder | Small routes are merged into one domain when a folder right inside a container organized by feature is imported only by them, by two or more (`mergeSmallRoutes`); the domain takes the folder's name | `notifications` + `notificationsPreferences` over `components/pages/notifications/`. Graph only: grouping by a shared `api/auth` file would depend on names and the lowest layer, so the `arch` skill proposes those groups instead, and a person decides |
| Notes of new domains | `doctor` flags `note-missing` for every domain without a note whenever `architecture.yml` changed, at any level; the `arch` skill drafts the notes of the domains it adds | Before, `note-missing` needed changed code in the domain, so domains added to the plan never got a note |

## Rails adapter (2026-11-10)

The team's backends are Rails, some with React through Inertia. The design planned a Ruby adapter that would wrap Packwerk; the adapter built does not.

| Topic | Decision | Why |
| --- | --- | --- |
| How Ruby is read | Parse every file with Prism compiled to WebAssembly (`@ruby/prism`, the only new dependency, in the adapter) | Packwerk needs Ruby, the gem in the Gemfile and its own `package.yml` setup, and the CLI would have to run Bundler. Prism is the parser Ruby ships, maintained by ruby-core, MIT, 1.1 MB, no transitive dependencies; it read 4440 files in 1.5 s. A regex reader was rejected: strings, heredocs and comments full of capitalized words would become false edges |
| What an edge is | A file names a constant that another file defines; plus `require_relative`/`require` of a repo file | Zeitwerk apps have no imports; the constant is the dependency |
| Where constants are defined | Indexed from the parsed `class`/`module`/`CONST =` definitions, not from file names | No inflector and no autoload-path configuration to mirror; files outside the autoload paths work. A module that only wraps other definitions is a namespace, not an owner |
| Lookup | Ruby's lexical lookup (innermost module outwards), then the longest prefix that has an owner. Ancestors are not followed | Covers what apps write; following superclasses needs the whole class hierarchy, gems included |
| Unresolved constants | Silent | Gems and Ruby itself are unresolved by design, so a warning would fire on every file. The contract's "never drop edges silently" is kept where a miss can be told apart: syntax errors and missing Inertia pages warn |
| Associations | `has_many :orders` is an edge of kind `association` to `Order`, resolved in the model's namespaces, with the app's acronyms and irregulars | It is a real dependency between models that no constant shows. Its own kind lets a rule ignore it (`ignore_kinds`) |
| Inertia | `render inertia:` (named or inferred from controller and action) and `inertia` routes become edges of kind `inertia` to the page file | The one place where Ruby names a frontend file. With `adapters: [js, rails]` the graph crosses languages, which the several-adapters design thought would not happen |
| Name | `rails`, not `ruby` | Detection, entry points, associations and the preset are Rails conventions; a plain Ruby gem would need different ones |
| Guessing the adapter in `init` | A `Gemfile` with `config/application.rb` wins over `package.json` | Rails apps with Vite have both, and the app is a Rails app. The frontend is added to `adapters:` by hand until `init` drafts for several adapters |
| `init` and Ruby files | `SOURCE` and `TEST` in the CLI's `init/infer.js` now include `.rb`, `.rake`, `spec/` and `_spec.rb` | The inference counted only JS extensions, so a Rails plan came out with no layers. The contract did not change (still version 1) |

## `init` knows no language (2026-11-10)

The Rails adapter showed that `init` was written for JavaScript: file extensions, test patterns, `index.js` as a folder's public API and the TypeScript check lived in the CLI. Every new language would have meant editing `init`.

| Topic | Decision | Why |
| --- | --- | --- |
| Where language knowledge lives | In the adapter's preset, as data: `sources`, `tests`, `index_files`, `orphans_ignore`, `ignore_kinds`. The CLI turns them into one `Conventions` object (`init/conventions.js`) that every inference function receives | The preset was already the channel from the adapter to `init`. Data, not callbacks: the CLI keeps the algorithms and nothing in the adapter runs during inference |
| Contract version | Still 1: the fields are optional | An adapter without them still works: every file counts as source |
| Older adapter with a newer CLI | `init` says the adapter is older and the draft rougher; no JS defaults are kept in the CLI | Keeping the old patterns as a fallback would keep the language in the CLI forever. `reins update` upgrades them together, and `init` runs once |
| TypeScript's `ignore_kinds: [type]` | The JS presets declare it (`if_files`, `unless_files`, `reason`) | Detecting it from `type` edges changed the draft of TypeScript repos that have no `import type` yet (2 of 8 repos compared) |
| A language without index files | A domain's public API is the files the rest of the code already imports, or the whole folder when nothing does | Proposing `index.js` in a Ruby pack was wrong; "what is used today" is the honest starting point, and a person narrows it |
| `init` with several adapters | One preset per adapter, joined: layers in the adapters' order (the graph decides the final order), the union of the rest. The draft has no `preset:` line; each adapter detects its own | Replaces "`init` drafts for one adapter" from the several-adapters decision. A single `preset:` can't name two presets |
| Which adapters `init` picks | The repo's main language first (Rails markers win), then any other guessed adapter that is installed and whose `detect` recognizes the repo | A Rails API with a `package.json` for tooling must not need the JS adapter; a missing one gets a one-line hint |
| Inertia pages | Preset `inertia-react` in the JS adapter, suggested when `vite.config.*` sits in a Rails app; `index_files: []` | In a pages folder `index.tsx` is a page, not a barrel, and every page is rendered by name |
| Route folders and `src/` | Also preset data: `route_segments` (`groups`, `params`, `skipped`, as regular expressions on a folder name) and `source_roots`. The three JS presets that already got those rules declare them; Rails declares `source_roots: [app]` | First left in `init/infer.js` because only Next used them; moved the same day: an `init` that still knew Next's folder names was not agnostic. Regular expressions, not globs, because the glob matcher has no character classes and `[slug]` vs `[...rest]` needs them |
| Check that nothing changed | `init --dry-run` with the code before and after, on both examples and 8 real repos: identical output | The existing tests pin the examples; real repos pin the rest |

## Presets are JS modules (2026-11-10)

The JS adapter kept its presets as YAML files plus shared fields merged in code; the Rails adapter wrote its preset as an object inside `src/`. Two shapes for the same thing, and in the YAML one a reader could not see where half of the preset came from.

| Topic | Decision | Why |
| --- | --- | --- |
| Format | Every adapter: `presets/<name>.js`, one file per preset, default export a plain object; `src/presets.js` lists them and `loadPreset` returns a copy | An adapter is a JS package whatever language it reads, so this layout works for every adapter (Rails today, Rust next) with no dependency |
| Shared fields | A preset spreads them (`...CONVENTIONS`) and replaces what differs, in the same file | The composition is written where it is read. With YAML it was a merge in another file, explained by a comment in each preset |
| What is given up | "Presets are YAML data, not code" (2026-11-04): a preset could now run code, and a tool without Node can't read it | An adapter is already code that runs, so nothing new is trusted. Presets are internal to the adapter package: teams edit `architecture.yml`, which stays YAML. No tool reads presets from outside |
| Dependency | `yaml` removed from `adapter-js` | Its only use was reading presets |
| Check | `loadPreset` of the five presets compared before and after: deep-equal | |

## The task level is measured, not guessed (2026-11-10)

In one long session an agent declared the level by eye four times and was wrong twice (small → medium, medium → large). `doctor` caught both, at the end, when the level could no longer change anything: a task that had become large was never presented as a plan.

| Topic | Decision | Why |
| --- | --- | --- |
| Who decides the level | `reins triage --files <paths>` measures it with the same signals as `reins scope` and records the higher of the declared and the measured level. With `--files` the level is optional | The level was the agent's estimate, checked afterwards. The same split as the rest of reins: what a tool can decide, a tool decides. The agent can still raise it (it knows what the diff will become); it can't go below the measure |
| The agent does not state the level | The instruction is `reins triage "<reason>" --files <paths>`: reins prints the level and the agent announces it. A level is given only to raise it | The first version still asked the agent for a level and corrected it. But the agent's real knowledge is which files the request means; the level follows from them. Asking for an estimate that a tool then overrules is ceremony |
| `--files` required below large | `small`/`medium` without files is refused with the fix; `large` alone is accepted | Without files there is nothing to measure, so only "it is big and I can't list the files" (a new feature, a migration, "review everything") makes sense. Older `AGENTS.md` blocks get the new instruction with `reins update`, which syncs them with the CLI |
| The person's level | `--override` records it without measuring | `[quick]` and `[deep]` are the person's decision; a measure must not overrule it |
| What counts | `triage.not_counted` in `doctor.yml` (default: Markdown and the usual test file and folder names): those files count neither as files nor as domains | A repo that asks for a test, a changelog entry and a note with every change made almost nothing "small" (3 files). The default lives in the config, so a team can replace it; the core applies globs and knows no language |
| When the agent hears about drift | `reins triage` and every `reins progress` edit print the doctor's `triage-mismatch` | `doctor` runs when closing. The in-flight warning came only from the notes hook, which does not fire on edits made through the shell. Updating the notebook is something the agent does mid-task |
| Not done | Hooking shell commands to see every edit | Fragile (pipes, `sed -i`, scripts), already rejected |
| Still an instruction | Telling the person when the level changes, and waiting for confirmation on large | reins can say it; it can't make the agent stop. The policy now says to tell the person when it happens, not in the final summary |

## Comparison base: branch start and `base:` (2026-11-11)

A team cuts task branches from `staging`; `origin/HEAD` is `main`. Every local command compared with `main`, so a branch with no work of its own showed ~100 files: `resume` injected notes of untouched modules, `doctor` judged the level and the notes against them, and integrity flagged, on every commit, an `architecture.yml` change already approved on `staging`. The workaround, `REINS_BASE=origin/staging` in every shell, editor and hook, is per person and wrong for a task cut from anywhere else.

| Topic | Decision | Why |
| --- | --- | --- |
| Order | `--base` → the marks (the task's triage line, task commands only; the branch start) → `REINS_BASE` → `origin/$GITHUB_BASE_REF` → `base:` in `architecture.yml` → `origin/HEAD`, `origin/main`, `origin/master`, `main`, `master`. One function, `comparison` in `cli/src/base.js`, for `check`, `review`, the PR map, `doctor` and `resume` | The marks say where this branch really started; the rest are guesses that are the same for every branch. Explicit beats everything, as a way out |
| Branch start | The commit of the branch's first reflog entry, `branch: Created from <x>`; `<x>` is the branch it came from (for `HEAD`, the branch in HEAD's `checkout: moving from <x> to <branch>`). When `<x>` (or `origin/<x>`) still exists, the newest merge base with it wins over the start | Git records nothing else about the parent. After merging or rebasing on staging, staging's newer commits are not the task: the merge base with the parent is what CI would compare with |
| No mark | No `Created from` entry (a clone, `git fetch origin x:x`, `gh pr checkout`); created from its own remote branch (`origin/<same name>`: someone else's work, whose commits its start would hide); start no longer an ancestor of HEAD (rebased); in CI (`CI` or `GITHUB_BASE_REF` set) | Each case would give a wrong diff; falling back to the base branch is what happened before |
| Scope | Task commands (`doctor`, `resume`): triage line first, then the branch start. `check` (integrity), `review` and the PR map: the branch start, never the triage line | A second task on a branch must not hide the first one's change to the plan from integrity; a review covers the PR |
| `base:` | Optional top-level key, used as written (`staging` is the local branch, `origin/staging` the remote one); recommended `origin/staging` so everyone compares with what CI sees. `init` keeps it when it runs again | The person decides which copy; resolving names behind their back was rejected as magic |
| Missing names | `--base`: an error (`resume`, `doctor`, `review`) or integrity's `noBase`, as before. `REINS_BASE` and `base:`: a warning in every command, even when a mark or another name wins, and the next candidate is used. `GITHUB_BASE_REF` stays silent (shallow CI clones) | A typo in a setting nobody reads again must not quietly bring back the inflated diff, and must not block a commit or a session start |
| Suggesting `base:` | `init` and `sync` (which `update` runs) print a hint when `origin/staging` or `origin/develop` exists, `origin/HEAD` is main or master and the plan has no `base:`. The agent asks the person; `base: origin/main` records a "no" and stops the hint | Not a default: in many teams staging is a deploy branch that main is merged into, and tasks start from main. A default would be a silent wrong guess there |
| `resume --base` | Added | The only command without a way to force the base, and the one that runs at every session start |
| Known limits | The reflog is local and expires (90 days); a task triaged before merging staging into its branch still counts staging's files (the triage line wins and is older than the merge) | The fallback is the old behavior; the second case needs a parent-aware task diff, not built until someone hits it |

## Open

- **Agent adapters for Codex and Cursor (proposed 2026-11-08):** [`proposals/agent-adapters.md`](proposals/agent-adapters.md). All logic stays in the CLI; each agent gets a generated adapter that only translates hook config and payloads.
- **Provider compatibility:** `AGENTS.md` plus the CLI is the shared baseline; actual instruction loading and native skill discovery in other clients remain unverified (see [`VERIFIED.md`](VERIFIED.md)).
- From the design, undecided: whether the team's repos share a base `architecture.yml`; what to do with monorepos; who updates the baseline and with what review.

## Notes before exploring (2026-11-12)

In DEV-8939 (repvue-employer, reins 0.15.0) the agent explored the code first (with `cat`, `sed` and `grep` in Bash, which the notes hook does not see), ran `triage` afterwards because it needed the files, and read the module note just before editing, when it could no longer save anything. The note did not cover the area either (`JobMatches/` had grown inside a module whose note described an older page).

| Topic | Decision | Why |
| --- | --- | --- |
| Notes come from the first step | `reins triage "<reason>"` without files and without a level suggests the likely notes and records nothing; the rule says to run it before reading or searching code | `triage` is the step every agent already runs first. A separate rule ("read the notes first") depends on the agent remembering; a hook only reaches Claude Code |
| How it finds them | Plain word matching (`suggestNotes` in core): reason words against note names and paths (3 points), names of the repo folders a note covers (3), its body (1, +1 when the word appears 5+ times); light English stemming; English and Spanish stopwords; test and fixture folders left out | Deterministic, no model, no network, no key: reins measures and the agent interprets. Folder names reach a module whose note fell behind its code |
| `--files` also prints notes | The notes of those files, once per session (shared with the hook's record) | The agent that already knows its files still gets the notes before editing |
| Notes guide, code decides | Hook and triage say "start from them; the code wins if they disagree, and say so" (was "follow them") | A stale note obeyed is worse than no note; the disagreement is how a note gets fixed |
| Purpose in the AGENTS.md index | Each line ends with the first sentence of the note's `## Purpose` | A task reaches a module by what it does, not only by its folder names; no per-domain aliases to maintain |
| `note-uncovered` | Doctor warns when the task changed a sizeable direct subfolder of a module (≥ `notes.uncovered_min_files`, default 10) that its note never names | Delivering a note faster helps only if it covers the area; only folders the task touched, so the fix is cheap and the agent knows them |
| Hook matcher | `Read\|Edit\|Write\|MultiEdit\|Grep\|Glob`; a folder gets the notes of the files inside it, the repo root none | Grep and Glob pass `path`; free to add |
| Not done | A hook on Bash (extracting paths from shell commands) | A cost on every shell command and fragile parsing; revisit if agents still explore before `triage` in real sessions |

