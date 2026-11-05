// Which module notes have fallen behind their code: commits to a note's paths since the note itself last
// changed. A signal, not proof: many commits may leave a note true, one commit may make it false.
// Pure: the caller reads the git history and passes it in.
import { matchesAny } from '../glob.js';

/**
 * @typedef {{ hash: string, date: string, files: string[] }} Commit
 * @typedef {{ file: string, lastChange: string | null, commits: number, files: number, uncommitted: boolean }} StaleEntry
 */

/**
 * @param {{ file: string, paths: string[] }[]} notes
 * @param {Commit[]} history newest first
 * @param {{ dirty?: string[] }} [opts] `dirty`: files with uncommitted changes (a note being edited is not behind)
 * @returns {StaleEntry[]} most behind first; notes that were never committed come last with `lastChange: null`
 */
export function rankStaleNotes(notes, history, opts = {}) {
  const dirty = new Set(opts.dirty ?? []);
  const entries = notes.map((n) => {
    const at = history.findIndex((c) => c.files.includes(n.file));
    const newer = at === -1 ? [] : history.slice(0, at);
    const touched = new Set();
    let commits = 0;
    for (const c of newer) {
      const hits = c.files.filter((f) => matchesAny(f, n.paths));
      if (!hits.length) continue;
      commits++;
      for (const f of hits) touched.add(f);
    }
    const uncommitted = dirty.has(n.file);
    return {
      file: n.file,
      lastChange: at === -1 ? null : history[at].date,
      commits: uncommitted ? 0 : commits,
      files: uncommitted ? 0 : touched.size,
      uncommitted,
    };
  });
  const rank = (e) => (e.lastChange === null ? -1 : e.commits);
  return entries.sort((a, b) => rank(b) - rank(a) || b.files - a.files || (a.file < b.file ? -1 : 1));
}
