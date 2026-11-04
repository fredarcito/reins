// baseline.json freezes the violations that already exist, so `check` starts green and only fails on new ones.
// The file is deterministic (sorted, no timestamps) so that changes to it show up clearly in a diff.
import { cmp } from './shared.js';

export const BASELINE_VERSION = 1;

/**
 * @typedef {{ rule: string, key: string, from: string, to?: string }} BaselineEntry
 * @typedef {{ version: number, violations: BaselineEntry[] }} Baseline
 */

/**
 * @param {import('./shared.js').Violation[]} violations
 * @returns {Baseline}
 */
export function createBaseline(violations) {
  const seen = new Set();
  const entries = [];
  for (const v of violations) {
    if (v.rule === 'integrity' || seen.has(v.key)) continue;
    seen.add(v.key);
    entries.push({ rule: v.rule, key: v.key, from: v.from, ...(v.to ? { to: v.to } : {}) });
  }
  return { version: BASELINE_VERSION, violations: entries.sort((a, b) => cmp(a.key, b.key)) };
}

/** @param {Baseline} baseline */
export const serializeBaseline = (baseline) => `${JSON.stringify(baseline, null, 2)}\n`;

/**
 * @param {string} text contents of baseline.json
 * @returns {Baseline}
 * @throws {Error} with a clear message when the file is not a valid baseline
 */
export function parseBaseline(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`baseline.json is not valid JSON: ${e.message}`);
  }
  if (!data || data.version !== BASELINE_VERSION || !Array.isArray(data.violations)) {
    throw new Error(`baseline.json must look like { "version": ${BASELINE_VERSION}, "violations": [...] }`);
  }
  data.violations.forEach((v, i) => {
    if (!v || typeof v.key !== 'string' || typeof v.rule !== 'string') {
      throw new Error(`baseline.json: violations[${i}] needs "rule" and "key"`);
    }
  });
  return data;
}

/** An empty baseline, for repos that don't have the file yet. */
export const emptyBaseline = () => ({ version: BASELINE_VERSION, violations: [] });
