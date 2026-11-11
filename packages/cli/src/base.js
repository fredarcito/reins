// What reins compares a branch with: one place for check, review, the PR map, doctor and resume.
// Order (docs/DECISIONS.md): --base → the marks (the task's triage line, for task commands; the branch start that
// git records in its reflog) → REINS_BASE → GITHUB_BASE_REF → `base:` in architecture.yml → origin/HEAD, origin/main,
// origin/master, main, master. The marks come first because they say where this branch really started; the rest
// are guesses that are the same for every branch.
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import { ARCHITECTURE_FILE } from './context.js';
import { readText } from './project.js';

const DEFAULTS = ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master'];
/** Branches teams commonly cut tasks from when the default branch is main: `init` and `sync` suggest `base:` for them. */
const INTEGRATION_BRANCHES = ['staging', 'develop'];

/** @returns {string | null} trimmed stdout, or null when git fails */
const tryGit = (root, args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch {
    return null;
  }
};

export const refExists = (root, ref) => tryGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null;
const isAncestor = (root, commit, ref) => tryGit(root, ['merge-base', '--is-ancestor', commit, ref]) !== null;
const mergeBaseWith = (root, ref) => tryGit(root, ['merge-base', 'HEAD', ref]) || null;
const short = (sha) => sha.slice(0, 7);
const remoteNames = (root) => (tryGit(root, ['remote']) ?? '').split('\n').filter(Boolean);

/** `base:` in architecture.yml, or null. Read without validating the plan: resume runs this at session start. */
export function planBase(root) {
  try {
    const raw = parse(readText(root, ARCHITECTURE_FILE) ?? '');
    return typeof raw?.base === 'string' && raw.base.trim() ? raw.base.trim() : null;
  } catch {
    return null;
  }
}

/**
 * The base branch: `--base`, REINS_BASE, GITHUB_BASE_REF, `base:` in architecture.yml, then the defaults; the first
 * that exists. Names are used as written (`staging` is the local branch, `origin/staging` the remote one).
 * A name a person wrote (REINS_BASE, `base:`) that does not exist is never skipped silently: it gives a warning,
 * even when another one wins, so a typo does not wait for the day it matters. An explicit `--base` is returned
 * as is: the caller reports it missing.
 * @param {string} root
 * @param {string | undefined} explicit
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ ref: string | null, source: string | null, warnings: string[] }}
 */
export function baseBranch(root, explicit, env = process.env) {
  const warnings = [];
  const plan = planBase(root);
  const written = [
    { ref: env.REINS_BASE, source: 'REINS_BASE' },
    { ref: plan, source: `base in ${ARCHITECTURE_FILE}` },
  ].filter((c) => c.ref);
  const missing = new Set(written.filter((c) => !refExists(root, c.ref)).map((c) => c.source));
  for (const c of written.filter((x) => missing.has(x.source))) {
    warnings.push(`${c.source === 'REINS_BASE' ? 'REINS_BASE' : `base: in ${ARCHITECTURE_FILE}`} names "${c.ref}", which does not exist, so it was skipped. Fix the name (git branch -a lists them) or remove it.`);
  }
  if (explicit) return { ref: explicit, source: '--base', warnings };
  const candidates = [
    { ref: env.REINS_BASE, source: 'REINS_BASE' },
    { ref: env.GITHUB_BASE_REF && `origin/${env.GITHUB_BASE_REF}`, source: 'GITHUB_BASE_REF' },
    { ref: plan, source: `base in ${ARCHITECTURE_FILE}` },
    ...DEFAULTS.map((ref) => ({ ref, source: null })),
  ];
  for (const c of candidates) {
    if (c.ref && !missing.has(/** @type {string} */ (c.source)) && refExists(root, c.ref)) return { ...c, warnings };
  }
  return { ref: null, source: null, warnings };
}

/**
 * The branch HEAD was on right before `branch` was created at `commit`, from HEAD's reflog
 * ("checkout: moving from staging to task" — what `git checkout -b` and `git switch -c` write). Null for a detached HEAD.
 */
function movedFrom(root, branch, commit) {
  const log = tryGit(root, ['log', '-g', '--format=%H%x00%gs', 'HEAD', '--']);
  const suffix = ` to ${branch}`;
  const hit = (log ?? '').split('\n').reverse().map((l) => l.split('\0'))
    .find(([sha, subject]) => sha === commit && subject?.startsWith('checkout: moving from ') && subject.endsWith(suffix));
  const from = hit?.[1].slice('checkout: moving from '.length, -suffix.length);
  return from && !/^[0-9a-f]{7,64}$/.test(from) ? from : null;
}

