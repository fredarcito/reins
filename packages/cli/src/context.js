// Where things live in a consumer repo, and small path helpers.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const REINS_DIR = '.reins';
export const ARCHITECTURE_FILE = `${REINS_DIR}/architecture.yml`;
export const BASELINE_FILE = `${REINS_DIR}/baseline.json`;
export const INIT_REPORT_FILE = `${REINS_DIR}/init-report.md`;

/** Git root of `cwd`, or `cwd` itself when it is not inside a git repo. */
export function findRepoRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return cwd;
  }
}

export const isGitRepo = (root) => existsSync(path.join(root, '.git'));

/** Repo-relative POSIX path. */
export const toRepoPath = (root, cwd, file) => path.relative(root, path.resolve(cwd, file)).split(path.sep).join('/');

/** Install command for the package manager the repo uses. */
export function installCommand(root, pkg) {
  if (existsSync(path.join(root, 'pnpm-lock.yaml'))) return `pnpm add -D ${pkg}`;
  if (existsSync(path.join(root, 'yarn.lock'))) return `yarn add -D ${pkg}`;
  if (existsSync(path.join(root, 'bun.lockb')) || existsSync(path.join(root, 'bun.lock'))) return `bun add -d ${pkg}`;
  return `npm install -D ${pkg}`;
}

/** How to run a package.json script with the repo's package manager. */
export function runScriptCommand(root, script) {
  if (existsSync(path.join(root, 'pnpm-lock.yaml'))) return `pnpm ${script}`;
  if (existsSync(path.join(root, 'yarn.lock'))) return `yarn ${script}`;
  if (existsSync(path.join(root, 'bun.lockb')) || existsSync(path.join(root, 'bun.lock'))) return `bun run ${script}`;
  return script === 'test' ? 'npm test' : `npm run ${script}`;
}

/** Error with an exit code; the message is shown as is. */
export class CliError extends Error {
  /** @param {string} message @param {number} [exitCode] */
  constructor(message, exitCode = 2) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

/**
 * The event name a hook response must carry, in Claude Code's spelling. Cursor runs the same hooks from
 * .claude/settings.json but sends its own spelling (`preToolUse`, `sessionStart`; VERIFIED P12).
 * @param {unknown} name the payload's `hook_event_name`
 * @param {string} fallback
 */
export const hookEventName = (name, fallback) => (typeof name === 'string' && name ? name[0].toUpperCase() + name.slice(1) : fallback);
