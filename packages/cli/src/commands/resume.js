// reins resume: what an agent needs to pick a task up again (after a compaction, a /clear or a new session):
// this session's task notebook, short summaries of the other open tasks on the branch, the files of the current task
// (since the commit on its triage line, or the branch diff) and the module notes of those files. It also tidies
// .reins/progress/: stale triage.log lines and old notebooks (notebooks.js).
// --hook is the Claude Code SessionStart hook that reins sync installs (matcher startup|compact|clear).
import { execFileSync } from 'node:child_process';
import { notesFor } from '@agentreins/core';
import { hookEventName, isGitRepo } from '../context.js';
import { buildImpactMapInBackground } from '../impact-map.js';
import { branchTasks, cleanNotebooks, resolveTask, sessionId, taskName } from '../notebooks.js';
import { takeUnseen } from '../notes-seen.js';
import { loadNotes } from '../project.js';
import { cleanTriageLog, readTriage, taskFiles } from '../triage-log.js';
import { pickBaseRef } from './check.js';

const MAX_FILES = 30;
const MAX_NOTES = 6;
const MAX_OTHERS = 5;

export const options = { hook: { type: 'boolean' }, json: { type: 'boolean' } };

export const help = `Usage: reins resume [--json]
       reins resume --hook

Prints what is needed to resume this session's task on the current branch: its progress notebook, a short line for
each other open task on the branch, the files the task changed (since the commit on its triage.log line; the
branch diff when it has none), and the module notes of those files. Run it at the start of a session or after the
context was compacted. It also tidies .reins/progress/: triage.log lines of deleted branches and of merged tasks,
notebooks closed more than 7 days ago, and open notebooks of branches deleted more than 7 days ago.
--hook is for the Claude Code SessionStart hook that reins sync installs: the same text arrives as context
when a session starts, after /clear and after a compaction (prints nothing when there is nothing to resume).`;

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const quietly = (fn, fallback) => {
  try {
    return fn();
  } catch {
    return fallback; // housekeeping never stops a resume
  }
};

/**
 * Everything resume knows, no formatting.
 * @param {string} root
 * @param {NodeJS.ProcessEnv} env
 * @param {{ session?: string | null, today?: string }} [opts] `session`: the hook payload's session id
 */
export function gather(root, env, { session = null, today = new Date().toISOString().slice(0, 10) } = {}) {
  const empty = { branch: null, notebook: null, guessed: false, coldDir: null, others: [], closed: [], removed: [], files: [], anchor: null, notes: [] };
  if (!isGitRepo(root)) return empty;
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const removed = quietly(() => cleanNotebooks(root, today), []);
  const who = { session: sessionId(env, session) };
  const { current, guessed, others, closed } = resolveTask(branchTasks(root, branch), who);
  let files = [];
  let anchor = null;
  try {
    const baseRef = pickBaseRef(root, undefined, env);
    quietly(() => cleanTriageLog(root, baseRef));
    ({ files, anchor } = taskFiles(root, readTriage(root, baseRef).log, branch, baseRef));
  } catch {
    /* no commits yet */
  }
  const all = loadNotes(root).notes;
  const notes = all.filter((n) => files.some((f) => notesFor(f, [n]).length));
  return {
    ...empty,
    branch,
    notebook: current && { file: current.file, task: current.task, text: current.text.trim() },
    guessed,
    coldDir: current?.dir ?? null,
    others: others.map((t) => ({ task: taskName(t), ...t.summary })),
    closed: closed.map(taskName),
    removed,
    files,
    anchor,
    notes,
  };
}

/** One or two lines for another session's task. */
const summaryLine = (t) =>
  `- ${t.task}${t.goal ? ` — ${t.goal}` : ''}${t.inProgress ? `\n  in progress: ${t.inProgress}` : ''} (updated ${t.updated ?? '?'})`;

