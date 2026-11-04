// reins audit: the local audit backlog (.reins/backlog/optimizations.md), edited one finding at a time.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BACKLOG_FILE, STATUSES, parseBacklog, addFinding, setStatus, markRecheck, renderFinding } from '@agentreins/core';
import { CliError } from '../context.js';
import { readText } from '../project.js';

export const options = {
  status: { type: 'string' },
  recheck: { type: 'boolean' },
  json: { type: 'boolean' },
};

export const help = `Usage:
  reins audit list [--status open|done|wontfix|all] [--recheck] [--json]
  reins audit add <path> <finding>
  reins audit set <id> <open|done|wontfix> <reason>
  reins audit recheck <id…> | open

Manages ${BACKLOG_FILE} (local, outside git): findings of audits with status open, done or wontfix
(done and wontfix need a reason). "recheck" flags findings to verify again against the current code;
changing the status clears the flag. Audits start from this file instead of from zero.`;

const today = (ctx) => ctx.today ?? new Date().toISOString().slice(0, 10);

/** @param {{ root: string, values: Record<string, any>, positionals: string[], out: (s: string) => void, today?: string }} ctx */
export async function audit(ctx) {
  const { root, values, out } = ctx;
  const [action, ...args] = ctx.positionals;
  const text = readText(root, BACKLOG_FILE);
  const save = (t) => {
    mkdirSync(path.dirname(path.join(root, BACKLOG_FILE)), { recursive: true });
    writeFileSync(path.join(root, BACKLOG_FILE), t.endsWith('\n') ? t : `${t}\n`);
  };
  const guard = (fn) => {
    try {
      return fn();
    } catch (e) {
      throw new CliError(e.message);
    }
  };

  switch (action) {
    case 'list': {
      const parsed = parseBacklog(text ?? '');
      const status = values.status ?? 'open';
      if (status !== 'all' && !STATUSES.includes(status)) throw new CliError(`--status must be one of ${STATUSES.join(', ')} or all.`);
      const items = parsed.items.filter((it) => (status === 'all' || it.status === status) && (!values.recheck || it.recheck));
      if (values.json) {
        out(JSON.stringify({ file: BACKLOG_FILE, problems: parsed.problems, items }, null, 2));
        return 0;
      }
      for (const p of parsed.problems) out(`! warning  ${BACKLOG_FILE}: ${p}`);
      if (text === null) out(`${BACKLOG_FILE} doesn't exist yet: no findings recorded.`);
      else if (!items.length) out(`No ${status === 'all' ? '' : `${status} `}findings${values.recheck ? ' flagged for recheck' : ''}.`);
      else for (const it of items) out(renderFinding(it).replace(/^- /, ''));
      const counts = STATUSES.map((s) => `${parsed.items.filter((it) => it.status === s).length} ${s}`).join(', ');
      if (text !== null) out(`(${counts}; ${parsed.items.filter((it) => it.recheck).length} to recheck)`);
      return 0;
    }
    case 'add': {
      if (args.length !== 2) throw new CliError(`reins audit add <path> <finding>\n\n${help}`);
      const r = guard(() => addFinding(text, { path: args[0], finding: args[1], date: today(ctx) }));
      save(r.text);
      out(`Added ${r.id}.`);
      return 0;
    }
    case 'set': {
      const [id, status, ...rest] = args;
      if (!id || !status) throw new CliError(`reins audit set <id> <open|done|wontfix> <reason>\n\n${help}`);
      if (text === null) throw new CliError(`${BACKLOG_FILE} doesn't exist yet.`);
      save(guard(() => setStatus(text, { id, status, reason: rest.join(' '), date: today(ctx) })));
      out(`${id} is now ${status}.`);
      if (status === 'wontfix') out('If the reason is durable, add it to the module note in .reins/notes/ so nobody proposes it again.');
      return 0;
    }
    case 'recheck': {
      if (!args.length) throw new CliError(`reins audit recheck <id…> | open\n\n${help}`);
      if (text === null) throw new CliError(`${BACKLOG_FILE} doesn't exist yet.`);
      const r = guard(() => markRecheck(text, args.length === 1 && args[0] === 'open' ? 'open' : args));
      save(r.text);
      out(r.marked.length ? `Flagged for recheck: ${r.marked.join(', ')}.` : 'Nothing to flag.');
      return 0;
    }
    default:
      out(help);
      return action ? 2 : 0;
  }
}
