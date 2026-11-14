---
paths: ["packages/adapters/rust/**"]
---
# adapter-rust

## Purpose
Language adapter for Rust (a Cargo package or workspace, or the `src-tauri/` half of a Tauri app): turns the module tree and the paths each file names into dependency edges for the core, and provides the `cargo` and `tauri` presets. Loaded by the CLI at runtime from the consumer repo.

## Map
- Used by: nothing outside the module (the CLI resolves it dynamically). Depends on: domain core, only through `@agentreins/core/contract`. No other dependency.
- `src/index.js`: the adapter object (`name: 'rust'`, `detect`, `graph`, `suggestPreset`, presets). No adapter rules, no `prepareCheckout` (nothing installed is needed to read Rust).
- `src/rust.js`: `tokenize` (identifiers, strings, `::` and punctuation; comments, chars, lifetimes and numbers dropped) and `readRust` (one file → `Scope`: `mods` with `#[path]` and inline scopes, `uses` as flattened use trees with alias/glob, `refs` as paths in code). Dispatch through lookup tables (`LEXERS`, `LITERAL_PREFIXES`, `PUNCT_HANDLERS`, `KEYWORD_HANDLERS`, `TOKEN_HANDLERS`).
- `src/cargo.js`: `readManifest` (Cargo.toml as text: sections and string/bool pairs, dotted keys) and `readPackage` (crate roots: lib with `[lib] name`/`path`, bins, build script, tests, examples, benches; edition, `edition.workspace` → 2021).
- `src/graph.js`: walks `.rs` files and Cargo.toml folders, builds each crate's module tree, resolves uses and paths, emits edges and warnings.
- `presets/cargo.js` (exports `RUST`, the shared language fields, and the `cargo` preset), `presets/tauri.js`; `src/presets.js` lists them. `src/detect.js`: root `Cargo.toml` → `cargo`; `src-tauri/Cargo.toml` → `tauri`.

## How it works
`graph()` reads every Cargo package, makes one root module per crate root, and follows `mod` declarations (`x.rs`, `x/mod.rs`, `#[path]` relative to the declaring file's folder, inline modules) into a tree. Then, in up to 5 passes, each `use` that names a whole module becomes an alias (or a glob) in its module. Finally every use and path is resolved: it starts at `crate`/`self`/`super`, a child module, an alias, a glob's child, a library crate of the repo by name, or (Rust 2015, `use` only) a child of the crate root; it walks child modules and stops at the deepest one; that module's file is the target. Edges: `mod` (declaration) and `static` (use); one per pair of files, `static` wins.

## Decisions
- 2026-11-14: own tokenizer, no parser dependency (see `docs/DECISIONS.md`, "Rust adapter"). Items are never indexed: module paths are explicit, so the deepest module gives the file.
- 2026-11-14: `mod` edges are kept but the presets propose `ignore_kinds: [mod]` (on Lingora, declarations made one 18-file cycle through `lib.rs`).
- 2026-11-14: the `tauri` preset never uses `src/*` for domains: in a Tauri app `src/` is the web frontend.

## Traps
- Silent edge loss is the main risk: a `mod x;` with no file must keep warning, and Rust files with no Cargo package must warn.
- A path is a dependency only when it starts at something local; a bare `Foo::new()` or `std::…` must stay unresolved. `::x` and paths after `.` (method turbofish) are external.
- A file reached twice (`#[path]`) keeps its first module, which also stops infinite loops; don't rebuild it.
- The tokenizer must never let a quote in a char literal (`'"'`) or a lifetime (`'a`) open a string, or the rest of the file is lost.
- Import nothing from core except `@agentreins/core/contract`. Edge paths repo-relative POSIX.
- Code style: descriptive names, lookup tables over `else if` chains (the team's rule).
