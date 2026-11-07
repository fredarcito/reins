// .reins/doctor.yml: thresholds of the doctor. They are uncalibrated starting values, kept apart from
// architecture.yml so they can move without touching the architecture plan.
import { parseDocument } from 'yaml';
import { ConfigError } from '../config/index.js';

export const DOCTOR_DEFAULTS = Object.freeze({
  triage: { small: { max_files: 3, max_domains: 1 }, medium: { max_domains: 1 } },
  agents_md: { max_lines: 45 },
  progress: { hot_max_lines: 40 },
  notes: { max_lines: 60 },
});

/**
 * @typedef {{ triage: { small: { max_files: number, max_domains: number }, medium: { max_domains: number } },
 *   agents_md: { max_lines: number }, progress: { hot_max_lines: number }, notes: { max_lines: number } }} DoctorConfig
 */

const SHAPE = {
  triage: { small: { max_files: 0, max_domains: 0 }, medium: { max_domains: 0 } },
  agents_md: { max_lines: 0 },
  progress: { hot_max_lines: 0 },
  notes: { max_lines: 0 },
};

/**
 * Parses doctor.yml (or nothing) and merges it over the defaults. Unknown keys and non-numbers are errors.
 * @param {string | null} text
 * @param {{ file?: string }} [opts]
 * @returns {DoctorConfig}
 */
export function parseDoctorConfig(text, opts = {}) {
  const file = opts.file ?? 'doctor.yml';
  const result = structuredClone(DOCTOR_DEFAULTS);
  if (text === null || !text.trim()) return result;
  const doc = parseDocument(text);
  if (doc.errors.length) throw new ConfigError(file, doc.errors.map((e) => `YAML syntax: ${e.message.split('\n')[0]}`));
  const raw = doc.toJS();
  const problems = [];
  const walk = (value, shape, target, where) => {
    if (value === null || value === undefined) return;
    if (typeof value !== 'object' || Array.isArray(value)) return problems.push(`${where || '(root)'}: expected a mapping`);
    for (const [k, v] of Object.entries(value)) {
      const at = where ? `${where}.${k}` : k;
      if (!(k in shape)) problems.push(`${at}: unknown key (expected one of: ${Object.keys(shape).join(', ')})`);
      else if (typeof shape[k] === 'object') walk(v, shape[k], target[k], at);
      else if (!Number.isInteger(v) || v < 0) problems.push(`${at}: expected a whole number ≥ 0`);
      else target[k] = v;
    }
  };
  walk(raw, SHAPE, result, '');
  if (problems.length) throw new ConfigError(file, problems);
  return result;
}
