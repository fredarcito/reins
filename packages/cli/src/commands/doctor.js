// reins doctor: local, informational process rules. Exit 0 unless --strict. Skipped in CI.
// Reads triage.log, the current branch's notebook, AGENTS.md and the local diff. No baseline, no adapter.
import { execFileSync } from 'node:child_process';
import { runDoctor, formatText, formatJson } from '@agentreins/core';
import { ARCHITECTURE_FILE, CliError, isGitRepo } from '../context.js';
import { DOCTOR_FILE, listNotebooks, listRepoFiles, loadNotes, readDoctorConfig, readDomains, readText as read } from '../project.js';
import { TRIAGE_LOG, readTriage, taskFiles } from '../triage-log.js';
import { pickBaseRef } from './check.js';

export const options = {
  strict: { type: 'boolean' },
  json: { type: 'boolean' },
  base: { type: 'string' },
};

export const help = `Usage: reins doctor [options]

Local, informational checks of the workflow: the current task's level vs. its diff (since the commit on its
triage line, or the branch diff when the line has none), AGENTS.md size, the format of every progress notebook
of the branch, the module notes of what the branch touched (missing, not updated, still a draft, too long) and, for every
note, paths that match no file and files it names that no longer exist. Never blocks (exit 0) unless --strict. Not meant for CI or git hooks: it is skipped when CI is set.
Thresholds: ${DOCTOR_FILE}.

Options:
  --strict      Exit 1 when there is any warning
  --json        JSON output
  --base <ref>  Base branch for the branch diff and for tasks already merged (default: as in reins check)`;

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * @param {{ root: string, values: Record<string, any>, out: (s: string) => void, env?: NodeJS.ProcessEnv }} ctx
 * @returns {Promise<number>}
 */
export async function doctor(ctx) {
  const { root, values, out } = ctx;
  const env = ctx.env ?? process.env;
  if (env.CI) {
    out('reins doctor is local-only and was skipped because CI is set. Use `reins check` in CI.');
    return 0;
  }

  const { result, notes } = doctorResult(root, values, env);
  if (values.json) out(formatJson(result, { warnings: notes }));
  else out(formatText(result, { title: 'reins doctor', warnings: notes, baseline: false }));
  return values.strict && result.violations.length ? 1 : 0;
}

/**
 * The doctor's findings for the current branch and task, without printing. Shared with `progress close`.
 * @param {string} root
 * @param {Record<string, any>} values
 * @param {NodeJS.ProcessEnv} env
 */
export function doctorResult(root, values, env) {
  const config = readDoctorConfig(root);

  const notes = [];
  let branch = 'HEAD';
  let files = [];
  let anchor = null;
  let triage = { text: read(root, TRIAGE_LOG), log: null };
  if (!isGitRepo(root)) notes.push('Not a git repository: triage rules were skipped.');
  else {
    branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    if (values.base) {
      try {
        git(root, ['rev-parse', '--verify', '--quiet', `${values.base}^{commit}`]);
      } catch {
        throw new CliError(`Base ref "${values.base}" not found.`);
      }
    }
    const baseRef = pickBaseRef(root, values.base, env);
    triage = readTriage(root, baseRef);
    ({ files, anchor } = taskFiles(root, triage.log, branch, baseRef));
    if (!baseRef && !anchor) notes.push('No base branch found: only uncommitted changes were compared.');
  }

  const result = runDoctor({
    config,
    branch,
    changedFiles: files,
    domains: readDomains(root, notes),
    architectureFile: ARCHITECTURE_FILE,
    triageLog: { file: TRIAGE_LOG, text: triage.text, log: triage.log },
    anchor,
    agentsMd: { file: 'AGENTS.md', text: read(root, 'AGENTS.md') },
    notebooks: listNotebooks(root, branch).map((n) => ({ file: n.file, text: n.text })),
    notes: loadNotes(root).notes,
    repoFiles: listRepoFiles(root),
  });

  return { result, notes };
}
