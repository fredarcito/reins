import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prStructure, nodeResolver, staticPrefix, renderPrMap } from '@agentreins/core';

// Config: two domains inside the `features` layer, `routes` and `shared` layers without domains.
const config = {
  ignore: ['**/*.gen.ts'],
  layers: [
    { name: 'routes', paths: ['src/app/**'] },
    { name: 'features', paths: ['src/features/**'] },
    { name: 'shared', paths: ['src/shared/**'] },
  ],
  domains: [
    { name: 'billing', paths: ['src/features/billing/**'], publicApi: ['src/features/billing/index.ts'] },
    { name: 'profile', paths: ['src/features/profile/**'], publicApi: ['src/features/profile/index.ts'] },
  ],
};
const e = (from, to, kind = 'static') => ({ from, to, kind });
const m = (path, status = 'M', oldPath) => ({ path, status, ...(oldPath ? { oldPath } : {}) });
const B = 'src/features/billing/', P = 'src/features/profile/';
const run = (over = {}) => prStructure({
  baseEdges: [], headEdges: [], changed: [], config, baseDomainNames: ['billing', 'profile'], newViolations: [], impacts: [],
  base: { label: 'main', sha: 'abc1234' }, ...over,
});
const statusOf = (model, from, to) => model.edges.find((x) => x.from === from && x.to === to)?.status;

test('4.1 node of a file: domain, then a layer without domains, else a no-domain folder (two levels under the layer root)', () => {
  const nodeOf = nodeResolver(config, [`${B}a.ts`, `${P}b.ts`, 'src/features/digest/ui/Card.tsx', 'src/app/page.tsx']);
  assert.equal(nodeOf(`${B}a.ts`)?.name, 'billing');
  assert.equal(nodeOf('src/app/page.tsx')?.name, 'routes');
  assert.deepEqual(nodeOf('src/shared/x.ts'), { name: 'shared', kind: 'layer', prefix: 'src/shared' });
  // `features` has domains inside: its other files are grouped by folder, at most 2 levels under `src/features`
  assert.equal(nodeOf('src/features/digest/ui/Card.tsx')?.name, 'src/features/digest/ui');
  assert.equal(nodeOf('src/features/digest/ui/Card.tsx')?.kind, 'nodomain');
  assert.equal(nodeOf('src/features/loose.ts')?.name, 'src/features');
  assert.equal(nodeOf('scripts/tool.ts'), null, 'outside every layer: not a node');
  assert.equal(nodeOf('README.md'), null);
  assert.equal(nodeOf('src/app/types.gen.ts'), null, 'ignored files are never nodes');
});

test('4.1 static prefix of a glob', () => {
  assert.equal(staticPrefix('src/features/**'), 'src/features');
  assert.equal(staticPrefix('packages/*/src/**'), 'packages');
  assert.equal(staticPrefix('**/*.ts'), '');
});

test('4.2 changed files: a rename touches both paths, a deletion only the base side, ignored files nothing', () => {
  const model = run({
    changed: [m(`${B}new.ts`, 'R', `${P}old.ts`), m(`${B}gone.ts`, 'D'), m('src/app/types.gen.ts', 'A')],
  });
  const byName = Object.fromEntries(model.nodes.map((n) => [n.name, n]));
  assert.equal(byName.billing.status, 'touched');
  assert.equal(byName.profile.status, 'touched', 'the old path of a rename touches its old node');
  assert.equal(byName.billing.changed, 2);
  assert.equal(byName.profile.changed, 1);
  assert.equal(model.fileCount, 2, 'the ignored file is not counted');
  assert.deepEqual(byName.billing.sample, ['new.ts', 'gone.ts'], 'names are relative to the domain folder');
});

