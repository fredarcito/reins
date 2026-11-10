// reins progress: mechanical edits of the current task's notebook (.reins/progress/<branch>/<task>/notebook.md),
// so the agent doesn't rewrite the file. Every edit validates the format before and after. The task is resolved by
// notebooks.js (explicit --task, or the one this session claimed); every command that edits a task claims it.
// `show` only reads: looking at another session's task must not take it.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  NotebookError, notebookFile, taskFolder, listItems, markDone, markStarted, markDropped, addItem, setNext, newNotebook, setHeader,
  parseNotebook, formatProblems, TASK_RE,
} from '@agentreins/core';
import { CliError } from '../context.js';
import { branchTasks, explicitTask, resolveTask, sessionId, taskName } from '../notebooks.js';
import { readText } from '../project.js';
import { readTemplate } from '../templates.js';
import { doctorResult, levelDrift } from './doctor.js';

/**
 * A notebook template: the repo's own copy in .reins/templates/ (so a team can adapt it), or the packaged one.
 * @returns {{ text: string, source: string }}
 */
function notebookTemplate(root, rel) {
  const own = readText(root, rel);
  if (own !== null) return { text: own, source: rel };
  if (rel.startsWith('.reins/')) {
    const coreRel = `.reins/core/${rel.slice('.reins/'.length)}`;
    const coreText = readText(root, coreRel);
    if (coreText !== null) return { text: coreText, source: coreRel };
  }
  return { text: readTemplate(rel), source: `the packaged ${rel}` };
}

export const options = {
  branch: { type: 'string' },
  task: { type: 'string' },
  criteria: { type: 'boolean' },
  hot: { type: 'boolean' },
  json: { type: 'boolean' },
  'notes-ok': { type: 'string' },
};

export const help = `Usage:
  reins progress new <task> [--hot]     Create the task's notebook from .reins/templates/ (mini; --hot for large tasks)
  reins progress show [--json]          Print the items, numbered
  reins progress add <text> [--criteria]  Add a pending item to Subtasks (or Done criteria)
  reins progress start <n>              Mark item n in progress [~] (only one at a time)
  reins progress done <n>               Mark item n done [x]
  reins progress drop <n> <reason>      Discard item n [-] with a reason (it stays in the list)
  reins progress next <text>            Set the "Next step" line
  reins progress close [--notes-ok <why>]  Close the task (only after the person confirmed it is done)

One notebook per task: .reins/progress/<branch>/<task>/notebook.md, on the current branch (--branch to choose
another). <task> is a short name for the person's request (css-refactor). The task is the one given with --task
(or REINS_TASK), else the open one this session works on; every command that edits a task claims it for this
session (session: in the header, from CLAUDE_CODE_SESSION_ID or REINS_SESSION); show only reads, so looking at
another session's task does not take it. Never edit another session's task. Every edit keeps the notebook valid and updates its date; an invalid notebook is refused with its problems.

close runs the end of the done skill for you and refuses while it is not finished: every item must be done [x] or
dropped [-] with a reason, and the doctor must not flag the module notes of the task's files (missing, not updated,
draft, dead paths). When nothing durable changed in a flagged note, close with --notes-ok "<why>": the reason is
kept in the notebook.`;

const today = (ctx) => ctx.today ?? new Date().toISOString().slice(0, 10);

function currentBranch(root) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new CliError('Not a git repository: pass --branch <name>.');
  }
}

const num = (s) => {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) throw new CliError(`Expected an item number, got "${s ?? ''}". Run \`reins progress show\`.`);
  return n;
};

