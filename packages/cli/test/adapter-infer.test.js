import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAdapter, candidates } from '../src/adapter.js';
import { inferLayers, inferDomains, inferSubmodules, inferOwnedFolders, importsFromOutside, findOrphans } from '../src/init/infer.js';
import { tempDir } from './helpers.js';

const fakeAdapter = (pkgName, { contract = 1, exportsPkg = true, body } = {}) => ({
  [`node_modules/${pkgName}/package.json`]: {
    name: pkgName, version: '9.9.9', type: 'module', reins: { contract },
    exports: exportsPkg ? { '.': './index.js', './package.json': './package.json' } : { '.': './index.js' },
  },
  [`node_modules/${pkgName}/index.js`]: body ?? 'export default { name: "x", contract: 1, detect() { return true; }, graph() { return []; } };',
});

test('adapter: official scoped name first, then reins-adapter-<name>', async () => {
  assert.deepEqual(candidates('ruby'), ['@agentreins/adapter-ruby', 'reins-adapter-ruby']);
  const dir = tempDir(fakeAdapter('reins-adapter-x', { exportsPkg: false }));
  const r = await resolveAdapter(dir, 'x');
  assert.equal(r.packageName, 'reins-adapter-x');
  assert.equal(r.version, '9.9.9');
});

test('adapter: a different contract version is refused with the fix', async () => {
  const dir = tempDir(fakeAdapter('reins-adapter-x', { contract: 2 }));
  await assert.rejects(resolveAdapter(dir, 'x'), /implements adapter contract 2, but this version of reins needs contract 1/);
});

test('adapter: an invalid module is refused with every problem', async () => {
  const dir = tempDir(fakeAdapter('reins-adapter-x', { body: 'export default { name: "x", contract: 1 };' }));
  await assert.rejects(resolveAdapter(dir, 'x'), /not a valid reins adapter:\n {2}- "detect" must be a function\n {2}- "graph" must be a function/);
});

const edge = (from, to, kind = 'static') => ({ from, to, kind });
const presetLayers = [
  { name: 'pages', paths: ['src/pages/**'] },
  { name: 'components', paths: ['src/components/**'] },
  { name: 'features', paths: ['src/features/**'] },
  { name: 'shared', paths: ['src/lib/**', 'src/missing/**'] },
  { name: 'unused', paths: ['src/nothing/**'] },
];
const files = ['src/pages/a.js', 'src/components/b.js', 'src/features/x/c.js', 'src/features/x/d.js', 'src/lib/e.js', 'src/store/s.js', 'src/store/t.js', 'src/a.test.js', 'vite.config.js'];

test('layers: absent layers and globs are dropped; order follows the dominant import direction', () => {
  const edges = [
    edge('src/pages/a.js', 'src/features/x/c.js'),
    edge('src/features/x/c.js', 'src/components/b.js'),
    edge('src/features/x/d.js', 'src/components/b.js'),
    edge('src/components/b.js', 'src/features/x/c.js'), // minority, a violation
    edge('src/components/b.js', 'src/lib/e.js'),
    edge('src/lib/e.js', 'src/pages/a.js', 'type'), // type-only: not evidence
  ];
  const r = inferLayers(presetLayers, files, edges);
  assert.deepEqual(r.layers.map((l) => `${l.name}:${l.files}`), ['pages:1', 'features:2', 'components:1', 'shared:1']);
  assert.deepEqual(r.layers[3].paths, ['src/lib/**']);
  assert.deepEqual(r.pairs.find((p) => p.above === 'features' && p.below === 'components'), { above: 'features', below: 'components', down: 2, up: 1 });
  assert.deepEqual(r.unclassified, [{ folder: 'src/store', files: 2, importedBy: [], imports: [], fits: null }]);
  assert.deepEqual(r.conflicts, []);
});

test('layers: a loop in the dominant directions keeps the preset order and is reported', () => {
  const edges = [edge('src/pages/a.js', 'src/components/b.js'), edge('src/components/b.js', 'src/features/x/c.js'), edge('src/features/x/c.js', 'src/pages/a.js')];
  const r = inferLayers(presetLayers, files, edges);
  assert.equal(r.conflicts.length, 1);
  assert.match(r.conflicts[0], /form a loop/);
});

