// The task's state in the output of the commands the agent already runs (DEV-8914): resume measures an untriaged
// branch, check and doctor propose the close at the right moment, and `progress close` works without a notebook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cli, exampleRepo, git } from './helpers.js';

const write = (dir, f, text) => {
  mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  writeFileSync(path.join(dir, f), text);
};
const LOG = '.reins/progress/triage.log';
const env = { GITHUB_BASE_REF: 'main' };

/** A branch with 4 changed files in orders and its note written: medium, nothing for the doctor once triaged. */
async function branch() {
  const dir = exampleRepo('next-app');
  await cli(dir, ['check', '--update-baseline']); // the example's violations are known debt on main
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'baseline');
  git(dir, 'switch', '-qc', 'feat/status');
  for (const f of ['queries.ts', 'types.ts', 'OrderList.tsx']) {
    write(dir, `src/features/orders/${f}`, `${readFileSync(path.join(dir, `src/features/orders/${f}`), 'utf8')}\nexport const status${f.length} = 1;\n`);
  }
  write(dir, 'src/features/orders/status.ts', 'export const STATUSES = ["open", "paid"];\n');
  write(dir, '.reins/notes/orders.md', '---\npaths: ["src/features/orders/**"]\n---\n## Purpose\nOrders list, filtered by status.\n');
  return dir;
}

test('resume: an untriaged branch is measured and told what to run, never "fine for a small task"', async () => {
  const dir = await branch();
  const r = await cli(dir, ['resume'], { env });
  assert.match(r.stdout, /## Task level: not measured\nThe changes on feat\/status look medium \(4 files \(small allows 3\)\) and no task was measured on this branch\. Before continuing, run `npx reins triage "<reason>" --files <paths>`/);
  assert.match(r.stdout, /read \.reins\/core\/policies\/progress\.md and keep a notebook \(`npx reins progress new <task>`\)/);
  assert.doesNotMatch(r.stdout, /fine for a small task/);
  assert.equal(JSON.parse((await cli(dir, ['resume', '--json'], { env })).stdout).measured.level, 'medium');

  write(dir, LOG, `2026-11-04 | feat/status | medium | filter by status | commit:${git(dir, 'rev-parse', '--short=12', 'HEAD').trim()}\n`);
  assert.match((await cli(dir, ['resume'], { env })).stdout, /Task is open \(medium\) and has no notebook: create it with `npx reins progress new <task>`/);
});

test('doctor and check propose the close for a clean medium task; progress close records it without a notebook', async () => {
  const dir = await branch();
  const closeEarly = await cli(dir, ['progress', 'close'], { env });
  assert.notEqual(closeEarly.code, 0);
  assert.match(closeEarly.stderr, /Nothing to close on feat\/status: no notebook and no task in \.reins\/progress\/triage\.log/);

  write(dir, LOG, `2026-11-04 | feat/status | medium | filter by status | commit:${git(dir, 'rev-parse', '--short=12', 'HEAD').trim()}\n`);
  const doctor = await cli(dir, ['doctor'], { env });
  assert.match(doctor.stdout, /reins doctor: nothing to report\nReady to close \(medium\): nothing left for check or doctor to flag\. When the person confirms it works, follow the done skill/, doctor.stdout);
  const check = await cli(dir, ['check'], { env });
  assert.equal(check.code, 0, check.stdout);
  assert.match(check.stdout, /Ready to close \(medium\)/);
  assert.doesNotMatch((await cli(dir, ['check'], { env: { ...env, CI: 'true' } })).stdout, /Ready to close/, 'never in CI');

  const closed = await cli(dir, ['progress', 'close'], { env });
  assert.equal(closed.code, 0, closed.stderr);
  assert.match(closed.stdout, /Closed the medium task on feat\/status \(no notebook\): recorded in \.reins\/progress\/triage\.log\./);
  assert.match(readFileSync(path.join(dir, LOG), 'utf8'), /\n2026-11-04 \| feat\/status \| medium \| closed \| commit:\w+ \| status:closed\n$/);
  assert.doesNotMatch((await cli(dir, ['doctor'], { env })).stdout, /Ready to close/);
  assert.match((await cli(dir, ['resume'], { env })).stdout, /The last task on feat\/status was closed on 2026-11-04\. A new request is a new task: measure it/);
  assert.match((await cli(dir, ['progress', 'close'], { env })).stdout, /already closed on 2026-11-04/);
});

test('progress close with a notebook also writes the closed line', async () => {
  const dir = await branch();
  write(dir, LOG, `2026-11-04 | feat/status | medium | filter by status | commit:${git(dir, 'rev-parse', '--short=12', 'HEAD').trim()} | task:status\n`);
  assert.equal((await cli(dir, ['progress', 'new', 'status'], { env })).code, 0);
  const nb = '.reins/progress/feat-status/status/notebook.md';
  write(dir, nb, readFileSync(path.join(dir, nb), 'utf8').replace(/- \[[ ~]\]/g, '- [x]'));
  const r = await cli(dir, ['progress', 'close', '--task', 'status'], { env });
  assert.equal(r.code, 0, r.stderr);
  assert.match(readFileSync(path.join(dir, LOG), 'utf8'), /\| medium \| closed \| commit:\w+ \| task:status \| status:closed\n$/);
});
