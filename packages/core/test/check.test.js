import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseConfig, runCheck, evaluate, createBaseline, emptyBaseline, serializeBaseline, parseBaseline } from '@reins/core';
import { edges } from './fixtures/edges.js';

const yml = await readFile(new URL('./fixtures/architecture.yml', import.meta.url), 'utf8');
const config = parseConfig(yml);
const withRules = (rules) => parseConfig(yml.replace(/rules:[\s\S]*?\n\n/, `rules:\n${rules}\n\n`));

test('the fixture produces exactly one violation of each rule', () => {
  const found = evaluate(edges, config).map((v) => `${v.rule} ${v.from} -> ${v.to}`);
  assert.deepEqual(found, [
    'layer-direction src/components/PriceTag.js -> src/features/billing/index.js',
    'domain-boundary src/app/checkout/page.js -> src/features/billing/total.js',
    'no-cycles src/lib/a.js -> src/lib/b.js',
  ]);
});

test('messages say what broke and how to fix it', () => {
  const [layer, domain, cycle] = evaluate(edges, config);
  assert.equal(layer.message, 'src/components/PriceTag.js (components) imports src/features/billing/index.js (features), but features is above components.');
  assert.equal(layer.fix, 'Move what src/components/PriceTag.js needs from features down to components or a lower layer, or invert the dependency (pass it in as props or callbacks).');
  assert.match(domain.message, /internal file of the billing domain/);
  assert.match(domain.fix, /src\/features\/billing\/index\.js/);
  assert.equal(cycle.message, 'Import cycle: src/lib/a.js → src/lib/b.js → src/lib/c.js → src/lib/a.js.');
  assert.deepEqual(cycle.files, ['src/lib/a.js', 'src/lib/b.js', 'src/lib/c.js']);
});

test('custom message and fix templates are rendered', () => {
  const cfg = withRules('  - { id: layer-direction, severity: error, message: "{from_layer} -> {to_layer}", fix: "see {to}" }');
  const [v] = evaluate(edges, cfg);
  assert.equal(v.message, 'components -> features');
  assert.equal(v.fix, 'see src/features/billing/index.js');
});

test('allow: removes the violation; without it the edge is reported', () => {
  const noAllow = parseConfig(yml.replace(/allow:[\s\S]*$/, ''));
  const keys = evaluate(edges, noAllow).map((v) => v.key);
  assert.ok(keys.includes('domain-boundary|src/features/search/Results.js|src/features/billing/total.js'));
  assert.ok(!evaluate(edges, config).some((v) => v.from === 'src/features/search/Results.js'));
});

test('allow: limited to one rule does not hide other rules', () => {
  const cfg = parseConfig(yml.replace('reason: "Search', 'rule: no-cycles, reason: "Search'));
  assert.ok(evaluate(edges, cfg).some((v) => v.rule === 'domain-boundary' && v.from === 'src/features/search/Results.js'));
});

test('ignore_kinds skips edges that only have ignored kinds', () => {
  const cfg = withRules('  - { id: layer-direction, severity: error }');
  assert.ok(evaluate(edges, cfg).some((v) => v.from === 'src/lib/types.js'));
  assert.ok(!evaluate(edges, config).some((v) => v.from === 'src/lib/types.js'));
});

test('severity off disables a rule, unlisted rules are off, warn does not fail', () => {
  const cfg = withRules('  - { id: no-cycles, severity: warn }\n  - { id: domain-boundary, severity: off }');
  const result = runCheck({ edges, config: cfg, baseline: emptyBaseline() });
  assert.deepEqual(result.violations.map((v) => `${v.rule}:${v.severity}`), ['no-cycles:warn']);
  assert.equal(result.ok, true);
  assert.equal(result.summary.newWarnings, 1);
});

test('no-cycles: self import, two separate cycles, and a cycle that grows gets a new key', () => {
  const extra = [
    { from: 'src/lib/self.js', to: 'src/lib/self.js', kind: 'static' },
    { from: 'src/lib/x.js', to: 'src/lib/y.js', kind: 'static' },
    { from: 'src/lib/y.js', to: 'src/lib/x.js', kind: 'static' },
  ];
  const cycles = evaluate([...edges, ...extra], config).filter((v) => v.rule === 'no-cycles').map((v) => v.key);
  assert.deepEqual(cycles, ['no-cycles|src/lib/a.js|src/lib/b.js|src/lib/c.js', 'no-cycles|src/lib/self.js', 'no-cycles|src/lib/x.js|src/lib/y.js']);
  const grown = evaluate([...edges, { from: 'src/lib/c.js', to: 'src/lib/d.js', kind: 'static' }, { from: 'src/lib/d.js', to: 'src/lib/a.js', kind: 'static' }], config)
    .filter((v) => v.rule === 'no-cycles').map((v) => v.key);
  assert.deepEqual(grown, ['no-cycles|src/lib/a.js|src/lib/b.js|src/lib/c.js|src/lib/d.js']);
});

