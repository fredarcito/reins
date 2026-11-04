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
| Scanned files | Whole repo except `node_modules`, `.git`, `.next`, `.harness`, `dist`, `build`, `out`, `coverage`, `.turbo`, `.vercel`, `.cache`, `storybook-static` | Layers decide what matters; files outside every layer are ignored by the rules |
| Edge kinds | `type` (type-only, with `tsPreCompilationDeps`), `dynamic` (`import()`), `static` (everything else) | Lets `ignore_kinds: [type]` work |
| Presets | YAML: `layers` (starting point for `init`), `domains_from` (folders whose children become domains), `entries` (globs) | Presets are data, not code |
| Entries | Next special files (`page`, `layout`, `route`, `template`, `loading`, `error`, `not-found`, metadata files, `middleware`…), every file under `pages/`, `src/main.*`, config files, tests and stories | Design: Next special files are entries, not orphans |
| `next-server-client` | Optional (off unless listed). A `'use client'` file (directive as first statement) must not reach, through runtime imports, a module that imports `server-only` or `next/headers`. Reports the nearest one per path, with the chain | Everything a client component imports ships to the browser. `'use server'` files are allowed: client components may import server actions |
| Contract growth | `graph()` may return `{ edges, files, entries, warnings }`; adapters may declare `rules` and implement `evaluate(repoPath, config, graph)`. Still contract 1 (all optional) | `init` needs files/entries; adapter rules need file contents |
| Contract surface | `matchesAny` re-exported from `@harness/core/contract` | Adapters can only import the contract; avoids a second glob implementation |
| Test runner | Each package runs `node --test "test/**/*.test.js"` | Without arguments node also runs fixture files under `test/` |

## Phase 4 defaults (CLI `check` and `init`)

| Topic | Decision | Why |
| --- | --- | --- |
| Files in a consumer repo | `.harness/architecture.yml`, `.harness/baseline.json`, `.harness/init-report.md` | Design layout. The report is for review only; phase 8 will add it to `.gitignore` |
| Adapter resolution | From the repo root (then optional extra folders, used by tests): `@harness/adapter-<x>`, then `harness-adapter-<x>`. Reads `harness.contract` from the package's `package.json` (falls back to walking up from the entry file), refuses a mismatch, validates the module | Verified in phase 0 that pnpm only warns on peer mismatches |
| Missing adapter | `init` guesses `js` when there is a `package.json` and prints the install command for the repo's package manager (pnpm/yarn/bun/npm by lockfile). Never installs | Design |
| Contract growth | Optional `presets`, `suggestPreset(repoPath)`, `loadPreset(name)` on adapters; presets may list `default_rules`. Still contract 1 | `init` needs the preset; the core can't know frameworks |
| Exit codes | `0` no new errors, `1` new errors, `2` could not run | Hooks and CI only need "did it fail"; `2` separates broken setup from violations |
| Output | The report always goes to stdout (pass or fail); usage and setup errors to stderr. `--json` adds `warnings` | Hooks and agents read one stream |
| Missing baseline | Treated as empty, with a warning | A repo without baseline still gets a useful result |
| Base ref for integrity | `--base`, `$HARNESS_BASE`, `origin/$GITHUB_BASE_REF`, `origin/HEAD`, `origin/main`, `origin/master`, `main`, `master`; first that exists. None → integrity skipped with a warning | Works locally and in CI without configuration |
| `--files` | Comma-separated or repeated; relative to the current folder; real paths (symlinks resolved) | Hooks pass staged files; macOS temp folders are symlinks (bug found by the tests) |
| `--update-baseline` | Rewrites the whole baseline; refused together with `--files`; prints `+frozen / -fixed` | Integrity flags a growing baseline in the PR anyway |
| `init` layers | Preset layers whose globs match files, ordered by the dominant direction of runtime imports (type-only ignored); ties and loops keep the preset order and are reported | Design: "infer layers by dominant direction" |
| `init` domains | One per folder matching the preset's `domains_from` (e.g. `src/features/*`); public API = its `index.*`, or a placeholder flagged in the report | Design: "subfolders of features/" |
| `init` rules | Three core rules `error`; `ignore_kinds: [type]` when the repo has TypeScript; `integrity` `warn`; preset `default_rules` (`next-server-client`) as `warn` | Type-only imports rarely matter; a new adapter rule shouldn't block on day one |
| `init` safety | Asks before overwriting `architecture.yml`/`baseline.json`; without a terminal it refuses and suggests `--force` or `--dry-run`. The draft is validated by running the real analysis on it before writing | Design: never overwrite without confirmation |
| Orphans | Source files not imported, not entries, not tests/stories, not `*.config.*`, not `.d.ts` | Report only; no rule |
| Trying it before phase 8 | `pnpm pack:all` + [`docs/try-it.md`](try-it.md) | The validation gate needs it now |

## Phase 5 defaults (`doctor`, experimental)

Built after the validation gate without feedback from a real repo ("continue"), so it is **experimental**.