test('4.3 edges: unchanged, new, removed; same-node imports and several imports of one pair collapse', () => {
  const shared = e('src/shared/a.ts', `${B}x.ts`);
  const model = run({
    baseEdges: [shared, e(`${P}a.ts`, 'src/shared/old.ts'), e(`${P}a.ts`, `${P}b.ts`)],
    headEdges: [shared, e(`${P}a.ts`, 'src/shared/new.ts'), e(`${P}b.ts`, 'src/shared/new.ts', 'type'), e(`${P}a.ts`, `${P}b.ts`)],
    changed: [m(`${P}a.ts`), m(`${P}b.ts`)],
  });
  assert.equal(statusOf(model, 'shared', 'billing'), undefined, 'unchanged edges are not reported');
  assert.equal(statusOf(model, 'profile', 'shared'), undefined, 'profile → shared exists in base and head');
  const m2 = run({ baseEdges: [], headEdges: [e(`${P}a.ts`, `${P}b.ts`), e(`${P}a.ts`, 'src/shared/n.ts'), e(`${P}b.ts`, 'src/shared/n.ts', 'type')], changed: [m(`${P}a.ts`)] });
  const edge = m2.edges.find((x) => x.from === 'profile' && x.to === 'shared');
  assert.equal(edge.status, 'new');
  assert.equal(edge.pairs.length, 2, 'both file imports are kept as examples, kinds merged');
  assert.equal(m2.edges.length, 1, 'profile → profile is not an edge');
  const m3 = run({ baseEdges: [e(`${P}a.ts`, 'src/shared/old.ts')], headEdges: [], changed: [m(`${P}a.ts`)] });
  assert.deepEqual(m3.edges.map((x) => [x.from, x.to, x.status]), [['profile', 'shared', 'removed']]);
});

test('4.3 the shortcut: base edges = head edges whose importer is unchanged + base edges whose importer changed', () => {
  const changed = [m(`${P}a.ts`)];
  const headEdges = [e('src/app/page.tsx', `${P}index.ts`), e(`${P}a.ts`, `${B}index.ts`)];
  const baseOfChangedFile = [e(`${P}a.ts`, 'src/shared/s.ts')];
  const baseEdges = [...headEdges.filter((x) => x.from !== `${P}a.ts`), ...baseOfChangedFile];
  const model = run({ baseEdges, headEdges, changed });
  assert.deepEqual(model.edges.map((x) => `${x.from}→${x.to}:${x.status}`), ['profile→billing:new', 'profile→shared:removed']);
});

test('4.3 forbidden: a new edge with a new violation on that node pair', () => {
  const v = { rule: 'domain-boundary', from: `${P}a.ts`, to: `${B}internal/p.ts`, message: 'm', fix: 'f' };
  const model = run({ headEdges: [e(`${P}a.ts`, `${B}internal/p.ts`)], changed: [m(`${P}a.ts`)], newViolations: [v] });
  assert.deepEqual(model.edges.map((x) => [x.status, x.rule]), [['forbidden', 'domain-boundary']]);
  assert.equal(model.violations.length, 1);
});

test('4.3 mutual: a new edge whose reverse exists in head (new or not); a pair already mutual in base is not reported', () => {
  const both = run({ headEdges: [e(`${P}a.ts`, `${B}index.ts`), e(`${B}b.ts`, `${P}index.ts`)], changed: [m(`${P}a.ts`), m(`${B}b.ts`)] });
  assert.deepEqual(both.edges.map((x) => `${x.from}→${x.to}:${x.status}`), ['billing→profile:mutual', 'profile→billing:mutual']);
  assert.equal(both.mutual.length, 1);
  assert.deepEqual([both.mutual[0].a, both.mutual[0].b], ['billing', 'profile']);
  const oldReverse = run({ baseEdges: [e(`${B}b.ts`, `${P}index.ts`)], headEdges: [e(`${P}a.ts`, `${B}index.ts`), e(`${B}b.ts`, `${P}index.ts`)], changed: [m(`${P}a.ts`)] });
  assert.deepEqual(oldReverse.edges.map((x) => `${x.from}→${x.to}:${x.status}`).sort(), ['billing→profile:mutual', 'profile→billing:mutual']);
  const already = run({
    baseEdges: [e(`${P}a.ts`, `${B}index.ts`), e(`${B}b.ts`, `${P}index.ts`)],
    headEdges: [e(`${P}a.ts`, `${B}index.ts`), e(`${B}b.ts`, `${P}index.ts`)], changed: [m(`${P}a.ts`)],
  });
  assert.equal(already.mutual.length, 0);
  assert.equal(already.edges.length, 0);
});

