import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, SCOPE } from '@agentreins/cli';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

function capture() {
  const io = { stdout: '', stderr: '' };
  return { io, out: (s) => (io.stdout += s + '\n'), err: (s) => (io.stderr += s + '\n') };
}

test('--version prints the package version', async () => {
  const c = capture();
  assert.equal(await run(['--version'], c), 0);
  assert.equal(c.io.stdout.trim(), pkg.version);
});

test('no command prints help and exits 0', async () => {
  const c = capture();
  assert.equal(await run([], c), 0);
  assert.match(c.io.stdout, /Usage: reins/);
});

test('unknown command exits non-zero', async () => {
  const c = capture();
  assert.equal(await run(['nope'], c), 2);
  assert.match(c.io.stderr, /Unknown command: nope/);
});

test('scope is derived from the package name', () => {
  assert.equal(`${SCOPE}/cli`, pkg.name);
});
