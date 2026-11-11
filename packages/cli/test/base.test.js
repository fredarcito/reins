import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseConfig } from '@agentreins/core';
import { baseBranch, branchStart, comparison, suggestBase } from '../src/base.js';
import { cli, exampleRepo, git, tempDir } from './helpers.js';

const write = (dir, f, text) => {
  mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  writeFileSync(path.join(dir, f), text);
};
const commit = (dir, f, msg = f) => {
  write(dir, f, `${msg}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', msg);
  return sha(dir, 'HEAD');
};
const sha = (dir, ref) => git(dir, 'rev-parse', ref).trim();

/** main with one commit, staging one commit ahead (what the issue describes: tasks are cut from staging). */
function stagingRepo() {
  const dir = tempDir();
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  commit(dir, 'a.txt');
  git(dir, 'switch', '-qc', 'staging');
  commit(dir, 'staging-only.txt');
  return dir;
}

test('branch start: git checkout -b / switch -c from the current branch, or naming the start point', () => {
  const dir = stagingRepo();
  const tip = sha(dir, 'staging');
  git(dir, 'checkout', '-qb', 'task-a');
  assert.deepEqual(branchStart(dir), { commit: tip, from: 'staging' }, 'Created from HEAD: the branch comes from the HEAD reflog');
  git(dir, 'switch', '-q', 'main');
  git(dir, 'switch', '-qc', 'task-b', 'staging');
  assert.deepEqual(branchStart(dir), { commit: tip, from: 'staging' });
  git(dir, 'switch', '-q', 'main');
  assert.equal(branchStart(dir), null, 'main was created by init: no "Created from" entry');
});

test('comparison: a task cut from staging compares with its start, not with main', () => {
  const dir = stagingRepo();
  git(dir, 'switch', '-qc', 'task');
  commit(dir, 'mine.txt');
  const c = comparison(dir, { env: {} });
  assert.deepEqual([c.commit, c.label, c.mark, c.ref], [sha(dir, 'staging'), 'the branch start (from staging)', 'branch', 'main']);
  const files = git(dir, 'diff', '--name-only', /** @type {string} */ (c.commit)).trim();
  assert.equal(files, 'mine.txt', 'staging-only.txt is not this task');
});

test('comparison: a task cut from a feature branch compares with the feature branch', () => {
  const dir = stagingRepo();
  git(dir, 'switch', '-qc', 'feature/x');
  const feature = commit(dir, 'feature.txt');
  git(dir, 'switch', '-qc', 'task');
  commit(dir, 'mine.txt');
  const c = comparison(dir, { env: {} });
  assert.deepEqual([c.commit, c.label], [feature, 'the branch start (from feature/x)']);
});

test('comparison: after merging newer staging into the task, staging commits are not the task', () => {
  const dir = stagingRepo();
  git(dir, 'switch', '-qc', 'task');
  commit(dir, 'mine.txt');
  git(dir, 'switch', '-q', 'staging');
  const newer = commit(dir, 'staging-later.txt');
  git(dir, 'switch', '-q', 'task');
  git(dir, 'merge', '-q', '--no-edit', 'staging');
  const c = comparison(dir, { env: {} });
  assert.equal(c.commit, newer);
  assert.equal(git(dir, 'diff', '--name-only', /** @type {string} */ (c.commit)).trim(), 'mine.txt');
});

test('comparison: the marks win over REINS_BASE; --base wins over everything; CI uses the PR target', () => {
  const dir = stagingRepo();
  git(dir, 'switch', '-qc', 'task');
  commit(dir, 'mine.txt');
  assert.equal(comparison(dir, { env: { REINS_BASE: 'main' } }).commit, sha(dir, 'staging'), 'a fixed REINS_BASE does not spoil a task from elsewhere');
  const explicit = comparison(dir, { explicit: 'main', env: { REINS_BASE: 'staging' } });
  assert.deepEqual([explicit.commit, explicit.label], [sha(dir, 'main'), 'main']);
  const ci = comparison(dir, { env: { CI: 'true', REINS_BASE: 'main' } });
  assert.deepEqual([ci.commit, ci.label, ci.mark], [sha(dir, 'main'), 'main', null], 'no reflog marks in CI');
  const task = comparison(dir, { env: {}, anchor: sha(dir, 'HEAD') });
  assert.deepEqual([task.mark, task.commit], ['task', sha(dir, 'HEAD')]);
});

test('comparison: no mark after a rebase that drops the start, or for a branch created from its own remote branch', () => {
  const dir = stagingRepo();
  git(dir, 'switch', '-qc', 'task');
  commit(dir, 'mine.txt');
  git(dir, 'rebase', '-q', '--onto', 'main', 'staging', 'task');
  assert.equal(branchStart(dir), null, 'the start is no longer an ancestor of HEAD');
  assert.equal(comparison(dir, { env: {} }).commit, sha(dir, 'main'), 'falls back to the base branch');

  git(dir, 'remote', 'add', 'origin', dir);
  git(dir, 'update-ref', 'refs/remotes/origin/theirs', sha(dir, 'staging'));
  git(dir, 'switch', '-q', '--track', '-c', 'theirs', 'origin/theirs');
  assert.equal(branchStart(dir), null, "someone else's branch: its start would hide their commits");
  git(dir, 'switch', '-q', 'main');
  git(dir, 'update-ref', 'refs/remotes/origin/fetched', sha(dir, 'staging'));
  git(dir, 'switch', '-q', 'fetched');
  assert.equal(branchStart(dir), null, 'git switch <name> of a remote branch: "Created from refs/remotes/origin/fetched"');
});

test('base branch: REINS_BASE and base: are used as written; a missing one warns and is skipped', () => {
  const dir = stagingRepo();
  git(dir, 'switch', '-q', 'main');
  assert.deepEqual(baseBranch(dir, undefined, {}).ref, 'main');
  write(dir, '.reins/architecture.yml', 'version: 1\nadapters: [js]\nbase: staging\n');
  assert.deepEqual(baseBranch(dir, undefined, {}), { ref: 'staging', source: 'base in .reins/architecture.yml', warnings: [] });
  assert.equal(baseBranch(dir, undefined, { GITHUB_BASE_REF: 'main' }).ref, 'staging', 'origin/main does not exist here: skipped silently, as before');

  const typo = baseBranch(dir, undefined, { REINS_BASE: 'origin/stagin' });
  assert.equal(typo.ref, 'staging');
  assert.match(typo.warnings.join('\n'), /REINS_BASE names "origin\/stagin", which does not exist, so it was skipped/);

  write(dir, '.reins/architecture.yml', 'version: 1\nadapters: [js]\nbase: origin/staging\n');
  const both = baseBranch(dir, undefined, { REINS_BASE: 'main' });
  assert.equal(both.ref, 'main');
  assert.match(both.warnings.join('\n'), /base: in \.reins\/architecture\.yml names "origin\/staging", which does not exist/, 'warned even when another one wins');
  assert.deepEqual(baseBranch(dir, 'nope', {}).ref, 'nope', '--base is returned as is: the caller reports it');
  assert.equal(comparison(dir, { explicit: 'nope', env: {} }).commit, null);
});

test('architecture.yml: base is optional and must look like a branch name', () => {
  const plan = (extra) => `version: 1\nadapters: [js]\n${extra}`;
  assert.equal(parseConfig(plan('base: origin/staging\n')).base, 'origin/staging');
  assert.equal(parseConfig(plan('')).base, undefined);
  assert.throws(() => parseConfig(plan('base: "my branch"\n')), /base: expected a branch name/);
  assert.throws(() => parseConfig(plan('base: [staging]\n')), /base: expected a branch name/);
});

test('suggestBase: origin/staging next to origin/main, until the plan answers', () => {
  const dir = stagingRepo();
  assert.equal(suggestBase(dir), null, 'no remote branches');
  git(dir, 'remote', 'add', 'origin', dir);
  git(dir, 'update-ref', 'refs/remotes/origin/main', sha(dir, 'main'));
  git(dir, 'update-ref', 'refs/remotes/origin/staging', sha(dir, 'staging'));
  git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  assert.equal(suggestBase(dir), 'origin/staging');
  write(dir, '.reins/architecture.yml', 'version: 1\nadapters: [js]\nbase: origin/main\n');
  assert.equal(suggestBase(dir), null, 'base: origin/main is an answer too');
});

test('check and resume: a task cut from staging does not report what staging already changed', async () => {
  const dir = exampleRepo('next-app');
  git(dir, 'switch', '-qc', 'staging');
  const plan = path.join(dir, '.reins/architecture.yml');
  writeFileSync(plan, `${readFileSync(plan, 'utf8')}\n# approved on staging\n`);
  write(dir, 'src/features/orders/staging.ts', 'export const s = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'staging work');
  git(dir, 'switch', '-qc', 'task');
  write(dir, 'src/features/orders/mine.ts', 'export const m = 1;\n');

  const check = await cli(dir, ['check']);
  assert.doesNotMatch(check.stdout, /architecture\.yml changed/, check.stdout);
  const vsMain = await cli(dir, ['check', '--base', 'main']);
  assert.match(vsMain.stdout, /\.reins\/architecture\.yml changed compared to main\./);

  const r = JSON.parse((await cli(dir, ['resume', '--json'])).stdout);
  assert.deepEqual([r.files, r.compared], [['src/features/orders/mine.ts'], 'the branch start (from staging)']);
  assert.match((await cli(dir, ['resume'])).stdout, /- src\/features\/orders\/mine\.ts\nCompared with the branch start \(from staging\)\./);
  const all = JSON.parse((await cli(dir, ['resume', '--json', '--base', 'main'])).stdout);
  assert.equal(all.files.length, 3, '--base main: staging work counts again');
  const bad = await cli(dir, ['resume', '--base', 'nope']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /Base ref "nope" not found/);
});
