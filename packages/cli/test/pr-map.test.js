import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cli, cliDir, examplesDir, exampleRepo, git } from './helpers.js';
import { parseNameStatus, changedSince } from '../src/pr-map.js';
import { analyze } from '../src/commands/check.js';

const write = (dir, f, text) => {
  mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  writeFileSync(path.join(dir, f), text);
};
const worktrees = (dir) => git(dir, 'worktree', 'list').trim().split('\n');
const leftovers = (dir) => (existsSync(path.join(dir, '.reins/tmp')) ? readdirSync(path.join(dir, '.reins/tmp')) : []);

test('parseNameStatus (-z): renames keep both paths, copies count as added, names are never quoted', () => {
  assert.deepEqual(parseNameStatus('M\0a.js\0D\0b.js\0A\0c.js\0R087\0old.js\0new.js\0C100\0src.js\0copy.js\0M\0src/Café ñ.js\0'), [
    { path: 'a.js', status: 'M' }, { path: 'b.js', status: 'D' }, { path: 'c.js', status: 'A' },
    { path: 'new.js', status: 'R', oldPath: 'old.js' }, { path: 'copy.js', status: 'A' }, { path: 'src/Café ñ.js', status: 'M' },
  ]);
});

test('review --map: base = HEAD on a clean commit is the short form, and no worktree is left behind', async () => {
  const dir = exampleRepo('vite-react'); // its own no-cycles violation is old: it must not show up
  const r = await cli(dir, ['review', '--map', '--base', 'main']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^<!-- reins:pr-map -->/);
  assert.match(r.stdout, /\*\*No code changes\*\*/);
  assert.doesNotMatch(r.stdout, /CAUTION|```diff|```mermaid|new dependenc/);
  assert.equal(worktrees(dir).length, 1);
  assert.deepEqual(leftovers(dir), [], 'the base worktree is gone');
  assert.equal(git(dir, 'status', '--porcelain').replace(/.*\.reins\/tmp.*\n?/g, '').trim(), '', 'the repo is left as it was');
});

test('review --map: a PR that reaches into another domain shows a new dependency that breaks domain-boundary', async () => {
  const dir = exampleRepo('vite-react');
  git(dir, 'checkout', '-q', '-b', 'feature');
  write(dir, 'src/features/catalog/ProductList.jsx', `import { useCart } from '../cart/cartStore';\n${readFileSync(path.join(dir, 'src/features/catalog/ProductList.jsx'), 'utf8')}`);
  git(dir, 'commit', '-qam', 'catalog reaches into cart');
  const r = await cli(dir, ['review', '--map', '--base', 'main']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /\*\*1 violation\*\*/);
  assert.match(r.stdout, /> \[!CAUTION\]\n> \*\*domain-boundary:\*\*/);
  assert.match(r.stdout, /- catalog +now uses +cart internals +✖ breaks domain-boundary/);
  assert.match(r.stdout, /\*\*catalog\*\*/);
  assert.doesNotMatch(r.stdout, /no-cycles/, 'the violation that was already there is not the PR\'s');
  assert.equal(worktrees(dir).length, 1);
});

test('review --map: an unknown base ref is a usage error', async () => {
  const dir = exampleRepo('vite-react');
  const r = await cli(dir, ['review', '--map', '--base', 'nope']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Base ref "nope" not found/);
});

