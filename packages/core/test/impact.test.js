import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impactOf } from '@agentreins/core';

// A small but representative graph: two domains (orders, billing), a shared folder, app pages.
const e = (from, to, kind = 'static') => ({ from, to, kind });
const domains = [
  { name: 'orders', paths: ['src/features/orders/**'], publicApi: ['src/features/orders/index.ts'] },
  { name: 'billing', paths: ['src/features/billing/**'], publicApi: ['src/features/billing/index.ts'] },
];
const edges = [
  e('src/app/page.tsx', 'src/features/orders/index.ts'),      // outside the domain, through the public API
  e('src/features/billing/Invoice.tsx', 'src/lib/date.ts'),   // shared code: no domain, no crossing
  e('src/features/orders/queries.ts', 'src/lib/date.ts'),
  e('src/lib/time.ts', 'src/lib/date.ts'),                    // shared code importing shared code
  e('src/app/orders/page.tsx', 'src/features/billing/tax.ts'),// bypasses billing's public API
  e('src/app/orders/page.tsx', 'src/features/billing/tax.ts', 'type'), // same pair, second kind
  e('src/features/orders/index.ts', 'src/features/orders/queries.ts'), // internal import of the domain
];

test('consumers: outside files that import the target, with their domain and deduped kinds', () => {
  const r = impactOf('src/lib/date.ts', edges, domains);
  assert.deepEqual(r.consumers, [
    { file: 'src/features/billing/Invoice.tsx', domain: 'billing', kinds: ['static'] },
    { file: 'src/features/orders/queries.ts', domain: 'orders', kinds: ['static'] },
    { file: 'src/lib/time.ts', domain: null, kinds: ['static'] },
  ]);
  assert.deepEqual(r.domains, [
    { domain: 'billing', files: ['src/features/billing/Invoice.tsx'] },
    { domain: 'orders', files: ['src/features/orders/queries.ts'] },
    { domain: null, files: ['src/lib/time.ts'] },
  ]);
  assert.equal(r.owner, null);
  assert.deepEqual(r.targets, ['src/lib/date.ts']);
  assert.deepEqual(r.publicApi, []);
  assert.deepEqual(r.crossings, []);
});

test('crossings: an import that bypasses a domain public API, one entry per importer and file', () => {
  const r = impactOf('src/features/billing/tax.ts', edges, domains);
  assert.deepEqual(r.crossings, [{ from: 'src/app/orders/page.tsx', to: 'src/features/billing/tax.ts', domain: 'billing', kinds: ['static', 'type'] }]);
  assert.deepEqual(r.consumers, [{ file: 'src/app/orders/page.tsx', domain: null, kinds: ['static', 'type'] }]);
  assert.equal(r.owner, 'billing');
  assert.deepEqual(r.publicApi, []);
});

test('public API file: named as such even when nobody imports it; no crossing through it', () => {
  const r = impactOf('src/features/orders/index.ts', edges, domains);
  assert.equal(r.owner, 'orders');
  assert.deepEqual(r.publicApi, ['src/features/orders/index.ts']);
  assert.deepEqual(r.crossings, []); // the importer goes through the public API
  assert.deepEqual(r.consumers.map((c) => c.file), ['src/app/page.tsx']);
});

test('internal imports of a domain are not consumers', () => {
  const r = impactOf('src/features/orders/queries.ts', edges, domains);
  assert.deepEqual(r.consumers, [{ file: 'src/features/orders/index.ts', domain: 'orders', kinds: ['static'] }]);
});

test('folder target: everything inside is the target, only outside importers are consumers', () => {
  const r = impactOf('src/lib', edges, domains);
  assert.deepEqual(r.targets, ['src/lib/date.ts', 'src/lib/time.ts']);
  assert.deepEqual(r.consumers.map((c) => c.file), ['src/features/billing/Invoice.tsx', 'src/features/orders/queries.ts']);
  // the trailing "/" of a folder target is ignored
  assert.deepEqual(impactOf('src/lib/', edges, domains).targets, r.targets);
});

test('barrels: importers behind a barrel are consumers of the file it re-exports, never crossings', () => {
  const g = [
    e('src/lib/index.ts', 'src/lib/date.ts'),
    e('src/features/orders/queries.ts', 'src/lib/index.ts'),
    e('src/app/page.tsx', 'src/features/billing/index.ts'), // billing's public API barrel
    e('src/features/billing/index.ts', 'src/features/billing/tax.ts'),
  ];
  const uses = [
    { from: 'src/features/orders/queries.ts', to: 'src/lib/date.ts' },
    { from: 'src/app/page.tsx', to: 'src/features/billing/tax.ts' },
  ];
  // without `uses` the barrel hides the real importer
  assert.deepEqual(impactOf('src/lib/date.ts', g, domains).consumers.map((c) => c.file), ['src/lib/index.ts']);
  assert.deepEqual(impactOf('src/lib/date.ts', g, domains, uses).consumers, [
    { file: 'src/features/orders/queries.ts', domain: 'orders', kinds: ['barrel'] },
    { file: 'src/lib/index.ts', domain: null, kinds: ['static'] },
  ]);
  const tax = impactOf('src/features/billing/tax.ts', g, domains, uses);
  assert.deepEqual(tax.consumers.map((c) => c.file), ['src/app/page.tsx', 'src/features/billing/index.ts']);
  assert.deepEqual(tax.crossings, []); // through the public API barrel: legal
  // a use from inside a folder target is internal
  assert.deepEqual(impactOf('src', g, domains, uses).consumers, []);
});

test('folder target: owned by a domain when all its files are, even though the folder never matches `dir/**`', () => {
  assert.equal(impactOf('src/features/billing', edges, domains).owner, 'billing');
  assert.equal(impactOf('src/features/orders/', edges, domains).owner, 'orders');
  assert.equal(impactOf('src/features', edges, domains).owner, null); // spans two domains
  assert.equal(impactOf('src/lib', edges, domains).owner, null);
});

test('a target with no importers at all still reports its owner and public API', () => {
  const r = impactOf('src/features/billing/tax.ts', [e('src/app/page.tsx', 'src/features/orders/index.ts')], domains);
  assert.deepEqual(r.consumers, []);
  assert.deepEqual(r.domains, []);
  assert.equal(r.owner, 'billing');
  assert.deepEqual(r.targets, []);
});

test('no domains configured: consumers still work, nothing is a crossing', () => {
  const r = impactOf('src/lib/date.ts', edges, []);
  assert.deepEqual(r.consumers.map((c) => c.file), ['src/features/billing/Invoice.tsx', 'src/features/orders/queries.ts', 'src/lib/time.ts']);
  assert.deepEqual(r.crossings, []);
  assert.equal(r.owner, null);
});
