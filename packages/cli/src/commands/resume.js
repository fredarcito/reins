// harness resume: what an agent needs to pick a task up again (after a compaction, a /clear or a new session):
// the branch's progress notebook, the files changed on the branch and the module notes of those files.
// --hook is the Claude Code SessionStart hook that harness sync installs (matcher startup|compact|clear).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { notebookFile, notesFor } from '@harness/core';
import { isGitRepo } from '../context.js';
import { takeUnseen } from '../notes-seen.js';
import { loadNotes, readText } from '../project.js';
import { changedFiles } from './doctor.js';
import { pickBaseRef } from './check.js';
import { execFileSync } from 'node:child_process';

const MAX_FILES = 30;
const MAX_NOTES = 6;

export const options = { hook: { type: 'boolean' }, json: { type: 'boolean' } };

export const help = `Usage: harness resume [--json]
       harness resume --hook

Prints what is needed to resume the task of the current branch: its progress notebook, the files changed on the
branch, and the module notes of those files. Run it at the start of a session or after the context was compacted.
--hook is for the Claude Code SessionStart hook that harness sync installs: the same text arrives as context
when a session starts, after /clear and after a compaction (prints nothing when there is nothing to resume).`;

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/**
 * Everything resume knows, no formatting.
 * @param {string} root
 * @param {NodeJS.ProcessEnv} env
 */
export function gather(root, env) {
  if (!isGitRepo(root)) return { branch: null, notebook: null, coldDir: null, files: [], notes: [] };
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const nbFile = notebookFile(branch);
  const text = readText(root, nbFile);
  const coldDir = nbFile.replace(/\.md$/, '');
  let files = [];
  try {
    files = changedFiles(root, pickBaseRef(root, undefined, env));
  } catch {
    /* no commits yet */
  }
  const all = loadNotes(root).notes;
  const notes = all.filter((n) => files.some((f) => notesFor(f, [n]).length));
  return {
    branch,
    notebook: text === null ? null : { file: nbFile, text: text.trim() },
    coldDir: existsSync(path.join(root, coldDir)) ? coldDir : null,
    files,
    notes,
  };
}

/** The text an agent reads. Null when there is nothing to resume. */
export function render(g, notes = g.notes) {
  if (!g.branch || (!g.notebook && !g.files.length)) return null;
  const parts = [`Context to resume the work on branch ${g.branch} (from harness resume). Read it before continuing.`];
  if (g.notebook) {
    parts.push(`## Progress notebook ${g.notebook.file}\nResume from its "Next step"; keep it updated with \`npx --no-install harness progress\`.\n\n${g.notebook.text}`);
    if (g.coldDir) parts.push(`Decisions, verification and reports of this task: ${g.coldDir}/ (read them when needed).`);
  } else {
    parts.push('No progress notebook for this branch (fine for a small task).');
  }
  if (g.files.length) {
    const shown = g.files.slice(0, MAX_FILES).map((f) => `- ${f}`);
    if (g.files.length > MAX_FILES) shown.push(`- … and ${g.files.length - MAX_FILES} more`);
    parts.push(`## Files changed on this branch (${g.files.length})\n${shown.join('\n')}`);
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
export function hookResponse(root, input, env) {
  const g = gather(root, env);
  const session = typeof input?.session_id === 'string' ? input.session_id : null;
  // after a compaction or a /clear the notes are no longer in the context: deliver them (and later ones) again
  const notes = takeUnseen(root, session, g.notes, { reset: input?.source === 'compact' || input?.source === 'clear' });
  const text = render(g, notes);
  if (!text) return null;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: input?.hook_event_name ?? 'SessionStart', additionalContext: text } });
}

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

/** @param {{ root: string, values: Record<string, any>, out: (s: string) => void, env?: NodeJS.ProcessEnv, stdin?: string }} ctx */
export async function resume(ctx) {
  const { root, values, out } = ctx;
  const env = ctx.env ?? process.env;
  if (values.hook) {
    try {
      const raw = ctx.stdin ?? (await readStdin());
      const response = hookResponse(env.CLAUDE_PROJECT_DIR || root, JSON.parse(raw || '{}'), env);
      if (response) out(response);
    } catch {
      /* never break the session start */
    }
    return 0;
  }
  const g = gather(root, env);
  if (values.json) {
    out(JSON.stringify({ branch: g.branch, notebook: g.notebook, coldDir: g.coldDir, files: g.files, notes: g.notes }, null, 2));
    return 0;
  }
  out(render(g) ?? `Nothing to resume${g.branch ? ` on ${g.branch}` : ''}: no progress notebook and no changes on this branch.`);
  return 0;
}
