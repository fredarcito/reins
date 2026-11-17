# Rails adapter (2026-11-10)

The team's backends are Rails, some with React through Inertia. The design planned a Ruby adapter that would wrap Packwerk; the adapter built does not.

| Topic | Decision | Why |
| --- | --- | --- |
| How Ruby is read | Parse every file with Prism compiled to WebAssembly (`@ruby/prism`, the only new dependency, in the adapter) | Packwerk needs Ruby, the gem in the Gemfile and its own `package.yml` setup, and the CLI would have to run Bundler. Prism is the parser Ruby ships, maintained by ruby-core, MIT, 1.1 MB, no transitive dependencies; it read 4440 files in 1.5 s. A regex reader was rejected: strings, heredocs and comments full of capitalized words would become false edges |
| What an edge is | A file names a constant that another file defines; plus `require_relative`/`require` of a repo file | Zeitwerk apps have no imports; the constant is the dependency |
| Where constants are defined | Indexed from the parsed `class`/`module`/`CONST =` definitions, not from file names | No inflector and no autoload-path configuration to mirror; files outside the autoload paths work. A module that only wraps other definitions is a namespace, not an owner |
| Lookup | Ruby's lexical lookup (innermost module outwards), then the longest prefix that has an owner. Ancestors are not followed | Covers what apps write; following superclasses needs the whole class hierarchy, gems included |
| Unresolved constants | Silent | Gems and Ruby itself are unresolved by design, so a warning would fire on every file. The contract's "never drop edges silently" is kept where a miss can be told apart: syntax errors and missing Inertia pages warn |
| Associations | `has_many :orders` is an edge of kind `association` to `Order`, resolved in the model's namespaces, with the app's acronyms and irregulars | It is a real dependency between models that no constant shows. Its own kind lets a rule ignore it (`ignore_kinds`) |
| Inertia | `render inertia:` (named or inferred from controller and action) and `inertia` routes become edges of kind `inertia` to the page file | The one place where Ruby names a frontend file. With `adapters: [js, rails]` the graph crosses languages, which the several-adapters design thought would not happen |
| Name | `rails`, not `ruby` | Detection, entry points, associations and the preset are Rails conventions; a plain Ruby gem would need different ones |
| Guessing the adapter in `init` | A `Gemfile` with `config/application.rb` wins over `package.json` | Rails apps with Vite have both, and the app is a Rails app. The frontend is added to `adapters:` by hand until `init` drafts for several adapters |
| `init` and Ruby files | `SOURCE` and `TEST` in the CLI's `init/infer.js` now include `.rb`, `.rake`, `spec/` and `_spec.rb` | The inference counted only JS extensions, so a Rails plan came out with no layers. The contract did not change (still version 1) |
