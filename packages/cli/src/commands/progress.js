// harness progress: mechanical edits of the current branch's notebook (.harness/progress/<branch>.md),
// so the agent doesn't rewrite the file. Every edit validates the format before and after.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  NotebookError, notebookFile, listItems, markDone, markStarted, markDropped, addItem, setNext, newNotebook,
  parseNotebook, formatProblems,
} from '@harness/core';
import { CliError } from '../context.js';
import { readText } from '../project.js';
import { readTemplate } from '../templates.js';

export const options = {
  branch: { type: 'string' },
  criteria: { type: 'boolean' },
  hot: { type: 'boolean' },
  json: { type: 'boolean' },
};

export const help = `Usage:
  harness progress new [--hot]            Create the notebook from the template (mini; --hot for large tasks)
  harness progress show [--json]          Print the items, numbered
  harness progress add <text> [--criteria]  Add a pending item to Subtasks (or Done criteria)
  harness progress start <n>              Mark item n in progress [~] (only one at a time)
  harness progress done <n>               Mark item n done [x]
  harness progress drop <n> <reason>      Discard item n [-] with a reason (it stays in the list)
  harness progress next <text>            Set the "Next step" line

Edits .harness/progress/<branch>.md of the current branch (--branch to choose another). Every edit keeps the
notebook valid and updates its date; a notebook that is already invalid is refused with the problems to fix.
Closing (status: closed) is left to the person.`;

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
  if (!Number.isInteger(n) || n < 1) throw new CliError(`Expected an item number, got "${s ?? ''}". Run \`harness progress show\`.`);
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
  const file = notebookFile(branch);
  const abs = path.join(root, file);
  const date = today(ctx);

  if (action === 'new') {
    if (existsSync(abs)) throw new CliError(`${file} already exists. Use \`harness progress show\`.`);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, newNotebook(readTemplate(`.harness/templates/progress-${values.hot ? 'hot' : 'mini'}.md`), branch, date));
    out(`Created ${file}${values.hot ? '' : ' (mini)'}. Fill in the goal and the done criteria before editing code.`);
    if (values.hot) {
      const cold = abs.replace(/\.md$/, '');
      mkdirSync(cold, { recursive: true });
      for (const f of ['decisions', 'verification', 'delivery']) {
        const target = path.join(cold, `${f}.md`);
        if (!existsSync(target)) writeFileSync(target, newNotebook(readTemplate(`.harness/templates/progress-cold/${f}.md`), branch, date));
      }
      out(`Created the cold folder ${file.replace(/\.md$/, '/')}.`);
    }
    return 0;
  }

  const text = readText(root, file);
  if (text === null) throw new CliError(`${file} doesn't exist. Create it with \`harness progress new\` (medium) or \`harness progress new --hot\` (large).`);
  const write = (t, msg) => {
    writeFileSync(abs, t);
    out(msg);
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
      default:
        throw new CliError(`Unknown action "${action}".\n\n${help}`);
    }
  } catch (e) {
    if (e instanceof NotebookError) throw new CliError(e.message);
    throw e;
  }
}
