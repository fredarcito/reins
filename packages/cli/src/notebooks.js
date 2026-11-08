// Progress notebooks, one per task: which task a session works on (shared by progress, resume and doctor) and
// the automatic cleanup that resume runs. Design: docs/proposals/multi-session-progress.md (phase 1).
import { rmSync, readdirSync, rmdirSync } from 'node:fs';
import path from 'node:path';
import { branchFolder, cleanupPlan, parseNotebook, summarizeNotebook, PROGRESS_DIR } from '@agentreins/core';
import { liveBranches, listNotebooks } from './project.js';

/**
 * @typedef {import('./project.js').NotebookEntry & { summary: ReturnType<typeof summarizeNotebook> }} Task
 */

/**
 * The session running this command: the hook payload's id, else `CLAUDE_CODE_SESSION_ID` (Claude Code sets it for the
 * agent's shell commands), else `REINS_SESSION` (any other agent). Null when none is known.
 * @param {NodeJS.ProcessEnv} env
 * @param {string | null} [hookSession]
 */
export const sessionId = (env, hookSession = null) => hookSession || env.CLAUDE_CODE_SESSION_ID || env.REINS_SESSION || null;

/** The task asked for explicitly: `--task <name>` or `REINS_TASK`. */
export const explicitTask = (values, env) => values?.task || env.REINS_TASK || null;

/** Newest first by `updated:`, then by name. */
const byUpdated = (a, b) => (b.summary.updated ?? '').localeCompare(a.summary.updated ?? '') || a.file.localeCompare(b.file);

/**
 * Which task this session works on. The first rule that matches wins:
 * 1. the explicit task (`--task` or `REINS_TASK`), open or closed;
 * 2. the open notebook whose `session:` is this session (covers compaction and /clear);
 * 3. with no session id, the only open notebook (agents that have no session id work as before);
 * 4. the older one-per-branch notebook while it is open (no migration: it behaves as before until it is closed).
 * Otherwise none: the session has not chosen yet. Rules 3 and 4 are a guess, and resume says so.
 * @param {Task[]} tasks every notebook of the branch (`branchTasks`)
 * @param {{ task?: string | null, session?: string | null }} who
 * @returns {{ current: Task | null, guessed: boolean, missing: string | null, others: Task[], closed: Task[] }}
 *   `missing`: the explicit task, when it has no notebook; `others`: the other open tasks, newest first
 */
export function resolveTask(tasks, { task = null, session = null }) {
  const open = tasks.filter((t) => t.summary.status !== 'closed').sort(byUpdated);
  let current = null;
  let guessed = false;
  if (task) current = tasks.find((t) => t.task === task) ?? null;
  else {
    current = (session && open.find((t) => t.summary.session === session)) || null;
    if (!current && !session && open.length === 1) current = open[0];
    if (!current) current = open.find((t) => t.task === null) ?? null;
    guessed = Boolean(current && !(session && current.summary.session === session));
  }
  return {
    current,
    guessed,
    missing: task && !current ? task : null,
    others: open.filter((t) => t !== current),
    closed: tasks.filter((t) => t.summary.status === 'closed' && t !== current),
  };
}

/**
 * Every notebook of a branch, with its summary.
 * @returns {Task[]}
 */
export const branchTasks = (root, branch) => listNotebooks(root, branch).map((n) => ({ ...n, summary: summarizeNotebook(n.text) }));

/** How a task is named to the agent. */
export const taskName = (t) => t.task ?? `(no task name) ${t.file}`;

/**
 * Deletes the notebooks that no longer describe work (closed more than 7 days ago, or of a deleted branch; open
 * ones only when their branch is gone and they have not changed for 7 days), with their task folder. A branch folder
 * left empty goes too. Run by resume at session start.
 * @param {string} root
 * @param {string} today YYYY-MM-DD
 * @returns {{ task: string, branch: string }[]} the open tasks removed (closed ones are removed silently)
 */
export function cleanNotebooks(root, today) {
  const all = listNotebooks(root);
  if (!all.length) return [];
  const live = new Set([...liveBranches(root).keys()].map((b) => branchFolder(b).slice(PROGRESS_DIR.length + 1)));
  const headers = all.map((n) => parseNotebook(n.text).header);
  const plan = cleanupPlan(all.map((n, i) => ({ folder: n.folder, status: headers[i]?.status ?? null, updated: headers[i]?.updated ?? null, changed: n.changed })), live, today);
  const removedOpen = [];
  for (const i of plan) {
    const n = all[i];
    if (n.task) rmSync(path.join(root, /** @type {string} */ (n.dir)), { recursive: true, force: true });
    else {
      rmSync(path.join(root, n.file), { force: true });
      // the older notebook's cold files: the plain files of its branch folder (task folders stay)
      if (n.dir) {
        for (const e of readdirSync(path.join(root, n.dir), { withFileTypes: true })) if (e.isFile()) rmSync(path.join(root, n.dir, e.name), { force: true });
      }
    }
    if (headers[i]?.status !== 'closed') removedOpen.push({ task: taskName(n), branch: headers[i]?.branch ?? n.folder });
  }
  for (const folder of new Set(plan.map((i) => all[i].folder))) {
    try {
      rmdirSync(path.join(root, PROGRESS_DIR, folder)); // only when empty
    } catch {
      /* still has tasks or files */
    }
  }
  return removedOpen;
}
