import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/commands/check.js';
import { cli, tempDir } from './helpers.js';

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