test('review --map: imports between workspace packages are not new when base = HEAD (pnpm relative links)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'reins-ws-'));
  write(dir, '.gitignore', 'node_modules/\n');
  write(dir, 'package.json', '{"name":"root","private":true,"type":"module"}');
  write(dir, 'packages/b/package.json', '{"name":"@t/b","type":"module","exports":{".":"./src/index.js"}}');
  write(dir, 'packages/b/src/index.js', 'export const b = 1;\n');
  write(dir, 'packages/a/package.json', '{"name":"@t/a","type":"module"}');
  write(dir, 'packages/a/src/index.js', "import { b } from '@t/b';\nexport const a = b + 1;\n");
  write(dir, '.reins/architecture.yml', [
    'version: 1', 'adapters: [js]', 'layers:',
    '  - { name: a, paths: ["packages/a/src/**"] }', '  - { name: b, paths: ["packages/b/src/**"] }',
    'rules:', '  - { id: layer-direction, severity: error }', '',
  ].join('\n'));
  // what pnpm does: a relative link in the package's own node_modules
  mkdirSync(path.join(dir, 'packages/a/node_modules/@t'), { recursive: true });
  symlinkSync('../../../b', path.join(dir, 'packages/a/node_modules/@t/b'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');

  const head = await analyze(dir, { searchPaths: [cliDir] });
  assert.ok(head.graph.edges.some((e) => e.from === 'packages/a/src/index.js' && e.to === 'packages/b/src/index.js'), 'the fixture really has a cross-package edge');

  const r = await cli(dir, ['review', '--map', '--base', 'main']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /\*\*No code changes\*\*/);
  assert.doesNotMatch(r.stdout, /now uses|new dependenc/);

  git(dir, 'checkout', '-q', '-b', 'feature');
  write(dir, 'packages/a/src/index.js', "import { b } from '@t/b';\nexport const a = b + 2;\n");
  git(dir, 'commit', '-qam', 'touch a');
  const r2 = await cli(dir, ['review', '--map', '--base', 'main']);
  assert.match(r2.stdout, /\*\*a\*\*/);
  assert.match(r2.stdout, /\*\*No structural changes\*\*/);
  assert.equal(worktrees(dir).length, 1);
});

test('changedSince: accented names come out unquoted, a rename keeps both paths, reins\' local folders are ignored', () => {
  const dir = exampleRepo('vite-react');
  git(dir, 'checkout', '-q', '-b', 'feature');
  git(dir, 'mv', 'src/lib/format.js', 'src/lib/Formató.js');
  write(dir, 'src/lib/ñandú.js', 'export const x = 1;\n');
  write(dir, '.reins/tmp/pr-map-base-1/leftover.js', 'x');
  write(dir, '.reins/progress/main/t/notebook.md', 'x');
  git(dir, 'add', '-A', '--', 'src');
  const changed = changedSince(dir, 'main');
  assert.deepEqual(changed.map((c) => [c.status, c.path, c.oldPath]).sort(), [
    ['A', 'src/lib/ñandú.js', undefined],
    ['R', 'src/lib/Formató.js', 'src/lib/format.js'],
  ]);
});

test('review --map: an accented file name and a rename are counted once each and shown unquoted', async () => {
  const dir = exampleRepo('vite-react');
  git(dir, 'checkout', '-q', '-b', 'feature');
  git(dir, 'mv', 'src/features/catalog/api.js', 'src/features/catalog/Catálogo.js');
  const r = await cli(dir, ['review', '--map', '--base', 'main']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /\*\*catalog\*\*/);
  assert.match(r.stdout, /`Catálogo\.js`, `api\.js`|`api\.js`, `Catálogo\.js`/);
  assert.doesNotMatch(r.stdout, /\\\d{3}|"src\//, 'no octal escapes or quoted paths');
});

test('review --map: the base graph is built by the head adapter, so a PR that changes the adapter is not a change in the code', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'reins-adapter-'));
  // prepareCheckout links the checkout's own copy of this adapter, like prepareCheckout of adapter-js links workspace packages
  const adapter = (extra) => `import { mkdirSync, symlinkSync } from 'node:fs';
export default {
  name: 'fake', contract: 1, detect: () => true,
  prepareCheckout: (dir) => { mkdirSync(dir + '/node_modules', { recursive: true }); symlinkSync('../tools/adapter', dir + '/node_modules/reins-adapter-fake'); return { warnings: [] }; },
  graph: () => ({ edges: [{ from: 'a/x.js', to: 'b/y.js', kind: 'static' }${extra}], files: ['a/x.js', 'b/y.js', 'c/w.js'] }),
};\n`;
  write(dir, '.gitignore', 'node_modules/\n');
  write(dir, 'package.json', '{"name":"root","private":true,"type":"module"}');
  write(dir, 'tools/adapter/package.json', '{"name":"reins-adapter-fake","type":"module","main":"index.js","reins":{"contract":1}}');
  write(dir, 'tools/adapter/index.js', adapter(''));
  for (const f of ['a/x.js', 'b/y.js', 'c/w.js']) write(dir, f, '// source\n');
  write(dir, '.reins/architecture.yml', 'version: 1\nadapters: [fake]\nlayers:\n  - { name: a, paths: ["a/**"] }\n  - { name: b, paths: ["b/**"] }\n  - { name: c, paths: ["c/**"] }\n');
  mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  symlinkSync('../tools/adapter', path.join(dir, 'node_modules/reins-adapter-fake')); // a workspace adapter, as pnpm links it
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  git(dir, 'checkout', '-q', '-b', 'feature');
  // the PR changes what the adapter reports (one more edge for every run) and touches a source file
  write(dir, 'tools/adapter/index.js', adapter(", { from: 'a/x.js', to: 'c/w.js', kind: 'static' }"));
  write(dir, 'a/x.js', '// changed\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'adapter change');
  const r = await cli(dir, ['review', '--map', '--base', 'main'], { adapterSearchPaths: [] });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /\*\*a\*\*/);
  // with the head adapter on both sides the extra edge exists in base and head: nothing new in the structure
  assert.match(r.stdout, /\*\*No structural changes\*\*/);
  assert.doesNotMatch(r.stdout, /now uses|new dependenc/);
});

