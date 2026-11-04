# Status

Each piece is either:

- **stable**: enforced by a tool and covered by tests.
- **experimental**: depends on the agent reading or writing files, or on tool behavior that is not verified (see [`VERIFIED.md`](VERIFIED.md)).

Version 0.1.0, not published. Nothing is measured yet: the [pilot](team-adoption.md) is how we find out what pays off.

| Piece | Package | Planned status | Built |
| --- | --- | --- | --- |
| Adapter contract (`detect`, `graph`, `validateAdapter`, `validateEdges`) | core | stable | Yes (phase 2), tested |
| `architecture.yml` loader and validation | core | stable | Yes (phase 2), tested |
| `check`: `layer-direction`, `domain-boundary`, `no-cycles`, baseline, integrity | core | stable | Engine yes (phase 2), tested; no command until phase 4 |
| Reports (text and JSON) | core | stable | Yes (phase 2), tested |
| `adapter-js`: detect, aliases, graph, presets | adapters/js | stable | Yes (phase 3), tested on both examples and 3 fixtures |
| `next-server-client` rule (optional, Next) | adapters/js | stable | Yes (phase 3), tested |
| CLI `check`, `init`, adapter resolution | cli | stable | Yes (phase 4), tested; installed from tarballs with npm and pnpm |
| Git pre-commit hook and CI job running `check` | templates + `install` | stable | Yes (phase 8); hook and CI steps verified end to end locally; not yet run on GitHub |
| `doctor` | core + cli | experimental | Yes (phase 5), tested with simulated logs, notebooks and diffs |
| `sync`, `notes`, `scope` | cli | experimental | Yes (phase 6), tested; notes hook verified with Claude Code (2/2) |
| Templates: AGENTS.md, policies, notebook, skills, agents, pre-commit hook | templates | experimental | Written (phase 6); shipped inside `@harness/cli` |
| Notes delivered by `PreToolUse` hook | cli (`notes --hook`) | experimental | Yes (phase 6); on `Read` and edits, once per session; verified 2/2 |
| Permissions denying `git commit`/`git push` | cli (`sync`) | experimental | Yes (phase 6), written by `sync`; known bypasses (P2) |
| `audit`, `progress`, `review` | core + cli | experimental | Yes (phase 7), tested; `progress` fuzzed with 500 random edit sequences |
| `install` in a consumer repo | cli | experimental | Yes (phase 8), tested; end-to-end with Husky |

## Repo tooling

| Piece | Status |
| --- | --- |
| `scripts/lint.mjs` (syntax, import boundaries, AGENTS.md rules, mermaid diagrams GitHub can render, package metadata) | stable, tested |
| `scripts/rename-scope.mjs` | stable, tested |
| `scripts/pack.mjs` (`pnpm pack:all`) | used by the end-to-end scripts in `scripts/verify/` |
| `scripts/self-check.mjs` (`pnpm self-check`) | stable; in CI; checks this repo with dependency-cruiser alone and with `harness check` |
| `.harness/architecture.yml` of this repo | `cli` > `adapters` > `core`, no cycles, adapters use only the core contract |
| `.github/workflows/ci.yml` | written, never run on GitHub |
