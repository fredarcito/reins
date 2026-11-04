// Drafting a module note from the import graph: what the graph already knows (files, public API, who uses the
// module and what it depends on) is filled in; what only a person or agent knows is left as TODO lines.
import { matchesAny } from '../glob.js';

/** Lines starting with "TODO" (optionally as a list item) mark a section of a note that is still a draft. */
export const NOTE_TODO_RE = /^\s*(?:- )?TODO\b/m;

const MAX_KEY_FILES = 8;
const MAX_GROUPS = 6;

/** "a (3), b (1)" from a count map, most first. */
function counted(map, max) {
  const items = [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = items.slice(0, max).map(([k, n]) => `${k} (${n})`);
  if (items.length > max) shown.push(`+${items.length - max} more`);
  return shown.join(', ');
}

/**
 * What the graph says about a module.
 * @param {object} input
 * @param {string[]} input.paths globs of the module
 * @param {string[]} input.files every file of the repo (repo-relative)
 * @param {{ from: string, to: string }[]} input.edges
 * @param {(file: string) => string} input.label group name of a file outside the module (a domain, a folder…)
 */
export function summarizeModule({ paths, files, edges, label }) {
  const inside = (f) => matchesAny(f, paths);
  const own = files.filter(inside).sort();
  const importers = new Map(own.map((f) => [f, 0]));
  const usedBy = new Map();
  const dependsOn = new Map();
  for (const e of edges) {
    const a = inside(e.from);
    const b = inside(e.to);
    if (b && importers.has(e.to)) importers.set(e.to, importers.get(e.to) + 1);
    if (!a && b) usedBy.set(label(e.from), (usedBy.get(label(e.from)) ?? 0) + 1);
    if (a && !b) dependsOn.set(label(e.to), (dependsOn.get(label(e.to)) ?? 0) + 1);
  }
  const keyFiles = [...importers.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .slice(0, MAX_KEY_FILES)
    .map(([f]) => f);
  return { files: own, keyFiles, usedBy, dependsOn };
}

/**
 * Text of a new note.
 * @param {object} input
 * @param {string} input.name
 * @param {string[]} input.paths
 * @param {string[]} input.publicApi files of the public API that exist
 * @param {ReturnType<typeof summarizeModule> | null} input.summary null when there is no graph
 * @param {string} input.date YYYY-MM-DD
 */
export function draftNote({ name, paths, publicApi, summary, date }) {
  const code = (f) => `\`${f}\``;
  const map = [];
  if (publicApi.length) map.push(`- Public API: ${publicApi.map(code).join(', ')}`);
  if (summary) {
    const n = summary.files.length;
    const rest = n - summary.keyFiles.length;
    map.push(`- Files: ${n}. Most imported: ${summary.keyFiles.map(code).join(', ') || 'none'}${rest > 0 ? ` (+${rest} more)` : ''}`);
    map.push(`- Used by: ${counted(summary.usedBy, MAX_GROUPS) || 'nothing outside the module'}`);
    map.push(`- Depends on: ${counted(summary.dependsOn, MAX_GROUPS) || 'nothing outside the module'}`);
  }
  map.push('- TODO: one line per key file saying what it is for (only the ones worth knowing).');
  return [
    '---',
    `paths: ${JSON.stringify(paths)}`,
    '---',
    `# ${name}`,
    `<!-- Drafted by reins notes new on ${date}. Replace every TODO line; keep the note short (it is read whenever an agent works here). -->`,
    '',
    '## Purpose',
    'TODO: what this module does and for whom, in one or two lines.',
    '',
    '## Map',
    ...map,
    '',
    '## How it works',
    'TODO: the main flow in a few lines: where the data comes from, what changes it, who reads it.',
    '',
    '## Decisions',
    '- TODO YYYY-MM-DD: a decision and why it was made (what was rejected, and why).',
    '',
    '## Traps',
    '- TODO: what looks wrong but is intentional, and the invariants that must hold.',
    '',
  ].join('\n');
}
