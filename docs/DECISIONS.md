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
- **`AGENTS.md` of at most 30 lines**, no per-folder `AGENTS.md`/`CLAUDE.md`. `CLAUDE.md` only contains `@AGENTS.md`.
- **`sync` only touches what it generated** (manifest) and never deletes third-party skills, agents or settings. Own names use the `reins-` prefix.
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
| Base ref for integrity | `--base`, `$REINS_BASE`, `origin/$GITHUB_BASE_REF`, `origin/HEAD`, `origin/main`, `origin/master`, `main`, `master`; first that exists. None → integrity skipped with a warning | Works locally and in CI without configuration |
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
| Diff | Files changed since the merge base with the base branch (same base-ref search as `check`), plus staged, unstaged and untracked files; `.reins/progress/` and `.reins/backlog/` excluded | "The task" is everything on the branch, committed or not |
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
| `yaml` | `adapters/js` | Read the presets (`presets/*.yml`). The adapter can't use the core's copy: it may only import `@agentreins/core/contract` |
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

## Open

- From the design, undecided: whether the team's repos share a base `architecture.yml`; what to do with monorepos; who updates the baseline and with what review.
