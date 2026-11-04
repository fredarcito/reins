// Integrity: nobody changes architecture.yml or baseline.json without it being noticed.
// Compares the current files with the ones at the base branch. It doesn't judge the change,
// it makes it visible (warn by default, `severity: error` in rules to make it block).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { mergeBase, showFile } from '../git.js';
import { parseBaseline } from './baseline.js';
import { render } from './shared.js';

export const id = 'integrity';

const MESSAGES = {
  architecture: {
    message: '{file} changed compared to {base}.',
    fix: 'Say why in the PR description. The architecture is decided by a person; an agent must not change it to make check pass.',
  },
  baselineGrew: {
    message: '{file} gained {count} violation(s) compared to {base}: {sample}.',
    fix: 'Fix the new violations instead of freezing them. If an exception is permanent, add it to allow: in architecture.yml with a reason.',
  },
  baselineInvalid: {
    message: '{file} is not a valid baseline: {error}',
    fix: 'Restore it from {base} or regenerate it with `harness check --update-baseline` and review the diff.',
  },
  noBase: {
    message: 'Could not compare with {base}: the ref was not found.',
    fix: 'In CI, fetch the base branch (e.g. actions/checkout with fetch-depth: 0) or pass the right ref with --base.',
  },
};

/**
 * Pure comparison of the base and current contents (null = file missing).
 * @param {{ base: { architecture: string|null, baseline: string|null }, head: { architecture: string|null, baseline: string|null },
 *   files: { architecture: string, baseline: string }, baseLabel: string, severity: 'error'|'warn' }} input
 * @returns {import('./shared.js').Violation[]}
 */
export function compareIntegrity({ base, head, files, baseLabel, severity }) {
  const out = [];
  const add = (kind, file, vars) =>
    out.push({
      rule: id,
      severity,
      key: `${id}|${kind}|${file}`,
      from: file,
      message: render(MESSAGES[kind].message, { file, base: baseLabel, ...vars }),
      fix: render(MESSAGES[kind].fix, { file, base: baseLabel, ...vars }),
    });

  const norm = (s) => (s ?? '').replace(/\r\n/g, '\n').trim();
  if (base.architecture !== null && norm(base.architecture) !== norm(head.architecture)) add('architecture', files.architecture, {});

  if (head.baseline !== null) {
    let headKeys;
    try {
      headKeys = parseBaseline(head.baseline).violations.map((v) => v.key);
    } catch (e) {
      add('baselineInvalid', files.baseline, { error: e.message });
      return out;
    }
    let baseKeys = new Set();
    if (base.baseline !== null) {
      try {
        baseKeys = new Set(parseBaseline(base.baseline).violations.map((v) => v.key));
      } catch {
        baseKeys = new Set(); // a broken base baseline: every current entry counts as added
      }
    }
    const added = headKeys.filter((k) => !baseKeys.has(k));
    if (base.baseline !== null && added.length) {
      const sample = added.slice(0, 3).join('; ') + (added.length > 3 ? '; …' : '');
      add('baselineGrew', files.baseline, { count: String(added.length), sample });
    }
  }
  return out;
}

/**
 * Reads the files from disk and from git and compares them.
 * When architecture.yml / baseline.json don't exist at the base (first adoption), there is nothing to compare.
 * @param {{ repoRoot: string, baseRef: string, architectureFile: string, baselineFile: string, severity: 'error'|'warn' }} opts
 *   architectureFile / baselineFile are repo-relative POSIX paths
 * @returns {import('./shared.js').Violation[]}
 */
export function checkIntegrity({ repoRoot, baseRef, architectureFile, baselineFile, severity }) {
  const commit = mergeBase(repoRoot, baseRef);
  if (!commit) {
    return [{ rule: id, severity: 'warn', key: `${id}|noBase|${baseRef}`, from: baseRef,
      message: render(MESSAGES.noBase.message, { base: baseRef }), fix: render(MESSAGES.noBase.fix, { base: baseRef }) }];
  }
  const read = (f) => (existsSync(path.join(repoRoot, f)) ? readFileSync(path.join(repoRoot, f), 'utf8') : null);
  return compareIntegrity({
    base: { architecture: showFile(repoRoot, commit, architectureFile), baseline: showFile(repoRoot, commit, baselineFile) },
    head: { architecture: read(architectureFile), baseline: read(baselineFile) },
    files: { architecture: architectureFile, baseline: baselineFile },
    baseLabel: baseRef,
    severity,
  });
}
