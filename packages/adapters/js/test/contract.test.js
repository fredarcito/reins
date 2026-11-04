import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import adapter from '@reins/adapter-js';
import { CONTRACT_VERSION } from '@reins/core/contract';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('adapter declares the contract version it implements', () => {
  assert.equal(adapter.name, 'js');
  assert.equal(adapter.contract, CONTRACT_VERSION);
  assert.equal(pkg.reins.contract, adapter.contract);
});

test('core is a peer dependency, not a regular dependency', () => {
  assert.ok(pkg.peerDependencies['@reins/core']);
  assert.equal(pkg.dependencies?.['@reins/core'], undefined);
});
