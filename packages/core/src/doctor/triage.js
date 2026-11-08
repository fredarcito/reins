// Triage: the agent declares a task level (small | medium | large) in .reins/progress/triage.log,
// one line per task: `YYYY-MM-DD | branch | level | reason`, optionally followed by `| commit:<sha>` (the commit the
// task started from, written by `reins triage`) and `| task:<name>`. With a commit, the doctor compares the current
// task's level with the diff since that commit; without one, the highest level declared on the branch with the
// branch diff.
import { matchesAny } from '../glob.js';

export const LEVELS = Object.freeze(['small', 'medium', 'large']);
const rank = (level) => LEVELS.indexOf(level);
const FIELD_RE = /^(commit|task):([^\s|]+)$/;

/**
 * @typedef {{ line: number, date: string, branch: string, level: string, reason: string, commit: string | null, task: string | null }} TriageEntry
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
    /** @type {Record<string, string>} */
    const fields = {};
    while (rest.length > 1 && FIELD_RE.test(rest[rest.length - 1])) {
      const [, key, value] = /** @type {RegExpExecArray} */ (FIELD_RE.exec(/** @type {string} */ (rest.pop())));
      fields[key] ??= value;
    }
    const reason = rest.join(' | ');
    if (parts.length < 4 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !branch || !LEVELS.includes(level) || !reason) {
      malformed.push({ line: i + 1, text: line });
    } else {
      entries.push({ line: i + 1, date, branch, level, reason, commit: fields.commit ?? null, task: fields.task ?? null });
    }
  });
  return { entries, malformed };
}

/**
 * One triage.log line.
 * @param {{ date: string, branch: string, level: string, reason: string, commit?: string | null, task?: string | null }} e
 */
export function formatTriageLine({ date, branch, level, reason, commit = null, task = null }) {
  return [date, branch, level, reason.replace(/\s+/g, ' ').trim(), commit && `commit:${commit}`, task && `task:${task}`].filter(Boolean).join(' | ');
}

/**
 * The commit the current task of a branch started from: the one on the branch's latest line, or null when that
 * line has none (written by hand or by an older reins).
 * @param {TriageEntry[]} entries
 * @param {string} branch
 */
export function taskAnchor(entries, branch) {
  const mine = entries.filter((e) => e.branch === branch);
  return mine.length ? mine[mine.length - 1].commit : null;
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
 * With `anchor` (the current task's start commit, see `taskAnchor`), `changedFiles` is the task's diff and only the
 * lines anchored at that commit count; without it, `changedFiles` is the branch diff and every line of the branch counts.
 * @param {{ branch: string, changedFiles: string[], log: ReturnType<typeof parseTriageLog> | null, logFile: string,
 *   signals: ReturnType<typeof scopeSignals>, thresholds: import('./config.js').DoctorConfig['triage'], anchor?: string | null }} input
 * @returns {import('../check/shared.js').Violation[]}
 */
export function checkTriage({ branch, changedFiles, log, logFile, signals, thresholds, anchor = null }) {
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
      'When announcing the task level, run `npx reins triage <small|medium|large> "<reason>"`.');
    return out;
  }
  // Tasks anchored at the same commit share the uncommitted diff, so the diff is compared with the highest level
  // among them, not the latest line: a small task (or a read-only one) after a large one must not make the large
  // diff look undeclared. Without an anchor the same holds for the whole branch. On ties the latest line wins,
  // since its reason is the most current.
  const window = anchor ? mine.filter((e) => e.commit === anchor) : [];
  const counted = window.length ? window : mine;
  const declared = counted.reduce((best, e) => (rank(e.level) >= rank(best.level) ? e : best));
  const suggested = suggestLevel(signals, thresholds);
  if (rank(suggested.level) > rank(declared.level)) {
    const what = window.length ? `Level declared for the current task on ${branch}` : `Highest level declared on ${branch}`;
    const diff = window.length ? `its diff (since ${anchor.slice(0, 7)})` : 'the diff';
    add('triage-mismatch', branch,
      `${what} is ${declared.level} (line ${declared.line}: "${declared.reason}"), but ${diff} looks ${suggested.level}: ${suggested.reasons.join('; ')}.`,
      `If the task grew, say so and run \`npx reins triage ${suggested.level} "<reason>"\`. If the thresholds are wrong for this repo, tune .reins/doctor.yml.`);
  }
  return out;
}
