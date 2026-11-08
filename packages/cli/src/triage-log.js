// The triage log (.reins/progress/triage.log) as doctor, resume and `reins triage` use it: which lines still
// matter, the current task's diff (since the commit it started from) and the automatic cleanup that resume runs.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { parseTriageLog, taskAnchor } from '@agentreins/core';
import { REINS_DIR, isGitRepo } from './context.js';
import { withFileLock, writeFileAtomic } from './local-state.js';
import { changedFiles, liveBranches, readText } from './project.js';

export const TRIAGE_LOG = `${REINS_DIR}/progress/triage.log`;

const run = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const ok = (root, args) => {
  try {
    run(root, args);
    return true;
  } catch {
    return false;
  }
};
const count = (root, args) => {
  try {
    return Number(run(root, ['rev-list', '--count', ...args]));
  } catch {
    return null;
  }
};

/** Whether `commit` is `ref` or one of its ancestors. False when either is unknown. */
export const isAncestor = (root, commit, ref) => ok(root, ['merge-base', '--is-ancestor', commit, ref]);

/**
 * Lines that no longer describe work in progress:
 * - their branch is gone (no local branch, no remote-tracking ref);
 * - or the task's work has landed: there are commits on the branch since the line's commit and all of them are
 *   already in the base. A task that has no commits yet is kept, even when its commit is in the base: that is
 *   where every task on main, or right after branching, starts.
 * Lines without a commit are only dropped with their branch. A rebased commit (no longer an ancestor) is kept.
 * @param {string} root
 * @param {{ line: number, branch: string, commit: string | null }[]} entries parsed triage.log lines
 * @param {string | null} baseRef
 * @returns {Set<number>} line numbers to drop
 */
export function staleLines(root, entries, baseRef) {
  const live = liveBranches(root);
  const landed = new Map();
  const isLanded = (branch, commit) => {
    const key = `${branch}\0${commit}`;
    if (!landed.has(key)) {
      const tip = /** @type {string} */ (live.get(branch));
      const since = isAncestor(root, commit, tip) ? count(root, [`${commit}..${tip}`]) : null;
      landed.set(key, Boolean(baseRef && since && count(root, [`${commit}..${tip}`, '--not', baseRef]) === 0));
    }
    return landed.get(key);
  };
  const drop = new Set();
  for (const e of entries) {
    if (!live.has(e.branch) || (e.commit && baseRef && isLanded(e.branch, e.commit))) drop.add(e.line);
  }
  return drop;
}

/**
 * The triage log with the stale lines left out (see `staleLines`).
 * @param {string} root
 * @param {string | null} baseRef
 * @returns {{ text: string | null, log: ReturnType<typeof parseTriageLog> | null, stale: Set<number> }} `stale` is empty outside git
 */
export function readTriage(root, baseRef) {
  const text = readText(root, TRIAGE_LOG);
  if (text === null) return { text, log: null, stale: new Set() };
  const parsed = parseTriageLog(text);
  const stale = isGitRepo(root) ? staleLines(root, parsed.entries, baseRef) : new Set();
  return { text, log: { entries: parsed.entries.filter((e) => !stale.has(e.line)), malformed: parsed.malformed }, stale };
}

/**
 * Removes the stale lines from triage.log (comments and unreadable lines stay). Run by resume at session start.
 * @returns {number} lines removed
 */
export function cleanTriageLog(root, baseRef) {
  const file = path.join(root, TRIAGE_LOG);
  return withFileLock(file, () => {
    const { text, stale } = readTriage(root, baseRef);
    if (!text || !stale.size) return 0;
    writeFileAtomic(file, text.split('\n').filter((_, i) => !stale.has(i + 1)).join('\n'));
    return stale.size;
  });
}

/**
 * The files of the current task: changed since the commit on the branch's latest triage line (plus uncommitted
 * changes). Falls back to the branch diff against the base when that line has no commit or the commit is no longer
 * an ancestor of HEAD (rebased).
 * @param {string} root
 * @param {ReturnType<typeof parseTriageLog> | null} log live lines (from `readTriage`)
 * @param {string} branch
 * @param {string | null} baseRef
 * @returns {{ files: string[], anchor: string | null }}
 */
export function taskFiles(root, log, branch, baseRef) {
  const anchor = taskAnchor(log?.entries ?? [], branch);
  if (anchor && isAncestor(root, anchor, 'HEAD')) return { files: changedFiles(root, { since: anchor }), anchor };
  return { files: changedFiles(root, { base: baseRef }), anchor: null };
}
