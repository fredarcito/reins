# Rust adapter (2026-11-14)

Asked by Lingora (Tauri: a React frontend and a Rust crate in `src-tauri/`), after `adapters: [js, rust]` became possible.

| Topic | Decision | Why |
| --- | --- | --- |
| How it reads Rust | Its own tokenizer (comments, strings, raw strings, chars, lifetimes) and a reader for `mod`, `use` trees and paths; no dependency | Only paths matter. tree-sitter or `syn` would add a WebAssembly or native dependency for a grammar we barely use; Rust has no Prism-like official parser on npm. Revisit if real repos show misses the tokenizer can't fix |
| What an edge is | A path ends at the deepest module it names; that module's file is the target. Items are never indexed | Module paths are explicit in Rust (`crate::config::Lang`), so no index is needed to find the file, and it stays fast (42 files in 70 ms) |
| Where paths start | `crate`, `self`, `super`, child modules, names a `use` brought in (resolved in passes, so a use can build on another), globs, other crates of the repo by crate name; Rust 2015 `use` paths from the crate root | The compiler's own rules, minus what needs type information |
| `mod` declarations | Edge kind `mod`; the presets propose `ignore_kinds: [mod]` | On Lingora, counting them put 18 files in one cycle through `lib.rs` (it declares every module, and they use `crate::AppState`). With them ignored: 4 small cycles, all real uses. Kept as edges so declared files are never orphans |
| Presets | `cargo` (root `Cargo.toml`; domains `crates/*`, `src/*`) and `tauri` (`src-tauri/Cargo.toml`; domains `src-tauri/src/*`). No layers | In a Tauri app `src/` is the frontend, so `src/*` would turn every React folder into a Rust domain. Rust has no layer convention to propose |
| Adapter order | `guessAdapterNames`: a root `Cargo.toml` makes `rust` the main language; `src-tauri/Cargo.toml` adds `rust` after `js` | The main language must be installed; the second joins only when installed and detected |
| Not done | `#[cfg]` (every module counts), build-time generated modules, `pub use` of items, crates outside the repo | Need the compiler; listed in the adapter's README |
