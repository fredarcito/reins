// End to end with the real Rust adapter: init on a Cargo crate, and a Tauri app checked with js + rust.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { guessAdapterNames } from '../src/adapter.js';
import { cli, tempDir } from './helpers.js';

const CRATE = {
  'Cargo.toml': '[package]\nname = "notes-app"\nedition = "2021"\n',
  'src/main.rs': 'mod chat;\nmod config;\nfn main() { chat::store::load(); }\n',
  'src/config.rs': 'pub struct Settings;\n',
  'src/chat/mod.rs': 'pub mod store;\nmod search;\n',
  'src/chat/store.rs': 'use crate::config::Settings;\nuse super::search;\npub fn load() { search::rank(); }\n',
  'src/chat/search.rs': 'pub fn rank() {}\n',
};
const TAURI = {
  'package.json': { name: 'desk', type: 'module' },
  'vite.config.js': 'export default {};\n',
  'src/main.jsx': "import { App } from './App.jsx';\nApp();\n",
  'src/App.jsx': 'export const App = () => null;\n',
  'src-tauri/Cargo.toml': '[package]\nname = "desk"\nedition = "2021"\n\n[lib]\nname = "desk_lib"\n',
  'src-tauri/build.rs': 'fn main() {}\n',
  'src-tauri/src/main.rs': 'fn main() { desk_lib::run() }\n',
  'src-tauri/src/lib.rs': 'mod audio;\nmod chat;\npub fn run() { chat::commands::ask(); }\n',
  'src-tauri/src/audio.rs': 'pub fn record() {}\n',
  'src-tauri/src/chat/mod.rs': 'pub mod commands;\nmod session;\n',
  'src-tauri/src/chat/commands.rs': 'use super::session;\npub fn ask() { session::open(); crate::audio::record(); }\n',
  'src-tauri/src/chat/session.rs': 'pub fn open() {}\n',
};

test('guess: a Cargo crate is rust; a Tauri app is js first, then rust', () => {
  assert.deepEqual(guessAdapterNames(tempDir(CRATE)), ['rust']);
  assert.deepEqual(guessAdapterNames(tempDir({ ...CRATE, 'package.json': { name: 'napi' } })), ['rust', 'js']);
  assert.deepEqual(guessAdapterNames(tempDir(TAURI)), ['js', 'rust']);
});

test('init on a Cargo crate drafts adapters: [rust] with one domain per module folder, and check passes', async () => {
  const dir = tempDir(CRATE);
  const result = await cli(dir, ['init']);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  const yml = readFileSync(path.join(dir, '.reins/architecture.yml'), 'utf8');
  assert.match(yml, /^adapters: \[rust\]$/m);
  assert.match(yml, /^preset: cargo$/m);
  assert.match(yml, /chat: \{ paths: \["src\/chat\/\*\*"\]/);
  const check = await cli(dir, ['check']);
  assert.equal(check.code, 0, check.stdout + check.stderr);
});

test('tauri: init drafts one plan for js + rust, and check finds a new Rust violation', async () => {
  const dir = tempDir(TAURI);
  const result = await cli(dir, ['init']);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  const yml = readFileSync(path.join(dir, '.reins/architecture.yml'), 'utf8');
  assert.match(yml, /^adapters: \[js, rust\]$/m);
  assert.match(yml, /chat: \{ paths: \["src-tauri\/src\/chat\/\*\*"\], public_api: \["src-tauri\/src\/chat\/commands\.rs", "src-tauri\/src\/chat\/mod\.rs"\] \}/);
  const report = readFileSync(path.join(dir, '.reins/init-report.md'), 'utf8');
  assert.match(report, /`@agentreins\/adapter-rust`, preset `tauri` \(detected\)/);
  assert.equal((await cli(dir, ['check'])).code, 0);

  // audio reaches past chat's public API into its private session module
  writeFileSync(path.join(dir, 'src-tauri/src/audio.rs'), 'pub fn record() { crate::chat::session::open(); }\n');
  const check = await cli(dir, ['check']);
  assert.equal(check.code, 1, check.stdout + check.stderr);
  assert.match(check.stdout, /src-tauri\/src\/audio\.rs.*src-tauri\/src\/chat\/session\.rs/s);
});
