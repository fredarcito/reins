// reins triage: the agent records a task level in .reins/progress/triage.log. reins adds the date, the branch and
// the commit the task starts from (HEAD), so doctor and resume can look at this task's diff only.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { LEVELS, TASK_RE, formatTriageLine, scopeSignals, suggestLevel } from '@agentreins/core';
import { ARCHITECTURE_FILE, CliError, isGitRepo, toRepoPath } from '../context.js';
import { withFileLock } from '../local-state.js';
import { branchTasks, explicitTask, resolveTask, sessionId } from '../notebooks.js';
import { readDoctorConfig, readDomains, readText } from '../project.js';
import { TRIAGE_LOG } from '../triage-log.js';
import { levelDrift } from './doctor.js';
import { expand } from './scope.js';

export const options = { task: { type: 'string' }, files: { type: 'string', multiple: true }, override: { type: 'boolean' } };

export const help = `Usage: reins triage <reason> --files <a,b> [--task <name>]
       reins triage <small|medium|large> <reason> --files <a,b>     raise the measured level
       reins triage large <reason>                                  a task whose files can't be listed
       reins triage <small|large> <reason> --override               the person set the level ([quick], [deep])

Measures the level of the task you are starting and records it in ${TRIAGE_LOG}, with today's date, the current
branch and the commit the task starts from (HEAD). Run it before acting, and again when a task escalates.

reins measures the level from the files or folders you expect to touch (--files): domains, public APIs,
architecture.yml and the number of code files (docs and tests are not counted). You don't state a level; state
one only to raise it, when you know the task is bigger than its files show. reins records the higher of the two.
Without --files only large is accepted: a new feature, a migration, "review everything". When the task's diff
already looks bigger than the level recorded, it says so.

Options:
  --files <a,b>  Files or folders the task will touch: a,b or a b after a quoted reason (repeatable). Same measure as reins scope
  --override     Record the level as given, without measuring: the person chose it
  --task <name>  The task's name (default: the task this session claimed, when it has a notebook)`;

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const tryGit = (root, args) => {
  try {
    return git(root, args) || null;
  } catch {
    return null;
  }
};

/** @param {{ root: string, cwd?: string, values: Record<string, any>, positionals: string[], out: (s: string) => void, env?: NodeJS.ProcessEnv, today?: string }} ctx */
export async function triage(ctx) {
  const { root, values, out } = ctx;
  const declared = LEVELS.includes(ctx.positionals[0]) ? ctx.positionals[0] : null;
  let words = declared ? ctx.positionals.slice(1) : ctx.positionals;
  // `--files a b c`: the shell gives b and c as loose words. After a quoted reason they can only be more files;
  // read as part of the reason, the level would be measured from the first file alone
  const loose = values.files && words[0]?.includes(' ') ? words.slice(1) : [];
  if (loose.length) words = words.slice(0, 1);
  const paths = [...(values.files ?? []), ...loose].flatMap((f) => f.split(',')).map((f) => f.trim()).filter(Boolean);
  const reason = words.join(' ').replace(/\s+/g, ' ').trim();
  if (values.override && !declared) throw new CliError('--override records the level the person chose: pass that level.');
  if (!reason || (!declared && !paths.length)) throw new CliError(`Expected a reason and --files (the files or folders you expect to touch).\n\n${help}`);
  if (!paths.length && declared !== 'large' && !values.override) {
    throw new CliError(
      `reins measures the level: pass --files with the files or folders you expect to touch, e.g. \`reins triage "${reason}" --files src/x.js,src/y\`.\n` +
        'Only `large` is accepted without files (a new feature, a migration, "review everything"), or the level the person chose with --override.',
    );
  }
  if (values.task !== undefined && !TASK_RE.test(values.task)) throw new CliError(`Task names use letters, digits, ".", "_" and "-": got "${values.task}".`);
  if (!isGitRepo(root)) throw new CliError('Not a git repository: the triage log needs the branch and commit.');
  const branch = tryGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? tryGit(root, ['symbolic-ref', '--short', 'HEAD']) ?? 'HEAD';
  const env = ctx.env ?? process.env;
  // the level measured from the files the task will touch: the agent may raise it, never go below it
  const notes = [];
  let level = declared;
  if (paths.length && !values.override) {
    const thresholds = readDoctorConfig(root).triage;
    const files = [...new Set(paths.flatMap((p) => expand(root, toRepoPath(root, ctx.cwd ?? root, p).replace(/\/$/, ''))))];
    const measured = suggestLevel(scopeSignals(files, readDomains(root, []), ARCHITECTURE_FILE, thresholds.not_counted), thresholds);
    if (!declared || LEVELS.indexOf(measured.level) > LEVELS.indexOf(declared)) {
      level = measured.level;
      notes.push(declared ? `Level raised from ${declared} to ${level}: ${measured.reasons.join('; ')}.` : `Measured level: ${level} (${measured.reasons.join('; ')}).`);
      if (level === 'large') notes.push('Large: present the plan to the person and wait for confirmation before editing.');
    }
  }
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
  // the task may already have outgrown the level (a second triage after some work, or an escalation that falls short)
  const drift = levelDrift(root, env);
  if (drift) notes.push(`! warning  ${drift.message}`, `    Fix: ${drift.fix}`);
  for (const note of notes) out(note);
  out(`Recorded in ${TRIAGE_LOG}: ${line}`);
  return 0;
}
