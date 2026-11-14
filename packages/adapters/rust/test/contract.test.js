import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import adapter from '@agentreins/adapter-rust';
import { CONTRACT_VERSION, validateAdapter } from '@agentreins/core/contract';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('adapter declares the contract version it implements', () => {
  assert.equal(adapter.name, 'rust');
  assert.equal(adapter.contract, CONTRACT_VERSION);
  assert.equal(pkg.reins.contract, adapter.contract);
  assert.deepEqual(validateAdapter(adapter), []);
});

test('core is a peer dependency, and nothing else is installed with it', () => {
  assert.ok(pkg.peerDependencies['@agentreins/core']);
  assert.equal(pkg.dependencies, undefined);
});

test('presets: Rust sources and entries, a fresh copy each time', () => {
  for (const name of adapter.presets) {
    const preset = adapter.loadPreset(name);
    assert.deepEqual(preset.sources, ['**/*.rs']);
    assert.ok(preset.entries.includes('**/build.rs'));
  }
  // in a Tauri app src/ is the web frontend: never a Rust domain folder
  assert.ok(!adapter.loadPreset('tauri').domains_from.some((glob) => glob.startsWith('src/')));
  const preset = adapter.loadPreset('cargo');
  preset.entries.length = 0;
  assert.ok(adapter.loadPreset('cargo').entries.length > 0);
  assert.throws(() => adapter.loadPreset('wasm'), /unknown preset "wasm"/);
});
