// reins triage: the agent records a task level in .reins/progress/triage.log. reins adds the date, the branch and
// the commit the task starts from (HEAD), so doctor and resume can look at this task's diff only.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { LEVELS, TASK_RE, formatTriageLine, matchesAny, notesFor, scopeSignals, suggestLevel, suggestNotes } from '@agentreins/core';
import { ARCHITECTURE_FILE, CliError, isGitRepo, toRepoPath } from '../context.js';
import { withFileLock } from '../local-state.js';
import { branchTasks, explicitTask, resolveTask, sessionId } from '../notebooks.js';
import { takeUnseen } from '../notes-seen.js';
import { listRepoFiles, loadNotes, readDoctorConfig, readDomains, readText } from '../project.js';
import { TRIAGE_LOG } from '../triage-log.js';
import { levelDrift } from './doctor.js';
import { render } from './notes.js';
import { expand } from './scope.js';

export const options = { task: { type: 'string' }, files: { type: 'string', multiple: true }, override: { type: 'boolean' } };

export const help = `Usage: reins triage <reason>                                       before exploring: likely areas and their notes
       reins triage <reason> --files <a,b> [--task <name>]
       reins triage <small|medium|large> <reason> --files <a,b>     raise the measured level
       reins triage large <reason>                                  a task whose files can't be listed
       reins triage <small|large> <reason> --override               the person set the level ([quick], [deep])

Measures the level of the task you are starting and records it in ${TRIAGE_LOG}, with today's date, the current
branch and the commit the task starts from (HEAD). Run it before acting, and again when a task escalates.

Without --files (and without a level) it measures nothing and records nothing: it matches the words of the reason
against the module notes (file names, paths, the folders they cover, their text) and prints the likely areas with
their notes, so you read them before exploring the code. Plain word matching: write the reason with the names the
code uses. Then run it again with --files to measure the level.

reins measures the level from the files or folders you expect to touch (--files): domains, public APIs,
architecture.yml and the number of code files (docs and tests are not counted). You don't state a level; state
one only to raise it, when you know the task is bigger than its files show. reins records the higher of the two.
With --files it also prints the notes of those files. Without --files only large is recorded: a new feature, a
migration, "review everything". When the task's diff already looks bigger than the level recorded, it says so.

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
  if (!reason) throw new CliError(`Expected a reason (and, to measure the level, --files with the files or folders you expect to touch).\n\n${help}`);
  const env = ctx.env ?? process.env;
  if (!paths.length && !declared) return suggest(ctx, reason, env);
  if (!paths.length && declared !== 'large' && !values.override) {
    throw new CliError(
      `reins measures the level: pass --files with the files or folders you expect to touch, e.g. \`reins triage "${reason}" --files src/x.js,src/y\`.\n` +
        'Only `large` is accepted without files (a new feature, a migration, "review everything"), or the level the person chose with --override.',
    );
  }
  if (values.task !== undefined && !TASK_RE.test(values.task)) throw new CliError(`Task names use letters, digits, ".", "_" and "-": got "${values.task}".`);
  if (!isGitRepo(root)) throw new CliError('Not a git repository: the triage log needs the branch and commit.');
  const branch = tryGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? tryGit(root, ['symbolic-ref', '--short', 'HEAD']) ?? 'HEAD';
  // the level measured from the files the task will touch: the agent may raise it, never go below it
  const notes = [];
  let level = declared;
  let files = [];
  if (paths.length) files = [...new Set(paths.flatMap((p) => expand(root, toRepoPath(root, ctx.cwd ?? root, p).replace(/\/$/, ''))))];
  if (paths.length && !values.override) {
    const thresholds = readDoctorConfig(root).triage;
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
  const delivered = notesOf(root, files, env);
  if (delivered) out(delivered);
  out(`Recorded in ${TRIAGE_LOG}: ${line}`);
  return 0;
}

const START_FROM = 'start from them; the code wins if they disagree, and say so';

/**
 * The notes of the files a task will touch, each once per session (the notes hook shares the record).
 * @returns {string | null}
 */
function notesOf(root, files, env) {
  if (!files.length) return null;
  const { notes: all } = loadNotes(root);
  const seen = new Map();
  for (const f of files) for (const n of notesFor(f, all)) if (!seen.has(n.file)) seen.set(n.file, { note: n, file: f });
  if (!seen.size) return null;
  const unseen = new Set(takeUnseen(root, sessionId(env), [...seen.values()].map((x) => x.note)).map((n) => n.file));
  const fresh = [...seen.values()].filter((x) => unseen.has(x.note.file));
  const old = [...seen.keys()].filter((f) => !unseen.has(f));
  const parts = [];
  if (fresh.length) parts.push(`Module notes for these files (${START_FROM}):\n\n${fresh.map((x) => render(x.file, [x.note])).join('\n\n')}`);
  if (old.length) parts.push(`Notes already delivered this session: ${old.join(', ')}.`);
  return parts.join('\n\n');
}

/**
 * `reins triage "<reason>"` with no files and no level: the likely areas of the task and their notes, so the agent
 * reads them before it explores. Nothing is measured or recorded.
 */
function suggest(ctx, reason, env) {
  const { root, out } = ctx;
  const { notes: all } = loadNotes(root);
  const measure = `npx reins triage "${reason}" --files <paths you expect to touch>`;
  if (!all.length) {
    out(`This repo has no module notes yet. Explore the code, then run \`${measure}\` to measure the level.`);
    return 0;
  }
  const folders = new Set();
  for (const f of listRepoFiles(root)) for (let i = f.indexOf('/'); i !== -1; i = f.indexOf('/', i + 1)) folders.add(f.slice(0, i));
  // test and fixture folders repeat the names of real code (`test/fixtures/.../hooks`) and point nowhere useful
  const skip = [...readDoctorConfig(root).triage.not_counted, '**/fixtures/**', '**/node_modules/**'];
  const found = suggestNotes(reason, all, [...folders].filter((d) => !matchesAny(`${d}/x.js`, skip)));
  if (!found.length) {
    out(`No module note matches "${reason}" (plain word matching: use the names the code uses).`);
    out(`Pick the area from the notes index in AGENTS.md and run \`npx reins notes <folder>\`, then \`${measure}\` to measure the level.`);
    return 0;
  }
  out(`Likely areas for "${reason}" (word matching, not measured; check them against the code):`);
  for (const r of found) {
    const where = r.folders.length ? ` · folders: ${r.folders.map((d) => `${d}/`).join(', ')}` : '';
    out(`  ${r.note.file} (${r.note.paths.slice(0, 2).join(', ')}) · matches: ${r.matched.join(', ')}${where}`);
  }
  // the two best in full; the rest are named above, `reins notes` gives them on demand
  const best = found.slice(0, 2).map((r) => r.note);
  const unseen = new Set(takeUnseen(root, sessionId(env), best).map((n) => n.file));
  const fresh = best.filter((n) => unseen.has(n.file));
  if (fresh.length) out(`\nRead these notes before exploring (${START_FROM}):\n\n${fresh.map((n) => `Note ${n.file} (applies to ${n.paths.join(', ')}):\n${n.body}`).join('\n\n')}`);
  const old = best.filter((n) => !unseen.has(n.file)).map((n) => n.file);
  if (old.length) out(`\nAlready delivered this session: ${old.join(', ')}.`);
  out(`\nNothing measured or recorded yet. Once you know the files, run \`${measure}\`.`);
  return 0;
}
