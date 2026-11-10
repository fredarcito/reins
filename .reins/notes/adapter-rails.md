---
paths: ["packages/adapters/rails/**"]
---
# adapter-rails

## Purpose
Language adapter for Ruby on Rails apps, with or without an Inertia frontend: turns the repo into dependency edges for the core (constant references, `require_relative`, associations, controller → Inertia page) and provides the `rails` preset. Loaded by the CLI at runtime from the consumer repo.

## Map
- Used by: nothing outside the module (the CLI resolves it dynamically). Depends on: domain core, only through `@agentreins/core/contract`; `@ruby/prism` (WebAssembly).
- `src/index.js`: the adapter object (`name: 'rails'`, `detect`, `graph`, preset). No adapter rules, no `prepareCheckout` (nothing installed is needed to read Ruby).
- `src/ruby.js`: `loadParser` (Prism, once per process, WASI warning hidden) and `readRuby` (one file → definitions, references with their lexical scopes, requires, associations, Inertia renders and routes).
- `src/graph.js`: walks the Ruby files, builds the constant index, `resolveConstant`, emits edges and warnings, entries from the preset.
- `src/inertia.js`: is `inertia_rails` in the Gemfile, where the pages folders are, component name → page file, `inferredComponent`.
- `src/inflect.js`: `camelize`, `singulars`, `readInflections` (acronyms and irregulars from `config/initializers/inflections.rb`), for associations only.
- `presets/rails.js`: the `rails` preset (one JS module per preset, the same layout as adapter-js); `src/presets.js` lists them and `loadPreset` returns a copy. `src/detect.js`: `Gemfile` + `config/application.rb`.

## How it works
`graph()` parses every `.rb`/`.rake` outside the ignored folders. Pass 1 indexes definitions: `known` (every constant, namespaces included) and `owners` (constant → files that really define it). Pass 2 resolves each reference from the innermost lexical scope outwards; the first scope where the head of the path is known decides, and the longest prefix with an owner gives the target files. Edges: `static` (constants, requires), `association`, `inertia`; one edge per pair of files, `static` wins.

## Decisions
- 2026-11-10: Prism as WebAssembly instead of wrapping Packwerk (the original design): no Ruby, no gem in the Gemfile, no booting the app; 4440 files in 1.5 s on the pilot. See `docs/DECISIONS.md`.
- 2026-11-10: the constant index comes from parsed definitions, not from Zeitwerk file names: no inflector needed for the index, and non-autoloaded files work.
- 2026-11-10: a `module`/`class` (without superclass) whose body is only other modules and classes is a namespace wrapper, not an owner; otherwise every file under `module Billing` would own `Billing`.
- 2026-11-10: Ruby's own classes (`CORE` in `graph.js`) never get an owner, so `lib/core_ext/string.rb` is not a dependency of every file that says `String`.
- 2026-11-10: association classes are looked up in every namespace of the model (as Rails does), not by lexical nesting; candidates only count when they resolve to a repo constant.
- 2026-11-10: `inertia 'x' => 'Y'` is read only in `config/routes.rb` and `config/routes/**`.

## Traps
- An unresolved constant can't be a warning: gems and Ruby itself are unresolved by design. The loud cases are syntax errors and Inertia pages that don't exist; keep them.
- `readRuby` takes bytes (a Buffer), not a string: Prism offsets are byte offsets.
- Compare Prism nodes with `instanceof` on the classes of the dynamically imported module (`parser.P`), never a static import: the static import prints the WASI warning.
- Edge targets of kind `inertia` are frontend files this adapter does not list in `files` (they belong to adapter-js).
- What `reins init` knows about Ruby is in the preset (`sources`, `tests`, `source_roots: [app]` so folders outside every layer are reported as `app/ops`, not `app`; no `index_files`, no `route_segments`): a new Ruby extension goes there and in `RUBY_FILE` (`graph.js`), never in the CLI.
- Tests run `node --test "test/**/*.test.js"`; fixtures are Ruby and are never executed.
