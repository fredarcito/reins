// Shared test helpers (not a test file: the runner only picks *.test.js).
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '@harness/cli';

export const cliDir = fileURLToPath(new URL('..', import.meta.url));
export const examplesDir = fileURLToPath(new URL('../../../examples/', import.meta.url));

export const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });

/** Copy of an example in a fresh git repo with one commit on main. keepHarness: keep its .harness/ folder. */
export function exampleRepo(name, { keepHarness = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), `harness-cli-${name}-`));
  cpSync(path.join(examplesDir, name), dir, { recursive: true });
  if (!keepHarness) rmSync(path.join(dir, '.harness'), { recursive: true, force: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

/** Temp folder with the given files. */
export function tempDir(files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-cli-'));
  for (const [f, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

/** Runs the CLI in `cwd` and captures its output. The adapter is resolved from this monorepo (dev dependency). */
export async function cli(cwd, args, extra = {}) {
  let stdout = '';
  let stderr = '';
  const code = await run(args, {
    cwd,
    out: (s) => (stdout += s + '\n'),
    err: (s) => (stderr += s + '\n'),
    adapterSearchPaths: [cliDir],
    env: {},
    today: '2026-11-04',
    ...extra,
  });
  return { code, stdout, stderr };
}
