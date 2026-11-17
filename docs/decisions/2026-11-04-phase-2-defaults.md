# Phase 2 defaults (core `check`)

Semantics are documented for users in [`architecture-yml.md`](../architecture-yml.md); this is why they are that way.

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
