import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lint, importSpecifiers } from './lint.mjs';
import { renameScope } from './rename-scope.mjs';

/** Builds a minimal fake repo. files: { relativePath: content } */
function fakeRepo(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'harness-scripts-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}

const base = () => ({
  'packages/core/package.json': { name: '@h/core', type: 'module' },
  'packages/core/src/index.js': "export const x = 1;\n",
  'packages/cli/package.json': { name: '@h/cli', type: 'module', dependencies: { '@h/core': 'workspace:^' } },
  'packages/cli/src/main.js': "import { x } from '@h/core';\nexport default x;\n",
  'packages/adapters/js/package.json': { name: '@h/adapter-js', type: 'module', peerDependencies: { '@h/core': 'workspace:^' }, harness: { contract: 1 } },
  'packages/adapters/js/src/index.js': "import { CONTRACT_VERSION } from '@h/core/contract';\nexport default CONTRACT_VERSION;\n",
  'AGENTS.md': '# repo\n',
});

test('importSpecifiers finds static, re-export, side-effect and dynamic imports', () => {
  const src = `import a from 'a';\nexport { b } from "b";\nimport 'c';\nconst d = await import('d');\nimport {\n  e,\n} from 'e';`;
  assert.deepEqual(importSpecifiers(src).sort(), ['a', 'b', 'c', 'd', 'e']);
});

test('lint passes on a clean repo', () => {
  assert.deepEqual(lint(fakeRepo(base())), []);
});

test('lint flags core importing the cli and adapters importing core internals', () => {
  const files = base();
  files['packages/core/src/index.js'] = "import { run } from '@h/cli';\nexport default run;\n";
  files['packages/adapters/js/src/index.js'] = "import x from '@h/core';\nexport default x;\n";
  const rules = lint(fakeRepo(files)).map((p) => `${p.rule}:${p.file}`);
  assert.deepEqual(rules.sort(), [
    'import-boundary:packages/adapters/js/src/index.js',
    'import-boundary:packages/core/src/index.js',
  ]);
});

test('lint flags adapter metadata, scope mismatch and syntax errors', () => {
  const files = base();
  files['packages/adapters/js/package.json'] = { name: '@other/adapter-js', dependencies: { '@h/core': '1' } };
  files['packages/cli/src/broken.js'] = 'export const = ;\n';
  const rules = lint(fakeRepo(files)).map((p) => p.rule);
  assert.equal(rules.filter((r) => r === 'packages').length, 5); // scope, not ESM, no peer, in dependencies, no contract
  assert.ok(rules.includes('syntax'));
});

test('lint flags long and nested AGENTS.md/CLAUDE.md', () => {
  const files = base();
  files['AGENTS.md'] = Array.from({ length: 31 }, (_, i) => `line ${i}`).join('\n');
  files['packages/core/CLAUDE.md'] = '@AGENTS.md\n';
  files['templates/AGENTS.md'] = '# template\n';
  files['examples/vite-react/AGENTS.md'] = '# example\n';
  const found = lint(fakeRepo(files)).map((p) => `${p.rule}:${p.file}`);
  assert.deepEqual(found.sort(), ['agents-md:AGENTS.md', 'agents-md:packages/core/CLAUDE.md']);
});

test('lint flags mermaid diagrams GitHub would fail to render', () => {
  const files = base();
  files['docs/a.md'] = '# a\n\n```mermaid\nflowchart LR\n    a["ok<br/>fine"] --> b["say &quot;hi&quot;"]\n    graph["x"] --> c["a | b"]\n```\n';
  const found = lint(fakeRepo(files)).filter((p) => p.rule === 'diagrams').map((p) => p.message);
  assert.equal(found.length, 3);
  assert.match(found[0], /^line 5: HTML entity/);
  assert.match(found[1], /^line 6: label contains/);
  assert.match(found[2], /^line 6: reserved word used as a node id/);
});

test('renameScope rewrites names and imports, skips history and longer scopes', () => {
  const files = base();
  files['README.md'] = 'npm i -D @h/cli @h/adapter-js\nnot @h-other/x\n';
  files['docs/VERIFIED.md'] = 'tested @h/core\n';
  const root = fakeRepo(files);
  const dry = renameScope(root, '@acme', { dryRun: true });
  assert.equal(readFileSync(path.join(root, 'README.md'), 'utf8').includes('@acme'), false);
  const r = renameScope(root, '@acme');
  assert.deepEqual(r.files, dry.files);
  assert.equal(r.from, '@h');
  assert.equal(JSON.parse(readFileSync(path.join(root, 'packages/core/package.json'), 'utf8')).name, '@acme/core');
  assert.match(readFileSync(path.join(root, 'packages/adapters/js/src/index.js'), 'utf8'), /'@acme\/core\/contract'/);
  assert.equal(readFileSync(path.join(root, 'README.md'), 'utf8'), 'npm i -D @acme/cli @acme/adapter-js\nnot @h-other/x\n');
  assert.equal(readFileSync(path.join(root, 'docs/VERIFIED.md'), 'utf8'), 'tested @h/core\n');
  assert.deepEqual(lint(root), []);
});

test('renameScope rejects invalid scopes', () => {
  assert.throws(() => renameScope(fakeRepo(base()), 'acme'), /Invalid scope/);
});
