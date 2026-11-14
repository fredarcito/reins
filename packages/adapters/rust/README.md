# @agentreins/adapter-rust

The Rust adapter of [**reins**](https://www.npmjs.com/package/@agentreins/cli): it reads which Rust file depends on which, so `reins check` can enforce the architecture of a crate, a Cargo workspace, or the Rust half of a [Tauri](https://tauri.app) app.

## Install

Install it next to the CLI, in the root of your repo (Node.js 22 or newer; **Rust and Cargo are not needed** to run it). A Rust repo without a `package.json` needs one first (`npm init -y`).

```bash
npm install -D @agentreins/cli @agentreins/adapter-rust
# Tauri app (web frontend + src-tauri/): add the JavaScript adapter too
# npm install -D @agentreins/cli @agentreins/adapter-js @agentreins/adapter-rust

npx reins install
npx reins init
```

`reins init` writes `adapters: [rust]` in `.reins/architecture.yml`. In a Tauri app with both adapters installed it writes `adapters: [js, rust]` and drafts one plan for both: one baseline covers the frontend and the Rust code.

## How it reads Rust

A crate is a tree of modules: `mod chat;` in `lib.rs` puts `chat.rs` (or `chat/mod.rs`) under it. A dependency is **"file A names a module that lives in file B"**:

```rust
// src/chat/commands.rs
use super::{cloud, local};            // → src/chat/cloud.rs, src/chat/local.rs
use crate::error::Result;             // → src/error.rs
pub fn ask() {
    crate::audio::record();           // → src/audio.rs
    store::save();                    // → src/chat/store.rs, when `store` was brought in by a `use`
}
```

- **Builds the module tree from Cargo's crate roots**: `src/lib.rs`, `src/main.rs`, `src/bin/*`, `build.rs`, `tests/*`, `examples/*`, `benches/*`, and the `path` of `[lib]`, `[[bin]]`, `[[test]]`… in each `Cargo.toml`. A workspace needs nothing special: every member is read.
- **Follows `mod` declarations** to `x.rs` or `x/mod.rs`, inline modules (`mod tests { … }`) and `#[path = "…"]`. A `mod x;` with no file gives a warning, because the code inside it would go unchecked.
- **Resolves paths the way the compiler starts them**: `crate::`, `super::`, `self::`, a child module, a name a `use` brought into scope (`use crate::chat; chat::store::load()`), `use x::*`, and other crates of the repo by their crate name (`my_lib::run()` from a bin, `[lib] name` respected). Rust 2015 crates also resolve `use` paths from the crate root.
- **A path ends at the deepest module it names**: `crate::config::Lang` depends on the file of `config`. Items (functions, structs) are not indexed, so the file that defines them is the module's file.
- **Reads the code with a small tokenizer**, not a compiler: comments, strings (raw ones too), chars and lifetimes are skipped, so a path in a comment or a string is not a dependency. Paths inside macro calls count (`tauri::generate_handler![chat::commands::ask]`).
- **Edge kinds**: `static` for uses, `mod` for declarations. The declarations only build the tree (`lib.rs` declares every module, and every module may use `crate::…`), so the plan `reins init` drafts ignores them in the rules (`ignore_kinds: [mod]`); they still keep declared files from being reported as orphans.
- **Skips what is not yours**: external crates (`std`, `serde`, `::anything`), `target/`, `vendor/`, `node_modules/` and hidden folders.

## Presets

| Preset | Repo | Detected by |
| --- | --- | --- |
| `cargo` | A Cargo package or workspace | `Cargo.toml` at the root. Domains: one per folder in `crates/` or `src/` (`src/chat/` is the module `chat`) |
| `tauri` | The Rust half of a Tauri app | `src-tauri/Cargo.toml`. Domains: folders in `src-tauri/src/`; `src/` is left to the web frontend |

Rust has no layer convention, so neither preset proposes layers: add them in `architecture.yml` when the crate has some (for example `commands` above `services` above `storage`). A domain's public API starts as the files the rest of the crate already uses; `mod.rs` is not treated as a barrel, because in Rust it holds code.

## What it can't see

- **Code generated at build time** (`include!(concat!(env!("OUT_DIR"), …))`, modules a macro declares): not read.
- **`#[cfg]`**: every module is read, whatever the target or feature. Two `#[cfg]` variants of the same module with different `#[path]`s both count.
- **Names re-exported with `pub use` inside a module** are followed only when they name modules; an item re-exported from elsewhere depends on the re-exporting file, which in turn depends on the original.
- **Macros by their name** (`my_macro!`) and trait methods called on values: a dependency only appears when a path names the module.
- **Crates outside the repo** (git or registry dependencies), even when they are yours.

Tried on a Tauri app (42 Rust files, 26 modules, 170 edges in 70 ms); every edge checked by hand was a real use. Report misses and false edges as issues with the snippet that caused them.
