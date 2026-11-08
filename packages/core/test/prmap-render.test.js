import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderPrMap, MAX_COMMENT_CHARS } from '@agentreins/core';

const example = (name) => readFileSync(fileURLToPath(new URL(`../../../docs/proposals/pr-map-examples/${name}.md`, import.meta.url)), 'utf8');

// Model inputs equal to the (invented) data behind the three examples in docs/proposals/pr-map-examples/.
const pad = (first, n) => [...first, ...Array.from({ length: Math.max(0, n - first.length) }, (_, i) => `f${i}.ts`)];
const node = (name, status, changed = 0, sample = [], importers = 0) => ({ name, status, changed, importers, sample: pad(sample, changed) });
const edge = (from, to, status, fromFile, toFile, extra = {}) => ({ from, to, status, pairs: fromFile ? [{ from: fromFile, to: toFile }] : [], ...extra });
const base = (label, sha) => ({ label, sha });

const SHORT = {
  form: 'short', base: base('main', '7b41d02'), fileCount: 4, newDomains: [], removedDomains: [], mutual: [], violations: [], affectedFiles: 12,
  nodes: [node('billing', 'touched', 4, ['invoice/totals.ts', 'invoice/round.ts', 'invoice/totals.test.ts', 'invoice/x.ts']), node('jobs', 'affected', 0, [], 12)],
  edges: [edge('jobs', 'billing', 'affected')],
};

const SMALL = {
  form: 'full', base: base('main', '9a1e07b'), fileCount: 23, removedDomains: [], affectedFiles: 12, mutual: [],
  newDomains: [{ name: 'notifications', paths: ['src/features/notifications/**'] }],
  violations: [{ rule: 'domain-boundary', message: '`profile/PlanBadge.tsx` imports `billing/internal/plans.ts`.', fix: "Import from billing's public API (`billing/index.ts`) instead." }],
  nodes: [
    node('notifications', 'new', 10, ['index.ts', 'send.ts', 'preferences.ts']),
    node('billing', 'touched', 6, ['changePlan.ts', 'index.ts', 'plans.ts']),
    node('profile', 'touched', 3, ['PlanBadge.tsx', 'format.ts', 'Settings.tsx']),
    node('jobs', 'affected', 0, [], 12),
    node('src/features/digest', 'nodomain', 4),
    ...['api-client', 'routes', 'ui', 'utils'].map((n) => node(n, 'unchanged')),
  ],
  edges: [
    edge('billing', 'notifications', 'new', 'billing/changePlan.ts', 'notifications/index.ts'),
    edge('notifications', 'api-client', 'new', 'notifications/send.ts', 'api-client/index.ts'),
    edge('profile', 'notifications', 'new', 'profile/Settings.tsx', 'notifications/index.ts'),
    edge('routes', 'notifications', 'new', 'app/settings/notifications/page.tsx', 'notifications/index.ts'),
    edge('src/features/digest', 'ui', 'new', 'src/features/digest/DigestCard.tsx', 'ui/index.ts'),
    edge('profile', 'utils', 'removed', 'profile/format.ts', 'utils/index.ts'),
    edge('profile', 'billing', 'forbidden', 'profile/PlanBadge.tsx', 'billing/internal/plans.ts', { rule: 'domain-boundary' }),
    edge('jobs', 'billing', 'affected'),
  ],
};

