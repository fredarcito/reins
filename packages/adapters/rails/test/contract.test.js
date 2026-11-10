import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import adapter from '@agentreins/adapter-rails';
import { CONTRACT_VERSION, validateAdapter } from '@agentreins/core/contract';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('adapter declares the contract version it implements', () => {
  assert.equal(adapter.name, 'rails');
  assert.equal(adapter.contract, CONTRACT_VERSION);
  assert.equal(pkg.reins.contract, adapter.contract);
  assert.deepEqual(validateAdapter(adapter), []);
});

test('core is a peer dependency, not a regular dependency', () => {
  assert.ok(pkg.peerDependencies['@agentreins/core']);
  assert.equal(pkg.dependencies?.['@agentreins/core'], undefined);
});

test('the preset has layers, entries and is a fresh copy each time', () => {
  const preset = adapter.loadPreset('rails');
  assert.ok(preset.layers.length > 0 && preset.entries.includes('config/**'));
  preset.layers.length = 0;
  assert.ok(adapter.loadPreset('rails').layers.length > 0);
  assert.throws(() => adapter.loadPreset('sinatra'), /unknown preset "sinatra"/);
});
