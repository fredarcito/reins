// Triage: the agent declares a task level (small | medium | large) in .reins/progress/triage.log,
// one line per task: `YYYY-MM-DD | branch | level | reason`. The doctor compares the highest level declared on
// the branch with the branch diff.
import { matchesAny } from '../glob.js';

export const LEVELS = Object.freeze(['small', 'medium', 'large']);
const rank = (level) => LEVELS.indexOf(level);

/**
 * @typedef {{ line: number, date: string, branch: string, level: string, reason: string }} TriageEntry
 */

/**
 * @param {string} text contents of triage.log
 * @returns {{ entries: TriageEntry[], malformed: { line: number, text: string }[] }}
 */
export function parseTriageLog(text) {
  const entries = [];
  const malformed = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const parts = line.split('|').map((s) => s.trim());
    const [date, branch, level, ...rest] = parts;
    const reason = rest.join(' | ');
    if (parts.length < 4 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !branch || !LEVELS.includes(level) || !reason) {
      malformed.push({ line: i + 1, text: line });
    } else {
      entries.push({ line: i + 1, date, branch, level, reason });
    }
  });
  return { entries, malformed };
}

/** Agent instructions and generated tool files: they change with the work but are not "files of the task". */
export const isReinsFile = (f) => /^(\.reins|\.claude)\//.test(f) || f === 'AGENTS.md' || f === 'CLAUDE.md';

/**
 * Objective signals of a set of changed files. Reins and agent files (.reins/, .claude/, AGENTS.md, CLAUDE.md)
 * don't count as files or domains; touching architecture.yml is reported on its own.
 * @param {string[]} files repo-relative changed files
 * @param {{ name: string, paths: string[], publicApi: string[] }[]} domains from architecture.yml
 * @param {string} architectureFile repo-relative path of architecture.yml
 */
export function scopeSignals(files, domains, architectureFile) {
  const touched = new Set();
  const publicApi = [];
  const counted = files.filter((f) => !isReinsFile(f));
  for (const f of counted) {
    const d = domains.find((x) => matchesAny(f, x.paths));
    if (!d) continue;
    touched.add(d.name);
    if (matchesAny(f, d.publicApi)) publicApi.push(f);
  }
  return { files: counted.length, domains: [...touched].sort(), publicApi, architecture: files.includes(architectureFile) };
}

/**
 * Minimum level suggested by the signals (same thresholds as `reins scope`):
 * small: ≤ max_files files in ≤ max_domains domain; medium: more files, still ≤ medium.max_domains domain;
 * large: more domains, a public API, or architecture.yml.
 * @param {ReturnType<typeof scopeSignals>} s
 * @param {import('./config.js').DoctorConfig['triage']} t
 * @returns {{ level: 'small'|'medium'|'large', reasons: string[] }}
 */
export function suggestLevel(s, t) {
  const large = [];
  if (s.domains.length > t.medium.max_domains) large.push(`${s.domains.length} domains (${s.domains.join(', ')})`);
  if (s.publicApi.length) large.push(`touches a public API (${s.publicApi.join(', ')})`);
  if (s.architecture) large.push('touches architecture.yml');
  if (large.length) return { level: 'large', reasons: large };
  const medium = [];
  if (s.files > t.small.max_files) medium.push(`${s.files} files (small allows ${t.small.max_files})`);
  if (s.domains.length > t.small.max_domains) medium.push(`${s.domains.length} domains (small allows ${t.small.max_domains})`);
  if (medium.length) return { level: 'medium', reasons: medium };
  return { level: 'small', reasons: [`${s.files} file(s) in ${s.domains.length || 'no'} domain${s.domains.length === 1 ? '' : 's'}`] };
}

/**
 * triage-missing and triage-mismatch.
 * @param {{ branch: string, changedFiles: string[], log: ReturnType<typeof parseTriageLog> | null, logFile: string,
 *   signals: ReturnType<typeof scopeSignals>, thresholds: import('./config.js').DoctorConfig['triage'] }} input
 * @returns {import('../check/shared.js').Violation[]}
 */
export function checkTriage({ branch, changedFiles, log, logFile, signals, thresholds }) {
  const out = [];
  const add = (rule, key, message, fix) => out.push({ rule, severity: 'warn', key: `${rule}|${key}`, from: logFile, message, fix });
  for (const m of log?.malformed ?? []) {
    add('triage-missing', `malformed|${m.line}`, `${logFile} line ${m.line} can't be read: "${m.text}".`,
      'Use one line per task: `YYYY-MM-DD | branch | small|medium|large | reason`.');
  }
  if (!signals.files && !signals.architecture) return out; // nothing but notes, notebook or generated files changed
  const mine = (log?.entries ?? []).filter((e) => e.branch === branch);
  if (!mine.length) {
    add('triage-missing', branch, `Branch ${branch} has ${changedFiles.length} changed file(s) but no line in ${logFile}.`,
      `When announcing the task level, append: \`${new Date().toISOString().slice(0, 10)} | ${branch} | <small|medium|large> | <reason>\`.`);
    return out;
  }
  // The diff covers the whole branch, so it is compared with the highest level declared on it, not the latest
  // line: a small task (or a read-only one) after a large one must not make the large diff look undeclared.
  // On ties the latest line wins, since its reason is the most current.
  const declared = mine.reduce((best, e) => (rank(e.level) >= rank(best.level) ? e : best));
  const suggested = suggestLevel(signals, thresholds);
  if (rank(suggested.level) > rank(declared.level)) {
    add('triage-mismatch', branch,
      `Highest level declared on ${branch} is ${declared.level} (line ${declared.line}: "${declared.reason}"), but the diff looks ${suggested.level}: ${suggested.reasons.join('; ')}.`,
      `If the task grew, say so and append a new line with level ${suggested.level}. If the thresholds are wrong for this repo, tune .reins/doctor.yml.`);
  }
  return out;
}
