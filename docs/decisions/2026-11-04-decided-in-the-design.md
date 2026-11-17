# Decided in the design (summary)

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
