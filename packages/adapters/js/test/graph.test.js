import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { graph } from '@reins/adapter-js';
import { typeScriptProblem } from '../src/graph.js';
import { validateEdges } from '@reins/core/contract';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const edgesOf = (r) => r.edges.map((e) => `${e.kind} ${e.from} -> ${e.to}`).sort();

test('Vite TS: aliases from tsconfig.app.json and vite.config.ts resolve; type and dynamic kinds', async () => {
  const r = await graph(path.join(fixtures, 'vite-ts-refs'), { preset: 'vite-react' });
  assert.deepEqual(edgesOf(r), [
    'dynamic src/main.tsx -> src/Lazy.tsx',
    'static src/main.tsx -> src/App.tsx',
    'static src/main.tsx -> src/config.ts',
    'static src/main.tsx -> src/shared/helper.ts',
    'type src/main.tsx -> src/types.ts',
  ]);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(validateEdges(r.edges), []);
  assert.ok(r.entries.includes('src/main.tsx'));
});

test('Next pages router (JSX, baseUrl): bare imports resolve, every page is an entry, orphans are not', async () => {
  const r = await graph(path.join(fixtures, 'next-pages'));
  assert.deepEqual(edgesOf(r), ['static pages/_app.jsx -> components/Header.jsx', 'static pages/index.jsx -> hooks/useUser.js']);
  assert.deepEqual(r.entries, ['next.config.mjs', 'pages/_app.jsx', 'pages/api/ping.js', 'pages/index.jsx']);
  assert.ok(r.files.includes('components/Orphan.jsx'));
  assert.deepEqual(r.warnings, [], 'the bare "react" import is not a local import');
});

test('unresolved local imports are reported, npm packages are not', async () => {
  const r = await graph(path.join(fixtures, 'vite-alias-array'));
  assert.deepEqual(edgesOf(r), ['static src/main.js -> src/a.js', 'static src/main.js -> src/b.js']);
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings[0], /regular expression in "find"/);
  assert.match(r.warnings[1], /^1 local import\(s\) could not be resolved.+'@\/does-not-exist' in src\/main\.js/);
});

test('TypeScript files without the typescript package fail loudly instead of being skipped', () => {
  const ts = mkdtempSync(path.join(tmpdir(), 'reins-ts-'));
  writeFileSync(path.join(ts, 'a.ts'), 'export const a = 1;');
  assert.match(typeScriptProblem(ts, false), /has TypeScript files, but the "typescript" package is not available/);
  assert.equal(typeScriptProblem(ts, true), null);
  const js = mkdtempSync(path.join(tmpdir(), 'reins-js-'));
  writeFileSync(path.join(js, 'a.jsx'), 'export const a = 1;');
  writeFileSync(path.join(js, 'types.d.ts'), 'export {};');
  assert.equal(typeScriptProblem(js, false), null, 'plain JS projects (even with .d.ts files) need no TypeScript');
});

test('monorepo workspaces: imports of "exports"-only packages resolve to their real path (regression)', async () => {
  const { mkdirSync, symlinkSync } = await import('node:fs');
  const ws = mkdtempSync(path.join(tmpdir(), 'reins-ws-'));
  const w = (f, t) => {
    mkdirSync(path.dirname(path.join(ws, f)), { recursive: true });
    writeFileSync(path.join(ws, f), t);
  };
  w('package.json', '{ "private": true }');
  w('packages/lib/package.json', JSON.stringify({ name: '@w/lib', type: 'module', exports: { '.': './src/index.js', './sub': './src/sub.js' } }));
  w('packages/lib/src/index.js', 'export const a = 1;\n');
  w('packages/lib/src/sub.js', 'export const b = 1;\n');
  w('packages/app/src/main.js', "import { a } from '@w/lib';\nimport { b } from '@w/lib/sub';\nexport default [a, b];\n");
  mkdirSync(path.join(ws, 'packages/app/node_modules/@w'), { recursive: true });
  symlinkSync('../../../lib', path.join(ws, 'packages/app/node_modules/@w/lib')); // what pnpm/npm workspaces do
  const r = await graph(ws, {});
  assert.deepEqual(edgesOf(r), ['static packages/app/src/main.js -> packages/lib/src/index.js', 'static packages/app/src/main.js -> packages/lib/src/sub.js']);
});

test('ignore: files matching architecture.yml "ignore" leave the graph, warnings included', async () => {
  const r = await graph(path.join(fixtures, 'vite-alias-array'), { ignore: ['src/main.js'] });
  assert.deepEqual(r.edges, []);
  assert.ok(!r.files.includes('src/main.js'));
  assert.ok(!r.warnings.some((w) => w.includes('could not be resolved')));
});
