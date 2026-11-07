import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cli, tempDir } from './helpers.js';

test('update dry-run uses the project package manager and runs its installed reins sync', async () => {
  const cases = [
    { lock: 'pnpm-lock.yaml', manager: 'pnpm', update: 'pnpm add -D @agentreins/cli@latest @agentreins/adapter-js@latest', sync: 'pnpm exec reins sync' },
    { lock: 'yarn.lock', manager: 'yarn', update: 'yarn add -D @agentreins/cli@latest @agentreins/adapter-js@latest', sync: 'yarn run reins sync' },
    { lock: 'bun.lock', manager: 'bun', update: 'bun add -d @agentreins/cli@latest @agentreins/adapter-js@latest', sync: 'bun run reins sync' },
    { lock: null, manager: 'npm', update: 'npm install -D @agentreins/cli@latest @agentreins/adapter-js@latest', sync: 'npm exec -- reins sync' },
  ];

  for (const { lock, manager, update, sync } of cases) {
    const files = {
      'package.json': JSON.stringify({ devDependencies: { '@agentreins/adapter-js': '^0.7.0' } }),
    };
    if (lock) files[lock] = '';
    const result = await cli(tempDir(files), ['update', '--dry-run']);
    assert.equal(result.code, 0, `${manager}: ${result.stderr}`);
    assert.match(result.stdout, new RegExp(update.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(result.stdout, new RegExp(sync.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('update --skip-claude keeps the package-manager sync provider-neutral', async () => {
  const result = await cli(tempDir({
    'package.json': JSON.stringify({}),
    'pnpm-lock.yaml': '',
  }), ['update', '--dry-run', '--skip-claude']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /pnpm exec reins sync --skip-claude/);
});

test('update --claude re-enables Claude Code integration after an opt-out', async () => {
  const result = await cli(tempDir({
    'package.json': JSON.stringify({}),
    'pnpm-lock.yaml': '',
  }), ['update', '--dry-run', '--claude']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /pnpm exec reins sync --claude/);
});

test('update rejects conflicting Claude adapter options before updating dependencies', async () => {
  const result = await cli(tempDir({
    'package.json': JSON.stringify({}),
    'pnpm-lock.yaml': '',
  }), ['update', '--dry-run', '--claude', '--skip-claude']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Use either --claude or --skip-claude/);
  assert.doesNotMatch(result.stdout, /updating/);
});