test('no-cycles handles a long chain without overflowing the stack', () => {
  const n = 20000;
  const chain = Array.from({ length: n }, (_, i) => ({ from: `src/lib/m${i}.js`, to: `src/lib/m${(i + 1) % n}.js`, kind: 'static' }));
  const [v] = evaluate(chain, config);
  assert.equal(v.files.length, n);
});

test('baseline: existing violations pass, only new ones fail', () => {
  const first = runCheck({ edges, config, baseline: emptyBaseline() });
  assert.equal(first.ok, false);
  assert.equal(first.summary.newErrors, 3);

  const baseline = parseBaseline(serializeBaseline(createBaseline(first.violations)));
  const second = runCheck({ edges, config, baseline });
  assert.equal(second.ok, true);
  assert.deepEqual(second.summary, { new: 0, newErrors: 0, newWarnings: 0, baseline: 3, stale: 0 });

  const added = [...edges, { from: 'src/components/Cart.js', to: 'src/app/page.js', kind: 'static' }];
  const third = runCheck({ edges: added, config, baseline });
  assert.equal(third.ok, false);
  assert.deepEqual(third.violations.filter((v) => v.status === 'new').map((v) => v.from), ['src/components/Cart.js']);
});

test('baseline: fixed violations are reported as stale', () => {
  const baseline = createBaseline(evaluate(edges, config));
  const fixed = edges.filter((e) => e.from !== 'src/components/PriceTag.js');
  const r = runCheck({ edges: fixed, config, baseline });
  assert.deepEqual(r.stale.map((s) => s.key), ['layer-direction|src/components/PriceTag.js|src/features/billing/index.js']);
  assert.equal(r.ok, true);
});

test('baseline is deterministic: sorted, no timestamps, same output for shuffled input', () => {
  const a = serializeBaseline(createBaseline(evaluate(edges, config)));
  const b = serializeBaseline(createBaseline(evaluate([...edges].reverse(), config)));
  assert.equal(a, b);
  assert.doesNotMatch(a, /20\d\d-\d\d/);
});

test('parseBaseline rejects broken files with a clear message', () => {
  assert.throws(() => parseBaseline('{'), /not valid JSON/);
  assert.throws(() => parseBaseline('{"version":2,"violations":[]}'), /must look like/);
  assert.throws(() => parseBaseline('{"version":1,"violations":[{}]}'), /violations\[0\] needs/);
});

test('files: only violations that involve touched files are reported, stale is skipped', () => {
  const baseline = createBaseline([]);
  const r = runCheck({ edges, config, baseline, files: ['src/lib/b.js'] });
  assert.deepEqual(r.violations.map((v) => v.rule), ['no-cycles']);
  assert.equal(r.partial, true);
  assert.deepEqual(r.stale, []);
  const none = runCheck({ edges, config, baseline, files: ['README.md'] });
  assert.equal(none.violations.length, 0);
  assert.equal(none.ok, true);
});

test('extra violations (integrity) are never baselined', () => {
  const integrity = { rule: 'integrity', severity: 'error', key: 'integrity|architecture|a.yml', from: 'a.yml', message: 'm', fix: 'f' };
  const baseline = { version: 1, violations: [{ rule: 'integrity', key: integrity.key, from: 'a.yml' }] };
  const r = runCheck({ edges: [], config, baseline, extra: [integrity], files: ['x.js'] });
  assert.equal(r.violations[0].status, 'new');
  assert.equal(r.ok, false);
  assert.equal(createBaseline([integrity]).violations.length, 0);
});

test('ignore: edges touching ignored files are not checked; invalid ignore is reported', () => {
  const cfg = parseConfig(yml.replace('preset: next-app', 'preset: next-app\nignore: ["src/lib/**"]'));
  assert.deepEqual(cfg.ignore, ['src/lib/**']);
  assert.ok(!evaluate(edges, cfg).some((v) => v.rule === 'no-cycles'));
  assert.deepEqual(parseConfig(yml).ignore, []);
  assert.throws(() => parseConfig(yml.replace('preset: next-app', 'preset: next-app\nignore: "src/**"')), /ignore: expected a non-empty list of globs/);
});