| Topic | Decision | Why |
| --- | --- | --- |
| Level names | `small`, `medium`, `large` (English), in `triage.log` and `doctor.yml` | Everything in the repo is English; the design's Spanish names are not accepted |
| `triage.log` | `.harness/progress/triage.log`, one line per task `YYYY-MM-DD \| branch \| level \| reason`; `#` comments allowed; the **latest** line of the branch counts (escalating = appending a line) | Design format; append-only keeps history |
| Diff | Files changed since the merge base with the base branch (same base-ref search as `check`), plus staged, unstaged and untracked files; `.harness/progress/` and `.harness/backlog/` excluded | "The task" is everything on the branch, committed or not |
| Suggested level | `small`: ≤ `max_files` files and ≤ `max_domains` domain; `medium`: more files, ≤ `medium.max_domains` domain; `large`: more domains, a public API file, or `architecture.yml`. Files outside every domain count as files but not as domains | Same thresholds as the planned `harness scope` (design); one function shared by both |
| `triage-mismatch` | Only when the diff needs **more** than declared. Declaring more than needed is not flagged | Design: "the diff exceeds the thresholds of the declared level"; "when in doubt pick the lower level" |
| Malformed `triage.log` lines | Reported under `triage-missing` | No separate rule in the design; the fix is the same (write a valid line) |
| Notebook | `.harness/progress/<branch>.md`, branch characters other than letters, digits, `.`, `_`, `-` become `-` (`feat/x` → `feat-x.md`). Header `# <branch> · status: open\|closed · updated: YYYY-MM-DD` (`\|` also accepted as separator). Items `- [ ]`, `- [~]`, `- [x]`, `- [-] text — reason` (`--` or `reason:` also accepted) | English version of the design's template; one parser shared with `harness progress` (phase 7) |
| `progress-closed` | Looks at items under a "Done criteria" section; if there is none, at every item | Subtasks may stay open when the task is closed; criteria may not |
| Exit code and CI | Always 0 unless `--strict`. When the `CI` environment variable is set, it prints a note and exits 0 without checking | Design: never in CI. The hook is not detected; the templates simply won't call it |
| Report format | Same as `check` (rule, why, fix; text or JSON) without the baseline parts | Design: same error format |
| `doctor.yml` | Optional; unknown keys and negative/non-integer values are errors | Same strictness as `architecture.yml` |

## Phase 6 defaults (templates, `sync`, `notes`, `scope`; experimental)

| Topic | Decision | Why |
| --- | --- | --- |
| Template texts | English translations of the design's texts; `[quick]`/`/quick` and `[deep]`/`/plan` overrides; backlog file `optimizations.md` | Everything in English |
| Where templates live | `templates/` at the repo root, laid out like a consumer repo; copied into `@harness/cli` at pack time (`prepack`/`postpack`) and read from there, or from the monorepo in development | The design puts `templates/` at the root; the CLI needs them at runtime |
| Who copies the `.harness/` sources | `harness install` (phase 8). `sync` only creates `AGENTS.md` and `CLAUDE.md` when missing, and generates `.claude/` from whatever is in `.harness/` | Keeps `sync` a pure generator |
| Generated names | Skills `.claude/skills/harness-<name>/`, agents `.claude/agents/harness-<name>.md`, with a "generated, edit the source" comment | Design: prefixed names avoid clashes with third-party skills |
| Agent sources | Frontmatter `name`, `description`, `permissions` (for people), `tools` (passed to Claude Code); body = role, when, how, returns | Design: the four parts of an agent |
| Notes index | A block between `<!-- harness:notes:start -->` and `<!-- harness:notes:end -->` in `AGENTS.md`, one line per note. An `AGENTS.md` without markers is left alone, with a warning | `AGENTS.md` belongs to the repo; harness owns only the block |
| `CLAUDE.md` | Created with `@AGENTS.md` only when missing; never touched afterwards | Belongs to the repo |
| Settings | Adds `deny: Bash(git commit:*), Bash(git push:*)` and the notes hook; removes only entries it added before and no longer wants; never reorders other entries | Design: never touch third-party settings |
| Manifest | `.harness/.generated.json` (committed): hash of each generated file, hash of the notes block, settings entries owned | Needed for `sync --check` in CI and to know what is ours |
| Ownership rules | A file at a generated path that harness didn't create is never overwritten (warning). A generated file edited by hand is overwritten by `sync` (with a message) and reported by `--check`. A generated file whose source is gone is deleted, unless edited by hand (then kept and released) | Generated files are regenerated from `.harness/`; manual edits must not vanish silently |
| `sync --check` in `check` | When the manifest exists, divergences become `integrity` findings (warn by default) | Design: integrity includes generated files |
| Notes hook | `"$CLAUDE_PROJECT_DIR"/node_modules/.bin/harness notes --hook` on `PreToolUse` for `Read\|Edit\|Write\|MultiEdit`; once per note per session (state in `.harness/progress/.notes-seen.json`, last 50 sessions); any error = no output, exit 0 | Accepted after phase 0; the local binary avoids `npx` startup on every tool call |
| `scope` | Folders are expanded to their files; thresholds from `doctor.yml`; same `suggestLevel` as the doctor | One definition of the levels |
| Pre-commit hook | `.harness/hooks/pre-commit.sh` runs `npx --no-install harness check --files <staged ACMR files>` | Design: the hook checks touched files only |

