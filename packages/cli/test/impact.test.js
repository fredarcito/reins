import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cli, exampleRepo } from './helpers.js';

const write = (dir, f, text) => {
  mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  writeFileSync(path.join(dir, f), text);
};

function repo() {
  const dir = exampleRepo('next-app');
  write(dir, '.reins/notes/billing.md', '---\npaths: ["src/features/billing/**"]\n---\n- 2026-11-01: taxes are computed server side.\n');
  write(dir, '.reins/notes/lib.md', '---\npaths: src/lib/**\n---\n- dates are UTC.\n');
  return dir;
}

test('impact <file>: domains that consume it, crossings, existing violations and level', async () => {
  const dir = repo();
  const r = await cli(dir, ['impact', 'src/features/billing/tax.ts']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(
    r.stdout,
    [
      'File: src/features/billing/tax.ts (domain: billing)',
      'Imported by: 1 file — no domain (1)',
      'Public API: no',
      'Boundary crossings: 1 — src/app/orders/page.tsx imports src/features/billing/tax.ts (bypasses billing\'s public API)',
      'Existing violations: 1 (domain-boundary new; run `reins check --files src/features/billing/tax.ts` to see them)',
      'Notes to read: .reins/notes/billing.md',
      'Minimum level (if the change breaks importers): small (2 file(s) in 1 domain)',
    ].join('\n') + '\n',
  );
});

test('impact: shared code without a domain — consumers by domain, type imports count, notes to read', async () => {
  const dir = repo();
  const j = JSON.parse((await cli(dir, ['impact', 'src/lib/date.ts', '--json'])).stdout);
  assert.deepEqual(j.consumers, [
    { file: 'src/features/billing/Invoice.tsx', domain: 'billing', kinds: ['static'] },
    { file: 'src/lib/time.ts', domain: null, kinds: ['static'] },
  ]);
  assert.equal(j.owner, null);
  assert.deepEqual(j.crossings, []);
  assert.deepEqual(j.violations.map((v) => [v.rule, v.status, v.from]), [['no-cycles', 'new', 'src/lib/date.ts']]);
  assert.deepEqual(j.notes, ['.reins/notes/lib.md', '.reins/notes/billing.md']); // the target's note and the consumers'
  assert.equal(j.level, 'small');
});

test('impact: a public API file is a large task before anyone touches it', async () => {
  const dir = repo();
  const j = JSON.parse((await cli(dir, ['impact', 'src/features/orders/index.ts', '--json'])).stdout);
  assert.deepEqual(j.publicApi, ['src/features/orders/index.ts']);
  assert.deepEqual(j.crossings, []); // importers go through the public API
  assert.deepEqual(j.consumers.map((c) => c.file), ['src/app/page.tsx', 'src/components/OrderBadge.tsx', 'src/components/OrdersLink.tsx']);
  assert.equal(j.level, 'large');
  assert.match(j.reasons.join('; '), /touches a public API/);
});

test('impact <folder>: everything inside is the target; only outside importers are consumers', async () => {
  const dir = repo();
  const j = JSON.parse((await cli(dir, ['impact', 'src/lib', '--json'])).stdout);
  assert.equal(j.folder, true);
  assert.deepEqual(j.targets, ['src/lib/date.ts', 'src/lib/db.ts', 'src/lib/time.ts']);
  assert.deepEqual(j.consumers.map((c) => c.file), ['src/features/billing/Invoice.tsx', 'src/features/orders/queries.ts']);
  assert.deepEqual(j.domains.map((g) => [g.domain, g.files.length]), [['billing', 1], ['orders', 1]]);
  assert.equal(j.level, 'large'); // the blast radius spans two domains
  assert.match(j.reasons.join('; '), /2 domains/);
  const text = await cli(dir, ['impact', 'src/lib']);
  assert.match(text.stdout, /^Folder: src\/lib \(no domain\)/);
});

test('impact: importers through a barrel count as consumers of the file behind it', async () => {
  const dir = repo();
  write(dir, 'src/lib/money.ts', 'export const formatMoney = (n: number) => `$${n}`;\n');
  write(dir, 'src/lib/index.ts', "export { formatMoney } from './money';\n");
  write(dir, 'src/features/billing/Total.tsx', "import { formatMoney } from '@/lib';\n\nexport const Total = () => formatMoney(1);\n");
  write(dir, 'src/features/orders/Sum.tsx', "import { formatMoney } from '../../lib';\n\nexport const Sum = () => formatMoney(2);\n");
  const j = JSON.parse((await cli(dir, ['impact', 'src/lib/money.ts', '--json'])).stdout);
  assert.deepEqual(j.consumers, [
    { file: 'src/features/billing/Total.tsx', domain: 'billing', kinds: ['barrel'] },
    { file: 'src/features/orders/Sum.tsx', domain: 'orders', kinds: ['barrel'] },
    { file: 'src/lib/index.ts', domain: null, kinds: ['static'] },
  ]);
  assert.equal(j.level, 'large'); // two domains break, though only the barrel imports the file directly
});

test('impact: a file nobody imports, and usage errors', async () => {
  const dir = repo();
  const orphan = await cli(dir, ['impact', 'src/lib/unused.ts']);
  assert.equal(orphan.code, 0);
  assert.match(orphan.stdout, /Imported by: nobody \(no importers in the graph\)/);
  assert.match(orphan.stdout, /Existing violations: none/);

  assert.equal((await cli(dir, ['impact'])).code, 2);
  assert.equal((await cli(dir, ['impact', 'a.ts', 'b.ts'])).code, 2);
  const missing = await cli(dir, ['impact', 'src/nope.ts']);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /"src\/nope\.ts" does not exist in the repo\./);
});
