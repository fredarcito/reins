# Status

Each piece is either:

- **stable**: enforced by a tool and covered by tests.
- **experimental**: depends on the agent reading or writing files, or on tool behavior that is not verified (see [`VERIFIED.md`](VERIFIED.md)).

Version 0.13.0, on npm as `@agentreins/cli`, `@agentreins/core` and `@agentreins/adapter-js`. Nothing is measured yet: the [pilot](team-adoption.md) is how we find out what pays off.

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
| `triage`: each task anchored to its start commit; doctor and resume per task; `triage.log` cleaned by `resume` | core + cli | experimental | Yes (2026-11-08, backlog A2), tested on temporary repos; not yet tried on a real long-lived branch |
| `sync`, `notes`, `scope` | cli | experimental | Yes (phase 6), tested; notes hook verified with Claude Code (2/2) |
| Several adapters in one repo (`adapters: [js, rust]`): graphs merged, each adapter's rules on its own graph, one baseline; `sync` migrates `adapter: js` | core + cli | experimental | Yes (2026-11-09, 0.12.0), tested with two fake adapters; no second real adapter exists yet (Rust is next, piloted on a Tauri repo); `init` drafts for one adapter |
| `impact` | core + cli | experimental | Yes (2026-11-06), tested; pure core function over the `check` graph, no new dependency |
| Cursor: runs the `.claude/settings.json` hooks; `sync` adds a no-op `sessionStart` to `.cursor/hooks.json`; session id from `CURSOR_CONVERSATION_ID` | cli | experimental | Yes (2026-11-08), tested; verified by hand in Cursor 3.29.9 (P12, few runs); compaction in Cursor not covered |
| Impact warning in the notes hook (`impact --map` built in the background at session start) | cli | experimental | Yes (2026-11-08), tested; background build checked by hand; not yet seen changing a real agent's behavior |
| Templates: AGENTS.md, policies, notebook, skills, agents, pre-commit hook | templates | experimental | Written (phase 6); shipped inside `reins` |
| Notes delivered by `PreToolUse` hook | cli (`notes --hook`) | experimental | Yes (phase 6); on `Read` and edits, once per session; verified 2/2 |
| Permissions denying `git commit`/`git push` | cli (`sync`) | experimental | Yes (phase 6), written by `sync`; known bypasses (P2) |
| `audit`, `progress`, `review` | core + cli | experimental | Yes (phase 7), tested; `progress` fuzzed with 500 random edit sequences |
| `install` in a consumer repo | cli | experimental | Yes (phase 8), tested; end-to-end with Husky |
| `notes new`: note drafted from the import graph | core + cli | experimental | Yes (phase 10), tested on both examples |
| `review --map`: architecture map comment on pull requests (model and Markdown in core, base graph through a git worktree and adapter `prepareCheckout`, CI step in both workflows) | core + cli + adapter-js + templates | experimental | Yes (2026-11-08), tested: snapshots equal the three examples, temp-repo CLI tests, base = HEAD gives no edges on pnpm-style workspaces; Mermaid checked on GitHub in the dark theme only (P13); the CI step ran on a real PR (2026-11-09: comment posted, edited in place on the next push; P14); forks, the `reins:no-map` label, the light theme and a structural-change comment are still unverified; the map-skipped limit is an assumption |
| Skills `notes`, `arch`, `agent` and `check --coverage` | templates + cli | experimental | Yes, tested; each skill run once with Claude Code (haiku) |
| `resume` + `SessionStart` hook (notebook and notes back after a compaction) | cli | experimental | Yes (phase 10), tested; verified with Claude Code (P9) |
| One notebook per task (several tasks and sessions on a branch): `progress new <task>`/`close`/`--task`, claim by session, read view and cleanup in `resume` | core + cli + policy | experimental | Phase 1 (2026-11-08), tested on temporary repos; session id verified (P11); not yet tried with real parallel Claude Code sessions |
| `progress close` enforces the done steps: every item done or dropped, flagged module notes updated (`--notes-ok "<why>"` to override, reason recorded) | cli + done skill + policy | experimental | Yes (2026-11-09, 0.11.0), tested on a temp repo: open items, a flagged note, `--notes-ok` |
| Doctor note rules: `note-missing` (also every domain without a note when `architecture.yml` changed, 0.13.0), `note-outdated`, `note-draft`, `note-size` | core + cli | experimental | Yes (phase 10), tested |
| Stale notes: doctor `note-dead-paths`, `note-dead-refs`; `notes stale`; `/reins-notes review` | core + cli + skill | experimental | Rules and ranking tested; thresholds none; the review skill untested with an agent |
| Notes for the parts of a module (`.reins/notes/<module>/<part>.md`), drafted by `init` for route domains; `note-layout` | core + cli | experimental | Tested; not yet tried on a real repo |
| `init` on repos organized by routes: `(group)` look-through, lone pages left out (unless they own a folder elsewhere; one-file routes sharing a feature folder merged, 0.13.0), folders and loose files assigned to a route by imports, barrels resolved | cli + adapter-js | experimental | Tested on synthetic scenarios; not yet tried on real repos |

Known limits of `init` on repos organized by routes:

- Inside a folder organized by feature, a subfolder joins the domain with 2/3 of its imports; the other imports are frozen in the baseline as violations (the report counts them).
- Directly under a layer root (`src/components/`), a component used by a single route today is still assigned to it; when a second route imports it, `check` fails until someone moves it or edits `architecture.yml`.
- Route folders are measured in files, not size: a route with one large `page.js` that owns no folder elsewhere is left out.
- Only when there is no `features/*` or `modules/*` folder: mixed repos get nothing from this.
- Barrels are read as text: named imports and `export … from` re-exports are resolved; default and namespace imports, `require` and dynamic `import()` of a barrel count as using everything behind it. Only `index.*` files are considered barrels.

## Repo tooling

| Piece | Status |
| --- | --- |
| `scripts/lint.mjs` (syntax, import boundaries, AGENTS.md rules, mermaid diagrams GitHub can render, package metadata) | stable, tested |
| `scripts/rename-scope.mjs` | stable, tested |
| `scripts/pack.mjs` (`pnpm pack:all`) | used by the end-to-end scripts in `scripts/verify/` |
| `scripts/self-check.mjs` (`pnpm self-check`) | stable; in CI; checks this repo with dependency-cruiser alone and with `reins check` |
| `.reins/architecture.yml` of this repo | `cli` > `adapters` > `core`, no cycles, adapters use only the core contract |
| `.github/workflows/ci.yml` | written, never run on GitHub |
| `site/` landing page + `.github/workflows/pages.yml` (GitHub Pages, plain HTML, no build step) | deployed at [fredarcito.github.io/reins](https://fredarcito.github.io/reins/) |