test('review --map: no architecture.yml at the base means every head domain is new', async () => {
  const dir = exampleRepo('vite-react', { keepReins: false });
  git(dir, 'checkout', '-q', '-b', 'feature');
  write(dir, '.reins/architecture.yml', readFileSync(path.join(examplesDir, 'vite-react/.reins/architecture.yml'), 'utf8'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'adopt reins');
  const r = await cli(dir, ['review', '--map', '--base', 'main']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /\*\*2 new domains\*\*/);
  assert.match(r.stdout, /`cart` added to architecture\.yml/);
  assert.doesNotMatch(r.stderr, /could not be read/);
});

test('review --map: a failure outside reins\' own checks is an exit code 2 with git\'s message, not a stack trace', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'reins-nocommit-'));
  write(dir, '.reins/architecture.yml', 'version: 1\nadapters: [js]\n');
  git(dir, 'init', '-q', '-b', 'main');
  const r = await cli(dir, ['review', '--map']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /git .* failed|could not run|not a git|ambiguous|unknown revision|bad revision/i);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test('review --map: a plan with several adapters draws one frame per adapter, and the arrow between them', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'reins-zones-'));
  // the backend adapter reads its file: a line `renders <file>` is a dependency on that file
  const adapter = (name, file) => `import { readFileSync } from 'node:fs';
export default {
  name: '${name}', contract: 1, detect: () => true,
  graph: (root) => ({ files: ['${file}'], edges: [...readFileSync(root + '/${file}', 'utf8').matchAll(/renders (\\S+)/g)].map((m) => ({ from: '${file}', to: m[1], kind: 'static' })) }),
};\n`;
  write(dir, '.gitignore', 'node_modules/\n');
  write(dir, 'package.json', '{"name":"root","private":true,"type":"module"}');
  for (const name of ['back', 'front']) {
    write(dir, `tools/${name}/package.json`, `{"name":"reins-adapter-${name}","type":"module","main":"index.js","reins":{"contract":1}}`);
    mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    symlinkSync(`../tools/${name}`, path.join(dir, `node_modules/reins-adapter-${name}`));
  }
  write(dir, 'tools/back/index.js', adapter('back', 'api/users.rb'));
  write(dir, 'tools/front/index.js', adapter('front', 'web/users.tsx'));
  write(dir, 'api/users.rb', '# source\n');
  write(dir, 'web/users.tsx', '// source\n');
  write(dir, '.reins/architecture.yml', 'version: 1\nadapters: [back, front]\nlayers:\n  - { name: api, paths: ["api/**"] }\n  - { name: web, paths: ["web/**"] }\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  git(dir, 'checkout', '-q', '-b', 'feature');
  // the PR makes the backend file use the frontend one (a controller that renders a page)
  write(dir, 'api/users.rb', '# renders web/users.tsx\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'render the page');
  const r = await cli(dir, ['review', '--map', '--base', 'main'], { adapterSearchPaths: [] });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /subgraph z1\["back"\]\n {4}n1\("`\*\*api\*\*/);
  assert.match(r.stdout, /subgraph z2\["front"\]\n {4}n2\("`\*\*web\*\*/);
  assert.match(r.stdout, /Frames:\*\* &nbsp; one per language \(back, front\)/);
});
