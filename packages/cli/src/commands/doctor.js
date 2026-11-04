// harness doctor: local, informational process rules. Exit 0 unless --strict. Skipped in CI.
// Reads triage.log, the current branch's notebook, AGENTS.md and the local diff. No baseline, no adapter.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CORE_RULES, ConfigError, parseConfig, parseDoctorConfig, runDoctor, notebookFile, formatText, formatJson } from '@harness/core';
import { ARCHITECTURE_FILE, CliError, HARNESS_DIR, isGitRepo } from '../context.js';
import { pickBaseRef } from './check.js';

export const DOCTOR_FILE = `${HARNESS_DIR}/doctor.yml`;
export const TRIAGE_LOG = `${HARNESS_DIR}/progress/triage.log`;
const LOCAL_DIRS = [`${HARNESS_DIR}/progress/`, `${HARNESS_DIR}/backlog/`];

export const options = {
  strict: { type: 'boolean' },
  json: { type: 'boolean' },
  base: { type: 'string' },
};

export const help = `Usage: harness doctor [options]

Local, informational checks of the workflow: triage log vs. the diff, AGENTS.md size, progress notebook
format. Never blocks (exit 0) unless --strict. Not meant for CI or git hooks: it is skipped when CI is set.
Thresholds: ${DOCTOR_FILE}.

Options:
  --strict      Exit 1 when there is any warning
  --json        JSON output
  --base <ref>  Base branch to compute the diff of this branch (default: as in harness check)`;

const read = (root, f) => (existsSync(path.join(root, f)) ? readFileSync(path.join(root, f), 'utf8') : null);
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** Files changed on this branch compared to the base (committed, staged, unstaged and untracked). */
function changedFiles(root, baseRef) {
  const base = baseRef ? git(root, ['merge-base', 'HEAD', baseRef]).trim() : 'HEAD';
  const tracked = git(root, ['diff', '--name-only', base]).split('\n');
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard']).split('\n');
  return [...new Set([...tracked, ...untracked])].filter((f) => f && !LOCAL_DIRS.some((d) => f.startsWith(d))).sort();
}

/** Domains from architecture.yml, without needing the adapter (unknown rule ids are accepted here). */
function readDomains(root, notes) {
  const text = read(root, ARCHITECTURE_FILE);
  if (text === null) {
    notes.push(`${ARCHITECTURE_FILE} not found: triage can't count domains.`);
    return [];
  }
  const ids = [...text.matchAll(/\bid:\s*["']?([\w-]+)/g)].map((m) => m[1]);
  try {
    return parseConfig(text, { file: ARCHITECTURE_FILE, knownRules: [...new Set([...CORE_RULES, ...ids])] }).domains;
  } catch (e) {
    notes.push(`${ARCHITECTURE_FILE} is not valid, so triage can't count domains (run \`harness check\` to see why).`);
    return [];
  }
}

/**
 * @param {{ root: string, values: Record<string, any>, out: (s: string) => void, env?: NodeJS.ProcessEnv }} ctx
 * @returns {Promise<number>}
 */
export async function doctor(ctx) {
  const { root, values, out } = ctx;
  const env = ctx.env ?? process.env;
  if (env.CI) {
    out('harness doctor is local-only and was skipped because CI is set. Use `harness check` in CI.');
    return 0;
  }

  let config;
  try {
    config = parseDoctorConfig(read(root, DOCTOR_FILE), { file: DOCTOR_FILE });
  } catch (e) {
    if (e instanceof ConfigError) throw new CliError(e.message);
    throw e;
  }

  const notes = [];
  let branch = 'HEAD';
  let files = [];
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
    files = changedFiles(root, baseRef);
    if (!baseRef) notes.push('No base branch found: only uncommitted changes were compared.');
  }

  const nbFile = notebookFile(branch);
  const nbText = read(root, nbFile);
  const result = runDoctor({
    config,
    branch,
    changedFiles: files,
    domains: readDomains(root, notes),
    architectureFile: ARCHITECTURE_FILE,
    triageLog: { file: TRIAGE_LOG, text: read(root, TRIAGE_LOG) },
    agentsMd: { file: 'AGENTS.md', text: read(root, 'AGENTS.md') },
    notebooks: nbText === null ? [] : [{ file: nbFile, text: nbText }],
  });

  if (values.json) out(formatJson(result, { warnings: notes }));
  else out(formatText(result, { title: 'harness doctor', warnings: notes, baseline: false }));
  return values.strict && result.violations.length ? 1 : 0;
}