test('layers: an unclassified folder gets the lowest layer its imports allow, or none when they go both ways', () => {
  const preset = [
    { name: 'app', paths: ['src/app/**'] },
    { name: 'components', paths: ['src/components/**'] },
    { name: 'shared', paths: ['src/utils/**'] },
  ];
  const files = ['src/app/layout.js', 'src/app/page.js', 'src/components/Card.js', 'src/utils/fmt.js',
    'src/store/cart.js', 'src/providers/Theme.js', 'src/legacy/x.js'];
  const e = (from, to) => ({ from, to, kind: 'static' });
  const edges = [
    e('src/app/page.js', 'src/components/Card.js'), e('src/components/Card.js', 'src/utils/fmt.js'),
    e('src/components/Card.js', 'src/store/cart.js'), e('src/store/cart.js', 'src/utils/fmt.js'), // store: like utils
    e('src/app/layout.js', 'src/providers/Theme.js'), e('src/providers/Theme.js', 'src/components/Card.js'), // providers: above components
    e('src/legacy/x.js', 'src/app/page.js'), e('src/utils/fmt.js', 'src/legacy/x.js'), // both ways
  ];
  const r = inferLayers(preset, files, edges);
  const fit = Object.fromEntries(r.unclassified.map((u) => [u.folder, [u.fits, u.importedBy.join(','), u.imports.join(',')]]));
  assert.deepEqual(fit['src/store'], ['shared', 'components', 'shared']);
  assert.deepEqual(fit['src/providers'], ['components', 'app', 'components']);
  assert.deepEqual(fit['src/legacy'], [null, 'shared', 'app']);
});

test('domains: one per folder, public API from its index, missing index flagged, names deduplicated', () => {
  const d = inferDomains(['src/features/*', 'src/modules/*'], [
    'src/features/billing/index.ts', 'src/features/billing/tax.ts', 'src/features/search/Results.jsx', 'src/modules/billing/a.js', 'src/features/README.md',
  ]);
  assert.deepEqual(d.map((x) => [x.name, x.publicApi.join(','), x.missingIndex, x.files]), [
    ['billing', 'src/features/billing/index.ts', false, 2],
    ['search', 'src/features/search/index.js', true, 1],
    ['billing-2', 'src/modules/billing/index.js', true, 1],
  ]);
});

test('domains from routes: look through [param] and (group), skip catch-alls, private folders and lone files', () => {
  const files = [
    'src/app/layout.tsx', 'src/app/[lang]/layout.tsx', 'src/app/[lang]/flights/page.tsx', 'src/app/[lang]/flights/Row.tsx',
    'src/app/[lang]/flights/Row.test.tsx', 'src/app/[lang]/(search)/page.tsx', 'src/app/[lang]/(search)/results/page.tsx',
    'src/app/[lang]/(search)/results/Filters.tsx', 'src/app/[lang]/[...rest]/page.tsx',
    'src/app/[lang]/[[...opt]]/page.tsx', 'src/app/[lang]/_lib/x.ts', 'src/app/[lang]/_lib/y.ts', 'src/app/[lang]/[id]/edit/page.tsx', 'src/app/api/ping/route.ts',
    'src/app/[lang]/shared/util.ts', 'src/app/[lang]/trips/index.ts', 'src/app/[lang]/trips/List.tsx',
    'src/app/(main)/(legal)/terms/page.tsx',
  ];
  const small = [];
  const d = inferDomains(['src/app/*'], files, {
    routes: true,
    small,
    entries: ['src/app/[lang]/flights/page.tsx', 'src/app/[lang]/(search)/results/page.tsx', 'src/app/api/ping/route.ts', 'src/app/[lang]/[id]/edit/page.tsx'],
    edges: [{ from: 'src/app/[lang]/trips/List.tsx', to: 'src/app/[lang]/shared/util.ts' }],
  });
  assert.deepEqual(d.map((x) => [x.name, x.folder, x.publicApi.join(','), x.missingIndex, x.files]), [
    ['results', 'src/app/[lang]/(search)/results', 'src/app/[lang]/(search)/results/page.tsx', false, 2],
    ['flights', 'src/app/[lang]/flights', 'src/app/[lang]/flights/page.tsx', false, 2],
    ['trips', 'src/app/[lang]/trips', 'src/app/[lang]/trips/index.ts', false, 2],
  ]);
  assert.deepEqual(small, ['src/app/(main)/(legal)/terms', 'src/app/[lang]/[id]/edit', 'src/app/[lang]/shared', 'src/app/api']);
});

