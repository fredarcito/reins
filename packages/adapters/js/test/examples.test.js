// End-to-end: adapter graph + adapter rules + core check on examples/, each with one intentional violation per rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import adapter from '@harness/adapter-js';
import { parseConfig, runCheck, emptyBaseline, createBaseline, validateAdapter, validateEdges, normalizeGraph, CORE_RULES } from '@harness/core';

const examples = fileURLToPath(new URL('../../../../examples/', import.meta.url));

async function check(name) {
  const repo = path.join(examples, name);
  const config = parseConfig(readFileSync(path.join(repo, '.harness/architecture.yml'), 'utf8'), { knownRules: [...CORE_RULES, ...adapter.rules] });
  const g = normalizeGraph(await adapter.graph(repo, config));
  const extra = await adapter.evaluate(repo, config, g);
  return { repo, config, g, extra, result: runCheck({ edges: g.edges, config, baseline: emptyBaseline(), extra }) };
}

test('the adapter satisfies the contract', () => {
  assert.deepEqual(validateAdapter(adapter), []);
});

test('vite-react (JS/JSX): exactly one violation per rule', async () => {
  const { g, result } = await check('vite-react');
  assert.equal(adapter.detect(path.join(examples, 'vite-react')), true);
  assert.deepEqual(validateEdges(g.edges), []);
  assert.deepEqual(g.warnings, []);
  assert.deepEqual(result.violations.map((v) => v.key), [
    'domain-boundary|src/pages/Home.jsx|src/features/catalog/api.js',
    'layer-direction|src/components/Button.jsx|src/features/cart/index.js',
    'no-cycles|src/lib/currency.js|src/lib/format.js',
  ]);
  assert.equal(result.ok, false);
});

test('next-app (TS): one violation per rule including next-server-client; type-only imports ignored', async () => {
  const { g, result } = await check('next-app');
  assert.deepEqual(validateEdges(g.edges), []);
  assert.deepEqual(g.warnings, []);
  assert.deepEqual(result.violations.map((v) => v.key), [
    'domain-boundary|src/app/orders/page.tsx|src/features/billing/tax.ts',
    'layer-direction|src/components/OrdersLink.tsx|src/features/orders/index.ts',
    'next-server-client|src/features/orders/OrderList.tsx|src/lib/db.ts',
    'no-cycles|src/lib/date.ts|src/lib/time.ts',
  ]);
  const leak = result.violations.find((v) => v.rule === 'next-server-client');
  assert.deepEqual(leak.files, ['src/features/orders/OrderList.tsx', 'src/features/orders/queries.ts', 'src/lib/db.ts']);
});

test('next-app: Next special files are entries, a real orphan is not', async () => {
  const { g } = await check('next-app');
  assert.deepEqual(g.entries, ['next.config.ts', 'src/app/api/health/route.ts', 'src/app/layout.tsx', 'src/app/orders/page.tsx', 'src/app/page.tsx']);
  const imported = new Set(g.edges.map((e) => e.to));
  const orphans = g.files.filter((f) => !imported.has(f) && !g.entries.includes(f));
  assert.deepEqual(orphans, ['src/lib/unused.ts']);
});

test('both examples pass once their violations are in the baseline (adapter rules included)', async () => {
  for (const name of ['vite-react', 'next-app']) {
    const { config, g, extra, result } = await check(name);
    const again = runCheck({ edges: g.edges, config, baseline: createBaseline(result.violations), extra });
    assert.equal(again.ok, true, name);
    assert.equal(again.summary.baseline, result.violations.length, name);
  }
});