const t = (name, n, first) => node(name, 'touched', n, first);
const LARGE = {
  form: 'full', base: base('main', 'c08e5d4'), fileCount: 142, removedDomains: [], affectedFiles: 64,
  newDomains: [{ name: 'invoices', paths: ['src/features/invoices/**'] }, { name: 'session', paths: ['src/features/session/**'] }],
  violations: [
    { rule: 'domain-boundary', message: '`invoices/totals.ts` imports `billing/internal/tax.ts`.', fix: "Import from billing's public API (`billing/index.ts`) instead." },
    { rule: 'layer-direction', message: '`shared/ui/SessionBadge.tsx` imports `session/current.ts`.', fix: 'Shared code must not depend on a feature: pass the session in as a prop.' },
  ],
  mutual: [{ a: 'reviews', b: 'session', ab: { from: 'reviews/ReviewForm.tsx', to: 'session/index.ts' }, ba: { from: 'session/SessionGate.tsx', to: 'reviews/ReviewPrompt.tsx' } }],
  nodes: [
    node('invoices', 'new', 22, ['index.ts', 'totals.ts', 'pdf.ts']),
    node('session', 'new', 18, ['index.ts', 'current.ts', 'refresh.ts']),
    t('routes', 14, ['app/layout.tsx', 'app/(auth)/login/page.tsx', 'app/billing/invoices/page.tsx']),
    t('billing', 12, ['checkout.ts', 'index.ts', 'charge.ts']),
    t('auth', 9, ['login.ts', 'token.ts', 'index.ts']),
    t('jobs', 8, ['JobList.tsx', 'query.ts', 'index.ts']),
    t('admin', 7, ['Billing.tsx', 'Users.tsx', 'index.ts']),
    t('profile', 6, ['useUser.ts', 'Profile.tsx', 'index.ts']),
    t('reviews', 5, ['ReviewForm.tsx', 'ReviewList.tsx', 'index.ts']),
    t('ui', 3, ['SessionBadge.tsx', 'index.ts', 'Avatar.tsx']),
    ...[6, 6, 6, 5, 5, 5, 5].map((n, i) => t(`quiet${i}`, n, [])),
    ...[['search', 18], ['settings', 14], ['reports', 11], ['onboarding', 9], ['messages', 6], ['notifications', 4], ['analytics', 2]].map(([n, c]) => node(n, 'affected', 0, [], c)),
    node('api-client', 'unchanged'), node('legacy-api', 'unchanged'),
  ],
  edges: [
    edge('admin', 'invoices', 'new', 'admin/Billing.tsx', 'invoices/index.ts'),
    edge('auth', 'session', 'new', 'auth/login.ts', 'session/index.ts'),
    edge('billing', 'invoices', 'new', 'billing/checkout.ts', 'invoices/index.ts'),
    edge('invoices', 'api-client', 'new', 'invoices/fetch.ts', 'api-client/index.ts'),
    edge('invoices', 'ui', 'new', 'invoices/InvoiceTable.tsx', 'ui/index.ts'),
    edge('jobs', 'session', 'new', 'jobs/JobList.tsx', 'session/index.ts'),
    edge('profile', 'session', 'new', 'profile/useUser.ts', 'session/index.ts'),
    edge('routes', 'invoices', 'new', 'app/billing/invoices/page.tsx', 'invoices/index.ts'),
    { ...edge('routes', 'session', 'new', 'app/layout.tsx', 'session/index.ts'), pairs: ['app/layout.tsx', 'app/a.tsx', 'app/b.tsx', 'app/c.tsx'].map((f) => ({ from: f, to: 'session/index.ts' })) },
    edge('session', 'api-client', 'new', 'session/refresh.ts', 'api-client/index.ts'),
    edge('reviews', 'session', 'mutual', 'reviews/ReviewForm.tsx', 'session/index.ts'),
    edge('session', 'reviews', 'mutual', 'session/SessionGate.tsx', 'reviews/ReviewPrompt.tsx'),
    edge('admin', 'billing', 'removed', 'admin/Billing.tsx', 'billing/index.ts'),
    edge('auth', 'legacy-api', 'removed', 'auth/token.ts', 'legacy-api/index.ts'),
    edge('billing', 'legacy-api', 'removed', 'billing/charge.ts', 'legacy-api/index.ts'),
    edge('jobs', 'auth', 'removed', 'jobs/JobList.tsx', 'auth/index.ts'),
    edge('profile', 'auth', 'removed', 'profile/useUser.ts', 'auth/index.ts'),
    edge('reviews', 'auth', 'removed', 'reviews/ReviewForm.tsx', 'auth/index.ts'),
    edge('invoices', 'billing', 'forbidden', 'invoices/totals.ts', 'billing/internal/tax.ts', { rule: 'domain-boundary' }),
    edge('ui', 'session', 'forbidden', 'shared/ui/SessionBadge.tsx', 'session/current.ts', { rule: 'layer-direction' }),
  ],
};

