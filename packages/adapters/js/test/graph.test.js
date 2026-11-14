import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { graph } from '@agentreins/adapter-js';
import { typeScriptProblem } from '../src/graph.js';
import { validateEdges } from '@agentreins/core/contract';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const edgesOf = (result) => result.edges.map((edge) => `${edge.kind} ${edge.from} -> ${edge.to}`).sort();

test('Vite TS: aliases from tsconfig.app.json and vite.config.ts resolve; type and dynamic kinds', async () => {
  const result = await graph(path.join(fixtures, 'vite-ts-refs'), { preset: 'vite-react' });
  assert.deepEqual(edgesOf(result), [
    'dynamic src/main.tsx -> src/Lazy.tsx',
    'static src/main.tsx -> src/App.tsx',
    'static src/main.tsx -> src/config.ts',
    'static src/main.tsx -> src/shared/helper.ts',
    'type src/main.tsx -> src/types.ts',
  ]);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(validateEdges(result.edges), []);
  assert.ok(result.entries.includes('src/main.tsx'));
});

test('Next pages router (JSX, baseUrl): bare imports resolve, every page is an entry, orphans are not', async () => {
  const result = await graph(path.join(fixtures, 'next-pages'));
  assert.deepEqual(edgesOf(result), ['static pages/_app.jsx -> components/Header.jsx', 'static pages/index.jsx -> hooks/useUser.js']);
  assert.deepEqual(result.entries, ['next.config.mjs', 'pages/_app.jsx', 'pages/api/ping.js', 'pages/index.jsx']);
  assert.ok(result.files.includes('components/Orphan.jsx'));
  assert.deepEqual(result.warnings, [], 'the bare "react" import is not a local import');
});

test('unresolved local imports are reported, npm packages are not', async () => {
  const result = await graph(path.join(fixtures, 'vite-alias-array'));
  assert.deepEqual(edgesOf(result), ['static src/main.js -> src/a.js', 'static src/main.js -> src/b.js']);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /regular expression in "find"/);
  assert.match(result.warnings[1], /^1 local import\(s\) could not be resolved.+'@\/does-not-exist' in src\/main\.js/);
});

test('TypeScript files without the typescript package fail loudly instead of being skipped', () => {
  const tsRepo = mkdtempSync(path.join(tmpdir(), 'reins-ts-'));
  writeFileSync(path.join(tsRepo, 'a.ts'), 'export const a = 1;');
  assert.match(typeScriptProblem(tsRepo, false), /has TypeScript files, but the "typescript" package is not available/);
  assert.equal(typeScriptProblem(tsRepo, true), null);
  const jsRepo = mkdtempSync(path.join(tmpdir(), 'reins-js-'));
  writeFileSync(path.join(jsRepo, 'a.jsx'), 'export const a = 1;');
  writeFileSync(path.join(jsRepo, 'types.d.ts'), 'export {};');
  assert.equal(typeScriptProblem(jsRepo, false), null, 'plain JS projects (even with .d.ts files) need no TypeScript');
});

test('monorepo workspaces: imports of "exports"-only packages resolve to their real path (regression)', async () => {
  const { mkdirSync, symlinkSync } = await import('node:fs');
  const ws = mkdtempSync(path.join(tmpdir(), 'reins-ws-'));
  const write = (relativePath, content) => {
    mkdirSync(path.dirname(path.join(ws, relativePath)), { recursive: true });
    writeFileSync(path.join(ws, relativePath), content);
  };
  write('package.json', '{ "private": true }');
  write('packages/lib/package.json', JSON.stringify({ name: '@w/lib', type: 'module', exports: { '.': './src/index.js', './sub': './src/sub.js' } }));
  write('packages/lib/src/index.js', 'export const a = 1;\n');
  write('packages/lib/src/sub.js', 'export const b = 1;\n');
  write('packages/app/src/main.js', "import { a } from '@w/lib';\nimport { b } from '@w/lib/sub';\nexport default [a, b];\n");
  mkdirSync(path.join(ws, 'packages/app/node_modules/@w'), { recursive: true });
  symlinkSync('../../../lib', path.join(ws, 'packages/app/node_modules/@w/lib')); // what pnpm/npm workspaces do
  const result = await graph(ws, {});
  assert.deepEqual(edgesOf(result), ['static packages/app/src/main.js -> packages/lib/src/index.js', 'static packages/app/src/main.js -> packages/lib/src/sub.js']);
});

test('ignore: files matching architecture.yml "ignore" leave the graph, warnings included', async () => {
  const result = await graph(path.join(fixtures, 'vite-alias-array'), { ignore: ['src/main.js'] });
  assert.deepEqual(result.edges, []);
  assert.ok(!result.files.includes('src/main.js'));
  assert.ok(!result.warnings.some((warning) => warning.includes('could not be resolved')));
});
