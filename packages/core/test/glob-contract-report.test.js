import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  matchesAny, validateAdapter, validateEdges, CONTRACT_VERSION,
  parseConfig, runCheck, emptyBaseline, createBaseline, evaluate, formatText, formatJson, REPORT_SCHEMA,
} from '@harness/core';
import { edges } from './fixtures/edges.js';

test('glob: *, **, ?, {a,b}', () => {
  const cases = [
    ['src/features/**', 'src/features/billing/index.js', true],
    ['src/features/**', 'src/featuresX/a.js', false],
    ['src/*.js', 'src/a.js', true],
    ['src/*.js', 'src/a/b.js', false],
    ['src/**/index.js', 'src/index.js', true],
    ['src/**/index.js', 'src/a/b/index.js', true],
    ['src/**/*.{js,jsx}', 'src/a/B.jsx', true],
    ['src/**/*.{js,jsx}', 'src/a/B.ts', false],
    ['src/?.js', 'src/a.js', true],
    ['src/app/(shop)/page.js', 'src/app/(shop)/page.js', true],
    ['src/[id]/page.js', 'src/[id]/page.js', true],
  ];
  for (const [glob, file, expected] of cases) assert.equal(matchesAny(file, [glob]), expected, `${glob} vs ${file}`);
});

test('contract: a valid adapter passes, a broken one lists every problem', () => {
  const ok = { name: 'js', contract: CONTRACT_VERSION, detect() {}, graph() {}, rules: ['next-server-client'], evaluate() {} };
  assert.deepEqual(validateAdapter(ok), []);
  assert.deepEqual(validateAdapter({ contract: 99, rules: 'x' }), [
    '"name" must be a non-empty string',
    `implements contract 99, but this core supports contract ${CONTRACT_VERSION}`,
    '"detect" must be a function',
    '"graph" must be a function',
    '"rules" must be a list of rule ids',
  ]);
  assert.deepEqual(validateAdapter(null), ['the adapter must export an object as default export']);
});

test('contract: edges must be repo-relative POSIX paths', () => {
  assert.deepEqual(validateEdges(edges), []);
  assert.deepEqual(validateEdges({}), ['graph() must return an array of edges']);
  assert.deepEqual(validateEdges([{ from: '/abs/a.js', to: './b.js', kind: '' }, { from: 'a\\b.js', to: '../c.js', kind: 'static' }]), [
    'edge 0: "kind" must be a non-empty string',
    'edge 0: "from" must be relative to the repo root with "/" separators ("/abs/a.js")',
    'edge 0: "to" must be relative to the repo root with "/" separators ("./b.js")',
    'edge 1: "from" must be relative to the repo root with "/" separators ("a\\b.js")',
    'edge 1: "to" must be relative to the repo root with "/" separators ("../c.js")',
  ]);
});

const config = parseConfig(await readFile(new URL('./fixtures/architecture.yml', import.meta.url), 'utf8'));

test('report text: rule, why and fix for each new violation, and a summary', () => {
  const text = formatText(runCheck({ edges, config, baseline: emptyBaseline() }));
  assert.match(text, /^✖ error layer-direction {2}src\/components\/PriceTag\.js → src\/features\/billing\/index\.js$/m);
  assert.match(text, /^ {4}Why: .+$/m);
  assert.match(text, /^ {4}Fix: .+$/m);
  assert.match(text, /harness check: 3 new \(3 errors, 0 warnings\) · 0 in baseline · 0 fixed/);
  assert.match(text, /Result: FAIL/);
});

test('report text: baseline violations are hidden unless verbose; stale entries are explained', () => {
  const baseline = createBaseline(evaluate(edges, config));
  const fixed = edges.filter((e) => e.from !== 'src/components/PriceTag.js');
  const r = runCheck({ edges: fixed, config, baseline });
  const text = formatText(r);
  assert.doesNotMatch(text, /Why:/);
  assert.match(text, /no new violations · 2 in baseline · 1 fixed/);
  assert.match(text, /1 baseline entry no longer occurs\. Remove it with `harness check --update-baseline`/);
  assert.match(text, /Result: pass/);
  assert.match(formatText(r, { verbose: true }), /\(in baseline\)/);
});

test('report json: stable shape for agents', () => {
  const data = JSON.parse(formatJson(runCheck({ edges, config, baseline: emptyBaseline(), files: ['src/lib/a.js'] })));
  assert.equal(data.schema, REPORT_SCHEMA);
  assert.equal(data.ok, false);
  assert.equal(data.partial, true);
  assert.deepEqual(Object.keys(data.violations[0]), ['rule', 'severity', 'status', 'from', 'to', 'files', 'message', 'fix', 'key']);
});
