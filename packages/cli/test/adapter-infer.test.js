import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAdapter, candidates } from '../src/adapter.js';
import { inferLayers, inferDomains, findOrphans } from '../src/init/infer.js';
import { tempDir } from './helpers.js';

const fakeAdapter = (pkgName, { contract = 1, exportsPkg = true, body } = {}) => ({
  [`node_modules/${pkgName}/package.json`]: {
    name: pkgName, version: '9.9.9', type: 'module', reins: { contract },
    exports: exportsPkg ? { '.': './index.js', './package.json': './package.json' } : { '.': './index.js' },
  },
  [`node_modules/${pkgName}/index.js`]: body ?? 'export default { name: "x", contract: 1, detect() { return true; }, graph() { return []; } };',
});

test('adapter: official scoped name first, then reins-adapter-<name>', async () => {
  assert.deepEqual(candidates('ruby'), ['@agentreins/adapter-ruby', 'reins-adapter-ruby']);
  const dir = tempDir(fakeAdapter('reins-adapter-x', { exportsPkg: false }));
  const r = await resolveAdapter(dir, 'x');
  assert.equal(r.packageName, 'reins-adapter-x');
  assert.equal(r.version, '9.9.9');
});

test('adapter: a different contract version is refused with the fix', async () => {
  const dir = tempDir(fakeAdapter('reins-adapter-x', { contract: 2 }));
  await assert.rejects(resolveAdapter(dir, 'x'), /implements adapter contract 2, but this version of reins needs contract 1/);
});

test('adapter: an invalid module is refused with every problem', async () => {
  const dir = tempDir(fakeAdapter('reins-adapter-x', { body: 'export default { name: "x", contract: 1 };' }));
  await assert.rejects(resolveAdapter(dir, 'x'), /not a valid reins adapter:\n {2}- "detect" must be a function\n {2}- "graph" must be a function/);
});

const edge = (from, to, kind = 'static') => ({ from, to, kind });
const presetLayers = [
  { name: 'pages', paths: ['src/pages/**'] },
  { name: 'components', paths: ['src/components/**'] },
  { name: 'features', paths: ['src/features/**'] },
  { name: 'shared', paths: ['src/lib/**', 'src/missing/**'] },
  { name: 'unused', paths: ['src/nothing/**'] },
];
const files = ['src/pages/a.js', 'src/components/b.js', 'src/features/x/c.js', 'src/features/x/d.js', 'src/lib/e.js', 'src/store/s.js', 'src/store/t.js', 'src/a.test.js', 'vite.config.js'];

test('layers: absent layers and globs are dropped; order follows the dominant import direction', () => {
  const edges = [
    edge('src/pages/a.js', 'src/features/x/c.js'),
    edge('src/features/x/c.js', 'src/components/b.js'),
    edge('src/features/x/d.js', 'src/components/b.js'),
    edge('src/components/b.js', 'src/features/x/c.js'), // minority, a violation
    edge('src/components/b.js', 'src/lib/e.js'),
    edge('src/lib/e.js', 'src/pages/a.js', 'type'), // type-only: not evidence
  ];
  const r = inferLayers(presetLayers, files, edges);
  assert.deepEqual(r.layers.map((l) => `${l.name}:${l.files}`), ['pages:1', 'features:2', 'components:1', 'shared:1']);
  assert.deepEqual(r.layers[3].paths, ['src/lib/**']);
  assert.deepEqual(r.pairs.find((p) => p.above === 'features' && p.below === 'components'), { above: 'features', below: 'components', down: 2, up: 1 });
  assert.deepEqual(r.unclassified, [{ folder: 'src/store', files: 2 }]);
  assert.deepEqual(r.conflicts, []);
});

test('layers: a loop in the dominant directions keeps the preset order and is reported', () => {
  const edges = [edge('src/pages/a.js', 'src/components/b.js'), edge('src/components/b.js', 'src/features/x/c.js'), edge('src/features/x/c.js', 'src/pages/a.js')];
  const r = inferLayers(presetLayers, files, edges);
  assert.equal(r.conflicts.length, 1);
  assert.match(r.conflicts[0], /form a loop/);
});

test('domains: one per folder, public API from its index, missing index flagged, names deduplicated', () => {
  const d = inferDomains(['src/features/*', 'src/modules/*'], [
    'src/features/billing/index.ts', 'src/features/billing/tax.ts', 'src/features/search/Results.jsx', 'src/modules/billing/a.js', 'src/features/README.md',
  ]);
  assert.deepEqual(d.map((x) => [x.name, x.publicApi.join(','), x.missingIndex, x.files]), [
    ['billing', 'src/features/billing/index.ts', false, 2],
    ['search', 'src/features/search/index.js', true, 1],
    ['billing-2', 'src/modules/billing/index.js', true, 1],
  ]);
});

test('orphans: not imported, not entries, not tests, not config, not .d.ts', () => {
  const o = findOrphans(
    ['src/a.js', 'src/b.js', 'src/page.js', 'src/a.test.js', 'vite.config.js', 'src/env.d.ts', 'src/c.ts'],
    ['src/page.js'],
    [{ from: 'src/a.js', to: 'src/b.js' }],
  );
  assert.deepEqual(o, ['src/a.js', 'src/c.ts']);
});
