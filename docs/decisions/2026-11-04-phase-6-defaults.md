# Phase 6 defaults (templates, `sync`, `notes`, `scope`; experimental)

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
