import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { graph } from '@harness/adapter-js';
import { typeScriptProblem } from '../src/graph.js';
import { validateEdges } from '@harness/core/contract';

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
  const ts = mkdtempSync(path.join(tmpdir(), 'harness-ts-'));
  writeFileSync(path.join(ts, 'a.ts'), 'export const a = 1;');
  assert.match(typeScriptProblem(ts, false), /has TypeScript files, but the "typescript" package is not available/);
  assert.equal(typeScriptProblem(ts, true), null);
  const js = mkdtempSync(path.join(tmpdir(), 'harness-js-'));
  writeFileSync(path.join(js, 'a.jsx'), 'export const a = 1;');
  writeFileSync(path.join(js, 'types.d.ts'), 'export {};');
  assert.equal(typeScriptProblem(js, false), null, 'plain JS projects (even with .d.ts files) need no TypeScript');
});
