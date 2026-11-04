import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { cli, exampleRepo, git } from './helpers.js';

const read = (dir, f) => readFileSync(path.join(dir, f), 'utf8');
const write = (dir, f, text) => {
  mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  writeFileSync(path.join(dir, f), text);
};
const pkg = (dir, extra) => write(dir, 'package.json', JSON.stringify({ name: 'app', private: true, scripts: { dev: 'vite', test: 'vitest' }, ...extra }, null, 2) + '\n');

function huskyRepo() {
  const dir = exampleRepo('vite-react', { keepHarness: false }); // a repo before adopting the harness
  pkg(dir, { devDependencies: { husky: '^9.1.7', '@harness/cli': '^0.1.0' } });
  mkdirSync(path.join(dir, '.husky'));
  return dir;
}

test('husky repo: sources, .gitignore, script, hook, CI workflow and sync, in one go', async () => {
  const dir = huskyRepo();
  const r = await cli(dir, ['install']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /\.harness\/ sources: 16 file\(s\) added/);
  for (const f of ['.harness/policies/triage.md', '.harness/skills/audit/SKILL.md', '.harness/agents/reviewer.md', '.harness/doctor.yml', 'AGENTS.md', 'CLAUDE.md', '.claude/settings.json', '.harness/.generated.json']) {
    assert.ok(existsSync(path.join(dir, f)), f);
  }
  assert.ok(statSync(path.join(dir, '.harness/hooks/pre-commit.sh')).mode & 0o100, 'hook script is executable');
  assert.match(read(dir, '.gitignore'), /# harness: local state \(not shared\)\n\.harness\/backlog\/\n\.harness\/progress\/\n\.harness\/init-report\.md\n$/);
  assert.equal(JSON.parse(read(dir, 'package.json')).scripts['harness:check'], 'harness check');
  assert.equal(read(dir, '.husky/pre-commit'), 'sh .harness/hooks/pre-commit.sh\n');
  assert.ok(statSync(path.join(dir, '.husky/pre-commit')).mode & 0o100);

  const wf = parse(read(dir, '.github/workflows/harness.yml'));
  assert.deepEqual(wf.on, { pull_request: null, push: { branches: ['main'] } });
  const runs = wf.jobs.harness.steps.map((s) => s.run ?? s.uses);
  assert.deepEqual(runs, ['actions/checkout@v4', 'actions/setup-node@v4', 'npm ci', 'npx --no-install harness check']);
  assert.equal(wf.jobs.harness.steps[0].with['fetch-depth'], 0);

  assert.match(r.stdout, /No \.harness\/architecture\.yml yet: run `npx --no-install harness init`/);
  assert.match(r.stdout, /protect the main branch/);
  assert.doesNotMatch(r.stdout, /@harness\/cli is not in package\.json/);
});

test('install is idempotent and never overwrites existing files', async () => {
  const dir = huskyRepo();
  write(dir, '.harness/policies/triage.md', 'our own policy\n');
  write(dir, '.husky/pre-commit', 'npm test');
  write(dir, '.gitignore', 'node_modules\n.harness/progress/\n');
  await cli(dir, ['install']);
  assert.equal(read(dir, '.harness/policies/triage.md'), 'our own policy\n');
  assert.equal(read(dir, '.husky/pre-commit'), 'npm test\nsh .harness/hooks/pre-commit.sh\n');
  assert.equal(read(dir, '.gitignore'), 'node_modules\n.harness/progress/\n\n# harness: local state (not shared)\n.harness/backlog/\n.harness/init-report.md\n');

  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'install');
  const again = await cli(dir, ['install']);
  assert.match(again.stdout, /0 file\(s\) added, 16 already there \(kept\)/);
  assert.match(again.stdout, /already ignores the local harness folders/);
  assert.match(again.stdout, /script "harness:check" already exists \(kept\)/);
  assert.match(again.stdout, /\.husky\/pre-commit already runs harness/);
  assert.match(again.stdout, /harness\.yml already exists \(kept; --force to overwrite\)/);
  assert.equal(git(dir, 'status', '--porcelain'), '', 'nothing changed');
});

test('lefthook: adds the command to lefthook.yml keeping comments and other commands', async () => {
  const dir = exampleRepo('vite-react');
  pkg(dir, { devDependencies: { lefthook: '^2.0.0' } });
  write(dir, 'lefthook.yml', '# our hooks\npre-commit:\n  commands:\n    lint:\n      run: npx eslint {staged_files} # keep me\n');
  await cli(dir, ['install', '--skip-ci']);
  const text = read(dir, 'lefthook.yml');
  assert.match(text, /# our hooks/);
  assert.match(text, /# keep me/);
  assert.deepEqual(parse(text)['pre-commit'].commands, { lint: { run: 'npx eslint {staged_files}' }, harness: { run: 'sh .harness/hooks/pre-commit.sh' } });
  assert.equal(existsSync(path.join(dir, '.github/workflows/harness.yml')), false, '--skip-ci');
  assert.match((await cli(dir, ['install'])).stdout, /lefthook\.yml already runs harness/);
});

test('no hook manager: explains what to do, installs nothing', async () => {
  const dir = exampleRepo('vite-react');
  pkg(dir, {});
  const r = await cli(dir, ['install']);
  assert.match(r.stdout, /No Husky or lefthook found, so no git hook was added/);
  assert.match(r.stdout, /@harness\/cli is not in package\.json/);
  assert.equal(existsSync(path.join(dir, '.husky')), false);
  assert.equal(existsSync(path.join(dir, 'node_modules')), false);
});

test('CI workflow follows the package manager: pnpm with and without packageManager', async () => {
  const dir = huskyRepo();
  write(dir, 'pnpm-lock.yaml', 'lockfileVersion: 9.0\n');
  await cli(dir, ['install']);
  const steps = parse(read(dir, '.github/workflows/harness.yml')).jobs.harness.steps;
  assert.equal(steps[1].uses, 'pnpm/action-setup@v4');
  assert.match(String(steps[1].with.version), /^\d+$/);
  assert.equal(steps[2].with.cache, 'pnpm');
  assert.equal(steps[3].run, 'pnpm install --frozen-lockfile');

  pkg(dir, { packageManager: 'pnpm@10.12.1', devDependencies: { husky: '^9' } });
  await cli(dir, ['install', '--force']);
  const forced = parse(read(dir, '.github/workflows/harness.yml')).jobs.harness.steps;
  assert.equal(forced[1].with, undefined, 'version comes from packageManager');
});

test('--dry-run writes nothing; no package.json is an error', async () => {
  const dir = huskyRepo();
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  const r = await cli(dir, ['install', '--dry-run']);
  assert.match(r.stdout, /dry run, nothing written/);
  assert.match(r.stdout, /16 file\(s\) added/);
  assert.equal(git(dir, 'status', '--porcelain'), '');

  const empty = exampleRepo('vite-react');
  writeFileSync(path.join(empty, 'package.json'), '{ broken');
  assert.match((await cli(empty, ['install'])).stderr, /package\.json is not valid JSON/);
});
