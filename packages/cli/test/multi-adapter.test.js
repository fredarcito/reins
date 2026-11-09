import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/commands/check.js';
import { cli, exampleRepo, tempDir } from './helpers.js';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

/** A fake adapter package `reins-adapter-<name>` whose module body is `body`. */
const adapterPkg = (name, body) => ({
  [`node_modules/reins-adapter-${name}/package.json`]: { name: `reins-adapter-${name}`, version: '1.0.0', type: 'module', reins: { contract: 1 }, exports: { '.': './index.js' } },
  [`node_modules/reins-adapter-${name}/index.js`]: body,
});

// "web" sees src/ (a ui -> lib edge and a lib -> ui violation); "native" sees core/ and runs its own rule on its own graph.
const web = adapterPkg('web', `export default { name: 'web', contract: 1, presets: ['spa'], detect: () => true,
  graph: (root, config) => ({ edges: [{ from: 'src/ui/a.js', to: 'src/lib/b.js', kind: 'static' }, { from: 'src/lib/b.js', to: 'src/ui/a.js', kind: 'static' }],
    files: ['src/ui/a.js', 'src/lib/b.js'], warnings: ['web saw preset ' + config.preset] }) };`);
const native = adapterPkg('native', `export default { name: 'native', contract: 1, rules: ['native-rule'], detect: () => true,
  graph: (root, config) => ({ edges: [{ from: 'core/cmd/x.rs', to: 'core/audio/y.rs', kind: 'static' }], files: ['core/cmd/x.rs', 'core/audio/y.rs'],
    warnings: ['native saw preset ' + config.preset] }),
  evaluate: (root, config, graph) => graph.files.includes('src/ui/a.js') ? [] : [{ rule: 'native-rule', severity: 'warn', key: 'native-rule|core/cmd/x.rs', from: 'core/cmd/x.rs', message: 'own graph only' }] };`);

const yml = `version: 1
adapters: [web, native]
preset: spa
layers:
  - { name: ui, paths: ["src/ui/**"] }
  - { name: lib, paths: ["src/lib/**"] }
  - { name: audio, paths: ["core/audio/**"] }
  - { name: cmd, paths: ["core/cmd/**"] }
rules:
  - { id: layer-direction, severity: error }
  - { id: native-rule, severity: warn }
`;

test('several adapters: graphs are merged, each adapter runs its rules on its own graph and gets only its own preset', async () => {
  const dir = tempDir({ ...web, ...native, '.reins/architecture.yml': yml });
  const a = await analyze(dir, {});
  assert.deepEqual(a.loaded.map((l) => l.packageName), ['reins-adapter-web', 'reins-adapter-native']);
  assert.deepEqual(a.graph.files, ['src/ui/a.js', 'src/lib/b.js', 'core/cmd/x.rs', 'core/audio/y.rs']);
  assert.equal(a.graph.edges.length, 3);
  assert.deepEqual(a.graph.warnings, ['web saw preset spa', 'native saw preset undefined']);
  assert.deepEqual(a.extra.map((v) => v.rule), ['native-rule']);

  const r = await cli(dir, ['check', '--json']);
  assert.equal(r.code, 1);
  const keys = JSON.parse(r.stdout).violations.map((v) => v.key).sort();
  assert.deepEqual(keys, ['layer-direction|core/cmd/x.rs|core/audio/y.rs', 'layer-direction|src/lib/b.js|src/ui/a.js', 'native-rule|core/cmd/x.rs']);
});

test('several adapters: a rule id declared by two adapters is refused', async () => {
  const twin = adapterPkg('twin', `export default { name: 'twin', contract: 1, rules: ['native-rule'], detect: () => true, graph: () => [], evaluate: () => [] };`);
  const dir = tempDir({ ...native, ...twin, '.reins/architecture.yml': 'version: 1\nadapters: [native, twin]\n' });
  await assert.rejects(analyze(dir, {}), /reins-adapter-native and reins-adapter-twin both declare rule "native-rule"/);
});

test('several adapters: a preset no adapter lists is refused, with each adapter\'s presets', async () => {
  const dir = tempDir({ ...web, ...native, '.reins/architecture.yml': yml.replace('preset: spa', 'preset: sap') });
  await assert.rejects(analyze(dir, {}), /preset "sap" is not a preset of any adapter \(web: spa; native: none\)/);
});

test('several adapters: an adapter may not declare a core rule', async () => {
  const bad = adapterPkg('bad', `export default { name: 'bad', contract: 1, rules: ['no-cycles'], detect: () => true, graph: () => [], evaluate: () => [] };`);
  const dir = tempDir({ ...web, ...bad, '.reins/architecture.yml': 'version: 1\nadapters: [web, bad]\n' });
  await assert.rejects(analyze(dir, {}), /reins-adapter-bad declares rule "no-cycles", which is a core rule/);
});

test('init refuses a plan that lists several adapters instead of redrafting it for one', async () => {
  const dir = exampleRepo('vite-react');
  writeFileSync(path.join(dir, '.reins/architecture.yml'), 'version: 1\nadapters: [js, rust]\n');
  const r = await cli(dir, ['init', '--force']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /lists several adapters, and init drafts a plan for one/);
});