/** @param {{ root: string, values: Record<string, any>, positionals: string[], out: (s: string) => void, today?: string }} ctx */
export async function progress(ctx) {
  const { root, values, out } = ctx;
  const [action, ...args] = ctx.positionals;
  if (!action) {
    out(help);
    return 0;
  }
  const branch = values.branch ?? currentBranch(root);
  const env = ctx.env ?? process.env;
  const session = sessionId(env);
  const date = today(ctx);

  if (action === 'new') {
    const task = args[0] ?? explicitTask(values, env);
    if (!task) throw new CliError('Name the task: `reins progress new <task>`, a short name for the request (css-refactor).');
    if (!TASK_RE.test(task)) throw new CliError(`Task names use letters, digits, ".", "_" and "-" and start with a letter or digit: got "${task}".`);
    const file = notebookFile(branch, task);
    const abs = path.join(root, file);
    if (existsSync(abs)) throw new CliError(`${file} already exists. Continue it with \`reins progress show --task ${task}\`.`);
    const tpl = notebookTemplate(root, `.reins/templates/progress-${values.hot ? 'hot' : 'mini'}.md`);
    const text = newNotebook(tpl.text, branch, date, { task, session });
    const problems = formatProblems(parseNotebook(text));
    if (problems.length) {
      throw new CliError(`${tpl.source} doesn't produce a valid notebook:\n${problems.map((pr) => `  - ${pr}`).join('\n')}\nFix the template (keep the header \`# <branch> · status: open · updated: YYYY-MM-DD\`), or delete it to use the default one.`);
    }
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
    out(`Created ${file}${values.hot ? '' : ' (mini)'}. Fill in the goal and the done criteria before editing code.`);
    if (values.hot) {
      const cold = path.join(root, taskFolder(branch, task));
      for (const f of ['decisions', 'verification', 'delivery']) {
        const target = path.join(cold, `${f}.md`);
        if (!existsSync(target)) writeFileSync(target, newNotebook(notebookTemplate(root, `.reins/templates/progress-cold/${f}.md`).text, branch, date));
      }
      out(`Cold files, agent reports included, go in ${taskFolder(branch, task)}/.`);
    }
    return 0;
  }

  const tasks = branchTasks(root, branch);
  const { current, missing, others } = resolveTask(tasks, { task: explicitTask(values, env), session });
  if (!current) {
    if (missing) throw new CliError(`Task "${missing}" has no notebook on ${branch}. Create it with \`reins progress new ${missing}\`.`);
    const open = others.map((t) => `  - ${taskName(t)}${t.summary.goal ? `: ${t.summary.goal}` : ''}`);
    throw new CliError(open.length
      ? `No task chosen for this session. Open tasks on ${branch}:\n${open.join('\n')}\nContinue one with --task <name> (the first edit claims it; show only reads), or create one with \`reins progress new <task>\`.`
      : `No notebook on ${branch}. Create one with \`reins progress new <task>\` (medium) or \`reins progress new <task> --hot\` (large).`);
  }
  const file = current.file;
  const abs = path.join(root, file);
  const text = current.text;
  /** Writes the edit and claims the task for this session. */
  const write = (t, msg) => {
    writeFileSync(abs, session ? claim(t, session, date) : t);
    out(msg);
    // the moment the agent updates its notebook is the moment to say the task outgrew its declared level
    const drift = levelDrift(root, env);
    if (drift) out(`! warning  ${drift.message}\n    Fix: ${drift.fix}`);
    return 0;
  };
  try {
    switch (action) {
      case 'show': {
        const nb = parseNotebook(text);
        const problems = formatProblems(nb);
        const items = problems.length ? nb.items.map((it, i) => ({ n: i + 1, ...it })) : listItems(text);
        if (values.json) {
          out(JSON.stringify({ file, header: nb.header, problems, items }, null, 2));
          return 0;
        }
        for (const p of problems) out(`! warning  ${p}`);
        if (nb.header) out(`${file} · ${nb.header.status} · updated ${nb.header.updated}`);
        let section = null;
        for (const it of items) {
          if (it.section !== section) {
            section = it.section;
            out(`${section || '(no section)'}:`);
          }
          out(`  ${String(it.n).padStart(2)}. [${it.marker}] ${it.text}`);
        }
        const next = nb.lines.find((l) => /^\*\*Next step:?\*\*/i.test(l.trim()));
        if (next) out(next.trim().replace(/\*\*/g, ''));
        return 0;
      }
      case 'add': {
        const t = args.join(' ');
        return write(addItem(text, values.criteria ? 'criteria' : 'subtasks', t, date), `Added to ${values.criteria ? 'Done criteria' : 'Subtasks'}: ${t}`);
      }
      case 'start': {
        const r = markStarted(text, num(args[0]), date);
        return write(r.text, `Item ${args[0]} is in progress.${r.paused.length ? ` Item ${r.paused.join(', ')} went back to pending.` : ''}`);
      }
      case 'done':
        return write(markDone(text, num(args[0]), date), `Item ${args[0]} is done.`);
      case 'drop':
        return write(markDropped(text, num(args[0]), args.slice(1).join(' '), date), `Item ${args[0]} was discarded.`);
      case 'next':
        return write(setNext(text, args.join(' '), date), 'Next step updated.');
      case 'close': {
        const blockers = closeBlockers(root, text, values, env);
        if (blockers.length) throw new CliError(`Not closed: the done steps are not finished (the done skill, .reins/core/skills/done/SKILL.md).\n\n${blockers.join('\n\n')}`);
        const reason = values['notes-ok']?.trim();
        const closed = reason ? setNext(text, `Closed with module notes unchanged: ${reason}`, date) : text;
        return write(setHeader(closed, { status: 'closed' }, date), `Closed ${taskName(current)}. reins deletes its notebook 7 days from now.`);
      }
      default:
        throw new CliError(`Unknown action "${action}".\n\n${help}`);
    }
  } catch (e) {
    if (e instanceof NotebookError) throw new CliError(e.message);
    throw e;
  }
}

const NOTE_RULES = new Set(['note-missing', 'note-outdated', 'note-draft', 'note-dead-paths', 'note-dead-refs']);

/**
 * What still stops a task from closing: items not done or dropped, and module notes the doctor flags (unless
 * --notes-ok says why they need nothing). Each entry is a paragraph for the error message.
 * @returns {string[]}
 */
function closeBlockers(root, text, values, env) {
  const blockers = [];
  const open = listItems(text).filter((it) => it.marker === ' ' || it.marker === '~');
  if (open.length) {
    blockers.push(['Items still open. Mark each one done (`reins progress done <n>`) or drop it with a reason (`reins progress drop <n> <reason>`):',
      ...open.map((it) => `  ${it.n}. [${it.marker}] ${it.text}`)].join('\n'));
  }
  if (values['notes-ok'] !== undefined && !values['notes-ok'].trim()) throw new CliError('--notes-ok needs the reason: --notes-ok "only the version number changed".');
  if (!values['notes-ok'] && !env.CI) {
    let flagged = [];
    try {
      flagged = doctorResult(root, {}, env).result.violations.filter((v) => NOTE_RULES.has(v.rule));
    } catch {
      flagged = []; // the doctor could not run (no git…): don't block the close on it
    }
    if (flagged.length) {
      blockers.push(['Module notes the doctor flags. Update them (decisions with their why, traps, Map), or, when nothing durable changed, close with `--notes-ok "<why>"`:',
        ...flagged.map((v) => `  - ${v.rule} ${v.from}: ${v.message}`)].join('\n'));
    }
  }
  return blockers;
}

/** The text with `session:` set to this session, when the notebook is valid; unchanged otherwise. */
function claim(text, session, date) {
  try {
    return setHeader(text, { session }, date);
  } catch {
    return text;
  }
}
