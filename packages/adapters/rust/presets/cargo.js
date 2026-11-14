// Preset for a Rust repo: one Cargo package, or a workspace of crates.
// Rust has no layer convention, so `reins init` starts from none and the import graph proposes the order.
export const RUST = {
  // what `reins init` needs to know about Rust. No index-file convention: a module's public API is what the rest
  // of the crate already uses (mod.rs is not a barrel, it holds code)
  sources: ['**/*.rs'],
  tests: ['tests/**', '**/tests/**', 'benches/**', '**/benches/**'],
  // entry points Cargo builds by itself: never reported as orphans
  entries: ['**/src/main.rs', '**/src/lib.rs', '**/src/bin/**', '**/build.rs', '**/tests/**', '**/benches/**', '**/examples/**'],
  // `mod x;` only builds the module tree: lib.rs declares every module and every module may use `crate::…`, so
  // counting declarations would put the whole crate in one cycle. The drafted rules check real uses only
  ignore_kinds: [{
    kind: 'mod',
    if_files: ['**/*.rs'],
    reason: 'Rust detected, so `mod` declarations (the module tree) are ignored by the rules; uses are checked',
  }],
};

export default {
  description: 'Rust: a Cargo package or workspace',
  layers: [],
  // workspace members, and the folders of a crate's modules (src/chat/ is the module chat)
  domains_from: ['crates/*', 'src/*'],
  source_roots: ['src'],
  ...RUST,
};
