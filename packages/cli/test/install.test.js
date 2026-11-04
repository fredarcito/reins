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
  const dir = exampleRepo('vite-react', { keepReins: false }); // a repo before adopting reins
  pkg(dir, { devDependencies: { husky: '^9.1.7', '@agentreins/cli': '^0.1.0' } });
  mkdirSync(path.join(dir, '.husky'));
  return dir;
}

test('husky repo: sources, .gitignore, script, hook, CI workflow and sync, in one go', async () => {
  const dir = huskyRepo();
  const r = await cli(dir, ['install']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /\.reins\/ sources: 20 file\(s\) added/);
  for (const f of ['.reins/policies/triage.md', '.reins/skills/audit/SKILL.md', '.reins/agents/reviewer.md', '.reins/doctor.yml', 'AGENTS.md', 'CLAUDE.md', '.claude/settings.json', '.reins/.generated.json']) {
    assert.ok(existsSync(path.join(dir, f)), f);
  }
  assert.ok(statSync(path.join(dir, '.reins/hooks/pre-commit.sh')).mode & 0o100, 'hook script is executable');
  assert.match(read(dir, '.gitignore'), /# reins: local state \(not shared\)\n\.reins\/backlog\/\n\.reins\/progress\/\n\.reins\/init-report\.md\n$/);
  assert.equal(JSON.parse(read(dir, 'package.json')).scripts['reins:check'], 'reins check');
  assert.equal(read(dir, '.husky/pre-commit'), 'sh .reins/hooks/pre-commit.sh\n');
  assert.ok(statSync(path.join(dir, '.husky/pre-commit')).mode & 0o100);

  const wf = parse(read(dir, '.github/workflows/reins.yml'));
  assert.deepEqual(wf.on, { pull_request: null, push: { branches: ['main'] } });
  const runs = wf.jobs.reins.steps.map((s) => s.run ?? s.uses);
  assert.deepEqual(runs, ['actions/checkout@v4', 'actions/setup-node@v4', 'npm ci', 'npx reins check']);
  assert.equal(wf.jobs.reins.steps[0].with['fetch-depth'], 0);

  assert.match(r.stdout, /No \.reins\/architecture\.yml yet: run `npx reins init`/);
  assert.match(r.stdout, /protect the main branch/);
  assert.doesNotMatch(r.stdout, /@agentreins\/cli is not in package\.json: install it/);
});

test('install is idempotent and never overwrites existing files', async () => {
  const dir = huskyRepo();
  write(dir, '.reins/policies/triage.md', 'our own policy\n');
  write(dir, '.husky/pre-commit', 'npm test');
  write(dir, '.gitignore', 'node_modules\n.reins/progress/\n');
  await cli(dir, ['install']);
  assert.equal(read(dir, '.reins/policies/triage.md'), 'our own policy\n');
  assert.equal(read(dir, '.husky/pre-commit'), 'npm test\nsh .reins/hooks/pre-commit.sh\n');
  assert.equal(read(dir, '.gitignore'), 'node_modules\n.reins/progress/\n\n# reins: local state (not shared)\n.reins/backlog/\n.reins/init-report.md\n');

  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'install');
  const again = await cli(dir, ['install']);
  assert.match(again.stdout, /0 file\(s\) added, 20 already there \(kept\)/);
  assert.match(again.stdout, /already ignores the local reins folders/);
  assert.match(again.stdout, /script "reins:check" already exists \(kept\)/);
  assert.match(again.stdout, /\.husky\/pre-commit already runs reins/);
  assert.match(again.stdout, /reins\.yml already exists \(kept; --force to overwrite\)/);
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
  assert.deepEqual(parse(text)['pre-commit'].commands, { lint: { run: 'npx eslint {staged_files}' }, reins: { run: 'sh .reins/hooks/pre-commit.sh' } });
  assert.equal(existsSync(path.join(dir, '.github/workflows/reins.yml')), false, '--skip-ci');
  assert.match((await cli(dir, ['install'])).stdout, /lefthook\.yml already runs reins/);
});

test('no hook manager: explains what to do, installs nothing', async () => {
  const dir = exampleRepo('vite-react');
  pkg(dir, {});
  const r = await cli(dir, ['install']);
  assert.match(r.stdout, /No Husky or lefthook found, so no git hook was added/);
  assert.match(r.stdout, /@agentreins\/cli is not in package\.json: install it/);
  assert.equal(existsSync(path.join(dir, '.husky')), false);
  assert.equal(existsSync(path.join(dir, 'node_modules')), false);
});

test('CI workflow follows the package manager: pnpm with and without packageManager', async () => {
  const dir = huskyRepo();
  write(dir, 'pnpm-lock.yaml', 'lockfileVersion: 9.0\n');
  await cli(dir, ['install']);
  const steps = parse(read(dir, '.github/workflows/reins.yml')).jobs.reins.steps;
  assert.equal(steps[1].uses, 'pnpm/action-setup@v4');
  assert.match(String(steps[1].with.version), /^\d+$/);
  assert.equal(steps[2].with.cache, 'pnpm');
  assert.equal(steps[3].run, 'pnpm install --frozen-lockfile');

  pkg(dir, { packageManager: 'pnpm@10.12.1', devDependencies: { husky: '^9' } });
  await cli(dir, ['install', '--force']);
  const forced = parse(read(dir, '.github/workflows/reins.yml')).jobs.reins.steps;
  assert.equal(forced[1].with, undefined, 'version comes from packageManager');
});

test('--dry-run writes nothing; no package.json is an error', async () => {
  const dir = huskyRepo();
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  const r = await cli(dir, ['install', '--dry-run']);
  assert.match(r.stdout, /dry run, nothing written/);
  assert.match(r.stdout, /20 file\(s\) added/);
  assert.equal(git(dir, 'status', '--porcelain'), '');

  const empty = exampleRepo('vite-react');
  writeFileSync(path.join(empty, 'package.json'), '{ broken');
  assert.match((await cli(empty, ['install'])).stderr, /package\.json is not valid JSON/);
});

test('an AGENTS.md the repo already had keeps its content and gets the notes index block appended once', async () => {
  const dir = huskyRepo();
  write(dir, 'AGENTS.md', '# shop\nOur own rules.');
  write(dir, '.reins/notes/cart.md', '---\npaths: ["src/features/cart/**"]\n---\n## Purpose\nThe cart.\n');
  const dry = await cli(dir, ['install', '--dry-run']);
  assert.match(dry.stdout, /AGENTS\.md: appended the module notes index block/);
  assert.equal(read(dir, 'AGENTS.md'), '# shop\nOur own rules.', 'dry run writes nothing');

  const r = await cli(dir, ['install']);
  assert.match(r.stdout, /AGENTS\.md: appended the module notes index block \(kept everything else\)/);
  assert.equal(
    read(dir, 'AGENTS.md'),
    '# shop\nOur own rules.\n\n## Module notes\n- Before touching these paths, read their note:\n<!-- reins:notes:start (generated by reins sync) -->\n- `src/features/cart/**` → `.reins/notes/cart.md`\n<!-- reins:notes:end -->\n',
  );
  assert.equal((await cli(dir, ['sync', '--check'])).code, 0);
  const again = await cli(dir, ['install']);
  assert.doesNotMatch(again.stdout, /AGENTS\.md: appended/);
});
