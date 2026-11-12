// Which module notes a task is probably about, from its description alone: plain word matching, no model.
// `reins triage "<reason>"` without --files uses it so the agent reads the notes before it explores the code,
// instead of exploring to find out which files to pass.
//
// Words of the reason are compared with the note's file name, its paths, the repo folders it covers and its body.
// A folder name that matches (`JobMatches/` for "job matches") counts even when the note never mentions it: that
// is how a task reaches a module whose note fell behind its code.
import { matchesAny } from '../glob.js';

/** Words that say nothing about where a task lives (English and Spanish: agents write reasons in both). */
const STOPWORDS = new Set(
  (
    'the and for with from into onto that this these those when then than what which where while about after before ' +
    'add adds adding added fix fixes fixing fixed make makes change changes update updates new use uses using via ' +
    'remove delete rename move support allow show hide get set should would could need needs task file files code ' +
    'page component components function functions test tests bug issue feature work some all any not only also ' +
    'los las del una uno unos unas que con para por sin como cuando donde este esta estos estas ese esa eso ' +
    'agregar anadir quitar cambiar arreglar mover crear nuevo nueva nuevos nuevas hacer usar archivo archivos ' +
    'pagina componente funcion prueba pruebas error'
  ).split(' '),
);

/**
 * Lower-case words of a text, accents removed, camelCase and snake_case split: `JobMatches` -> job, matches.
 * Words shorter than 3 letters and stopwords are dropped.
 * @param {string} text
 * @returns {string[]}
 */
export function words(text) {
  return [...new Set(allWords(text))];
}

/** Like `words`, with repeats (to count how often a note mentions something). */
function allWords(text) {
  const split = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z\d]+/);
  return split.filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** A word without its usual English ending: matcher, matching, matches -> match. Never shorter than 3 letters. */
const stem = (w) => {
  const m = /^(.{3,}?)(ings|ing|ers|er|ed|es|s)$/.exec(w);
  return m ? m[1] : w;
};
/**
 * Same word for a task description: equal, one a prefix of the other with 4+ letters (match, matches), or the same
 * stem (matcher, matching; job, jobs). `company` and `compare` are not the same.
 */
const same = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) || stem(a) === stem(b);
const hits = (wanted, have) => wanted.filter((w) => have.some((h) => same(w, h)));

/** Points per reason word found in each place: names say where a module is, the body only mentions it. */
const WEIGHT = { name: 3, folder: 3, body: 1 };
/** Mentions in a note's body that count as one more word found. */
const OFTEN = 5;

/**
 * The notes a task description most likely refers to, best first.
 * @param {string} reason the task description
 * @param {{ file: string, paths: string[], body: string }[]} notes
 * @param {string[]} [folders] repo-relative folders of the repo (for folder names the note may not mention); the
 *   caller leaves out test and fixture folders
 * @param {{ limit?: number }} [opts]
 * @returns {{ note: { file: string, paths: string[], body: string }, score: number, matched: string[], folders: string[] }[]}
 */
export function suggestNotes(reason, notes, folders = [], opts = {}) {
  const wanted = words(reason);
  if (!wanted.length || !notes.length) return [];
  const limit = opts.limit ?? 3;
  // folders whose own name matches a word, with the notes that cover them (a file inside the folder)
  const folderHits = folders
    .map((dir) => ({ dir, matched: hits(wanted, words(dir.split('/').pop() ?? '')) }))
    .filter((f) => f.matched.length);

  const ranked = notes.map((note) => {
    const name = words(`${note.file.replace(/^.*\.reins\/notes\//, '')} ${note.paths.join(' ')}`);
    const fromName = hits(wanted, name);
    const own = folderHits.filter((f) => matchesAny(`${f.dir}/x`, note.paths));
    const fromFolders = [...new Set(own.flatMap((f) => f.matched))].filter((w) => !fromName.includes(w));
    const bodyWords = allWords(note.body);
    const fromBody = hits(wanted, [...new Set(bodyWords)]).filter((w) => !fromName.includes(w) && !fromFolders.includes(w));
    // a word the note keeps coming back to says more than one passing mention
    const often = fromBody.filter((w) => bodyWords.filter((b) => same(w, b)).length >= OFTEN).length;
    const score = fromName.length * WEIGHT.name + fromFolders.length * WEIGHT.folder + (fromBody.length + often) * WEIGHT.body;
    // the deepest matching folders first: they say where inside the module the task is
    const shown = own.sort((a, b) => b.matched.length - a.matched.length || b.dir.length - a.dir.length).slice(0, 3).map((f) => f.dir);
    return { note, score, matched: [...fromName, ...fromFolders, ...fromBody], folders: shown };
  });
  const scored = ranked.filter((r) => r.score > 0).sort((a, b) => b.score - a.score || a.note.file.localeCompare(b.note.file));
  if (!scored.length) return [];
  // a note far behind the best one is noise: one stray word in a long body
  const floor = Math.max(1, scored[0].score / 3);
  return scored.filter((r) => r.score >= floor).slice(0, limit);
}
