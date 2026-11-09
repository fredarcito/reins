import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compareIntegrity, checkIntegrity } from '@agentreins/core';

const files = { architecture: '.reins/architecture.yml', baseline: '.reins/baseline.json' };
const bl = (...keys) => JSON.stringify({ version: 1, violations: keys.map((key) => ({ rule: 'no-cycles', key, from: 'a' })) });
const compare = (base, head) => compareIntegrity({ base, head, files, baseLabel: 'origin/main', severity: 'warn' });

test('unchanged files produce no findings', () => {
  assert.deepEqual(compare({ architecture: 'a: 1\n', baseline: bl('k1') }, { architecture: 'a: 1', baseline: bl('k1') }), []);
});

test('a changed or deleted architecture.yml is reported', () => {
  const [v] = compare({ architecture: 'a: 1', baseline: null }, { architecture: 'a: 2', baseline: null });
  assert.equal(v.message, '.reins/architecture.yml changed compared to origin/main.');
  assert.match(v.fix, /decided by a person/);
  assert.equal(compare({ architecture: 'a: 1', baseline: null }, { architecture: null, baseline: null }).length, 1);
});

test('a baseline that grows is reported; one that shrinks is not', () => {
  const [v] = compare({ architecture: null, baseline: bl('k1') }, { architecture: null, baseline: bl('k1', 'k2', 'k3') });
  assert.equal(v.message, '.reins/baseline.json gained 2 violation(s) compared to origin/main: k2; k3.');
  assert.deepEqual(compare({ architecture: null, baseline: bl('k1', 'k2') }, { architecture: null, baseline: bl('k1') }), []);
});

test('first adoption (files missing at the base) is not reported', () => {
  assert.deepEqual(compare({ architecture: null, baseline: null }, { architecture: 'a: 1', baseline: bl('k1') }), []);
});

test('an invalid baseline is reported', () => {
  const [v] = compare({ architecture: null, baseline: bl('k1') }, { architecture: null, baseline: '{oops' });
  assert.match(v.message, /is not a valid baseline/);
});

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'reins-integrity-'));
  const g = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  mkdirSync(path.join(dir, '.reins'));
  writeFileSync(path.join(dir, files.architecture), 'version: 1\n');
  writeFileSync(path.join(dir, files.baseline), bl('k1'));
  g('add', '-A');
  g('commit', '-qm', 'base');
  g('checkout', '-q', '-b', 'feature');
  return { dir, g };
}

test('checkIntegrity compares the working tree with the merge base of the base ref', () => {
  const { dir, g } = repo();
  const run = () => checkIntegrity({ repoRoot: dir, baseRef: 'main', architectureFile: files.architecture, baselineFile: files.baseline, severity: 'error' });
  assert.deepEqual(run(), []);
  writeFileSync(path.join(dir, files.baseline), bl('k1', 'k9'));
  g('commit', '-qam', 'freeze a new violation');
  const found = run();
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, 'error');
  assert.match(found[0].message, /gained 1 violation\(s\) compared to main: k9/);
  writeFileSync(path.join(dir, files.architecture), 'version: 1\nadapters: [js]\n'); // uncommitted change counts too
  assert.equal(run().length, 2);
});

test('checkIntegrity warns when the base ref does not exist', () => {
  const { dir } = repo();
  const [v] = checkIntegrity({ repoRoot: dir, baseRef: 'origin/nope', architectureFile: files.architecture, baselineFile: files.baseline, severity: 'error' });
  assert.equal(v.severity, 'warn');
  assert.match(v.message, /Could not compare with origin\/nope/);
});
