import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseConfig, loadConfig, validateConfig, ConfigError, CORE_RULES } from '@harness/core';

const minimal = 'version: 1\nadapter: js\n';

/** @returns {string[]} problems of an invalid config */
function problemsOf(text, opts) {
  try {
    parseConfig(text, opts);
  } catch (e) {
    assert.ok(e instanceof ConfigError);
    return e.problems;
  }
  assert.fail('expected a ConfigError');
}

test('a minimal config gets the default rules', () => {
  const c = parseConfig(minimal);
  assert.deepEqual(Object.fromEntries(Object.entries(c.rules).map(([k, r]) => [k, r.severity])), {
    'layer-direction': 'error', 'domain-boundary': 'error', 'no-cycles': 'error', integrity: 'warn',
  });
  assert.deepEqual([c.layers, c.domains, c.allow], [[], [], []]);
});

test('listing rules turns unlisted ones off, except integrity', () => {
  const c = parseConfig(`${minimal}rules:\n  - { id: no-cycles, severity: warn }\n`);
  assert.deepEqual(Object.keys(c.rules).sort(), ['integrity', 'no-cycles']);
  const off = parseConfig(`${minimal}rules:\n  - { id: integrity, severity: off }\n`);
  assert.equal(off.rules.integrity.severity, 'off');
});

test('domains keep their public API; layers keep their order', () => {
  const c = parseConfig(`${minimal}layers:\n  - { name: top, paths: ["a/**"] }\n  - { name: bottom, paths: ["b/**"] }\ndomains:\n  billing: { paths: ["a/billing/**"], public_api: ["a/billing/index.js"] }\n`);
  assert.deepEqual(c.layers.map((l) => l.name), ['top', 'bottom']);
  assert.deepEqual(c.domains, [{ name: 'billing', paths: ['a/billing/**'], publicApi: ['a/billing/index.js'] }]);
});

test('every problem is reported at once, with the exact field', () => {
  const problems = problemsOf(`version: 2
adaptor: js
layers:
  - { name: ui, paths: [] }
  - { name: ui, paths: ["x/**"] }
domains:
  billing: { paths: ["b/**"] }
rules:
  - { id: layer-direction, severity: fatal }
  - { id: made-up, severity: error }
allow:
  - { from: "a/**", to: "b/**" }
`);
  assert.deepEqual(problems, [
    'adaptor: unknown key (expected one of: version, adapter, preset, layers, domains, rules, allow)',
    'version: expected 1, got 2',
    'adapter: required, e.g. "adapter: js"',
    'layers[0].paths: expected a non-empty list of globs',
    'layers[1].name: duplicate layer "ui"',
    "domains.billing.public_api: expected a non-empty list of files or globs (e.g. the domain's index.js)",
    'rules[0] (layer-direction).severity: expected one of error, warn, off',
    `rules[1] (made-up).id: unknown rule "made-up" (known: ${CORE_RULES.join(', ')})`,
    'allow[0].reason: required; say why this exception is acceptable',
  ]);
});

test('the error message lists the problems under the file name', () => {
  assert.throws(() => parseConfig('version: 1\n', { file: '.harness/architecture.yml' }), {
    message: '.harness/architecture.yml is not valid:\n  - adapter: required, e.g. "adapter: js"',
  });
});

test('YAML syntax errors are reported as config errors', () => {
  const [p] = problemsOf('version: 1\nadapter: [js\n');
  assert.match(p, /^YAML syntax:/);
});

test('adapter rules are accepted when the caller passes them as known', () => {
  const text = `${minimal}rules:\n  - { id: next-server-client, severity: warn, options: { strict: true } }\n`;
  assert.match(problemsOf(text)[0], /unknown rule "next-server-client"/);
  const c = parseConfig(text, { knownRules: [...CORE_RULES, 'next-server-client'] });
  assert.deepEqual(c.rules['next-server-client'].options, { strict: true });
});

test('validateConfig rejects non-mappings', () => {
  assert.deepEqual(validateConfig([1, 2]).problems, ['the file must be a YAML mapping (key: value)']);
});

test('loadConfig reads the file and explains a missing one', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-config-'));
  writeFileSync(path.join(dir, 'architecture.yml'), minimal);
  assert.equal((await loadConfig(path.join(dir, 'architecture.yml'))).adapter, 'js');
  await assert.rejects(loadConfig(path.join(dir, 'missing.yml')), { name: 'ConfigError', message: /Run `harness init`/ });
});
