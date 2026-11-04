import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cli, exampleRepo, git, tempDir } from './helpers.js';

const BASELINE = '.reins/baseline.json';

test('without a baseline every violation is new: exit 1, with rule, why and fix', async () => {
  const dir = exampleRepo('vite-react');
  const r = await cli(dir, ['check']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /baseline\.json not found/);
  assert.match(r.stdout, /✖ error layer-direction {2}src\/components\/Button\.jsx → src\/features\/cart\/index\.js/);
  assert.match(r.stdout, /Why: .+\n {4}Fix: .+/);
  assert.match(r.stdout, /3 new \(3 errors/);
});

test('--update-baseline freezes the violations; then check passes', async () => {
  const dir = exampleRepo('next-app');
  const u = await cli(dir, ['check', '--update-baseline']);
  assert.equal(u.code, 0);
  assert.match(u.stdout, /4 violation\(s\) \(\+4 frozen, -0 fixed\)/);
  assert.equal(JSON.parse(readFileSync(path.join(dir, BASELINE), 'utf8')).violations.length, 4);
  const r = await cli(dir, ['check']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /no new violations · 4 in baseline · 0 fixed/);
});

test('a new violation fails; --files only reports the touched files', async () => {
  const dir = exampleRepo('vite-react');
  await cli(dir, ['check', '--update-baseline']);
  writeFileSync(path.join(dir, 'src/lib/money.js'), "import { CartSummary } from '@/features/cart';\nexport const m = CartSummary;\n");
  const all = await cli(dir, ['check']);
  assert.equal(all.code, 1);
  assert.match(all.stdout, /layer-direction {2}src\/lib\/money\.js → src\/features\/cart\/index\.js/);

  const touched = await cli(path.join(dir, 'src/lib'), ['check', '--files', 'money.js']); // relative to cwd
  assert.equal(touched.code, 1);
  assert.match(touched.stdout, /\(touched files only\)/);
  const other = await cli(dir, ['check', '--files', 'src/App.jsx,index.html']);
  assert.equal(other.code, 0);
});

test('--json gives agents a stable shape, warnings included', async () => {
  const dir = exampleRepo('next-app');
  const r = await cli(dir, ['check', '--json']);
  const data = JSON.parse(r.stdout);
  assert.equal(r.code, 1);
  assert.equal(data.schema, 1);
  assert.equal(data.ok, false);
  assert.match(data.warnings[0], /baseline\.json not found/);
  assert.deepEqual(data.violations.map((v) => v.rule).sort(), ['domain-boundary', 'layer-direction', 'next-server-client', 'no-cycles']);
});

test('integrity: a branch that grows the baseline is flagged (warn by default, error when configured)', async () => {
  const dir = exampleRepo('vite-react');
  await cli(dir, ['check', '--update-baseline']);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'adopt reins');
  git(dir, 'checkout', '-q', '-b', 'feature');
  writeFileSync(path.join(dir, 'src/lib/money.js'), "import { CartSummary } from '@/features/cart';\nexport const m = CartSummary;\n");
  await cli(dir, ['check', '--update-baseline']);

  const warn = await cli(dir, ['check', '--base', 'main']);
  assert.equal(warn.code, 0);
  assert.match(warn.stdout, /! warn {2}integrity {2}\.reins\/baseline\.json/);
  assert.match(warn.stdout, /gained 1 violation\(s\) compared to main/);

  const yml = path.join(dir, '.reins/architecture.yml');
  writeFileSync(yml, readFileSync(yml, 'utf8').replace('  - { id: no-cycles,       severity: error }', '  - { id: no-cycles,       severity: error }\n  - { id: integrity, severity: error }'));
  const error = await cli(dir, ['check', '--base', 'main']);
  assert.equal(error.code, 1);
  assert.match(error.stdout, /architecture\.yml changed compared to main/);
});

test('integrity is skipped with a warning outside git or without a base branch', async () => {
  const dir = exampleRepo('vite-react');
  git(dir, 'branch', '-m', 'main', 'trunk');
  const r = await cli(dir, ['check']);
  assert.match(r.stdout, /No base branch found/);
});

test('exit 2 with a clear message: no architecture.yml, invalid config, bad options', async () => {
  const empty = tempDir({ 'package.json': '{}' });
  const none = await cli(empty, ['check']);
  assert.equal(none.code, 2);
  assert.match(none.stderr, /architecture\.yml not found\. Run `reins init`/);

  const bad = tempDir({ 'package.json': '{}', '.reins/architecture.yml': 'version: 1\nadapter: js\nlayers: oops\n' });
  const invalid = await cli(bad, ['check']);
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /layers: must be a list/);

  const opt = await cli(empty, ['check', '--nope']);
  assert.equal(opt.code, 2);
  assert.match(opt.stderr, /Unknown option '--nope'/);

  const both = await cli(empty, ['check', '--update-baseline', '--files', 'a.js']);
  assert.equal(both.code, 2);
  assert.match(both.stderr, /needs the whole project/);
});

test('check --help', async () => {
  const r = await cli(tempDir(), ['check', '--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /--update-baseline/);
  assert.equal(existsSync(path.join(tempDir(), BASELINE)), false);
});

test('check --coverage: layers, folders outside every layer, imports between layers, domains, baseline', async () => {
  const dir = exampleRepo('vite-react');
  await cli(dir, ['check', '--update-baseline']);
  mkdirSync(path.join(dir, 'src/utils'), { recursive: true });
  writeFileSync(path.join(dir, 'src/utils/slug.js'), 'export const slug = (s) => s;\n');
  const r = await cli(dir, ['check', '--coverage']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^reins check --coverage: what \.reins\/architecture\.yml covers/);
  assert.match(r.stdout, /Outside every layer: 1 files .*\n {2}src\/utils\/ \(1\)/);
  assert.match(r.stdout, /features → components: 2 down, 1 up {3}\(mixed: check this order\)/);
  assert.match(r.stdout, /Baseline: 3 frozen violation\(s\) \(/);
  const json = JSON.parse((await cli(dir, ['check', '--coverage', '--json'])).stdout);
  assert.deepEqual(json.outside.folders, [{ folder: 'src/utils', files: 1 }]);
  assert.deepEqual(json.domains.map((d) => [d.name, d.publicApiFiles.length > 0]).sort(), [['cart', true], ['catalog', true]]);
  assert.equal(json.baseline.total, 3);
});
