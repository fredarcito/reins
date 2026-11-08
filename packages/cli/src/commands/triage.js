// reins triage: the agent records a task level in .reins/progress/triage.log. reins adds the date, the branch and
// the commit the task starts from (HEAD), so doctor and resume can look at this task's diff only.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { LEVELS, TASK_RE, formatTriageLine } from '@agentreins/core';
import { CliError, isGitRepo } from '../context.js';
import { withFileLock } from '../local-state.js';
import { branchTasks, explicitTask, resolveTask, sessionId } from '../notebooks.js';
import { readText } from '../project.js';
import { TRIAGE_LOG } from '../triage-log.js';

export const options = { task: { type: 'string' } };

export const help = `Usage: reins triage <small|medium|large> <reason> [--task <name>]

Records the level of the task you are starting in ${TRIAGE_LOG}, with today's date, the current branch and the
commit the task starts from (HEAD). Run it when announcing the level, and again with the new level when a task
escalates. reins doctor compares the level with this task's diff (since that commit, plus uncommitted changes).

Options:
  --task <name>  The task's name (default: the task this session claimed, when it has a notebook)`;

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const tryGit = (root, args) => {
  try {
    return git(root, args) || null;
  } catch {
    return null;
  }
};

/** @param {{ root: string, values: Record<string, any>, positionals: string[], out: (s: string) => void, env?: NodeJS.ProcessEnv, today?: string }} ctx */
export async function triage(ctx) {
  const { root, values, out } = ctx;
  const [level, ...words] = ctx.positionals;
  const reason = words.join(' ').replace(/\s+/g, ' ').trim();
  if (!LEVELS.includes(level) || !reason) throw new CliError(`Expected a level (${LEVELS.join(', ')}) and a reason.\n\n${help}`);
  if (values.task !== undefined && !TASK_RE.test(values.task)) throw new CliError(`Task names use letters, digits, ".", "_" and "-": got "${values.task}".`);
  if (!isGitRepo(root)) throw new CliError('Not a git repository: the triage log needs the branch and commit.');
  const branch = tryGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? tryGit(root, ['symbolic-ref', '--short', 'HEAD']) ?? 'HEAD';
  const env = ctx.env ?? process.env;
  const own = resolveTask(branchTasks(root, branch), { session: sessionId(env) });
  const task = explicitTask(values, env) ?? (own.guessed ? null : own.current?.task ?? null);
  const line = formatTriageLine({
    date: ctx.today ?? new Date().toISOString().slice(0, 10),
    branch,
    level,
    reason,
    commit: tryGit(root, ['rev-parse', '--short=12', 'HEAD']), // null before the first commit
    task,
  });
  const file = path.join(root, TRIAGE_LOG);
  withFileLock(file, () => {
    mkdirSync(path.dirname(file), { recursive: true });
    const current = readText(root, TRIAGE_LOG);
    appendFileSync(file, `${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`);
  });
  out(`Recorded in ${TRIAGE_LOG}: ${line}`);
  return 0;
}