test('a route split across (groups) is one domain with several folders, and so are its parts', () => {
  const files = [
    'src/app/(companies)/companies/[slug]/page.js', 'src/app/(companies)/companies/[slug]/layout.js',
    'src/app/(companies)/companies/[slug]/salaries/page.js', 'src/app/(companies)/companies/[slug]/salaries/index.js',
    'src/app/(main)/companies/sizes/page.js', 'src/app/(main)/companies/sizes/index.js',
    'src/app/(main)/companies/funding-sources/page.js', 'src/app/(main)/companies/funding-sources/List.js',
    'src/app/(staticMain)/companies/salaries/x/page.js', 'src/app/(staticMain)/companies/salaries/x/Extra.js',
    'src/app/(main)/jobs/page.js', 'src/app/(main)/jobs/List.js',
  ];
  const d = inferDomains(['src/app/*'], files, { routes: true });
  assert.deepEqual(d.map((x) => [x.name, x.folders, x.paths]), [
    ['companies', ['src/app/(companies)/companies', 'src/app/(main)/companies', 'src/app/(staticMain)/companies'],
      ['src/app/(companies)/companies/**', 'src/app/(main)/companies/**', 'src/app/(staticMain)/companies/**']],
    ['jobs', ['src/app/(main)/jobs'], ['src/app/(main)/jobs/**']],
  ]);
  const { submodules } = inferSubmodules(d[0], files);
  assert.deepEqual(submodules.map((x) => [x.name, x.folders, x.files]), [
    ['companies/slug', ['src/app/(companies)/companies/[slug]'], 2],
    ['companies/salaries', ['src/app/(companies)/companies/[slug]/salaries'], 2],
    ['companies/funding-sources', ['src/app/(main)/companies/funding-sources'], 2],
    ['companies/sizes', ['src/app/(main)/companies/sizes'], 2],
    ['companies/salaries-2', ['src/app/(staticMain)/companies/salaries'], 2],
  ], 'salaries under [slug] and salaries under /companies are different URLs, so different parts');
});

test('a parameter folder that is a page itself is a part, covering only its own files', () => {
  const r = 'src/app/(emptyLayout)/rating';
  const files = [`${r}/[slug]/index.js`, `${r}/[slug]/page.js`, `${r}/success/index.js`, `${r}/success/page.js`, `${r}/re-rate/index.js`, `${r}/re-rate/page.js`];
  const { submodules } = inferSubmodules({ name: 'rating', folder: r }, files, { entries: [`${r}/[slug]/page.js`] });
  assert.deepEqual(submodules.map((x) => [x.name, x.paths, x.publicApi]), [
    ['rating/slug', [`${r}/[slug]/*`], [`${r}/[slug]/index.js`]],
    ['rating/re-rate', [`${r}/re-rate/**`], [`${r}/re-rate/index.js`]],
    ['rating/success', [`${r}/success/**`], [`${r}/success/index.js`]],
  ]);
});

test('owned folders: whole feature folders by imports, never split; shared code and the lowest layer stay out', () => {
  const route = (name) => ({ name, folder: `src/app/(main)/${name}`, paths: [`src/app/(main)/${name}/**`], publicApi: [`src/app/(main)/${name}/page.js`], missingIndex: false, files: 2, owned: [] });
  const domains = [route('companies'), route('jobs')];
  const C = 'src/app/(main)/companies/index.js';
  const J = 'src/app/(main)/jobs/index.js';
  const P = 'src/components/pages/companies';
  const files = [
    C, 'src/app/(main)/companies/page.js', J, 'src/app/(main)/jobs/page.js',
    // the companies feature, with subfolders and loose files; jobs imports one file of it once
    `${P}/OverviewPage/index.js`, `${P}/OverviewPage/Header.js`, `${P}/OverviewPage/content/Body.js`, `${P}/OverviewPage/faq/Faq.js`, `${P}/Tabs.js`,
    'src/components/pages/jobs/JobBoard.js', 'src/components/pages/jobs/JobRow.js',
    // shared on purpose: one of them used by companies only, today
    'src/components/shared/CircularProgress/index.js', 'src/components/shared/CircularProgress/Ring.js',
    'src/components/shared/Modal/index.js', 'src/components/shared/Modal/Body.js',
    'src/components/shared/Tooltip/index.js', 'src/components/shared/Tooltip/Arrow.js',
    // used only by an owned folder: follows it
    'src/components/widgets/Rating.js', 'src/components/widgets/Stars.js',
    // flat, any name, used by companies only: its note, not its rules
    'src/components/paginaContacto.js',
    // mostly jobs
    'src/components/jobs-list/List.js', 'src/components/jobs-list/Row.js',
    // lowest layer: shared by design
    'src/utils/vote.js', 'src/constants/dates.js',
  ];
  const e = (from, to) => ({ from, to });
  const edges = [
    e(C, `${P}/OverviewPage/index.js`), e(C, `${P}/Tabs.js`), e(`${P}/OverviewPage/index.js`, `${P}/OverviewPage/Header.js`),
    e(`${P}/OverviewPage/Header.js`, `${P}/OverviewPage/content/Body.js`), e(`${P}/OverviewPage/Header.js`, `${P}/OverviewPage/faq/Faq.js`),
    e(J, `${P}/Tabs.js`),
    e(J, 'src/components/pages/jobs/JobBoard.js'), e('src/components/pages/jobs/JobBoard.js', 'src/components/pages/jobs/JobRow.js'),
    e(`${P}/Tabs.js`, 'src/components/shared/CircularProgress/index.js'), e('src/components/shared/CircularProgress/index.js', 'src/components/shared/CircularProgress/Ring.js'),
    e(C, 'src/components/shared/Modal/index.js'), e(J, 'src/components/shared/Modal/index.js'),
    e(C, 'src/components/shared/Tooltip/index.js'), e(J, 'src/components/shared/Tooltip/index.js'),
    e(`${P}/OverviewPage/Header.js`, 'src/components/widgets/Rating.js'), e('src/components/widgets/Rating.js', 'src/components/widgets/Stars.js'),
    e(C, 'src/components/paginaContacto.js'),
    e(J, 'src/components/jobs-list/List.js'), e(J, 'src/components/jobs-list/Row.js'), e('src/app/(main)/jobs/page.js', 'src/components/jobs-list/Row.js'), e(C, 'src/components/jobs-list/Row.js'),
    e(`${P}/Tabs.js`, 'src/utils/vote.js'), e(C, 'src/constants/dates.js'),
  ];
  const layers = [{ paths: ['src/app/**'] }, { paths: ['src/components/**'] }, { paths: ['src/{utils,constants}/**'] }];
  const { doubtful } = inferOwnedFolders(domains, files, edges, layers);
  assert.deepEqual(domains[0].owned.map((o) => [o.folder, o.files, o.imports, o.total]), [
    [P, 5, 2, 3],
    ['src/components/widgets', 2, 1, 1],
  ], 'companies/ whole (OverviewPage and its subfolders included, not one by one), even with an import from jobs');
  assert.deepEqual(domains[1].owned.map((o) => o.folder), ['src/components/pages/jobs']);
  assert.deepEqual(domains[0].loose, ['src/components/paginaContacto.js']);
  assert.ok(!domains.some((d) => d.paths.some((p) => /shared|utils|constants/.test(p))), 'shared code stays out');
  assert.deepEqual(doubtful, [{ folder: 'src/components/jobs-list', domain: 'jobs', share: 0.75, imports: 3 }]);
  assert.equal(importsFromOutside(domains[0], edges), 1, 'the jobs import into companies/ is now outside companies');
});

