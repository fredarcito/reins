import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cli, exampleRepo, git } from './helpers.js';

/** Example repo on a feature branch with some changes, as an agent would leave it. */
function workingRepo() {
  const dir = exampleRepo('vite-react');
  git(dir, 'checkout', '-q', '-b', 'feat/discounts');
  for (const f of ['src/features/cart/discount.js', 'src/features/cart/rules.js', 'src/features/cart/format.js', 'src/features/cart/api.js']) {
    writeFileSync(path.join(dir, f), 'export const x = 1;\n');
  }
  git(dir, 'add', 'src/features/cart/discount.js');
  git(dir, 'commit', '-qm', 'wip');
  mkdirSync(path.join(dir, '.harness/progress'), { recursive: true });
  return dir;
}
const write = (dir, f, text) => writeFileSync(path.join(dir, f), text);

test('reports triage-missing for a branch with changes, exits 0; --strict exits 1', async () => {
  const dir = workingRepo();
  const r = await cli(dir, ['doctor']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /! warn {2}triage-missing {2}\.harness\/progress\/triage\.log/);
  assert.match(r.stdout, /Branch feat\/discounts has 4 changed file\(s\)/);
  assert.match(r.stdout, /harness doctor: 0 errors, 1 warning$/m);
  assert.equal((await cli(dir, ['doctor', '--strict'])).code, 1);
});

test('compares the declared level with the diff (committed + untracked files, local folders excluded)', async () => {
  const dir = workingRepo();
  write(dir, '.harness/progress/triage.log', '2026-11-04 | feat/discounts | small | add a discount\n');
  write(dir, '.harness/progress/notes.txt', 'local, not counted');
  const r = await cli(dir, ['doctor', '--json']);
  const data = JSON.parse(r.stdout);
  assert.deepEqual(data.violations.map((v) => v.rule), ['triage-mismatch']);
  assert.match(data.violations[0].message, /looks medium: 4 files \(small allows 3\)/);
});

test('reads thresholds from doctor.yml', async () => {
  const dir = workingRepo();
  write(dir, '.harness/progress/triage.log', '2026-11-04 | feat/discounts | small | add a discount\n');
  write(dir, '.harness/doctor.yml', 'triage:\n  small: { max_files: 10 }\n');
  const r = await cli(dir, ['doctor']);
  assert.match(r.stdout, /nothing to report/);
});

test('checks the current branch notebook and AGENTS.md', async () => {
  const dir = workingRepo();
  write(dir, '.harness/progress/triage.log', '2026-11-04 | feat/discounts | medium | cart discounts\n');
  write(dir, '.harness/progress/feat-discounts.md', '# feat/discounts · status: open · updated: 2026-11-04\n- [~] a\n- [~] b\n');
  write(dir, 'AGENTS.md', 'line\n'.repeat(35));
  const r = await cli(dir, ['doctor']);
  assert.match(r.stdout, /progress-format {2}\.harness\/progress\/feat-discounts\.md/);
  assert.match(r.stdout, /agents-size {2}AGENTS\.md/);
});

test('never runs in CI, even with --strict', async () => {
  const dir = workingRepo();
  const r = await cli(dir, ['doctor', '--strict'], { env: { CI: 'true' } });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /local-only and was skipped because CI is set/);
});

test('invalid doctor.yml or base ref: exit 2 with the reason', async () => {
  const dir = workingRepo();
  assert.match((await cli(dir, ['doctor', '--base', 'nope'])).stderr, /Base ref "nope" not found/);
  write(dir, '.harness/doctor.yml', 'progres: {}\n');
  const r = await cli(dir, ['doctor']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /doctor\.yml is not valid:\n {2}- progres: unknown key/);
});
