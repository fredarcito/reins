import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import adapter from '@agentreins/adapter-rust';
import { validateEdges } from '@agentreins/core/contract';
import { readManifest } from '../src/cargo.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const workspace = fixture('workspace');
const result = await adapter.graph(workspace, {});
const LIB = 'crates/core-lib/src';
const targets = (from, kind) => result.edges.filter((edge) => edge.from === from && (!kind || edge.kind === kind)).map((edge) => edge.to).sort();

test('detect: Cargo.toml at the root (cargo) or in src-tauri/ (tauri)', () => {
  assert.equal(adapter.detect(workspace), true);
  assert.equal(adapter.suggestPreset(workspace), 'cargo');
  assert.equal(adapter.detect(fixture('tauri-app')), true);
  assert.equal(adapter.suggestPreset(fixture('tauri-app')), 'tauri');
  assert.equal(adapter.detect(fixture('.')), false);
  assert.equal(adapter.suggestPreset(fixture('.')), null);
});

test('graph: valid edges, .rs files only, target/ skipped, crate roots are entries', () => {
  assert.deepEqual(validateEdges(result.edges), []);
  assert.ok(result.files.every((file) => file.endsWith('.rs')));
  assert.ok(!result.files.some((file) => file.startsWith('target/')));
  assert.deepEqual(result.entries, ['crates/app/src/main.rs', 'crates/core-lib/src/lib.rs', 'crates/core-lib/tests/smoke.rs']);
});

test('mod declarations: a mod edge per file, #[path] followed, a missing file warns', () => {
  // config and gen/bindings are also used, and a use wins over the declaration: one edge per pair of files
  assert.deepEqual(targets(`${LIB}/lib.rs`, 'mod'), [`${LIB}/chat/mod.rs`]);
  assert.deepEqual(targets(`${LIB}/lib.rs`), [`${LIB}/chat/mod.rs`, `${LIB}/config.rs`, `${LIB}/gen/bindings.rs`]);
  assert.deepEqual(targets(`${LIB}/chat/mod.rs`, 'mod'), [`${LIB}/chat/search.rs`, `${LIB}/chat/store.rs`]);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /1 Rust module declaration\(s\) point to no file.*`mod missing` in crates\/core-lib\/src\/lib\.rs/);
});

test('uses and paths: crate, super, self, aliases, child modules; comments and strings are not code', () => {
  // `use config::Settings` names a child module; `generated::call()` goes through #[path]
  assert.deepEqual(targets(`${LIB}/lib.rs`, 'static'), [`${LIB}/config.rs`, `${LIB}/gen/bindings.rs`]);
  // `use crate::{config::{self, …}, chat}` then `chat::search::rank()` through the alias
  assert.deepEqual(targets(`${LIB}/chat/store.rs`), [`${LIB}/chat/mod.rs`, `${LIB}/chat/search.rs`, `${LIB}/config.rs`]);
  // `use super::Turn` is the parent's file; the inline tests module reaches store through `super::super`
  assert.deepEqual(targets(`${LIB}/chat/search.rs`), [`${LIB}/chat/mod.rs`, `${LIB}/chat/store.rs`]);
  // only comments and a char literal name other modules
  assert.deepEqual(targets(`${LIB}/config.rs`), []);
  assert.deepEqual(targets(`${LIB}/chat/mod.rs`, 'static'), []);
});

test('other crates of the repo: a bin and an integration test reach the library by its crate name', () => {
  assert.deepEqual(targets('crates/app/src/main.rs'), [`${LIB}/chat/store.rs`]);
  assert.deepEqual(targets('crates/core-lib/tests/smoke.rs'), [`${LIB}/lib.rs`]);
});

test('ignore: ignored files leave the graph', async () => {
  const ignored = await adapter.graph(workspace, { ignore: [`${LIB}/gen/**`] });
  assert.ok(!ignored.files.includes(`${LIB}/gen/bindings.rs`));
  assert.ok(!ignored.edges.some((edge) => edge.to.startsWith(`${LIB}/gen/`)));
  // the file exists, so its mod declaration is not reported as missing
  assert.equal(ignored.warnings.length, 1);
});

test('tauri: the Rust crate in src-tauri/, the lib named in [lib]', async () => {
  const tauri = await adapter.graph(fixture('tauri-app'), { preset: 'tauri' });
  assert.deepEqual(tauri.files, ['src-tauri/src/a.rs', 'src-tauri/src/lib.rs', 'src-tauri/src/main.rs']);
  assert.deepEqual(tauri.edges.map((edge) => `${edge.from} -> ${edge.to} (${edge.kind})`).sort(), [
    'src-tauri/src/lib.rs -> src-tauri/src/a.rs (static)',
    'src-tauri/src/main.rs -> src-tauri/src/lib.rs (static)',
  ]);
});

test('Rust files without any Cargo package warn instead of passing silently', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'reins-rust-'));
  writeFileSync(path.join(dir, 'loose.rs'), 'mod other;\n');
  const loose = await adapter.graph(dir, {});
  assert.deepEqual(loose.files, ['loose.rs']);
  assert.match(loose.warnings.join('\n'), /no Cargo\.toml with a \[package\] table/);
});

test('readManifest: sections, arrays of tables, quotes, dotted keys and comments', () => {
  const sections = readManifest('[package]\nname = "a-b" # comment\nedition.workspace = true\n\n[[bin]]\nname = \'tool\'\npath = "src/tool.rs"\n');
  assert.deepEqual(sections.slice(1), [
    { table: 'package', array: false, values: { name: 'a-b', 'edition.workspace': 'true' } },
    { table: 'bin', array: true, values: { name: 'tool', path: 'src/tool.rs' } },
  ]);
});