test('4.3 a cycle that makes no-cycles fire is forbidden, not mutual', () => {
  const v = { rule: 'no-cycles', from: `${P}a.ts`, files: [`${P}a.ts`, `${B}b.ts`], message: 'm', fix: 'f' };
  const model = run({ headEdges: [e(`${P}a.ts`, `${B}b.ts`), e(`${B}b.ts`, `${P}a.ts`)], changed: [m(`${P}a.ts`)], newViolations: [v] });
  assert.ok(model.edges.every((x) => x.status === 'forbidden'));
  assert.equal(model.mutual.length, 0);
});

test('4.4 touched, affected (direct importers, a file once), new and removed domains', () => {
  const model = run({
    config: { ...config, domains: [...config.domains.filter((d) => d.name !== 'profile'), { name: 'search', paths: ['src/features/search/**'], publicApi: [] }] },
    changed: [m(`${B}a.ts`), m(`${B}b.ts`)],
    impacts: [
      { file: `${B}a.ts`, importers: ['src/app/page.tsx', 'src/app/other.tsx', `${B}b.ts`] },
      { file: `${B}b.ts`, importers: ['src/app/page.tsx', 'src/features/search/q.ts'] }, // page.tsx again: counted once
    ],
  });
  const byName = Object.fromEntries(model.nodes.map((n) => [n.name, n]));
  assert.equal(byName.billing.status, 'touched');
  assert.equal(byName.routes.status, 'affected');
  assert.equal(byName.routes.importers, 2);
  assert.equal(byName.search.importers, 1);
  assert.equal(model.affectedFiles, 3);
  assert.deepEqual(model.newDomains.map((d) => d.name), ['search']);
  assert.deepEqual(model.removedDomains, ['profile']);
  assert.equal(byName.search.status, 'affected', 'a new domain nobody changed a file of is not "new" in the nodes unless it has files');
  assert.deepEqual(model.edges.filter((x) => x.status === 'affected').map((x) => `${x.from}→${x.to}`), ['routes→billing', 'search→billing']);
});

test('4.5 structural change: only a new/removed domain, no-domain folder, edge, mutual pair or violation make the full form', () => {
  assert.equal(run({ changed: [m(`${B}a.ts`)], impacts: [{ file: `${B}a.ts`, importers: ['src/app/p.tsx'] }] }).form, 'short');
  assert.equal(run({ baseEdges: [e(`${B}a.ts`, `${B}b.ts`)], headEdges: [e(`${B}a.ts`, `${B}b.ts`)], changed: [m('src/features/digest/a.ts')] }).form, 'full');
  assert.equal(run({ baseDomainNames: ['billing'] , changed: []}).form, 'full');
  assert.equal(run({ baseDomainNames: ['billing', 'profile', 'gone'] }).form, 'full');
  assert.equal(run({ headEdges: [e(`${B}a.ts`, 'src/shared/s.ts')], changed: [m(`${B}a.ts`)] }).form, 'full');
  assert.equal(run({ changed: [m(`${B}a.ts`)], newViolations: [{ rule: 'x', from: `${B}a.ts`, message: 'm', fix: 'f' }] }).form, 'full');
});

test('base = HEAD: the same graph on both sides and no new violations is the short form with no edges', () => {
  const edges = [e(`${P}a.ts`, `${B}index.ts`), e('src/app/page.tsx', `${P}index.ts`)];
  const model = run({ baseEdges: edges, headEdges: edges, changed: [] });
  assert.equal(model.form, 'short');
  assert.equal(model.edges.length, 0);
  assert.equal(model.fileCount, 0);
});

