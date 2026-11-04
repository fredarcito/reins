# Status

Each piece is either:

- **stable**: enforced by a tool and covered by tests.
- **experimental**: depends on the agent reading or writing files, or on tool behavior that is not verified (see [`VERIFIED.md`](VERIFIED.md)).

Nothing here is measured. The design is a design, not a proven product.

| Piece | Package | Planned status | Built |
| --- | --- | --- | --- |
| Adapter contract (`detect`, `graph`, `validateAdapter`, `validateEdges`) | core | stable | Yes (phase 2), tested |
| `architecture.yml` loader and validation | core | stable | Yes (phase 2), tested |
| `check`: `layer-direction`, `domain-boundary`, `no-cycles`, baseline, integrity | core | stable | Engine yes (phase 2), tested; no command until phase 4 |
| Reports (text and JSON) | core | stable | Yes (phase 2), tested |
| `adapter-js`: detect, aliases, graph, presets | adapters/js | stable | Yes (phase 3), tested on both examples and 3 fixtures |
| `next-server-client` rule (optional, Next) | adapters/js | stable | Yes (phase 3), tested |
| CLI `check`, `init`, adapter resolution | cli | stable | Yes (phase 4), tested; installed from tarballs with npm and pnpm |
| Git pre-commit hook and CI job running `check` | templates | stable | No (phase 8) |
| `doctor` | core + cli | experimental | Yes (phase 5), tested with simulated logs, notebooks and diffs |
| `sync`, `notes`, `scope` | cli | experimental | Not started |
| Templates: AGENTS.md, policies, notebook, skills, agents | templates | experimental | Not started |
| Notes delivered by `PreToolUse` hook | templates | experimental | Not started; hook behavior partially verified (P1) |
| Permissions denying `git commit`/`git push` | templates | experimental | Not started; known bypasses (P2) |
| `audit`, `progress`, `review` | cli | experimental | Not started |
| `install` in a consumer repo | cli | experimental | Not started |

## Repo tooling

| Piece | Status |
| --- | --- |
| `scripts/lint.mjs` (syntax, import boundaries, AGENTS.md rules, package metadata) | stable, tested |
| `scripts/rename-scope.mjs` | stable, tested |
| `scripts/pack.mjs` (`pnpm pack:all`) | used in phase 4, no automated test |
| `.github/workflows/ci.yml` | written, never run on GitHub |