test('orphans: not imported, not entries, not tests, not config, not .d.ts', () => {
  const o = findOrphans(
    ['src/a.js', 'src/b.js', 'src/page.js', 'src/a.test.js', 'vite.config.js', 'src/env.d.ts', 'src/c.ts'],
    ['src/page.js'],
    [{ from: 'src/a.js', to: 'src/b.js' }],
  );
  assert.deepEqual(o, ['src/a.js', 'src/c.ts']);
});

test('sub-modules of a route domain: follow single folders and [param], one per folder with 2+ source files', () => {
  const base = 'src/app/(companies)/companies/[slug]';
  const files = [
    `${base}/index.js`, `${base}/layout.js`, `${base}/page.js`,
    `${base}/culture/index.js`, `${base}/culture/page.js`, `${base}/culture/culture.module.scss`,
    `${base}/questions/index.js`, `${base}/questions/page.js`, `${base}/questions/[question_slug]/page.js`,
    `${base}/salaries/[...role]/page.js`, `${base}/salaries/countries/page.js`, `${base}/salaries/countries/List.js`,
    `${base}/benefits/page.js`, `${base}/benefits/page.test.js`,
    `${base}/_lib/a.js`, `${base}/_lib/b.js`,
  ];
  const used = new Set(['companies', 'companies/culture']);
  const { submodules, more } = inferSubmodules({ name: 'companies', folder: 'src/app/(companies)' }, files, { entries: [`${base}/culture/page.js`], used });
  assert.deepEqual(submodules.map((s) => [s.name, s.folder, s.files, s.publicApi.join(',')]), [
    ['companies/slug', base, 3, `${base}/index.js`],
    ['companies/culture-2', `${base}/culture`, 2, `${base}/culture/index.js`],
    ['companies/questions', `${base}/questions`, 3, `${base}/questions/index.js`],
    ['companies/salaries', `${base}/salaries`, 3, `${base}/salaries/index.js`],
  ]);
  assert.deepEqual(more, []);
  assert.ok(used.has('companies/salaries'));

  const capped = inferSubmodules({ name: 'companies', folder: 'src/app/(companies)' }, files, { max: 2 });
  assert.deepEqual(capped.submodules.map((s) => s.name), ['companies/slug', 'companies/questions']);
  assert.deepEqual(capped.more, [`${base}/salaries`, `${base}/culture`]);
  assert.deepEqual(inferSubmodules({ name: 'jobs', folder: 'src/app/jobs' }, ['src/app/jobs/page.js', 'src/app/jobs/list/a.js', 'src/app/jobs/list/b.js']).submodules, []);
});
