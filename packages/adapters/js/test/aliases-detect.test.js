import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAliases, parseJsonc, detectFramework, loadPreset, PRESETS } from '@reins/adapter-js';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const examples = fileURLToPath(new URL('../../../../examples/', import.meta.url));

/** Aliases with absolute paths turned into repo-relative ones. */
function relAliases(repo) {
  const info = readAliases(repo);
  const rel = (p) => path.relative(repo, p).split(path.sep).join('/');
  return {
    alias: Object.fromEntries(Object.entries(info.alias).map(([k, v]) => [k, v.map(rel)])),
    modules: info.modules.map(rel),
    sources: info.sources,
    warnings: info.warnings,
  };
}

function tempRepo(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'reins-adapter-'));
  for (const [f, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), content);
  }
  return dir;
}

test('parseJsonc: comments, trailing commas, and "/*" inside strings', () => {
  const text = '{\n  // c\n  "paths": { "@/*": ["src/*"], /* block */ },\n  "url": "http://x//y",\n}';
  assert.deepEqual(parseJsonc(text), { paths: { '@/*': ['src/*'] }, url: 'http://x//y' });
});

test('aliases: Vite JS example reads jsconfig.json and vite.config.js', () => {
  assert.deepEqual(relAliases(path.join(examples, 'vite-react')), {
    alias: { '@': ['src'] }, modules: [''], sources: ['jsconfig.json', 'vite.config.js'], warnings: [],
  });
});

test('aliases: Next TS example reads tsconfig.json paths without baseUrl', () => {
  assert.deepEqual(relAliases(path.join(examples, 'next-app')), { alias: { '@': ['src'] }, modules: [], sources: ['tsconfig.json'], warnings: [] });
});

test('aliases: Vite TS template follows references and extends, exact keys, and vite.config.ts with fileURLToPath', () => {
  assert.deepEqual(relAliases(path.join(fixtures, 'vite-ts-refs')), {
    alias: { '@': ['src'], '@config$': ['src/config.ts'], '~': ['src/shared'] },
    modules: [''],
    sources: ['tsconfig.app.json', 'vite.config.ts'],
    warnings: [],
  });
});

test('aliases: vite.config array form, "/src" means the project root, regex finds are reported', () => {
  const r = relAliases(path.join(fixtures, 'vite-alias-array'));
  assert.deepEqual(r.alias, { '@': ['src'], '#root': ['src'] });
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /regular expression in "find"/);
});

test('aliases: baseUrl alone becomes a module folder (pages router fixture)', () => {
  assert.deepEqual(relAliases(path.join(fixtures, 'next-pages')), { alias: {}, modules: [''], sources: ['jsconfig.json'], warnings: [] });
});

test('aliases: unsupported patterns and non-literal vite aliases are reported, broken JSON too', () => {
  const repo = tempRepo({
    'tsconfig.json': '{ "compilerOptions": { "paths": { "*": ["src/*"], "@x/*": ["src/x"] } } }',
    'jsconfig.json': '{ broken',
    'vite.config.js': "const aliases = {}; export default { resolve: { alias: aliases } };",
  });
  const { warnings } = readAliases(repo);
  assert.equal(warnings.length, 4);
  assert.match(warnings.join('\n'), /paths pattern "\*" is not supported/);
  assert.match(warnings.join('\n'), /"@x\/\*" maps to targets without "\/\*"/);
  assert.match(warnings.join('\n'), /jsconfig\.json: could not be parsed/);
  assert.match(warnings.join('\n'), /resolve\.alias is not a literal object or array/);
});

test('detectFramework: vite, next app, next pages, both routers, nothing', () => {
  assert.deepEqual(detectFramework(path.join(examples, 'vite-react')), { framework: 'vite', configFile: 'vite.config.js', suggestedPreset: 'vite-react' });
  assert.deepEqual(detectFramework(path.join(examples, 'next-app')), { framework: 'next', configFile: 'next.config.ts', router: 'app', suggestedPreset: 'next-app' });
  assert.equal(detectFramework(path.join(fixtures, 'next-pages')).suggestedPreset, 'next-pages');
  const both = tempRepo({ 'next.config.js': '', 'app/page.js': '', 'pages/old.js': '' });
  assert.deepEqual(detectFramework(both), { framework: 'next', configFile: 'next.config.js', router: 'both', suggestedPreset: 'next-app' });
  assert.equal(detectFramework(tempRepo({ 'package.json': '{}' })), null);
});

test('presets: every preset loads with layers and entries', () => {
  for (const name of PRESETS) {
    const p = loadPreset(name);
    assert.ok(p.description && p.layers.length >= 3 && p.entries.length >= 3, name);
  }
  assert.throws(() => loadPreset('remix'), /unknown preset "remix"/);
});
