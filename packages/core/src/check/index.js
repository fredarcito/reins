// `check`: applies the architecture rules to the dependency edges and compares the result with the baseline.
// Pure: no file system, no git. Integrity findings are computed separately (integrity.js) and passed in.
import * as layerDirection from './rules/layer-direction.js';
import * as domainBoundary from './rules/domain-boundary.js';
import * as noCycles from './rules/no-cycles.js';
import { mergeEdges, cmp } from './shared.js';
import { matchesAny } from '../glob.js';

export const RULES = Object.freeze([layerDirection, domainBoundary, noCycles]);

/**
 * @typedef {import('./shared.js').Violation & { status: 'new' | 'baseline' }} CheckedViolation
 * @typedef {object} CheckResult
 * @property {boolean} ok                 false when there is at least one new violation with severity error
 * @property {boolean} partial            true when only some files were checked (stale entries are not computed)
 * @property {CheckedViolation[]} violations new ones first, then the ones in the baseline
 * @property {import('./baseline.js').BaselineEntry[]} stale baseline entries that no longer occur
 * @property {{ new: number, newErrors: number, newWarnings: number, baseline: number, stale: number }} summary
 */

/**
 * Runs every core rule on the edges.
 * @param {import('../contract/index.js').Edge[]} edges
 * @param {import('../config/index.js').Config} config
 * @returns {import('./shared.js').Violation[]}
 */
export function evaluate(edges, config) {
  const ignore = config.ignore ?? [];
  const kept = ignore.length ? edges.filter((e) => !matchesAny(e.from, ignore) && !matchesAny(e.to, ignore)) : edges;
  const merged = mergeEdges(kept);
  return RULES.flatMap((r) => r.run(merged, config));
}

/**
 * @param {object} input
 * @param {import('../contract/index.js').Edge[]} input.edges
 * @param {import('../config/index.js').Config} input.config
 * @param {import('./baseline.js').Baseline} input.baseline
 * @param {import('./shared.js').Violation[]} [input.extra] violations from other sources (integrity, adapter rules)
 * @param {string[]} [input.files] only report violations involving these files (pre-commit hook). Repo-relative paths
 * @returns {CheckResult}
 */
export function runCheck({ edges, config, baseline, extra = [], files }) {
  const frozen = new Set(baseline.violations.map((v) => v.key));
  const all = [...evaluate(edges, config), ...extra];
  const touched = files ? new Set(files) : null;
  const involved = (v) => !touched || [v.from, v.to, ...(v.files ?? [])].some((f) => f && touched.has(f)) || v.rule === 'integrity';

  /** @type {CheckedViolation[]} */
  const violations = all
    .filter(involved)
    .map((v) => ({ ...v, status: v.rule !== 'integrity' && frozen.has(v.key) ? 'baseline' : 'new' }))
    .sort((a, b) => (a.status === b.status ? cmp(a.key, b.key) : a.status === 'new' ? -1 : 1));

  const present = new Set(all.map((v) => v.key));
  const stale = touched ? [] : baseline.violations.filter((b) => !present.has(b.key));
  const fresh = violations.filter((v) => v.status === 'new');
  const newErrors = fresh.filter((v) => v.severity === 'error').length;
  return {
    ok: newErrors === 0,
    partial: Boolean(touched),
    violations,
    stale,
    summary: {
      new: fresh.length,
      newErrors,
      newWarnings: fresh.length - newErrors,
      baseline: violations.length - fresh.length,
      stale: stale.length,
    },
  };
}
