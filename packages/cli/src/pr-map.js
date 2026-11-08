// `reins review --map`: the architecture map of this branch compared with its merge base (all I/O lives here;
// the model and the Markdown are pure functions of @agentreins/core). See docs/proposals/pr-map.md.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  parseConfig, ConfigError, CORE_RULES, runCheck, emptyBaseline, impactOf, prStructure, renderPrMap,
} from '@agentreins/core';
import { ARCHITECTURE_FILE, REINS_DIR, CliError } from './context.js';
import { analyze, pickBaseRef } from './commands/check.js';

export const TMP_DIR = `${REINS_DIR}/tmp`;
const CHECKOUT_PREFIX = 'pr-map-base-';
const LOCAL_PREFIXES = [`${REINS_DIR}/progress/`, `${REINS_DIR}/backlog/`, `${TMP_DIR}/`];

/** Runs git and returns stdout. A failure becomes a CliError (exit 2) carrying git's own message. */
function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const detail = String(e.stderr ?? '').trim() || e.message;
    throw new CliError(`git ${args.join(' ')} failed: ${detail}`);
  }
}
const tryGit = (root, args) => {
  try {
    return git(root, args);
  } catch {
    return null;
  }
};

/**
 * `git diff --name-status -M -z` output (NUL separated, so names are never quoted or escaped) → changed files.
 * Copies count as added.
 * @returns {{ path: string, status: 'A'|'M'|'D'|'R', oldPath?: string }[]}
 */
export function parseNameStatus(text) {
  const out = [];
  const t = text.split('\0');
  for (let i = 0; i < t.length && t[i]; ) {
    const code = t[i];
    if (code.startsWith('R') || code.startsWith('C')) {
      const [a, b] = [t[i + 1], t[i + 2]];
      out.push(code.startsWith('R') ? { path: b, status: 'R', oldPath: a } : { path: b, status: 'A' });
      i += 3;
    } else {
      const f = t[i + 1];
      out.push({ path: f, status: code.startsWith('D') ? 'D' : code.startsWith('A') ? 'A' : 'M' });
      i += 2;
    }
  }
  return out;
}