/** The text an agent reads. Null when there is nothing to resume. */
export function render(g, notes = g.notes) {
  if (!g.branch || (!g.notebook && !g.files.length && !g.others.length && !g.removed.length)) return null;
  const parts = [`Context to resume the work on branch ${g.branch} (from reins resume). Read it before continuing.`];
  if (g.notebook) {
    const name = g.notebook.task ? `task ${g.notebook.task}` : 'notebook';
    parts.push(`## Your ${name}: ${g.notebook.file}\nResume from its "Next step"; keep it updated with \`npx reins progress\`.\n\n${g.notebook.text}`);
    if (g.coldDir) parts.push(`Decisions, verification and reports of this task: ${g.coldDir}/ (read them when needed).`);
    if (g.guessed) {
      parts.push(`This session has not claimed this task: it was picked because it is the ${g.notebook.task ? 'only open task' : 'older one-per-branch notebook'}. If the request is a different task, create a new one with \`npx reins progress new <task>\`.`);
    }
  } else if (!g.others.length) {
    parts.push('No progress notebook for this branch (fine for a small task).');
  }
  if (g.others.length) {
    const shown = g.others.slice(0, MAX_OTHERS).map(summaryLine);
    if (g.others.length > MAX_OTHERS) shown.push(`- … and ${g.others.length - MAX_OTHERS} more`);
    parts.push(`## Other open tasks on this branch (other sessions' work: read them, never edit them)\n${shown.join('\n')}${g.closed.length ? `\nDone: ${g.closed.join(', ')}.` : ''}`);
    if (!g.notebook) {
      parts.push('No task chosen for this session yet. If the request continues one of these tasks, continue it: pass `--task <name>` to `npx reins progress` (its first edit claims it; `show` only reads). If it is new, create one with `npx reins progress new <task>`. If it overlaps one of them, or it is unclear, ask the person first.');
    }
  }
  for (const r of g.removed) parts.push(`Removed the open notebook of task ${r.task}: branch ${r.branch} no longer exists and the notebook had not changed for 7 days.`);
  if (g.files.length) {
    const shown = g.files.slice(0, MAX_FILES).map((f) => `- ${f}`);
    if (g.files.length > MAX_FILES) shown.push(`- … and ${g.files.length - MAX_FILES} more`);
    const title = g.anchor ? `Files changed by the current task, since ${g.anchor.slice(0, 7)}` : 'Files changed on this branch';
    parts.push(`## ${title} (${g.files.length})\n${shown.join('\n')}`);
  }
  if (notes.length) {
    const full = notes.slice(0, MAX_NOTES).map((n) => `### ${n.file} (applies to ${n.paths.join(', ')})\n${n.body}`);
    const rest = notes.slice(MAX_NOTES).map((n) => n.file);
    parts.push(`## Module notes for those files (follow them)\n${full.join('\n\n')}${rest.length ? `\n\nAlso read: ${rest.join(', ')}` : ''}`);
  }
  return parts.join('\n\n');
}

/**
 * The SessionStart hook. Exported for tests.
 * @param {string} root
 * @param {any} input hook JSON (session_id, source: startup | resume | clear | compact)
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | null}
 */
export function hookResponse(root, input, env, today) {
  const session = typeof input?.session_id === 'string' ? input.session_id : null;
  const g = gather(root, env, { session, today });
  // after a compaction or a /clear the notes are no longer in the context: deliver them (and later ones) again
  const notes = takeUnseen(root, session, g.notes, { reset: input?.source === 'compact' || input?.source === 'clear' });
  const text = render(g, notes);
  if (!text) return null;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: hookEventName(input?.hook_event_name, 'SessionStart'), additionalContext: text } });
}

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

/** @param {{ root: string, values: Record<string, any>, out: (s: string) => void, env?: NodeJS.ProcessEnv, stdin?: string, today?: string }} ctx */
export async function resume(ctx) {
  const { root, values, out } = ctx;
  const env = ctx.env ?? process.env;
  if (values.hook) {
    try {
      const raw = ctx.stdin ?? (await readStdin());
      const hookRoot = env.CLAUDE_PROJECT_DIR || root;
      const input = JSON.parse(raw || '{}');
      // a fresh graph per session (not per compaction); only from Claude Code, which always sets CLAUDE_PROJECT_DIR
      if (env.CLAUDE_PROJECT_DIR && input?.source !== 'compact') buildImpactMapInBackground(hookRoot);
      const response = hookResponse(hookRoot, input, env, ctx.today);
      if (response) out(response);
    } catch {
      /* never break the session start */
    }
    return 0;
  }
  const g = gather(root, env, { today: ctx.today });
  if (values.json) {
    const { branch, notebook, guessed, coldDir, others, closed, removed, files, anchor, notes } = g;
    out(JSON.stringify({ branch, notebook, guessed, coldDir, others, closed, removed, files, anchor, notes }, null, 2));
    return 0;
  }
  out(render(g) ?? `Nothing to resume${g.branch ? ` on ${g.branch}` : ''}: no progress notebook and no changes on this branch.`);
  return 0;
}
