// reins doctor: process rules, local and informational. Unlike `check`, it looks at files the agent writes
// (triage.log, the progress notebook) and at the local diff. It never blocks (warn only), never uses the
// baseline or a language adapter, and must not run in CI or in the git hook.
// Pure: the caller reads the files and git state and passes them in.
import { checkTriage, parseTriageLog, scopeSignals, suggestLevel } from './triage.js';
import { checkNotes } from './notes.js';
import { checkNotebook, countLines } from './progress.js';

export const DOCTOR_RULES = Object.freeze(['triage-mismatch', 'triage-missing', 'agents-size', 'progress-hot-size', 'progress-format', 'progress-closed',
  'note-missing', 'note-outdated', 'note-draft', 'note-size', 'note-layout', 'note-dead-paths', 'note-dead-refs']);

/**
 * @param {object} input
 * @param {import('./config.js').DoctorConfig} input.config thresholds
 * @param {string} input.branch
 * @param {string[]} input.changedFiles repo-relative files changed on this branch (committed or not)
 * @param {{ name: string, paths: string[], publicApi: string[] }[]} input.domains from architecture.yml (may be empty)
 * @param {string} input.architectureFile
 * @param {{ file: string, text: string | null, log?: ReturnType<typeof parseTriageLog> | null }} input.triageLog `log`: already
 *   parsed and without the lines that no longer matter (the CLI drops gone branches and merged tasks); else `text` is parsed
 * @param {string | null} [input.anchor] start commit of the current task; `changedFiles` is then the task's diff
 * @param {{ file: string, text: string | null }} input.agentsMd
 * @param {{ file: string, text: string }[]} input.notebooks hot notebooks to check (usually the current branch's)
 * @param {{ file: string, paths: string[], body: string }[]} [input.notes] module notes of the repo
 * @param {string[] | null} [input.repoFiles] every file of the repo; without it the note-dead-* rules are skipped
 * @returns {import('../check/index.js').CheckResult}
 */
export function runDoctor({ config, branch, changedFiles, domains, architectureFile, triageLog, agentsMd, notebooks, notes = [], repoFiles = null, anchor = null }) {
  const findings = [];
  const signals = scopeSignals(changedFiles, domains, architectureFile);

  findings.push(
    ...checkTriage({
      branch,
      changedFiles,
      log: triageLog.log ?? (triageLog.text === null ? null : parseTriageLog(triageLog.text)),
      logFile: triageLog.file,
      signals,
      thresholds: config.triage,
      anchor,
    }),
  );

  if (agentsMd.text !== null) {
    const n = countLines(agentsMd.text);
    if (n > config.agents_md.max_lines) {
      findings.push({
        rule: 'agents-size', severity: 'warn', key: `agents-size|${agentsMd.file}`, from: agentsMd.file,
        message: `${agentsMd.file} has ${n} lines; the limit is ${config.agents_md.max_lines}. Every line is paid on every session.`,
        fix: 'Keep only what is needed always; move the rest to a policy or a module note and link it under "On demand".',
      });
    }
  }

  findings.push(
    ...checkNotes({ changedFiles, notes, domains, planChanged: changedFiles.includes(architectureFile), level: suggestLevel(signals, config.triage).level, maxLines: config.notes.max_lines, repoFiles }),
  );

  for (const nb of notebooks) findings.push(...checkNotebook({ file: nb.file, text: nb.text, maxLines: config.progress.hot_max_lines }));

  const violations = findings.map((f) => ({ ...f, status: /** @type {const} */ ('new') }));
  return {
    ok: true,
    partial: false,
    violations,
    stale: [],
    summary: { new: violations.length, newErrors: 0, newWarnings: violations.length, baseline: 0, stale: 0 },
  };
}

export { parseDoctorConfig, DOCTOR_DEFAULTS } from './config.js';
export { LEVELS, parseTriageLog, formatTriageLine, taskAnchor, scopeSignals, suggestLevel } from './triage.js';
export {
  parseNotebook, formatProblems, notebookFile, taskFolder, branchFolder, PROGRESS_DIR, NOTEBOOK_NAME, TASK_RE, formatHeader, summarizeNotebook,
  cleanupPlan, MARKERS, countLines,
} from './progress.js';
