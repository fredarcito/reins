---
paths: ["packages/cli/**"]
---
# cli

## Purpose
The `reins` command line: wires the provider-neutral core and language adapter to a consumer repo's files and git, with an optional Claude Code adapter (`check`, `init`, `doctor`, `sync`, `notes`, `scope`, `impact`, `resume`, `audit`, `progress`, `review`, `install`, `update`).

## Map
- Files: 33. Used by: nothing outside the module. Depends on: domain core (13), only through `@agentreins/core`; adapters are loaded at runtime, never imported
- `src/main.js`: `run(argv, io)` — command table, `parseArgs`, repo root, `CliError` -> exit code. Everything in `io` is injectable for tests.
- `src/context.js`: `.reins/` file paths, repo root, package-manager commands, `CliError`.
- `src/project.js`: reads `architecture.yml` domains, `doctor.yml` and notes without loading the adapter; `listRepoFiles` (git ls-files, or a walk without git), `readHistory` and `dirtyFiles` for doctor's `note-dead-*` and `notes stale`; `changedFiles` (since a commit or the merge base); `liveBranches` (local + remote-tracking refs + the current branch).
- `src/notebooks.js`: one notebook per task. `resolveTask` (shared by `progress`, `resume`, `triage`: explicit `--task`/`REINS_TASK` → the open task whose `session:` is this session → no session id and one open → the older `<branch>.md` while open → none), `sessionId` (hook payload, `CLAUDE_CODE_SESSION_ID`, `REINS_SESSION`), `cleanNotebooks` (run by `resume`). `project.js` `listNotebooks` finds them.
- `src/triage-log.js`: `readTriage` (triage.log without stale lines), `cleanTriageLog` (run by `resume`), `taskFiles` (the current task's diff since the commit on its latest line, or the branch diff). Used by `doctor`, `resume` and `triage`.
- `src/adapter.js`: resolves `@agentreins/adapter-<x>` / `reins-adapter-<x>` from the repo root, checks `reins.contract`, validates it.
- `src/commands/*.js`: one file per command exporting `options`, `help` and the run function.
- `src/sync/index.js`: syncs packaged defaults from `templates/.reins/core/` into the consumer's core source directory and updates the shared rules/notes blocks in AGENTS.md; the Claude Code adapter is optional (`--skip-claude`); its preference is persisted in `.reins/.generated.json`.
- `src/commands/update.js`: upgrades the CLI and installed adapters with the project's package manager, then runs the newly installed `reins sync` executable.
- `src/init/`: `infer.js` (layers, domains, rules from the graph and preset), `render.js` (YAML and init report).
- `init` domains: `domains_from` first; only if it finds none, `route_domains_from` (one domain per route folder; `[param]` and `(group)` looked through; fewer than 2 source files → left out, listed in the report). Route domains then take feature folders by imports (`inferOwnedFolders`: never by names, through barrels via the adapter's `uses`; whole folders at 2/3 of imports inside folders organized by feature, 100% right under a layer root; never the lowest layer or a shared container) and, in their notes only, the loose files only they use (`loose`). A domain's note is skipped only when a note named after it exists, or a top-level note whose paths all lie inside it (then its parts go in that note's folder); a broader note never blocks it. Notes are drafted per domain, so no domains means no notes. Route domains also get one note per part (`inferSubmodules`: looks through `(group)`/`[param]` and single-folder chains, 2+ source files, max 12), named `<domain>/<part>` and written to `.reins/notes/<domain>/<part>.md`; parts are notes, never domains. `loadNotes` reads note folders; `sync` puts parts on their module's line in the AGENTS.md index; `notes new <folder inside a domain>` drafts a part.
- `src/templates.js`: finds `templates/` (packed copy or monorepo root). `notes-seen.js`, `notes-draft.js`: notes hook state and drafting. `local-state.js`: `writeFileAtomic` and `withFileLock` for local state files several processes write.

## How it works
`bin.js` calls `run`, which picks the command and passes a context (`root`, `cwd`, `values`, `out`, `err`, `env`, `confirm`, `today`). Commands do the I/O (files, git) and call pure core functions. `check` loads the config, resolves the adapter, builds the graph, adds integrity (git merge base) and generated-file divergences (`sync --check`), then runs `runCheck` and prints the report. `update` runs `sync` through the package manager after dependency updates so it uses the newly installed CLI rather than the already-loaded process. Exit codes: 0 ok, 1 new errors, 2 could not run.

## Decisions
- 2026-11-04: no CLI framework, `node:util` `parseArgs`. The npm scope is derived from the package's own name (`scope.js`), never hardcoded.
- 2026-11-04: the CLI never installs packages; a missing adapter prints the install command for the repo's package manager.
- 2026-11-04: `sync` only touches what its manifest records; third-party skills, agents and settings are never overwritten or deleted. Hand-edited generated files are overwritten with a message.
- 2026-11-04: Claude Code hooks (`notes --hook`, `resume --hook`) must never fail: any error means no output and exit 0.
- 2026-11-04: on `compact`/`clear`, `resume --hook` forgets the session's seen-notes record so notes are delivered again.
- 2026-11-05: `sync` never writes an AGENTS.md that doctor rejects: the notes index fits in `agents_md.max_lines` minus the hand-written lines, or shrinks to its first line (`fitNotesIndex`). That line always says to run `reins notes <path…>`: the hook misses shell reads and MCP tools.
- 2026-11-06: `impact` passes the adapter's `uses` to `impactOf` so importers behind a barrel count as consumers; without it a re-exported util shows only the barrel and the level comes out too low.
- 2026-11-07: packaged policy, skill, agent, and notebook defaults live in `templates/.reins/core/` and sync copies them into the consumer's `.reins/core/`; `.reins/{skills,agents,policies,templates,review}/` are overrides.
- 2026-11-07: upgrading from <= 0.7.4: `sync` removes unmodified copies of shipped defaults from those override folders (frozen sha256 list in `src/sync/legacy-defaults.json`, plus the current core) and moves an unedited legacy `## Always`…`## On demand` section into the rules block. Anything edited is kept; edited rules only get a warning. Without this every old repo would freeze on its copied skills and get the rules twice.
- 2026-11-07: `update` launches the installed `reins sync` via the project's package manager after upgrading; calling the imported sync function would use the old CLI code already loaded in memory.
- 2026-11-07: shared workflows use plain Markdown in `AGENTS.md` and the reins CLI; `sync`, `install`, and `update` accept `--skip-claude` to avoid touching provider-specific files. Client-level instruction loading outside Claude Code is unverified.
- 2026-11-07: `sync` persists whether the optional Claude Code adapter is enabled in its generated manifest so bare `sync --check` and CI use the same choice; `--claude` explicitly re-enables it.
- 2026-11-07: `sync` writes a README into `.reins/{skills,agents,policies,review}/`; `templates/` gets none on purpose (the notebook format is parsed by `progress`, `resume` and doctor, so overriding it is not advertised, and the policies README asks not to shadow reins' policies): without it, after the migration removes the old copies nobody knows where their own skills go. `install` skips those folders; agent scanning skips `README.md`.
- 2026-11-08: when `sync` overwrites a hand-edited file it never points to `templates/…` (inside the package) or `.reins/core/` (rewritten too): `editHint` names the override folder (skills, agents, review) or says reins rewrites it.
- 2026-11-08: `update` reads the installed CLI version before and after the package manager and says `X -> Y` or "still X" (`versionReport`), because package managers exit 0 when they hold `@latest` back.
- 2026-11-08: each task is anchored to its start commit (`reins triage` writes `commit:<HEAD>`); doctor and resume use the task's diff. A line is stale when its branch is gone or its task has landed (commits since its commit, all already in the base): not "its commit is in the base", which is true for every task started on main or right after branching. See `docs/DECISIONS.md`.
- 2026-11-08: notebooks are per task (`<branch>/<task>/notebook.md`), see `docs/DECISIONS.md`. Every `progress` command, `show` included, claims the task it acts on (`session:`), so a compaction finds it again. A new session never gets a task silently; the exceptions (no session id with one open task, the older `<branch>.md`) are flagged `guessed` and resume says so.
- 2026-11-08: `.notes-seen.json` is updated under `withFileLock` and replaced with `writeFileAtomic`: parallel tool calls run their hooks at the same time, and plain read-modify-write delivered a note twice and left invalid JSON (which reads as empty, so every session got its notes again). The lock gives up after 200 ms and runs anyway (hooks never block or fail); a lock older than 5 s is stale.

## Traps
- Commands read the session from `ctx.env`, never `process.env`: tests run inside Claude Code sessions that set `CLAUDE_CODE_SESSION_ID`.
- `cleanNotebooks` deletes files: it only runs inside `resume`, after `liveBranches`; an open task of a live branch is never removed.
- pnpm 11 has `minimumReleaseAge` (a day by default): `pnpm add pkg@latest` resolves to the newest release old enough and says "Already up to date". An exact version installs and adds a `minimumReleaseAgeExclude` entry. Don't bypass it from `update`.
- `update` at a pnpm workspace root must pass `-w` to `pnpm add`, or pnpm refuses to install.
- `legacy-defaults.json` is frozen history: never add new core versions to it; the current core is compared at runtime.
- `cwd` and root are real paths on purpose: macOS `/var` -> `/private/var` would break `--files` repo-relative paths.
- Adapter resolution starts at the consumer repo, not the CLI folder: with pnpm the CLI can't see packages it doesn't declare.
- `confirm` is undefined without a TTY (CI, hooks, agents): commands that would overwrite must refuse and suggest `--force`/`--dry-run`.
- Report goes to stdout (pass or fail); usage and setup errors to stderr.
- `templates/` lives at the repo root and is copied into the package only at pack time.
