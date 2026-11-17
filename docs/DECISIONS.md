# Decisions

Source of truth for the design: [`DESIGN.md`](DESIGN.md). One file per decision in [`decisions/`](decisions/), named `YYYY-MM-DD-<topic>.md`, listed below; dependencies and open questions stay in this file.

- **A new decision:** a new file in `decisions/` (topic table: decision and why; what was not done), plus one row here. Module notes link to the file, never to this index.
- **A decision that replaces another:** say it in the new file, and mark the old row here as superseded (fully or partly). Never delete the old file: it keeps the idea from coming back.
- **Every new dependency** is justified in the "Dependencies" section below.

| Date | Decision | Status |
| --- | --- | --- |
| 2026-11-04 | [Decided in the design (summary)](decisions/2026-11-04-decided-in-the-design.md) |  |
| 2026-11-04 | [Build defaults](decisions/2026-11-04-build-defaults.md) |  |
| 2026-11-04 | [Phase 1 defaults](decisions/2026-11-04-phase-1-defaults.md) |  |
| 2026-11-04 | [Phase 2 defaults (core `check`)](decisions/2026-11-04-phase-2-defaults.md) |  |
| 2026-11-04 | [Phase 3 defaults (adapter-js)](decisions/2026-11-04-phase-3-defaults.md) | Partly superseded by [Presets are JS modules](decisions/2026-11-10-presets-are-js-modules.md): presets as YAML |
| 2026-11-04 | [Phase 4 defaults (CLI `check` and `init`)](decisions/2026-11-04-phase-4-defaults.md) |  |
| 2026-11-04 | [Phase 5 defaults (`doctor`, experimental)](decisions/2026-11-04-phase-5-defaults.md) |  |
| 2026-11-04 | [Phase 6 defaults (templates, `sync`, `notes`, `scope`; experimental)](decisions/2026-11-04-phase-6-defaults.md) |  |
| 2026-11-04 | [Phase 7 defaults (`audit`, `progress`, `review`; experimental)](decisions/2026-11-04-phase-7-defaults.md) |  |
| 2026-11-04 | [Phase 8 defaults (`install`, distribution; experimental)](decisions/2026-11-04-phase-8-defaults.md) |  |
| 2026-11-04 | [Phase 9 defaults (docs, self-check, 0.1.0)](decisions/2026-11-04-phase-9-defaults.md) |  |
| 2026-11-04 | [Phase 10 defaults (context between sessions; experimental)](decisions/2026-11-04-phase-10-defaults.md) |  |
| 2026-11-04 | [Design adjustments proposed after phase 0](decisions/2026-11-04-design-adjustments-proposed-after-phase-0.md) |  |
| 2026-11-04 | [After 0.1.0: skills for the steps people skip](decisions/2026-11-04-after-010-skills-for-the-steps-people.md) |  |
| 2026-11-04 | [Name: reins (2026-11-04)](decisions/2026-11-04-name-reins.md) |  |
| 2026-11-05 | [Notes for the parts of a module (2026-11-05)](decisions/2026-11-05-notes-for-the-parts-of-a-module.md) |  |
| 2026-11-05 | [Route domains: groups, lone pages, owned folders (2026-11-05)](decisions/2026-11-05-route-domains-groups-lone-pages-owned-folders.md) | Partly superseded by [Owned folders, second version](decisions/2026-11-05-owned-folders-second-version.md): how folders join a route domain |
| 2026-11-05 | [Owned folders, second version (2026-11-05)](decisions/2026-11-05-owned-folders-second-version.md) |  |
| 2026-11-05 | [GitHub Pages site (2026-11-05)](decisions/2026-11-05-github-pages-site.md) |  |
| 2026-11-06 | [`reins impact`: the reverse of scope (2026-11-06)](decisions/2026-11-06-reins-impact-the-reverse-of-scope.md) |  |
| 2026-11-08 | [Tasks anchored to their start commit (2026-11-08, backlog A2)](decisions/2026-11-08-tasks-anchored-to-their-start-commit.md) |  |
| 2026-11-08 | [One notebook per task (2026-11-08, phase 1)](decisions/2026-11-08-one-notebook-per-task.md) |  |
| 2026-11-08 | [Impact through the notes hook (2026-11-08)](decisions/2026-11-08-impact-through-the-notes-hook.md) |  |
| 2026-11-08 | [Architecture map comment on PRs (2026-11-08)](decisions/2026-11-08-architecture-map-comment-on-prs.md) |  |
| 2026-11-09 | [`progress close` enforces the done steps (2026-11-09)](decisions/2026-11-09-progress-close-enforces-the-done-steps.md) |  |
| 2026-11-09 | [Several adapters in one repo (2026-11-09)](decisions/2026-11-09-several-adapters-in-one-repo.md) | Partly superseded by [`init` knows no language](decisions/2026-11-10-init-knows-no-language.md): `init` drafting for one adapter only |
| 2026-11-09 | [Thin routes in `init`, notes of new domains (2026-11-09)](decisions/2026-11-09-thin-routes-in-init-notes-of-new.md) |  |
| 2026-11-10 | [Rails adapter (2026-11-10)](decisions/2026-11-10-rails-adapter.md) |  |
| 2026-11-10 | [`init` knows no language (2026-11-10)](decisions/2026-11-10-init-knows-no-language.md) |  |
| 2026-11-10 | [Presets are JS modules (2026-11-10)](decisions/2026-11-10-presets-are-js-modules.md) |  |
| 2026-11-10 | [The task level is measured, not guessed (2026-11-10)](decisions/2026-11-10-the-task-level-is-measured-not-guessed.md) |  |
| 2026-11-11 | [Comparison base: branch start and `base:` (2026-11-11)](decisions/2026-11-11-comparison-base-branch-start-and-base.md) |  |
| 2026-11-12 | [Notes before exploring (2026-11-12)](decisions/2026-11-12-notes-before-exploring.md) |  |
| 2026-11-13 | [Gitignored generated files (2026-11-13)](decisions/2026-11-13-gitignored-generated-files.md) |  |
| 2026-11-14 | [Rust adapter (2026-11-14)](decisions/2026-11-14-rust-adapter.md) |  |
| 2026-11-14 | [Guards against skipping reins (2026-11-14, backlog A6)](decisions/2026-11-14-guards-against-skipping-reins.md) |  |
| 2026-11-17 | [Shell edits and module notes (2026-11-17)](decisions/2026-11-17-shell-edits-and-module-notes.md) |  |
| 2026-11-17 | [The task's state in the commands' output (2026-11-17)](decisions/2026-11-17-the-tasks-state-in-the-commands-output.md) |  |
| 2026-11-17 | [PR map arrows follow the change (2026-11-17)](decisions/2026-11-17-pr-map-arrows-follow-the-change.md) |  |