for (const [name, model] of [['short', SHORT], ['small', SMALL], ['large', LARGE]]) {
  test(`render: ${name} equals docs/proposals/pr-map-examples/${name}.md`, () => {
    assert.equal(renderPrMap(model), example(name));
  });
}

test('render: ids are n1, n2… and names are escaped only inside labels', () => {
  const model = {
    ...SHORT,
    nodes: [node('end', 'touched', 2, ['a.ts']), node('api-client', 'touched', 1, ['b.ts']), node('app/(auth)/[id]', 'touched', 1, ['c.ts']), node('say "hi" `x`', 'touched', 1, ['d.ts'])],
    edges: [edge('end', 'api-client', 'new', 'a.ts', 'b.ts'), edge('end', 'app/(auth)/[id]', 'new', 'a.ts', 'c.ts'), edge('end', 'say "hi" `x`', 'new', 'a.ts', 'd.ts')], form: 'full',
  };
  const text = renderPrMap(model);
  assert.match(text, /n3\("`\*\*end\*\*\n  2 files changed`"\):::touched/);
  assert.match(text, /\*\*app\/\(auth\)\/\[id\]\*\*/);
  assert.match(text, /\*\*say #quot;hi#quot; #96;x#96;\*\*/);
  assert.match(text, /n3 --> n1\n  n3 --> n2\n  n3 --> n4/);
  assert.doesNotMatch(text, /--> end|end -->/);
});

test('render: more than 20 structural edges skips the map and says so; the diff and Details stay', () => {
  const edges = Array.from({ length: 21 }, (_, i) => edge(`a${String(i).padStart(2, '0')}`, 'z', 'new', `a${i}.ts`, 'z.ts'));
  const text = renderPrMap({ ...LARGE, edges, violations: [], mutual: [] });
  assert.doesNotMatch(text, /```mermaid/);
  assert.doesNotMatch(text, /Boxes:/);
  assert.match(text, /<sub>Map skipped: 21 structural changes\. Consider splitting this PR\.<\/sub>/);
  assert.match(text, /```diff/);
  assert.match(text, /<summary><b>Details<\/b>/);
});

test('render: the diff keeps 40 lines and "… N more in Details" is true: Details lists every change', () => {
  const edges = Array.from({ length: 60 }, (_, i) => edge(`a${String(i).padStart(2, '0')}`, 'z', 'new', `a${i}.ts`, 'z.ts'));
  const text = renderPrMap({ ...SMALL, nodes: [node('z', 'unchanged')], edges, violations: [], newDomains: [], form: 'full' });
  assert.match(text, /… 20 more in Details/);
  assert.equal(text.match(/\| New dependency \|/g).length, 60);
  assert.doesNotMatch(text, /one row per/);
});

test('render: over 150 Details rows the rest is grouped per kind, and the diff no longer points at Details', () => {
  const edges = Array.from({ length: 200 }, (_, i) => edge(`a${String(i).padStart(3, '0')}`, 'z', 'new', `a${i}.ts`, 'z.ts'));
  const text = renderPrMap({ ...SMALL, nodes: [node('z', 'unchanged')], edges, violations: [], newDomains: [], form: 'full' });
  assert.match(text, /… one row per new dependency \(50\)/);
  assert.match(text, /… 160 more not listed/);
  assert.doesNotMatch(text, /more in Details/);
});

test('render: an untouched folder outside the domains keeps its dashed look on the map', () => {
  const model = { ...SHORT, form: 'full', nodes: [node('billing', 'touched', 1, ['a.ts']), { ...node('src/features/old', 'unchanged'), kind: 'nodomain' }], edges: [edge('billing', 'src/features/old', 'new', 'a.ts', 'src/features/old/x.ts')] };
  const text = renderPrMap(model);
  assert.match(text, /\*\*src\/features\/old\*\*\n  not in architecture\.yml`"\):::nodomain/);
  assert.match(text, /⬚ Not in architecture\.yml/);
  assert.doesNotMatch(text, /⬜ Unchanged/);
});

test('render: no analyzed code files means no map and "No code changes"', () => {
  const model = { ...SHORT, fileCount: 0, notAnalyzed: 3, outsideLayers: 1, nodes: [], edges: [], affectedFiles: 0 };
  const text = renderPrMap(model);
  assert.match(text, /\*\*No code changes\*\*/);
  assert.doesNotMatch(text, /```mermaid|Boxes:|Files by domain/);
  assert.match(text, /· 4 files \(4 not on the map: they don't change the architecture\)</);
});

test('render: a map without edges is drawn top to bottom, so the boxes sit in one row', () => {
  const model = { ...SHORT, nodes: [node('cli', 'touched', 5, ['a.ts']), node('core', 'touched', 4, ['b.ts'])], edges: [], affectedFiles: 0, fileCount: 9 };
  const text = renderPrMap(model);
  assert.match(text, /\nflowchart TB\n/);
  assert.doesNotMatch(text, /flowchart LR/);
  assert.match(renderPrMap(SMALL), /\nflowchart LR\n/, 'with edges the map stays left to right');
});

test('render: the short form never draws more than 8 touched boxes', () => {
  const touched = Array.from({ length: 12 }, (_, i) => node(`t${String(i).padStart(2, '0')}`, 'touched', 20 - i, ['a.ts']));
  const model = { ...SHORT, nodes: [...touched, node('jobs', 'affected', 0, [], 3)], edges: [edge('jobs', 't11', 'affected'), edge('jobs', 't00', 'affected')], fileCount: 100 };
  const text = renderPrMap(model);
  assert.equal(text.match(/:::touched/g).length, 8);
  assert.match(text, /\+ 4 more touched/);
  assert.doesNotMatch(text, /t11\*\*/, 'a ninth box is not drawn just to hold an edge');
});

test('render: truncation cuts on a line boundary and closes the open fence and details', () => {
  const huge = 'x'.repeat(70_000);
  const model = { ...SMALL, violations: [{ rule: 'domain-boundary', message: huge, fix: 'f' }] };
  const text = renderPrMap(model);
  assert.ok(text.length <= MAX_COMMENT_CHARS);
  assert.equal((text.match(/^```/gm) ?? []).length % 2, 0, 'fences are balanced');
  assert.equal(text.match(/<details>/g)?.length ?? 0, text.match(/<\/details>/g)?.length ?? 0);
  assert.match(text, /comment truncated/);
  const cutLine = text.split('\n').find((l) => l.startsWith('> **domain-boundary:**'));
  assert.ok(!cutLine || cutLine.length < 70_000, 'the giant line is dropped whole, not cut in the middle');
});

test('render: a synthetic PR of 300 domains stays under the size limit', () => {
  const names = Array.from({ length: 300 }, (_, i) => `domain-${String(i).padStart(3, '0')}`);
  const model = {
    form: 'full', base: base('main', 'abc1234'), fileCount: 3000, removedDomains: names.slice(0, 50), affectedFiles: 900, mutual: [],
    newDomains: names.map((name) => ({ name, paths: [`src/${name}/**`, `lib/${name}/**`] })),
    violations: names.map((n) => ({ rule: 'domain-boundary', message: `\`src/${n}/a.ts\` imports \`src/other/internal/${n}.ts\`.`, fix: 'Import from the public API instead. '.repeat(3) })),
    nodes: [...names.map((n) => node(n, 'new', 10, ['a.ts', 'b.ts', 'c.ts'])), ...names.map((n) => node(`touched-${n}`, 'touched', 5, ['a.ts'])), ...names.map((n) => node(`aff-${n}`, 'affected', 0, [], 3))],
    edges: names.flatMap((n) => [edge(n, 'core', 'new', `src/${n}/a.ts`, 'src/core/index.ts'), edge(`touched-${n}`, n, 'removed', `src/touched-${n}/a.ts`, `src/${n}/a.ts`)]),
  };
  const text = renderPrMap(model);
  assert.ok(text.length <= MAX_COMMENT_CHARS, `${text.length} chars`);
  assert.ok(text.startsWith('<!-- reins:pr-map -->'));
  assert.match(text, /Map skipped/);
});
