import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('root and ./contract entry points resolve by package name', async () => {
  const root = await import('@reins/core');
  const contract = await import('@reins/core/contract');
  assert.equal(contract.CONTRACT_VERSION, 1);
  assert.equal(root.CONTRACT_VERSION, contract.CONTRACT_VERSION);
  for (const name of ['parseConfig', 'runCheck', 'createBaseline', 'checkIntegrity', 'formatText', 'formatJson']) {
    assert.equal(typeof root[name], 'function', name);
  }
});

test('internal files are not reachable through the package name', async () => {
  await assert.rejects(import('@reins/core/src/index.js'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
});

test('core only imports node builtins, yaml and its own files (never cli, adapters or a framework)', async () => {
  const src = fileURLToPath(new URL('../src', import.meta.url));
  const files = (await readdir(src, { recursive: true })).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 5);
  const bad = [];
  for (const f of files) {
    const text = await readFile(path.join(src, f), 'utf8');
    const re = /^\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;
    for (const m of text.matchAll(re)) {
      const spec = m[1] ?? m[2] ?? m[3];
      const relativeInsideSrc = spec.startsWith('.') && path.resolve(path.dirname(path.join(src, f)), spec).startsWith(src + path.sep);
      if (!(spec.startsWith('node:') || spec === 'yaml' || relativeInsideSrc)) bad.push(`${f}: ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});
