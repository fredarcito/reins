// Thin wrapper around the git CLI. The core depends on Node + git only.
import { execFileSync } from 'node:child_process';

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string | null} stdout, or null if git failed
 */
export function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/**
 * Commit where the current branch forked from `baseRef` (e.g. "origin/main").
 * @returns {string | null}
 */
export function mergeBase(cwd, baseRef) {
  return git(cwd, ['merge-base', 'HEAD', baseRef])?.trim() || null;
}

/**
 * Contents of a file at a commit, or null if it doesn't exist there.
 * @param {string} cwd repo root
 * @param {string} commit
 * @param {string} file repo-relative POSIX path
 */
export function showFile(cwd, commit, file) {
  return git(cwd, ['show', `${commit}:${file}`]);
}
