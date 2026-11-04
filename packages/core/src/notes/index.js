// Module notes: .reins/notes/<module>.md with the paths they apply to in the frontmatter.
//
//   ---
//   paths: ["src/features/billing/**"]
//   ---
//   - 2026-11-01: prices are integer cents; never use floats.
//
// Files starting with "_" (templates, drafts) are not notes.
import { parse } from 'yaml';
import { matchesAny } from '../glob.js';

export const NOTES_DIR = '.reins/notes';

/**
 * @typedef {{ file: string, paths: string[], body: string }} Note
 */

/**
 * Splits a markdown file into its YAML frontmatter and body.
 * @param {string} text
 * @returns {{ data: Record<string, any>, body: string } | null} null when there is no frontmatter
 * @throws {Error} when the frontmatter is not valid YAML
 */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const data = parse(m[1]) ?? {};
  return { data: typeof data === 'object' && !Array.isArray(data) ? data : {}, body: m[2] };
}

/**
 * @param {string} file repo-relative path of the note
 * @param {string} text
 * @returns {{ note: Note | null, problem: string | null }}
 */
export function parseNote(file, text) {
  let fm;
  let body;
  try {
    const parsed = parseFrontmatter(text);
    if (!parsed) return { note: null, problem: `${file}: missing frontmatter with "paths" (---\\npaths: ["src/x/**"]\\n---)` };
    fm = parsed.data;
    body = parsed.body;
  } catch (e) {
    return { note: null, problem: `${file}: frontmatter is not valid YAML (${e.message.split('\n')[0]})` };
  }
  const paths = typeof fm.paths === 'string' ? [fm.paths] : fm.paths;
  if (!Array.isArray(paths) || !paths.length || !paths.every((p) => typeof p === 'string' && p)) {
    return { note: null, problem: `${file}: frontmatter "paths" must be a non-empty list of globs` };
  }
  return { note: { file, paths, body: body.trim() }, problem: null };
}

/** Is this file under .reins/notes a note (not a template)? */
export const isNoteFile = (name) => name.endsWith('.md') && !name.startsWith('_');

/**
 * Notes that apply to a repo-relative file, in note order.
 * @param {string} file
 * @param {Note[]} notes
 */
export const notesFor = (file, notes) => notes.filter((n) => matchesAny(file, n.paths));