/** Changed files since `base` (committed and uncommitted) plus untracked ones; reins' own local folders are never counted. */
export function changedSince(root, base) {
  const tracked = parseNameStatus(git(root, ['diff', '--name-status', '-M', '-z', base]));
  const seen = new Set(tracked.map((c) => c.path));
  const untracked = git(root, ['ls-files', '-z', '--others', '--exclude-standard']).split('\0')
    .filter((f) => f && !seen.has(f)).map((f) => ({ path: f, status: /** @type {const} */ ('A') }));
  return [...tracked, ...untracked].filter((c) => !LOCAL_PREFIXES.some((p) => c.path.startsWith(p) || c.oldPath?.startsWith(p)));
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

/**
 * Checks out `commit` in a git worktree inside the repo (one folder per process), runs `fn(dir)`, and always removes it
 * (also on errors and signals). Folders left by killed processes are removed first.
 * @template T
 * @param {string} root @param {string} commit @param {(dir: string) => Promise<T>} fn
 */
export async function withCheckout(root, commit, fn) {
  const tmp = path.join(root, TMP_DIR);
  const drop = (dir) => {
    tryGit(root, ['worktree', 'remove', '--force', dir]);
    rmSync(dir, { recursive: true, force: true });
  };
  if (existsSync(tmp)) {
    for (const name of readdirSync(tmp)) {
      const pid = Number(name.startsWith(CHECKOUT_PREFIX) ? name.slice(CHECKOUT_PREFIX.length) : NaN);
      if (Number.isInteger(pid) && !alive(pid)) drop(path.join(tmp, name));
    }
    tryGit(root, ['worktree', 'prune']);
  }
  const dir = path.join(tmp, `${CHECKOUT_PREFIX}${process.pid}`);
  mkdirSync(tmp, { recursive: true });
  git(root, ['worktree', 'add', '--detach', dir, commit]);
  const remove = () => {
    drop(dir);
    tryGit(root, ['worktree', 'prune']);
  };
  const handlers = ['SIGINT', 'SIGTERM'].map((sig) => [sig, () => { remove(); process.kill(process.pid, sig); }]);
  for (const [sig, h] of handlers) process.once(sig, h);
  try {
    return await fn(dir);
  } finally {
    for (const [sig, h] of handlers) process.removeListener(sig, h);
    remove();
  }
}

/** Parsed architecture.yml text; null when it can't be read. */
function parseAt(text, knownRules) {
  try {
    return parseConfig(text, { file: ARCHITECTURE_FILE, knownRules });
  } catch (e) {
    if (e instanceof ConfigError) return null;
    throw e;
  }
}

/**
 * @param {{ root: string, values: Record<string, any>, adapterSearchPaths?: string[], env?: NodeJS.ProcessEnv }} ctx
 * @returns {Promise<{ markdown: string, warnings: string[] }>}
 */
export async function buildPrMap(ctx) {
  const { root, values } = ctx;
  const warnings = [];
  const baseRef = pickBaseRef(root, values.base, ctx.env);
  const mergeBase = baseRef ? git(root, ['merge-base', 'HEAD', baseRef]).trim() : git(root, ['rev-parse', 'HEAD']).trim();
  const searchPaths = ctx.adapterSearchPaths;

  const head = await analyze(root, { searchPaths });
  const changed = changedSince(root, mergeBase);

  // domains of the base architecture.yml. Missing there: every head domain is new. Unreadable: say so, report none.
  const baseText = tryGit(root, ['show', `${mergeBase}:${ARCHITECTURE_FILE}`]);
  const knownRules = [...CORE_RULES, ...(head.adapter.rules ?? [])];
  let baseConfig = baseText === null ? null : parseAt(baseText, knownRules);
  let baseDomainNames = [];
  if (baseText !== null && !baseConfig) {
    warnings.push(`${ARCHITECTURE_FILE} could not be read at ${baseRef ?? 'HEAD'}: domains are not reported as new or removed.`);
    baseDomainNames = head.config.domains.map((d) => d.name);
  } else if (baseConfig) baseDomainNames = baseConfig.domains.map((d) => d.name);
  baseConfig = baseConfig ?? undefined;

  // The base graph is built by the HEAD adapter and config, never by whatever the checkout resolves: a PR that changes
  // the adapter (or the config) must not look like a change in the code's structure.
  const base = await withCheckout(root, mergeBase, async (dir) => {
    if (head.adapter.prepareCheckout) warnings.push(...(await head.adapter.prepareCheckout(dir, root)).warnings);
    return analyze(dir, { searchPaths }, { loaded: { adapter: head.adapter, packageName: head.packageName }, config: head.config });
  });
  warnings.push(...base.graph.warnings.map((w) => `base: ${w}`));

  const violationsOf = (a) => runCheck({ edges: a.graph.edges, config: head.config, baseline: emptyBaseline(), extra: a.extra }).violations;
  const baseKeys = new Set(violationsOf(base).map((v) => v.key));
  const newViolations = violationsOf(head).filter((v) => !baseKeys.has(v.key));

  const impacts = changed.filter((c) => c.status !== 'D').map((c) => ({
    file: c.path,
    importers: impactOf(c.path, head.graph.edges, head.config.domains, head.graph.uses).consumers.map((x) => x.file),
  }));

  const model = prStructure({
    baseEdges: base.graph.edges, headEdges: head.graph.edges, changed, config: head.config, baseConfig, baseDomainNames, newViolations, impacts,
    base: { label: baseRef ?? 'HEAD', sha: mergeBase.slice(0, 7) },
    analyzed: [...head.graph.files, ...base.graph.files],
  });
  return { markdown: renderPrMap(model), warnings };
}
