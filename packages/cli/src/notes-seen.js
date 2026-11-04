// Which module notes each Claude Code session already received, so the hooks deliver each note once per
// session. After a compaction the session keeps its id but loses the notes from its context, so `harness
// resume --hook` forgets that session's record and the notes are delivered again.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HARNESS_DIR } from './context.js';

export const SEEN_FILE = `${HARNESS_DIR}/progress/.notes-seen.json`;
const MAX_SESSIONS = 50;

/** @returns {Record<string, string[]>} */
function read(root) {
  const file = path.join(root, SEEN_FILE);
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  } catch {
    return {};
  }
}

function write(root, seen) {
  const sessions = Object.keys(seen);
  for (const old of sessions.slice(0, Math.max(0, sessions.length - MAX_SESSIONS))) delete seen[old];
  try {
    mkdirSync(path.dirname(path.join(root, SEEN_FILE)), { recursive: true });
    writeFileSync(path.join(root, SEEN_FILE), JSON.stringify(seen));
  } catch {
    /* read-only checkout: notes may repeat, which is harmless */
  }
}

/**
 * Keeps the notes this session has not received yet and records them as received.
 * @template {{ file: string }} T
 * @param {string} root
 * @param {string | null} session
 * @param {T[]} notes
 * @param {{ reset?: boolean }} [opts] reset: forget what the session received before (after a compaction)
 * @returns {T[]}
 */
export function takeUnseen(root, session, notes, opts = {}) {
  if (!session) return notes;
  const seen = read(root);
  const already = new Set(opts.reset ? [] : (seen[session] ?? []));
  const unseen = notes.filter((n) => !already.has(n.file));
  if (!unseen.length && !opts.reset) return unseen;
  seen[session] = [...already, ...unseen.map((n) => n.file)];
  write(root, seen);
  return unseen;
}