## Dependencies

| Package | Where | Why |
| --- | --- | --- |
| `yaml` | `core` | Read `architecture.yml` and `doctor.yml`. Node has no YAML parser |
| `dependency-cruiser` | `adapters/js` only | Compute the import graph (with aliases). Decided in the design over writing our own parser. Requires Node `^22 \|\| ^24 \|\| >=26` |
| `yaml` | `adapters/js` | Removed 2026-11-10: presets are JS modules now (see "Presets are JS modules"). Was: read the presets (`presets/*.yml`) |
| `yaml` | `cli` | Edit `lefthook.yml` without losing comments (`reins install`) |
| `typescript` | `adapters/js`: optional peer + dev | Only needed for TS repos; dependency-cruiser uses it to parse `.ts`/`.tsx`. Dev dependency so the TS example can be tested |

## Open

- **Agent adapters for Codex and Cursor (proposed 2026-11-08):** [`proposals/agent-adapters.md`](proposals/agent-adapters.md). All logic stays in the CLI; each agent gets a generated adapter that only translates hook config and payloads.
- **Provider compatibility:** `AGENTS.md` plus the CLI is the shared baseline; actual instruction loading and native skill discovery in other clients remain unverified (see [`VERIFIED.md`](VERIFIED.md)).
- From the design, undecided: whether the team's repos share a base `architecture.yml`; what to do with monorepos; who updates the baseline and with what review.
