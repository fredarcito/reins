// Module notes: .reins/notes/<module>.md with the paths they apply to in the frontmatter.
//
//   ---
//   paths: ["src/features/billing/**"]
//   ---
//   - 2026-11-01: prices are integer cents; never use floats.
//
// Files starting with "_" (templates, drafts) are not notes.
//
// A module with parts keeps their notes in a folder named after it, one level deep:
//   .reins/notes/companies.md            the module (shared context)
//   .reins/notes/companies/salaries.md   one of its parts (only what is specific to it)
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
 * Notes that apply to a repo-relative file, most general first (a module's note before the note of one of its
 * parts): ordered by the length of the longest glob that matches the file, ties in note order.
 * @param {string} file
 * @param {Note[]} notes
 */
export function notesFor(file, notes) {
  const reach = (n) => Math.max(...n.paths.filter((p) => matchesAny(file, [p])).map((p) => p.length));
  return notes.filter((n) => matchesAny(file, n.paths)).map((n) => ({ n, r: reach(n) })).sort((a, b) => a.r - b.r).map((x) => x.n);
}

/**
 * The module note a part belongs to, from its location: `.reins/notes/companies/salaries.md` ->
 * `.reins/notes/companies.md`. Null for a note at the top level (or nested deeper, which is not a valid layout).
 * @param {string} file repo-relative path of the note
 */
export function parentNoteFile(file) {
  const rel = file.slice(NOTES_DIR.length + 1).split('/');
  return rel.length === 2 ? `${NOTES_DIR}/${rel[0]}.md` : null;
}

/**
 * True if every glob of `part` lies inside a folder of `module` (one of its `<dir>/**` globs).
 * @param {{ paths: string[] }} part
 * @param {{ paths: string[] }} module
 */
export function pathsInside(part, module) {
  const dirs = module.paths.filter((p) => p.endsWith('/**')).map((p) => p.slice(0, -2));
  return part.paths.every((p) => dirs.some((d) => p.startsWith(d)));
}

/**
 * The first sentence of a note's `## Purpose` section, or null when there is none (or it is still a TODO). Used for
 * the AGENTS.md index, so a task reaches its module by what the module does, not only by its folder names.
 * @param {string} body
 * @param {number} [max] characters kept
 */
export function notePurpose(body, max = 110) {
  const m = /^##\s+Purpose\s*\n+([\s\S]*?)(?=\n##\s|$)/m.exec(body);
  if (!m) return null;
  const text = m[1].split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  if (!text || /\bTODO\b/.test(text)) return null;
  const sentence = /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
  return sentence.length > max ? `${sentence.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : sentence;
}
