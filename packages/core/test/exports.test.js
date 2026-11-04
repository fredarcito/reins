import { test } from 'node:test';
import assert from 'node:assert/strict';

test('root and ./contract entry points resolve by package name', async () => {
  const root = await import('@harness/core');
  const contract = await import('@harness/core/contract');
  assert.equal(contract.CONTRACT_VERSION, 1);
  assert.equal(root.CONTRACT_VERSION, contract.CONTRACT_VERSION);
});

test('internal files are not reachable through the package name', async () => {
  await assert.rejects(import('@harness/core/src/index.js'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
});
