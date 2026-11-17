# Several adapters in one repo (2026-11-09)

> Partly superseded by [`init` knows no language](2026-11-10-init-knows-no-language.md): `init` drafts for every adapter.

A team with a Tauri app (React in `src/`, Rust in `src-tauri/`) asked to cover both halves. `architecture.yml` named a single adapter.

| Decision | Why |
| --- | --- |
| `adapters:` is always a list, even with one adapter: `init` writes `adapters: [js]` | Adding a language is adding a name to a list that is already there, so neither the person nor the agent has to know a second form |
| `sync` (so `reins update`) rewrites `adapter: js` as `adapters: [js]`, and `check` refuses the old key with that fix | One valid form instead of two to maintain. Upgrades that skip `sync` (Dependabot, `npm update`) get the exact fix, not a generic "unknown key". This is the first edit reins makes to `architecture.yml`: only the line, shown in the diff, and the README promise now says so. The first PR map after the migration warns once that the base plan could not be read |
| One plan, one baseline, one merged graph | Layers and domains are paths, so they need no language. Two plans would split the baseline and make `impact` and `scope` merge results |
| No `root:` per adapter: each adapter gets the repo root and finds its own files | Avoids rewriting paths between adapters. A `{ name, root }` form can come if two adapters ever claim the same files |
| Each adapter's `evaluate` sees only its own graph; duplicate rule ids are refused | An adapter rule only understands its language; one id in `rules:` must mean one thing |
| `preset` goes only to the adapter that lists it; a preset no adapter lists is an error | `adapter-js` throws on an unknown preset, so a Rust preset would break the JS graph. Without the error, a typo would be dropped silently and the graph built without the preset's entry points |
| `init` still drafts for one adapter, and refuses a plan that lists several | Only `js` can be detected today; detecting several waits for a second real adapter |
| The adapter contract did not change (still version 1) | Everything happens in the CLI |