/**
 * Where the current branch started, from git's reflog (it exists only in this clone): the commit of the branch's
 * "branch: Created from <x>" entry, and the branch it came from (<x>; for "HEAD", the branch HEAD moved from).
 * Null when it is not reliable: no such entry (a clone, `git fetch origin x:x`, `gh pr checkout`), a branch created
 * from its own remote branch (someone else's work: its start would hide their commits), or a start that is no
 * longer an ancestor of HEAD (rebased). The reflog expires (90 days by default): old branches have no mark.
 * @returns {{ commit: string, from: string | null } | null}
 */
export function branchStart(root) {
  const branch = tryGit(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
  if (!branch) return null;
  const log = tryGit(root, ['log', '-g', '--format=%H%x00%gs', `refs/heads/${branch}`, '--']);
  const first = log?.split('\n').filter(Boolean).at(-1)?.split('\0');
  const createdFrom = first?.[1]?.match(/^branch: Created from (.+)$/)?.[1];
  if (!first || !createdFrom) return null;
  const commit = first[0];
  const from = createdFrom === 'HEAD' ? movedFrom(root, branch, commit) : createdFrom.replace(/^refs\/(heads\/|remotes\/)?/, '');
  if (from && remoteNames(root).some((r) => from === `${r}/${branch}`)) return null;
  if (!isAncestor(root, commit, 'HEAD')) return null;
  return { commit, from };
}

/** The newest of some commits that lie on one line of history (each an ancestor of the next); null when empty. */
function newest(root, commits) {
  let best = null;
  for (const c of commits) if (!best || (c !== best && isAncestor(root, best, c))) best = c;
  return best;
}

/**
 * The commit to compare with, and what to call it in messages.
 * - `explicit` (`--base`): the merge base with it, always.
 * - `anchor` (task commands: the commit on the task's triage line), when still an ancestor of HEAD.
 * - The branch start (`branchStart`), except in CI (`CI` or `GITHUB_BASE_REF` set: the PR target decides there).
 *   When the branch it came from is known and still exists, the newest merge base with it (local or origin/) wins
 *   over the start: after merging or rebasing on staging, staging's commits are not this branch's work.
 * - Otherwise the merge base with `baseBranch`.
 * @param {string} root
 * @param {{ explicit?: string, env?: NodeJS.ProcessEnv, anchor?: string | null, base?: ReturnType<typeof baseBranch> }} [opts]
 * @returns {{ commit: string | null, ref: string | null, label: string, mark: 'task' | 'branch' | null, warnings: string[] }}
 *   commit null: nothing to compare with (no base, unknown --base, or no commits yet). `ref`: the base branch, for the
 *   triage.log cleanup. `label`: e.g. "origin/staging" or "the branch start (from staging)".
 */
export function comparison(root, { explicit, env = process.env, anchor = null, base = baseBranch(root, explicit, env) } = {}) {
  const out = { ref: base.ref, warnings: base.warnings };
  if (explicit) return { ...out, commit: mergeBaseWith(root, explicit), label: explicit, mark: null };
  if (anchor && isAncestor(root, anchor, 'HEAD')) return { ...out, commit: anchor, label: `the task start (its triage line, ${short(anchor)})`, mark: 'task' };
  const start = env.CI || env.GITHUB_BASE_REF ? null : branchStart(root);
  if (start) {
    const isRemote = start.from && remoteNames(root).some((r) => start.from?.startsWith(`${r}/`));
    const parents = start.from ? [start.from, ...(isRemote ? [] : [`origin/${start.from}`])] : [];
    const bases = parents.filter((r) => refExists(root, r)).map((r) => mergeBaseWith(root, r)).filter((c) => c && isAncestor(root, start.commit, c));
    const commit = /** @type {string} */ (newest(root, [start.commit, ...bases]));
    return { ...out, commit, label: start.from ? `the branch start (from ${start.from})` : 'the branch start', mark: 'branch' };
  }
  if (!base.ref) return { ...out, commit: null, label: 'HEAD', mark: null };
  return { ...out, commit: mergeBaseWith(root, base.ref), label: base.ref, mark: null };
}

/**
 * The branch to suggest for `base:` (`init`, `sync`): origin/staging or origin/develop when it exists, origin/HEAD is
 * main or master and the plan has no `base:` yet. The agent asks the person: in some teams staging is only a
 * deploy branch that main is merged into, and tasks start from main.
 * @returns {string | null}
 */
export function suggestBase(root) {
  if (planBase(root)) return null;
  const head = tryGit(root, ['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD']);
  if (head && !['origin/main', 'origin/master'].includes(head)) return null;
  return INTEGRATION_BRANCHES.map((b) => `origin/${b}`).find((r) => refExists(root, r)) ?? null;
}

/** The line `init` and `sync` print for `suggestBase`. */
export const suggestBaseHint = (ref) =>
  `Branch ${ref} exists next to main. If tasks branch from it (ask the person: in some teams it is only a deploy branch), add \`base: ${ref}\` to ${ARCHITECTURE_FILE}: reins compares with it when a branch has no start mark, for the whole team. If not, \`base: origin/main\` records that answer and stops this hint.`;
