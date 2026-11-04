// harness notes <path…>: prints the module notes that apply to a path.
// harness notes --hook: the same, as a Claude Code PreToolUse hook (JSON in on stdin, JSON out), at most once
// per note and session. It never blocks the agent: any problem means "no note".
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { notesFor } from '@harness/core';
import { HARNESS_DIR, toRepoPath } from '../context.js';
import { loadNotes } from '../project.js';

export const SEEN_FILE = `${HARNESS_DIR}/progress/.notes-seen.json`;
const MAX_SESSIONS = 50;

export const options = { hook: { type: 'boolean' }, json: { type: 'boolean' } };
export const positionals = true;

export const help = `Usage: harness notes <path…> [--json]
       harness notes --hook

Prints the module notes (.harness/notes/*.md) whose "paths" match each path.
--hook is for the Claude Code PreToolUse hook that harness sync installs: it reads the tool call from stdin and
returns the notes as additional context, once per note and session.`;

/** Formats notes for a path, for people and agents alike. */
const render = (file, notes) =>
  notes.map((n) => `Note ${n.file} (applies to ${n.paths.join(', ')}) for ${file}:\n${n.body}`).join('\n\n');

/** Reads all of stdin. */
async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

/**
 * The hook. Exported for tests; `input` is the parsed hook JSON.
 * @param {string} root
 * @param {any} input
 * @returns {string | null} JSON to print, or null for "nothing to add"
 */
export function hookResponse(root, input) {
  const target = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path ?? input?.tool_input?.path;
  if (typeof target !== 'string' || !target) return null;
  // real paths on both sides: the project may be opened through a symlink (e.g. macOS /var -> /private/var)
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return path.resolve(p); // a file about to be created doesn't exist yet
    }
  };
  const realRoot = real(root);
  const realTarget = existsSync(target) ? real(target) : path.join(real(path.dirname(target)), path.basename(target));
  const file = toRepoPath(realRoot, realRoot, realTarget);
  if (file.startsWith('..') || path.isAbsolute(file)) return null;
  const notes = notesFor(file, loadNotes(root).notes);
  if (!notes.length) return null;

  // once per note and session
  const session = typeof input.session_id === 'string' ? input.session_id : null;
  let unseen = notes;
  if (session) {
    const seenPath = path.join(root, SEEN_FILE);
    let seen = {};
    try {
      seen = existsSync(seenPath) ? JSON.parse(readFileSync(seenPath, 'utf8')) : {};
    } catch {
      seen = {};
    }
    const already = new Set(seen[session] ?? []);
    unseen = notes.filter((n) => !already.has(n.file));
    if (!unseen.length) return null;
    seen[session] = [...already, ...unseen.map((n) => n.file)];
    const sessions = Object.keys(seen);
    for (const old of sessions.slice(0, Math.max(0, sessions.length - MAX_SESSIONS))) delete seen[old];
    try {
      mkdirSync(path.dirname(seenPath), { recursive: true });
      writeFileSync(seenPath, JSON.stringify(seen));
    } catch {
      /* read-only checkout: deliver the note anyway */
    }
  }
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: input.hook_event_name ?? 'PreToolUse',
      additionalContext: `Module notes for ${file} (from .harness/notes; follow them):\n\n${render(file, unseen)}`,
    },
  });
}

/** @param {{ root: string, cwd: string, values: Record<string, any>, positionals: string[], out: (s: string) => void, env?: NodeJS.ProcessEnv, stdin?: string }} ctx */
export async function notes(ctx) {
  const { root, cwd, values, out } = ctx;
  if (values.hook) {
    try {
      const raw = ctx.stdin ?? (await readStdin());
      const hookRoot = ctx.env?.CLAUDE_PROJECT_DIR || root;
      const response = hookResponse(hookRoot, JSON.parse(raw));
      if (response) out(response);
    } catch {
      /* never break the agent's tool call */
    }
    return 0;
  }
  if (!ctx.positionals.length) {
    out(help);
    return 2;
  }
  const { notes: all, problems } = loadNotes(root);
  const results = ctx.positionals.map((p) => {
    const file = toRepoPath(root, cwd, p);
    return { file, notes: notesFor(file, all) };
  });
  if (values.json) {
    out(JSON.stringify({ problems, paths: results.map((r) => ({ path: r.file, notes: r.notes })) }, null, 2));
    return 0;
  }
  for (const pr of problems) out(`! warning  ${pr}`);
  out(results.map((r) => (r.notes.length ? render(r.file, r.notes) : `No notes for ${r.file}.`)).join('\n\n'));
  return 0;
}
