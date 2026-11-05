import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { graph } from '@agentreins/adapter-js';
import { parseBarrel, importedNames, declaredExports } from '../src/barrels.js';

test('parseBarrel: only files that do nothing but re-export', () => {
  assert.deepEqual(parseBarrel("'use client';\n// all of them\nexport * from './Button';\nexport { Modal, Dialog as Popup } from './Modal'\nexport * as icons from './icons';\nexport type { Props } from './types';\n"), [
    { star: true, names: [], spec: './Button' },
    { star: false, names: [['Modal', 'Modal'], ['Popup', 'Dialog']], spec: './Modal' },
    { star: false, names: [['icons', '*']], spec: './icons' },
    { star: false, names: [['Props', 'Props']], spec: './types' },
  ]);
  assert.equal(parseBarrel("export * from './a';\nexport const b = 1;\n"), null, 'declares something of its own');
  assert.equal(parseBarrel("import x from './a';\nexport { x };\n"), null);
  assert.equal(parseBarrel('export const a = 1;\n'), null);
});

test('importedNames: named imports only; anything else means "uses everything"', () => {
  const src = "import { A, B as Bee } from '@/components'\nimport x from './x'\nimport type { T } from '@/components';\n";
  assert.deepEqual(importedNames(src, '@/components'), ['A', 'B', 'T'], 'no semicolons: one import never swallows the next');
  assert.equal(importedNames("import UI from '@/components';", '@/components'), null);
  assert.equal(importedNames("import * as UI from '@/components';", '@/components'), null);
  assert.equal(importedNames("import X, { A } from '@/components';", '@/components'), null);
  assert.equal(importedNames("import { A } from '@/components';\nconst B = await import('@/components');", '@/components'), null);
  assert.equal(importedNames("// import { A } from '@/components'\n", '@/components'), null, 'commented out');
});

test('declaredExports: declarations, export lists and default', () => {
  const names = declaredExports('export const A = 1;\nexport function B() {}\nexport default class C {}\nconst d = 1;\nexport { d as D };\nexport type E = 1;\n');
  assert.deepEqual([...names].sort(), ['A', 'B', 'C', 'D', 'E', 'default']);
});

function repo(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'reins-barrels-'));
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), c);
  }
  return dir;
}

test('graph: what each importer really uses through barrels, nested and with export *', async () => {
  const dir = repo({
    'package.json': '{"name":"t","type":"module"}',
    'vite.config.js': 'export default {}\n',
    'jsconfig.json': '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}',
    'src/components/index.js': "export * from './JobBoard';\nexport { Button } from './Button';\nexport * from './widgets';\n",
    'src/components/JobBoard/index.js': "export { JobBoard } from './JobBoard';\n",
    'src/components/JobBoard/JobBoard.jsx': 'export const JobBoard = 1;\n',
    'src/components/Button.jsx': 'export const Button = 1;\n',
    'src/components/widgets/index.js': "export * from './Rating';\n",
    'src/components/widgets/Rating.jsx': 'export function Rating() {}\n',
    'src/routes/jobs/Jobs.jsx': "import { JobBoard, Button } from '@/components'\nexport const Jobs = [JobBoard, Button];\n",
    'src/routes/profile/Profile.jsx': "import { Rating } from '@/components';\nexport const Profile = Rating;\n",
    'src/routes/admin/Admin.jsx': "import * as UI from '@/components';\nexport const Admin = UI;\n",
  });
  const r = await graph(dir, { preset: 'vite-react' });
  assert.deepEqual(r.barrels, ['src/components/JobBoard/index.js', 'src/components/index.js', 'src/components/widgets/index.js']);
  const uses = r.uses.map((u) => `${u.from} -> ${u.to}`);
  assert.deepEqual(uses, [
    'src/routes/admin/Admin.jsx -> src/components/Button.jsx',
    'src/routes/admin/Admin.jsx -> src/components/JobBoard/JobBoard.jsx',
    'src/routes/admin/Admin.jsx -> src/components/widgets/Rating.jsx',
    'src/routes/jobs/Jobs.jsx -> src/components/Button.jsx',
    'src/routes/jobs/Jobs.jsx -> src/components/JobBoard/JobBoard.jsx',
    'src/routes/profile/Profile.jsx -> src/components/widgets/Rating.jsx',
  ]);
  assert.ok(r.edges.some((e) => e.from === 'src/routes/jobs/Jobs.jsx' && e.to === 'src/components/index.js'), 'the real edges are untouched');
});