## Phase 7 defaults (`audit`, `progress`, `review`; experimental)

| Topic | Decision | Why |
| --- | --- | --- |
| Backlog file | `.harness/backlog/optimizations.md` (local), plain markdown, one finding per line: `- [open\|done\|wontfix] [recheck]? A<n> · date · \`path\` · finding — status date: reason` | Readable by people and agents, editable line by line, survives hand edits around it |
| Backlog ids | `A1`, `A2`… (max + 1) | Short, stable references for `audit set` |
| Duplicates | `audit add` refuses the same path + text (case-insensitive) as any existing finding, including `wontfix` | The design's point: don't propose the same thing again |
| Status changes | `done` and `wontfix` need a reason; reopening doesn't; any status change clears `recheck`. `wontfix` prints a hint to move durable reasons to the module note | Design |
| Recheck | `audit recheck <id…>` or `audit recheck open` flags findings; `list --recheck` shows them | "mark for re-verification" |
| Invalid backlog | Reported by `list`; every edit refuses to work on an invalid file | Never build on a broken file |
| `progress` actions | `new [--hot]`, `show`, `add [--criteria]`, `start`, `done`, `drop <reason>`, `next`. No `close`: only the person closes | Design lists done/add/next; start/drop cover the other two markers; new uses the templates |
| Item numbers | 1-based, file order, across all sections; `show` prints them | One numbering for every command |
| `start` | Puts any other `[~]` back to `[ ]` and says so | Only one in progress; the agent switching tasks shouldn't fail |
| Validity | Every edit: parse → refuse if invalid → apply → bump `updated:` → re-validate before writing. A refused edit writes nothing | Criterion: "progress never leaves the notebook badly formatted"; tested with 500 random edit sequences |
| `review` | Prints a prompt: instructions, changed files, `.harness/review/checklist.md` (template as fallback), notes of touched paths, and the diff against the merge base, including uncommitted and untracked files (local `.harness/progress|backlog` excluded). Diff truncated at 200 KB (`--max-bytes`) with a notice | Design: no API calls; any agent can use the prompt |
| Executors | `EXECUTORS` map in `commands/review.js`; only `print` exists; `--executor` selects one | Extension point for a future runner, without building it |

## Phase 8 defaults (`install`, distribution; experimental)

| Topic | Decision | Why |
| --- | --- | --- |
| `install` vs. documented steps | A command, additive and idempotent: copies missing `.harness/` sources, appends missing `.gitignore` lines, adds a `harness:check` script, wires the hook, writes the CI workflow, runs `sync`. Never overwrites existing files (the workflow only with `--force`), never installs packages; `--dry-run`, `--skip-hook`, `--skip-ci` | Fewer manual steps means fewer half-installed repos |
| Hook manager | Uses what the repo has: lefthook (config file or dependency) first, then Husky (`.husky/` or dependency). Neither → explains how to add one; no hook is written | Task: "Husky or lefthook, whichever the repo already uses". Installing one would be installing packages |
| Husky hook | Appends `sh .harness/hooks/pre-commit.sh` to `.husky/pre-commit` (no shebang: Husky 9 runs hook files with `sh`) | Husky 9 format |
| lefthook | Adds `pre-commit.commands.harness.run` with the `yaml` Document API, keeping comments and other commands | Editing YAML as text is fragile |
| CI workflow | `.github/workflows/harness.yml`: PRs and pushes to the default branch; `fetch-depth: 0` (integrity needs the base); Node 22; setup and install per package manager (npm `npm ci`, pnpm `pnpm/action-setup@v4` with the major version from `packageManager` or the local pnpm, yarn, bun); then only `npx --no-install harness check` | Design: CI runs only `check` |
| `.gitignore` | `.harness/backlog/`, `.harness/progress/`, `.harness/init-report.md` | Local state; the init report is for review only |
| Distribution without publishing | Tarballs committed in each repo under `vendor/harness/` and installed with relative `file:` paths | Verified: installing from a path outside the repo writes that path into the lockfile, and CI can't reach it |
| Branch protection | Printed as a next step and documented; not automated | Needs repo admin rights; outward-facing |

## Dependencies

| Package | Where | Why |
| --- | --- | --- |
| `yaml` | `core` | Read `architecture.yml` and `doctor.yml`. Node has no YAML parser |
| `dependency-cruiser` | `adapters/js` only | Compute the import graph (with aliases). Decided in the design over writing our own parser. Requires Node `^22 \|\| ^24 \|\| >=26` |
| `yaml` | `adapters/js` | Read the presets (`presets/*.yml`). The adapter can't use the core's copy: it may only import `@harness/core/contract` |
| `yaml` | `cli` | Edit `lefthook.yml` without losing comments (`harness install`) |
| `typescript` | `adapters/js`: optional peer + dev | Only needed for TS repos; dependency-cruiser uses it to parse `.ts`/`.tsx`. Dev dependency so the TS example can be tested |

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
