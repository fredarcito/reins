// The small part of ActiveSupport's inflector the adapter needs: turning an association name (`has_many :line_items`)
// into the class it points to (`LineItem`). Candidates are only used when they resolve to a constant of the repo,
// so a wrong guess never becomes an edge.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * @typedef {{ acronyms: Map<string, string>, irregulars: Map<string, string> }} Inflections
 *   acronyms: lower case -> as written (`oauth` -> `OAuth`); irregulars: plural -> singular
 */

/**
 * Reads `inflect.acronym` and `inflect.irregular` from config/initializers/inflections.rb, as text.
 * @param {string} root
 * @returns {Inflections}
 */
export function readInflections(root) {
  const acronyms = new Map();
  const irregulars = new Map();
  const file = path.join(root, 'config/initializers/inflections.rb');
  if (existsSync(file)) {
    const source = readFileSync(file, 'utf8').replace(/^\s*#.*$/gm, '');
    for (const m of source.matchAll(/\.acronym\s*\(?\s*['"](\w+)['"]/g)) acronyms.set(m[1].toLowerCase(), m[1]);
    for (const m of source.matchAll(/\.irregular\s*\(?\s*['"](\w+)['"]\s*,\s*['"](\w+)['"]/g)) irregulars.set(m[2].toLowerCase(), m[1].toLowerCase());
  }
  return { acronyms, irregulars };
}

/**
 * `line_item` -> `LineItem`, `admin/user` -> `Admin::User`.
 * @param {string} name
 * @param {Inflections} inflections
 */
export function camelize(name, inflections) {
  return name
    .split('/')
    .map((segment) => segment.split('_').filter(Boolean).map((w) => inflections.acronyms.get(w) ?? w[0].toUpperCase() + w.slice(1)).join(''))
    .join('::');
}

/**
 * Possible singular forms of a plural snake_case name, most likely first; the name itself comes last.
 * @param {string} name
 * @param {Inflections} inflections
 * @returns {string[]}
 */
export function singulars(name, inflections) {
  const cut = name.lastIndexOf('_') + 1;
  const head = name.slice(0, cut);
  const word = name.slice(cut);
  const out = [];
  const irregular = inflections.irregulars.get(word);
  if (irregular) out.push(irregular);
  if (/ies$/.test(word)) out.push(word.replace(/ies$/, 'y'));
  if (/(ss|x|ch|sh|z)es$/.test(word)) out.push(word.replace(/es$/, ''));
  if (/ses$/.test(word)) out.push(word.replace(/es$/, ''), word.replace(/s$/, ''));
  if (/s$/.test(word) && !/ss$/.test(word)) out.push(word.replace(/s$/, ''));
  out.push(word);
  return [...new Set(out)].map((w) => head + w);
}