test('4.2 files the adapter does not analyze are not nodes: they are counted apart', () => {
  const model = run({ changed: [m(`${B}a.ts`), m('docs/guide.md'), m('src/features/other/b.ts', 'D'), m('src/app/types.gen.ts')], analyzed: [`${B}a.ts`] });
  assert.equal(model.fileCount, 1);
  assert.equal(model.notAnalyzed, 2, 'the ignored file is silent, the others are counted');
  assert.deepEqual(model.nodes.map((n) => n.name), ['billing']);
  assert.equal(model.form, 'short');
});

test('4.1 a file outside every layer is not a node and not a structural change: the short form counts it apart', () => {
  const model = run({
    baseEdges: [e(`${B}a.ts`, `${B}b.ts`)], headEdges: [e(`${B}a.ts`, `${B}b.ts`)],
    changed: [m(`${B}a.ts`), m('packages/core/test/x.test.js', 'A'), m('packages/cli/test/y.test.js', 'A'), m('scripts/z.mjs')],
    analyzed: [`${B}a.ts`, `${B}b.ts`, 'packages/core/test/x.test.js', 'packages/cli/test/y.test.js', 'scripts/z.mjs'],
  });
  assert.equal(model.form, 'short');
  assert.equal(model.outsideLayers, 3);
  assert.equal(model.notAnalyzed, 0);
  assert.deepEqual(model.nodes.map((n) => n.name), ['billing']);
  const text = renderPrMap(model);
  assert.match(text, /\*\*No structural changes\*\*/);
  assert.match(text, /· 4 files \(3 not on the map: they don't change the architecture\)<\/sub>/);
  assert.doesNotMatch(text, /outside architecture\.yml/);
});

test('4.2 a deleted file and the old path of a rename are placed with the base config: a removed domain is not "not in architecture.yml"', () => {
  const baseConfig = { ...config, domains: [...config.domains, { name: 'legacy', paths: ['src/features/legacy/**'], publicApi: [] }] };
  const model = run({
    baseConfig, baseDomainNames: ['billing', 'profile', 'legacy'],
    baseEdges: [e(`${B}a.ts`, `${B}b.ts`)], headEdges: [e(`${B}a.ts`, `${B}b.ts`)],
    changed: [m('src/features/legacy/old.ts', 'D'), m(`${B}moved.ts`, 'R', 'src/features/legacy/moved.ts')],
  });
  const byName = Object.fromEntries(model.nodes.map((n) => [n.name, n]));
  assert.equal(byName.legacy.status, 'touched');
  assert.equal(byName.legacy.changed, 2);
  assert.ok(!model.nodes.some((n) => n.status === 'nodomain'));
  assert.deepEqual(model.removedDomains, ['legacy']);
  assert.equal(model.form, 'full');
});

test('4.3 a new violation on a pair that already had an edge makes that edge forbidden', () => {
  const edge = e(`${P}a.ts`, `${B}index.ts`);
  const v = { rule: 'domain-boundary', from: `${P}c.ts`, to: `${B}internal/p.ts`, message: 'm', fix: 'f' };
  const model = run({ baseEdges: [edge], headEdges: [edge, e(`${P}c.ts`, `${B}internal/p.ts`)], changed: [m(`${P}c.ts`)], newViolations: [v] });
  assert.deepEqual(model.edges.map((x) => [x.from, x.to, x.status, x.rule]), [['profile', 'billing', 'forbidden', 'domain-boundary']]);
  assert.equal(model.form, 'full');
});

test('an untouched no-domain endpoint keeps its kind', () => {
  const model = run({
    headEdges: [e(`${P}a.ts`, 'src/features/loose/x.ts'), e(`${B}a.ts`, `${B}b.ts`)], changed: [m(`${P}a.ts`)],
  });
  const loose = model.nodes.find((n) => n.name === 'src/features/loose');
  assert.equal(loose.status, 'unchanged');
  assert.equal(loose.kind, 'nodomain');
});
